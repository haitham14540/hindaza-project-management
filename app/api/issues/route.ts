import { and, asc, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getBucket, getDb } from "@/db";
import { activityLogs, issueAttachments, issueCategories, issueComments, notifications, projectIssues, projectMembers, projects, tasks, users } from "@/db/schema";
import { getCurrentUser, isManagement, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";
import { ensureIssueCommentsStorage } from "@/lib/issue-comments-storage";
import { createNotifications } from "@/lib/notification-delivery";

export const dynamic = "force-dynamic";

const disciplines = ["Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure"] as const;
const statuses = ["open", "re_open", "closed"] as const;
const priorities = ["low", "medium", "high", "critical"] as const;
const ISSUE_QUERY_CHUNK_SIZE = 85;
const disciplineCodes: Record<string, string> = {
  Manager: "MGR",
  Architecture: "ARC",
  ID: "ID",
  Structure: "STR",
  Mechanical: "MECH",
  Electrical: "ELEC",
  Infrastructure: "INF",
};

function cleanText(value: unknown, max = 1_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, fallback: T[number]) {
  return typeof value === "string" && values.includes(value) ? value as T[number] : fallback;
}

function issueNumber(projectCode: string, discipline: string, sequence: number) {
  const projectPrefix = projectCode.replace(/[^A-Z0-9]/gi, "").slice(0, 4).toUpperCase();
  return `${projectPrefix}-${disciplineCodes[discipline] || "ARC"}-${String(sequence).padStart(3, "0")}`;
}

function operationalDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function validRaisedBy(db: Awaited<ReturnType<typeof getDb>>, email: string, discipline: (typeof disciplines)[number], projectCode: string) {
  if (!email) return null;
  const [account] = await db.select({ email: users.email, displayName: users.displayName, discipline: users.discipline, role: users.role }).from(users)
    .where(and(eq(users.email, email), eq(users.active, true))).limit(1);
  if (!account) return null;
  if (account.role === "owner") return account;
  const [raisedBy] = await db.select({ email: users.email, displayName: users.displayName, discipline: users.discipline, role: users.role }).from(users)
    .innerJoin(projectMembers, eq(projectMembers.employeeEmail, users.email))
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(users.email, email), eq(users.active, true), eq(users.discipline, discipline), eq(projects.code, projectCode))).limit(1);
  return raisedBy || null;
}

async function isAssignedToProject(db: Awaited<ReturnType<typeof getDb>>, email: string, projectCode: string) {
  const [row] = await db.select({ id: projectMembers.id }).from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projectMembers.employeeEmail, email), eq(projects.code, projectCode))).limit(1);
  return Boolean(row);
}

async function canEditIssue(db: Awaited<ReturnType<typeof getDb>>, currentUser: Awaited<ReturnType<typeof getCurrentUser>>, issue: typeof projectIssues.$inferSelect) {
  return currentUser.role === "owner" ||
    (currentUser.role === "manager" && Boolean(currentUser.discipline) && currentUser.discipline === issue.discipline && await isAssignedToProject(db, currentUser.email, issue.projectCode)) ||
    (currentUser.role === "member" && currentUser.email === issue.raisedByEmail);
}

async function notifyDisciplineManagers(
  db: Awaited<ReturnType<typeof getDb>>,
  actor: Awaited<ReturnType<typeof getCurrentUser>>,
  issue: typeof projectIssues.$inferSelect,
  type: "issue_created" | "issue_updated",
) {
  if (actor.role !== "member") return;
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, issue.projectCode)).limit(1);
  if (!project) return;
  const projectEmails = (await db.select({ email: projectMembers.employeeEmail }).from(projectMembers).where(eq(projectMembers.projectId, project.id))).map((row) => row.email);
  const projectHasDiscipline = projectEmails.length > 0 && Boolean((await db.select({ email: users.email }).from(users)
    .where(and(inArray(users.email, projectEmails), eq(users.discipline, issue.discipline), eq(users.active, true))).limit(1))[0]);
  const reviewers = await db.select({ email: users.email, role: users.role, discipline: users.discipline }).from(users)
    .where(and(inArray(users.role, ["owner", "manager"]), eq(users.active, true)));
  const recipients = reviewers.filter((reviewer) => reviewer.role === "owner" || (projectHasDiscipline && reviewer.discipline === issue.discipline && projectEmails.includes(reviewer.email)));
  if (!recipients.length) return;
  await createNotifications(db, recipients.map((recipient) => ({
    recipientEmail: recipient.email,
    type,
    issueId: issue.id,
    title: type === "issue_created" ? "New project issue · مشكلة مشروع جديدة" : "Project issue updated · تم تحديث مشكلة المشروع",
    message: `${issue.issueNumber} · ${actor.displayName} · ${type === "issue_created" ? "مشكلة جديدة" : "تم التحديث"}`,
  })));
}

