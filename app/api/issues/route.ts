import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getBucket, getDb } from "@/db";
import { activityLogs, issueAttachments, issueCategories, issueComments, notifications, projectIssues, projectMembers, projects, users } from "@/db/schema";
import { getCurrentUser, isManagement, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";
import { ensureIssueCommentsStorage } from "@/lib/issue-comments-storage";

export const dynamic = "force-dynamic";

const disciplines = ["Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure"] as const;
const statuses = ["open", "re_open", "closed"] as const;
const priorities = ["low", "medium", "high", "critical"] as const;
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
  await db.insert(notifications).values(recipients.map((recipient) => ({
    recipientEmail: recipient.email,
    type,
    issueId: issue.id,
    title: type === "issue_created" ? "New project issue" : "Project issue updated",
    message: `${issue.issueNumber} · ${actor.displayName}`,
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

async function issueRows() {
  await ensureIssueCommentsStorage();
  const db = await getDb();
  // Keep D1 reads in bounded batches. The categories request runs alongside
  // this function, so adding every issue dependency to one Promise.all can
  // exhaust the Worker's concurrent subrequest allowance and leave the client
  // waiting indefinitely.
  const issues = await db.select().from(projectIssues)
    .orderBy(asc(projectIssues.projectCode), asc(projectIssues.discipline), asc(projectIssues.sequence), asc(projectIssues.id));
  const [attachments, notes, createdActivities] = await Promise.all([
    db.select().from(issueAttachments).orderBy(asc(issueAttachments.createdAt), asc(issueAttachments.id)),
    db.select().from(issueComments).orderBy(asc(issueComments.createdAt), asc(issueComments.id)),
    db.select({ issueId: activityLogs.entityId, actorEmail: activityLogs.actorEmail }).from(activityLogs)
      .where(and(eq(activityLogs.entityType, "issue"), eq(activityLogs.action, "created"))).orderBy(asc(activityLogs.id)),
  ]);
  const raisedByEmails = Array.from(new Set(issues.map((issue) => issue.raisedByEmail.toLowerCase()).filter(Boolean)));
  const raisedByAccounts = raisedByEmails.length
    ? await db.select({ email: users.email, displayName: users.displayName, profileImageKey: users.profileImageKey })
      .from(users).where(inArray(users.email, raisedByEmails))
    : [];
  const byIssue = new Map<number, typeof attachments>();
  for (const attachment of attachments) byIssue.set(attachment.issueId, [...(byIssue.get(attachment.issueId) || []), attachment]);
  const notesByIssue = new Map<number, typeof notes>();
  for (const note of notes) notesByIssue.set(note.issueId, [...(notesByIssue.get(note.issueId) || []), note]);
  const creatorByIssue = new Map<number, string>();
  for (const activity of createdActivities) if (activity.issueId && !creatorByIssue.has(activity.issueId)) creatorByIssue.set(activity.issueId, activity.actorEmail);
  const raisedByAccount = new Map(raisedByAccounts.map((account) => [account.email.toLowerCase(), account]));
  const normalizedIssues = [];
  for (const issue of issues) {
    const normalizedNumber = issueNumber(issue.projectCode, issue.discipline, issue.sequence);
    if (issue.issueNumber !== normalizedNumber) {
      await db.update(projectIssues).set({ issueNumber: normalizedNumber, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(projectIssues.id, issue.id));
    }
    normalizedIssues.push({ ...issue, issueNumber: normalizedNumber });
  }
  return normalizedIssues.map((issue) => {
    const account = raisedByAccount.get(issue.raisedByEmail.toLowerCase());
    return {
      ...issue,
      raisedByName: account?.displayName || issue.raisedByName,
      raisedByProfileImageKey: account?.profileImageKey || "",
      createdByEmail: creatorByIssue.get(issue.id) || "",
      attachments: byIssue.get(issue.id) || [],
      notes: notesByIssue.get(issue.id) || [],
    };
  });
}

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const db = await getDb();
    const [allIssues, savedCategories] = await Promise.all([
      issueRows(),
      db.select({ name: issueCategories.name }).from(issueCategories).orderBy(asc(issueCategories.name)),
    ]);
    const memberships = currentUser.role === "owner" ? [] : await db.select({ code: projects.code }).from(projectMembers).innerJoin(projects, eq(projectMembers.projectId, projects.id)).where(eq(projectMembers.employeeEmail, currentUser.email));
    const allowedCodes = new Set(memberships.map((row) => row.code));
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
      clientReply: existing.clientReply,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(projectIssues.id, id)).returning();
    await rememberCategory(db, category, currentUser.email);
    await recordActivity(db, currentUser, { action: "updated", entityType: "issue", entityId: id, entityLabel: updated[0].issueNumber, projectCode, details: description });
    const [attachments, notes] = await Promise.all([
      db.select().from(issueAttachments).where(eq(issueAttachments.issueId, id)).orderBy(asc(issueAttachments.createdAt)),
      db.select().from(issueComments).where(eq(issueComments.issueId, id)).orderBy(asc(issueComments.createdAt), asc(issueComments.id)),
    ]);
    return Response.json({ issue: { ...updated[0], createdByEmail: existing.id ? (await db.select({ actorEmail: activityLogs.actorEmail }).from(activityLogs).where(and(eq(activityLogs.entityType, "issue"), eq(activityLogs.entityId, existing.id), eq(activityLogs.action, "created"))).orderBy(asc(activityLogs.id)).limit(1))[0]?.actorEmail || "" : "", attachments, notes } });
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
    return Response.json({ ok: true, issues: await issueRows() });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    console.error("Unable to delete project issue", error);
    return Response.json({ error: "Unable to delete the project issue right now. Please try again." }, { status: 500 });
  }
}