async function rememberCategory(db: Awaited<ReturnType<typeof getDb>>, category: string, createdBy: string) {
  if (!category) return;
  await db.insert(issueCategories).values({ name: category, createdBy }).onConflictDoNothing({ target: issueCategories.name });
}

async function renumberAfter(db: Awaited<ReturnType<typeof getDb>>, projectCode: string, discipline: string, sequence: number) {
  const later = await db.select({ id: projectIssues.id, sequence: projectIssues.sequence })
    .from(projectIssues)
    .where(and(eq(projectIssues.projectCode, projectCode), eq(projectIssues.discipline, discipline), gt(projectIssues.sequence, sequence)))
    .orderBy(asc(projectIssues.sequence));
  for (const row of later) {
    const next = row.sequence - 1;
    await db.update(projectIssues).set({ sequence: next, issueNumber: issueNumber(projectCode, discipline, next), updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(projectIssues.id, row.id));
  }
}

async function issueRows(projectCode = "") {
  await ensureIssueCommentsStorage();
  const db = await getDb();
  const issues = await db.select().from(projectIssues)
    .where(projectCode ? eq(projectIssues.projectCode, projectCode) : undefined)
    .orderBy(asc(projectIssues.projectCode), asc(projectIssues.discipline), asc(projectIssues.sequence), asc(projectIssues.id));

  const attachments: (typeof issueAttachments.$inferSelect)[] = [];
  const notes: (typeof issueComments.$inferSelect)[] = [];
  const createdActivities: { issueId: number | null; actorEmail: string }[] = [];
  for (const issueIds of chunks(issues.map((issue) => issue.id), ISSUE_QUERY_CHUNK_SIZE)) {
    const [chunkAttachments, chunkNotes, chunkActivities] = await db.batch([
      db.select().from(issueAttachments).where(inArray(issueAttachments.issueId, issueIds)).orderBy(asc(issueAttachments.createdAt), asc(issueAttachments.id)),
      db.select().from(issueComments).where(inArray(issueComments.issueId, issueIds)).orderBy(asc(issueComments.createdAt), asc(issueComments.id)),
      db.select({ issueId: activityLogs.entityId, actorEmail: activityLogs.actorEmail }).from(activityLogs)
        .where(and(eq(activityLogs.entityType, "issue"), eq(activityLogs.action, "created"), inArray(activityLogs.entityId, issueIds)))
        .orderBy(asc(activityLogs.id)),
    ]);
    attachments.push(...chunkAttachments);
    notes.push(...chunkNotes);
    createdActivities.push(...chunkActivities);
  }

  const raisedByEmails = Array.from(new Set(issues.map((issue) => issue.raisedByEmail.toLowerCase()).filter(Boolean)));
  const raisedByAccounts: { email: string; displayName: string; profileImageKey: string }[] = [];
  for (const emailChunk of chunks(raisedByEmails, ISSUE_QUERY_CHUNK_SIZE)) {
    raisedByAccounts.push(...await db.select({ email: users.email, displayName: users.displayName, profileImageKey: users.profileImageKey })
      .from(users).where(inArray(users.email, emailChunk)));
  }
  const linkedTaskRows: { id: number; createdAt: string }[] = [];
  const linkedTaskIds = Array.from(new Set(issues.map((issue) => issue.convertedTaskId).filter((id): id is number => Boolean(id))));
  for (const taskIds of chunks(linkedTaskIds, ISSUE_QUERY_CHUNK_SIZE)) {
    linkedTaskRows.push(...await db.select({ id: tasks.id, createdAt: tasks.createdAt }).from(tasks).where(inArray(tasks.id, taskIds)));
  }
  const linkedTaskCreatedAt = new Map(linkedTaskRows.map((task) => [task.id, task.createdAt]));
  const byIssue = new Map<number, typeof attachments>();
  for (const attachment of attachments) {
    const rows = byIssue.get(attachment.issueId);
    if (rows) rows.push(attachment); else byIssue.set(attachment.issueId, [attachment]);
  }
  const notesByIssue = new Map<number, typeof notes>();
  for (const note of notes) {
    const rows = notesByIssue.get(note.issueId);
    if (rows) rows.push(note); else notesByIssue.set(note.issueId, [note]);
  }
  const creatorByIssue = new Map<number, string>();
  for (const activity of createdActivities) if (activity.issueId && !creatorByIssue.has(activity.issueId)) creatorByIssue.set(activity.issueId, activity.actorEmail);
  const raisedByAccount = new Map(raisedByAccounts.map((account) => [account.email.toLowerCase(), account]));
  const normalizedIssues = issues.map((issue) => ({ ...issue, issueNumber: issueNumber(issue.projectCode, issue.discipline, issue.sequence) }));
  return normalizedIssues.map((issue) => {
    const account = raisedByAccount.get(issue.raisedByEmail.toLowerCase());
    return {
      ...issue,
      raisedByName: account?.displayName || issue.raisedByName,
      raisedByProfileImageKey: account?.profileImageKey || "",
      createdByEmail: creatorByIssue.get(issue.id) || "",
      linkedTaskCreatedAt: issue.convertedTaskId ? linkedTaskCreatedAt.get(issue.convertedTaskId) || "" : "",
      attachments: byIssue.get(issue.id) || [],
      notes: notesByIssue.get(issue.id) || [],
    };
  });
}

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const db = await getDb();
    const url = new URL(request.url);
    const requestedProject = cleanText(url.searchParams.get("project"), 80).toUpperCase();
    const summaryOnly = url.searchParams.get("summary") === "1";
    const reportOnly = url.searchParams.get("report") === "1";
    const memberships = currentUser.role === "owner" ? [] : await db.select({ code: projects.code }).from(projectMembers).innerJoin(projects, eq(projectMembers.projectId, projects.id)).where(eq(projectMembers.employeeEmail, currentUser.email));
    const allowedCodes = new Set(memberships.map((row) => row.code));
    if (requestedProject && currentUser.role !== "owner" && !allowedCodes.has(requestedProject)) {
      return Response.json({ error: "You do not have access to this project." }, { status: 403 });
    }

    if (summaryOnly || reportOnly) {
      const summaryRows = await db.select({
        id: projectIssues.id,
        issueNumber: projectIssues.issueNumber,
        sequence: projectIssues.sequence,
        projectCode: projectIssues.projectCode,
        status: projectIssues.status,
        discipline: projectIssues.discipline,
        description: projectIssues.description,
        priority: projectIssues.priority,
        issueDate: projectIssues.issueDate,
        resolvedDate: projectIssues.resolvedDate,
        raisedByEmail: projectIssues.raisedByEmail,
        raisedByName: projectIssues.raisedByName,
        createdAt: projectIssues.createdAt,
        updatedAt: projectIssues.updatedAt,
      }).from(projectIssues)
        .where(requestedProject ? eq(projectIssues.projectCode, requestedProject) : undefined)
        .orderBy(asc(projectIssues.projectCode), asc(projectIssues.discipline), asc(projectIssues.sequence), asc(projectIssues.id));
      const visibleSummary = currentUser.role === "owner" ? summaryRows : summaryRows.filter((issue) => allowedCodes.has(issue.projectCode));
      if (reportOnly) {
        const attachmentCountByIssue = new Map<number, number>();
        for (const issueIds of chunks(visibleSummary.map((issue) => issue.id), ISSUE_QUERY_CHUNK_SIZE)) {
          const counts = await db.select({ issueId: issueAttachments.issueId, total: count() })
            .from(issueAttachments)
            .where(inArray(issueAttachments.issueId, issueIds))
            .groupBy(issueAttachments.issueId);
          for (const row of counts) attachmentCountByIssue.set(row.issueId, row.total);
        }
        return Response.json({
          issues: visibleSummary.map((issue) => ({
            ...issue,
            issueNumber: issueNumber(issue.projectCode, issue.discipline, issue.sequence),
            attachmentCount: attachmentCountByIssue.get(issue.id) || 0,
            attachments: [],
            notes: [],
          })),
        }, { headers: { "Cache-Control": "private, no-store" } });
      }
      return Response.json({
        issues: visibleSummary.map((issue) => ({ ...issue, issueNumber: issueNumber(issue.projectCode, issue.discipline, issue.sequence) })),
      }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const allIssues = await issueRows(requestedProject);
    const savedCategories = await db.select({ name: issueCategories.name }).from(issueCategories).orderBy(asc(issueCategories.name));
    const issues = currentUser.role === "owner" ? allIssues : allIssues.filter((issue) => allowedCodes.has(issue.projectCode));
    const categories = Array.from(new Set(["Coordination", "Design Issue", "Site Issue", "Client Comment", "Clash", ...savedCategories.map((item) => item.name), ...issues.map((issue) => issue.category).filter(Boolean)])).sort((a, b) => a.localeCompare(b));
    return Response.json({ issues, categories });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    console.error("Unable to load project issues", error);
    return Response.json({ error: "Unable to load project issues right now. Please try again." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    await ensureIssueCommentsStorage();
    const payload = await request.json() as Record<string, unknown>;
    const projectCode = cleanText(payload.projectCode, 80).toUpperCase();
    const requestedDiscipline = enumValue(payload.discipline, disciplines, "Architecture");
    const discipline = currentUser.role === "owner"
      ? requestedDiscipline
      : enumValue(currentUser.discipline, disciplines, requestedDiscipline);
    if (currentUser.role !== "owner" && currentUser.discipline !== discipline) {
      return Response.json({ error: "Users can create issues only in their discipline." }, { status: 403 });
    }
    const description = cleanText(payload.description, 2_000);
    if (!projectCode || !description) return Response.json({ error: "Project and issue description are required." }, { status: 400 });

    const db = await getDb();
    const [project] = await db.select({ code: projects.code }).from(projects).where(eq(projects.code, projectCode)).limit(1);
    if (!project) return Response.json({ error: "Select an existing project." }, { status: 400 });
    if (currentUser.role === "manager" && !(await isAssignedToProject(db, currentUser.email, projectCode))) return Response.json({ error: "Managers can edit issues only within assigned projects." }, { status: 403 });
    if (currentUser.role !== "owner" && !(await isAssignedToProject(db, currentUser.email, projectCode))) return Response.json({ error: "You can create issues only in projects you are assigned to." }, { status: 403 });
    const [last] = await db.select({ sequence: projectIssues.sequence })
      .from(projectIssues)
      .where(and(eq(projectIssues.projectCode, projectCode), eq(projectIssues.discipline, discipline)))
      .orderBy(desc(projectIssues.sequence))
      .limit(1);
    const sequence = (last?.sequence || 0) + 1;
    const status = "open" as const;
    const raisedByEmail = currentUser.role === "member" ? currentUser.email : cleanText(payload.raisedByEmail, 180).toLowerCase();
    const raisedBy = await validRaisedBy(db, raisedByEmail, discipline, projectCode);
    if (!raisedBy) return Response.json({ error: "Select an active project team member from the same discipline for Raised by." }, { status: 400 });
    const category = cleanText(payload.category, 120);
    const inserted = await db.insert(projectIssues).values({
      issueNumber: issueNumber(projectCode, discipline, sequence),
      sequence,
      projectCode,
      discipline,
      status,
      description,
      category,
      priority: enumValue(payload.priority, priorities, "medium"),
      assigneeEmail: "",
      raisedByEmail: raisedBy.email,
      raisedByName: raisedBy.displayName,
      issueDate: cleanText(payload.issueDate, 10) || new Date().toISOString().slice(0, 10),
      resolvedDate: "",
      comments: cleanText(payload.comments, 4_000),
      clientReply: "",
    }).returning();
    await rememberCategory(db, category, currentUser.email);
    await recordActivity(db, currentUser, { action: "created", entityType: "issue", entityId: inserted[0].id, entityLabel: inserted[0].issueNumber, projectCode, details: description });
    const initialNote = cleanText(payload.comments, 2_000);
    const notes = initialNote ? await db.insert(issueComments).values({ issueId: inserted[0].id, section: "internal", authorEmail: currentUser.email, authorName: currentUser.displayName, body: initialNote }).returning() : [];
    await notifyDisciplineManagers(db, currentUser, inserted[0], "issue_created");
    return Response.json({ issue: { ...inserted[0], createdByEmail: currentUser.email, attachments: [], notes } }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    console.error("Unable to create project issue", error);
    return Response.json({ error: "Unable to create the project issue right now. Please try again." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    await ensureIssueCommentsStorage();
    const payload = await request.json() as Record<string, unknown>;
    const id = Number(payload.id);
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid issue id." }, { status: 400 });
    const db = await getDb();
    const [existing] = await db.select().from(projectIssues).where(eq(projectIssues.id, id)).limit(1);
    if (!existing) return Response.json({ error: "Project issue not found." }, { status: 404 });
    if (!(await canEditIssue(db, currentUser, existing))) {
      return Response.json({ error: "You cannot edit this project issue." }, { status: 403 });
    }
    const management = isManagement(currentUser);
    const requestedStatus = enumValue(payload.status, statuses, existing.status);
    const status = existing.status === "closed"
      ? requestedStatus === "re_open" ? "re_open" : "closed"
      : existing.status === "re_open"
        ? requestedStatus === "closed" ? "closed" : "re_open"
        : requestedStatus === "closed" ? "closed" : "open";
    const coreLocked = existing.status === "closed" && status !== "re_open";
    const projectCode = management && !coreLocked ? cleanText(payload.projectCode, 80).toUpperCase() || existing.projectCode : existing.projectCode;
    const discipline = management && !coreLocked
      ? currentUser.role === "owner"
        ? enumValue(payload.discipline, disciplines, existing.discipline === "Manager" ? "Architecture" : existing.discipline as (typeof disciplines)[number])
        : enumValue(currentUser.discipline, disciplines, existing.discipline === "Manager" ? "Architecture" : existing.discipline as (typeof disciplines)[number])
      : existing.discipline as (typeof disciplines)[number];
    const [project] = await db.select({ code: projects.code }).from(projects).where(eq(projects.code, projectCode)).limit(1);
    if (!project) return Response.json({ error: "Select an existing project." }, { status: 400 });
    if (currentUser.role === "manager" && !(await isAssignedToProject(db, currentUser.email, projectCode))) return Response.json({ error: "Managers can edit issues only within assigned projects." }, { status: 403 });
    const raisedByEmail = management && !coreLocked ? cleanText(payload.raisedByEmail, 180).toLowerCase() || existing.raisedByEmail : existing.raisedByEmail;
    const raisedByChanged = raisedByEmail !== existing.raisedByEmail || projectCode !== existing.projectCode || discipline !== existing.discipline;
    const raisedBy = management && !coreLocked && raisedByChanged
      ? await validRaisedBy(db, raisedByEmail, discipline, projectCode)
      : { email: existing.raisedByEmail, displayName: existing.raisedByName };
    if (!raisedBy) return Response.json({ error: "Select an active project team member from the same discipline for Raised by." }, { status: 400 });
    const category = coreLocked ? existing.category : cleanText(payload.category, 120);
    const description = coreLocked ? existing.description : cleanText(payload.description, 2_000) || existing.description;
    const groupChanged = projectCode !== existing.projectCode || discipline !== existing.discipline;
    let nextSequence = existing.sequence;
    let nextIssueNumber = existing.issueNumber;
    if (groupChanged) {
      await db.update(projectIssues).set({ projectCode, discipline, sequence: 0, issueNumber: `MOVING-${id}-${Date.now()}` }).where(eq(projectIssues.id, id));
      await renumberAfter(db, existing.projectCode, existing.discipline, existing.sequence);
      const [last] = await db.select({ sequence: projectIssues.sequence }).from(projectIssues)
        .where(and(eq(projectIssues.projectCode, projectCode), eq(projectIssues.discipline, discipline), gt(projectIssues.sequence, 0)))
        .orderBy(desc(projectIssues.sequence)).limit(1);
      nextSequence = (last?.sequence || 0) + 1;
      nextIssueNumber = issueNumber(projectCode, discipline, nextSequence);
    }
    const updated = await db.update(projectIssues).set({
      projectCode,
      discipline,
      sequence: nextSequence,
      issueNumber: nextIssueNumber,
      status,
      description,
      category,
      priority: coreLocked ? existing.priority : enumValue(payload.priority, priorities, existing.priority),
      assigneeEmail: existing.assigneeEmail,
      raisedByEmail: raisedBy.email,
      raisedByName: raisedBy.displayName,
      issueDate: coreLocked ? existing.issueDate : cleanText(payload.issueDate, 10) || existing.issueDate,
      resolvedDate: status === "closed" ? cleanText(payload.resolvedDate, 10) || (existing.status === "closed" && existing.resolvedDate ? existing.resolvedDate : operationalDate()) : "",
      comments: existing.comments,
      clientReply: cleanText(payload.clientReply, 4_000),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(projectIssues.id, id)).returning();
    await rememberCategory(db, category, currentUser.email);
    await recordActivity(db, currentUser, { action: "updated", entityType: "issue", entityId: id, entityLabel: updated[0].issueNumber, projectCode, details: description });
    const [attachments, notes, createdActivities] = await db.batch([
      db.select().from(issueAttachments).where(eq(issueAttachments.issueId, id)).orderBy(asc(issueAttachments.createdAt)),
      db.select().from(issueComments).where(eq(issueComments.issueId, id)).orderBy(asc(issueComments.createdAt), asc(issueComments.id)),
      db.select({ actorEmail: activityLogs.actorEmail }).from(activityLogs)
        .where(and(eq(activityLogs.entityType, "issue"), eq(activityLogs.entityId, id), eq(activityLogs.action, "created")))
        .orderBy(asc(activityLogs.id)).limit(1),
    ]);
    return Response.json({ issue: { ...updated[0], createdByEmail: createdActivities[0]?.actorEmail || "", attachments, notes } });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    console.error("Unable to update project issue", error);
    return Response.json({ error: "Unable to update the project issue right now. Please try again." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    await ensureIssueCommentsStorage();
    if (!isManagement(currentUser)) return Response.json({ error: "Only management can delete project issues." }, { status: 403 });
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid issue id." }, { status: 400 });
    const db = await getDb();
    const [existing] = await db.select().from(projectIssues).where(eq(projectIssues.id, id)).limit(1);
    if (!existing) return Response.json({ error: "Project issue not found." }, { status: 404 });
    if (currentUser.role === "manager" && (currentUser.discipline !== existing.discipline || !(await isAssignedToProject(db, currentUser.email, existing.projectCode)))) {
      return Response.json({ error: "Managers can delete issues only in their discipline." }, { status: 403 });
    }
    const attachments = await db.select().from(issueAttachments).where(eq(issueAttachments.issueId, id));
    if (attachments.length) {
      const bucket = await getBucket();
      await bucket.delete(attachments.map((attachment) => attachment.objectKey));
    }
    await db.delete(issueAttachments).where(eq(issueAttachments.issueId, id));
    await db.delete(issueComments).where(eq(issueComments.issueId, id));
    await db.delete(notifications).where(eq(notifications.issueId, id));
    await db.delete(projectIssues).where(eq(projectIssues.id, id));
    await renumberAfter(db, existing.projectCode, existing.discipline, existing.sequence);
    await recordActivity(db, currentUser, { action: "deleted", entityType: "issue", entityId: id, entityLabel: existing.issueNumber, projectCode: existing.projectCode, details: existing.description });
    return Response.json({ ok: true, issues: await issueRows(existing.projectCode) });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    console.error("Unable to delete project issue", error);
    return Response.json({ error: "Unable to delete the project issue right now. Please try again." }, { status: 500 });
  }
}
