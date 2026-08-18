import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getBucket, getDb } from "@/db";
import { notifications, projectIssues, projectMembers, projects, taskAttachments, taskComments, taskSubtasks, taskTimeEntries, tasks, users } from "@/db/schema";
import { getCurrentUser, isManagement, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";
import { createNotifications } from "@/lib/notification-delivery";
import { canManageTask } from "@/lib/task-access";

export const dynamic = "force-dynamic";

const priorities = ["high", "medium", "low"] as const;
const statuses = [
  "not_started",
  "in_progress",
  "paused",
  "blocked",
  "needs_revision",
  "done",
] as const;
const checks = ["new", "pending", "approved", "returned"] as const;

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 999) : 0;
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  values: T,
  fallback: T[number],
) {
  return typeof value === "string" && values.includes(value) ? value : fallback;
}

type Database = Awaited<ReturnType<typeof getDb>>;
type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;

async function assignableEmployee(db: Database, currentUser: CurrentUser, employeeEmail: string) {
  const row = await db.select({ role: users.role, discipline: users.discipline })
    .from(users)
    .where(and(eq(users.email, employeeEmail), eq(users.active, true)))
    .limit(1);
  if (!row[0] || (row[0].role !== "member" && row[0].role !== "manager")) return false;
  return currentUser.role === "owner" || (currentUser.role === "manager" && Boolean(currentUser.discipline) && row[0].discipline === currentUser.discipline);
}

async function relevantReviewers(db: Database, employeeEmail: string, projectCode: string) {
  const [employee] = await db.select({ discipline: users.discipline }).from(users).where(eq(users.email, employeeEmail)).limit(1);
  const reviewers = await db.select({ email: users.email, role: users.role, discipline: users.discipline })
    .from(users)
    .where(and(inArray(users.role, ["owner", "manager"]), eq(users.active, true)));
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, projectCode)).limit(1);
  const memberEmails = project ? new Set((await db.select({ email: projectMembers.employeeEmail }).from(projectMembers).where(eq(projectMembers.projectId, project.id))).map((row) => row.email)) : new Set<string>();
  return reviewers.filter((reviewer) => reviewer.role === "owner" || (Boolean(employee?.discipline) && reviewer.discipline === employee.discipline && (projectCode === "PERSONAL" || memberEmails.has(reviewer.email))));
}

async function canAdoptSubmittedTask(db: Database, currentUser: CurrentUser, task: typeof tasks.$inferSelect) {
  if (!task.submittedToManager || task.visibility !== "private") return false;
  if (currentUser.role === "owner") return true;
  if (currentUser.role !== "manager" || !currentUser.discipline) return false;
  const [employee] = await db.select({ discipline: users.discipline }).from(users).where(eq(users.email, task.employeeEmail)).limit(1);
  return employee?.discipline === currentUser.discipline && (task.project === "PERSONAL" || await canManageProject(db, currentUser, task.project));
}

async function isProjectMember(db: Database, projectCode: string, employeeEmail: string) {
  if (projectCode === "PERSONAL") return true;
  const row = await db.select({ id: projectMembers.id })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projects.code, projectCode), eq(projectMembers.employeeEmail, employeeEmail)))
    .limit(1);
  return Boolean(row[0]);
}

async function canManageProject(db: Database, currentUser: CurrentUser, projectCode: string) {
  if (currentUser.role === "owner") return true;
  if (currentUser.role !== "manager") return false;
  return isProjectMember(db, projectCode, currentUser.email);
}

async function canManageExistingTask(db: Database, currentUser: CurrentUser, task: typeof tasks.$inferSelect) {
  return canManageTask(db, currentUser, task);
}

function elapsedSeconds(startedAt: string, endedAt: string) {
  const seconds = Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

async function isActiveProject(db: Database, projectCode: string) {
  if (projectCode === "PERSONAL") return true;
  const [project] = await db.select({ status: projects.status }).from(projects).where(eq(projects.code, projectCode)).limit(1);
  return project?.status === "active";
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const payload = (await request.json()) as Record<string, unknown>;
    const title = text(payload.title, 180);
    const requestedPrivate = payload.visibility === "private";
    const project = text(payload.project, 80) || (currentUser.role === "member" || requestedPrivate ? "PERSONAL" : "");
    if (!title || !project) {
      return Response.json(
        { error: "Task title and project are required." },
        { status: 400 },
      );
    }

    const management = isManagement(currentUser);
    const requestedEmployeeEmail = management && !requestedPrivate ? text(payload.employeeEmail, 180).toLowerCase() : currentUser.email;
    const selfAssigned = management && !requestedPrivate && requestedEmployeeEmail === currentUser.email;
    const employeeName = selfAssigned ? currentUser.displayName : management && !requestedPrivate ? text(payload.employeeName, 120) : currentUser.displayName;
    const employeeEmail = selfAssigned ? currentUser.email : requestedEmployeeEmail;
    if (!employeeName || !employeeEmail) {
      return Response.json({ error: "Select an employee for this task." }, { status: 400 });
    }
    const db = await getDb();
    if (!(await isActiveProject(db, project))) {
      return Response.json({ error: "New tasks can be created only in active projects." }, { status: 409 });
    }
    if (currentUser.role === "manager" && !(await canManageProject(db, currentUser, project))) {
      return Response.json({ error: "Managers can create tasks only in projects they are assigned to." }, { status: 403 });
    }
    if (management && !requestedPrivate && !selfAssigned && !(await assignableEmployee(db, currentUser, employeeEmail))) {
      return Response.json({ error: currentUser.role === "manager" ? "You can assign tasks only to employees in your discipline." : "Select an active employee account." }, { status: 403 });
    }
    if (!requestedPrivate && !selfAssigned && !(await isProjectMember(db, project, employeeEmail))) {
      return Response.json({ error: "Select an employee assigned to this project." }, { status: 400 });
    }
    const startDate = text(payload.startDate, 10);
    const taskDate = text(payload.taskDate, 10) || new Date().toISOString().slice(0, 10);
    if (startDate && taskDate && startDate > taskDate) {
      return Response.json({ error: "Start Date must be on or before Due Date. · يجب أن يكون تاريخ البداية قبل أو في تاريخ الإنجاز المتوقع." }, { status: 400 });
    }
    const inserted = await db
      .insert(tasks)
      .values({
        startDate,
        taskDate,
        employeeName,
        employeeEmail,
        project,
        title,
        expectedOutput: text(payload.expectedOutput, 800),
        priority: enumValue(payload.priority, priorities, "medium") as
          | "high"
          | "medium"
          | "low",
        plannedHours: number(payload.plannedHours),
        startTime: "",
        endTime: "",
        actualHours: 0,
        status: enumValue(payload.status, statuses, "not_started") as
          | "not_started"
          | "in_progress"
          | "paused"
          | "blocked"
          | "needs_revision"
          | "done",
        managerCheck: "new",
        managerNote: "",
        visibility: currentUser.role === "member" || requestedPrivate ? "private" : "team",
        submittedToManager: false,
        createdBy: currentUser.email,
      })
      .returning();
    const initialSubtaskTitles = Array.isArray(payload.subtasks)
      ? payload.subtasks.map((value) => text(value, 240)).filter(Boolean).slice(0, 50)
      : [];
    const createdSubtasks = initialSubtaskTitles.length
      ? await db.insert(taskSubtasks).values(initialSubtaskTitles.map((subtaskTitle) => ({ taskId: inserted[0].id, title: subtaskTitle, createdBy: currentUser.email }))).returning()
      : [];
    const initialNote = text(payload.initialNote, 2_000);
    const createdComments = initialNote
      ? await db.insert(taskComments).values({ taskId: inserted[0].id, authorEmail: currentUser.email, authorName: currentUser.displayName, body: initialNote }).returning()
      : [];

    if (management && !requestedPrivate && employeeEmail !== currentUser.email) {
      await createNotifications(db, {
        recipientEmail: employeeEmail,
        type: "task_assigned",
        taskId: inserted[0].id,
        title: "New task assigned · تم إسناد مهمة جديدة",
        message: `${title} · ${project} · مهمة جديدة`,
        actorName: currentUser.displayName,
        actorLabel: "Created By",
      });
    }

    await recordActivity(db, currentUser, { action: "created", entityType: "task", entityId: inserted[0].id, entityLabel: inserted[0].title, projectCode: inserted[0].project, details: `Created by ${currentUser.displayName} · Assigned to ${inserted[0].employeeName}` });

    return Response.json({ task: inserted[0], subtasks: createdSubtasks, comments: createdComments }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    console.error("Unable to create task", error);
    return Response.json(
      { error: "Unable to create the task right now. Please retry. · تعذر إنشاء المهمة حاليًا، يرجى إعادة المحاولة." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const payload = (await request.json()) as Record<string, unknown>;
    const id = Number(payload.id);
    if (!Number.isInteger(id)) {
      return Response.json({ error: "Invalid task id." }, { status: 400 });
    }

    const db = await getDb();
    const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!existing[0]) {
      return Response.json({ error: "Task not found." }, { status: 404 });
    }
    if (payload.action === "update_completion") {
      const completionPercent = Number(payload.completionPercent);
      if (![0, 25, 50, 75, 100].includes(completionPercent)) {
        return Response.json({ error: "Select a valid completion percentage." }, { status: 400 });
      }
      if (!existing[0].employeeEmail || existing[0].employeeEmail.toLowerCase() !== currentUser.email.toLowerCase()) {
        return Response.json({ error: "Only the assigned user can update task completion." }, { status: 403 });
      }
      if (existing[0].managerCheck === "pending" || existing[0].managerCheck === "approved") {
        return Response.json({ error: "Task completion is locked during or after manager review." }, { status: 409 });
      }
      if (completionPercent === 100) {
        return Response.json({ error: "Complete the task through the review submission workflow." }, { status: 409 });
      }
      const [updatedTask] = await db.update(tasks).set({ completionPercent, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(tasks.id, id)).returning();
      await recordActivity(db, currentUser, { action: "updated", entityType: "task", entityId: id, entityLabel: updatedTask.title, projectCode: updatedTask.project, details: `Completion updated to ${completionPercent}%` });
      return Response.json({ task: updatedTask });
    }
    if (payload.action === "gantt_dates") {
      if (!(await canManageTask(db, currentUser, existing[0]))) {
        return Response.json({ error: "Only authorized management can adjust this task timeline." }, { status: 403 });
      }
      const startDate = text(payload.startDate, 10);
      const taskDate = text(payload.taskDate, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(taskDate) || startDate > taskDate) {
        return Response.json({ error: "Start Date must be on or before Due Date." }, { status: 400 });
      }
      const [updatedTask] = await db.update(tasks).set({ startDate, taskDate, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(tasks.id, id)).returning();
      await recordActivity(db, currentUser, { action: "updated", entityType: "task", entityId: id, entityLabel: updatedTask.title, projectCode: updatedTask.project, details: `Gantt dates changed to ${startDate} — ${taskDate}` });
      return Response.json({ task: updatedTask });
    }
    if (payload.action === "submit_to_manager") {
      const canSubmit = currentUser.role === "member"
        && existing[0].visibility === "private"
        && existing[0].createdBy === currentUser.email
        && existing[0].employeeEmail === currentUser.email;
      if (!canSubmit) {
        return Response.json({ error: "Only the owner can submit this private task." }, { status: 403 });
      }
      const submitted = await db
        .update(tasks)
        .set({
          submittedToManager: true,
          managerCheck: "new",
          originatedByEmail: existing[0].originatedByEmail || currentUser.email,
          originatedByName: existing[0].originatedByName || currentUser.displayName,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(tasks.id, id))
        .returning();
      const managers = await relevantReviewers(db, existing[0].employeeEmail, existing[0].project);
      if (managers.length) {
        await createNotifications(db, managers.map((manager) => ({
          recipientEmail: manager.email,
          type: "private_task_submitted" as const,
          taskId: id,
          title: "Private task shared for assignment · تمت مشاركة مهمة خاصة للإسناد",
          message: `${existing[0].title} · ${currentUser.displayName} · مرسلة من الموظف`,
          actorName: currentUser.displayName,
        })));
      }
      await recordActivity(db, currentUser, { action: "updated", entityType: "task", entityId: id, entityLabel: submitted[0].title, projectCode: submitted[0].project, details: "Private task shared with management" });
      return Response.json({ task: submitted[0] });
    }
    const adoptingSubmittedTask = await canAdoptSubmittedTask(db, currentUser, existing[0]);
    const scopedManagement = await canManageExistingTask(db, currentUser, existing[0]) || adoptingSubmittedTask;
    const kanbanReviewUpdate = payload.action === "kanban_review";
    if (kanbanReviewUpdate && !scopedManagement) {
      return Response.json({ error: "Only authorized management can move this task in Kanban." }, { status: 403 });
    }
    const canEdit =
      (scopedManagement && (existing[0].visibility === "team" || existing[0].submittedToManager || existing[0].createdBy === currentUser.email)) ||
      existing[0].employeeEmail === currentUser.email;
    if (!canEdit) {
      return Response.json({ error: "You cannot edit this task." }, { status: 403 });
    }

    const title = text(payload.title, 180) || existing[0].title;
    const project = text(payload.project, 80) || existing[0].project;
    if (scopedManagement && !(await canManageProject(db, currentUser, project))) {
      return Response.json({ error: "Managers can move tasks only within their assigned projects." }, { status: 403 });
    }
    const requestedCheck = enumValue(
      payload.managerCheck,
      checks,
      existing[0].managerCheck,
    ) as "new" | "pending" | "approved" | "returned";
    const canEditPrivateDetails = currentUser.role === "member"
      && existing[0].visibility === "private"
      && !existing[0].submittedToManager
      && existing[0].createdBy === currentUser.email;
    const management = scopedManagement;
    const convertingPrivate = management && existing[0].visibility === "private" && payload.visibility === "team";
    const employeeEmail = management
      ? text(payload.employeeEmail, 180).toLowerCase() || existing[0].employeeEmail
      : existing[0].employeeEmail;
    const employeeName = management
      ? text(payload.employeeName, 120) || existing[0].employeeName
      : existing[0].employeeName;
    const requestedCreatedBy = currentUser.role === "owner"
      ? text(payload.createdBy, 180).toLowerCase() || existing[0].createdBy
      : existing[0].createdBy;
    if (currentUser.role === "owner" && requestedCreatedBy !== existing[0].createdBy) {
      const [creatorAccount] = await db.select({ email: users.email, role: users.role, discipline: users.discipline }).from(users)
        .where(and(eq(users.email, requestedCreatedBy), eq(users.active, true)))
        .limit(1);
      if (!creatorAccount || !["owner", "manager"].includes(creatorAccount.role)) {
        return Response.json({ error: "Created By must be an active owner or manager." }, { status: 400 });
      }
      if (creatorAccount.role === "manager" && project !== "PERSONAL" && !(await isProjectMember(db, project, creatorAccount.email))) {
        return Response.json({ error: "The selected Created By manager must be assigned to this project." }, { status: 400 });
      }
      const [employeeAccount] = await db.select({ discipline: users.discipline }).from(users)
        .where(and(eq(users.email, employeeEmail), eq(users.active, true)))
        .limit(1);
      if (creatorAccount.role === "manager" && (!creatorAccount.discipline || employeeAccount?.discipline !== creatorAccount.discipline)) {
        return Response.json({ error: "Select an employee from the same discipline as the Created By manager." }, { status: 400 });
      }
    }
    const employeeChanged = management && employeeEmail !== existing[0].employeeEmail;
    if (convertingPrivate) {
      if (!employeeChanged) {
        return Response.json({ error: "Select another project employee before converting the private task. · اختر موظفًا آخر في المشروع قبل تحويل المهمة الخاصة." }, { status: 400 });
      }
      const [activeSession] = await db.select({ id: taskTimeEntries.id }).from(taskTimeEntries)
        .where(and(eq(taskTimeEntries.taskId, id), isNull(taskTimeEntries.endedAt)))
        .limit(1);
      if (activeSession) {
        return Response.json({ error: "Pause the private task timer before converting it. · أوقف عداد المهمة الخاصة مؤقتًا قبل تحويلها." }, { status: 409 });
      }
    }
    const reassignmentAfterSubmission = existing[0].submittedToManager || existing[0].managerCheck === "pending" || convertingPrivate;
    if (employeeChanged && !reassignmentAfterSubmission) {
      const sessions = await db.select({ id: taskTimeEntries.id }).from(taskTimeEntries).where(eq(taskTimeEntries.taskId, id)).limit(1);
      if (sessions[0]) return Response.json({ error: "This task has already started. Reassignment is available after the employee submits it for manager review." }, { status: 409 });
    }
    if (employeeChanged && !(await assignableEmployee(db, currentUser, employeeEmail))) {
      return Response.json({ error: currentUser.role === "manager" ? "You can reassign tasks only within your discipline." : "Select an active employee account." }, { status: 403 });
    }
    const privateSelfEdit = management && existing[0].visibility === "private" && !convertingPrivate && employeeEmail === currentUser.email;
    const managementSelfTask = management && existing[0].createdBy === currentUser.email && employeeEmail === currentUser.email;
    if ((management || canEditPrivateDetails) && !privateSelfEdit && !managementSelfTask && employeeEmail && !(await isProjectMember(db, project, employeeEmail))) {
      return Response.json({ error: "Select an employee assigned to this project." }, { status: 400 });
    }
    let approvalActualHours = existing[0].actualHours;
    let approvalStartTime = existing[0].startTime;
    let approvalEndTime = existing[0].endTime;
    let timerPausedByReview = false;
    if (management && kanbanReviewUpdate && requestedCheck !== "approved") {
      const now = new Date().toISOString();
      const activeReviewSessions = await db.select().from(taskTimeEntries)
        .where(and(eq(taskTimeEntries.taskId, id), isNull(taskTimeEntries.endedAt)));
      for (const session of activeReviewSessions) {
        const durationSeconds = session.durationSeconds + elapsedSeconds(session.resumedAt || session.startedAt, now);
        await db.update(taskTimeEntries).set({ endedAt: now, resumedAt: null, durationSeconds }).where(eq(taskTimeEntries.id, session.id));
      }
      timerPausedByReview = activeReviewSessions.length > 0;
    }
    let taskSessions = management && requestedCheck === "approved"
      ? await db.select().from(taskTimeEntries).where(eq(taskTimeEntries.taskId, id))
      : [];
    if (management && requestedCheck === "approved") {
      const now = new Date().toISOString();
      if (!taskSessions.length) {
        const insertedSession = await db.insert(taskTimeEntries).values({
          taskId: id,
          employeeEmail: existing[0].employeeEmail || currentUser.email,
          employeeName: existing[0].employeeName || currentUser.displayName,
          startedAt: now,
          resumedAt: null,
          endedAt: now,
          durationSeconds: 0,
          workCycle: existing[0].workCycle,
        }).returning();
        taskSessions = insertedSession;
      } else {
        for (const session of taskSessions.filter((entry) => !entry.endedAt)) {
          timerPausedByReview = true;
          const durationSeconds = session.durationSeconds + elapsedSeconds(session.resumedAt || session.startedAt, now);
          await db.update(taskTimeEntries).set({ endedAt: now, resumedAt: null, durationSeconds }).where(eq(taskTimeEntries.id, session.id));
          session.endedAt = now;
          session.resumedAt = null;
          session.durationSeconds = durationSeconds;
        }
      }
      const totalSeconds = taskSessions.reduce((sum, entry) => sum + entry.durationSeconds, 0);
      const firstSession = [...taskSessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
      const lastSession = [...taskSessions].filter((entry) => entry.endedAt).sort((a, b) => (a.endedAt || "").localeCompare(b.endedAt || "")).at(-1);
      approvalActualHours = Math.round((totalSeconds / 3600) * 100) / 100;
      approvalStartTime = firstSession?.startedAt.slice(11, 16) || approvalStartTime;
      approvalEndTime = lastSession?.endedAt?.slice(11, 16) || approvalEndTime;
    }
    const movingToPending = management && kanbanReviewUpdate && requestedCheck === "pending";
    const movingToReturned = management && kanbanReviewUpdate && requestedCheck === "returned";
    const returningForRevision = movingToReturned && ["pending", "approved"].includes(existing[0].managerCheck);
    const approving = management && requestedCheck === "approved";
    const nextStartDate = management || canEditPrivateDetails ? text(payload.startDate, 10) : existing[0].startDate;
    const nextTaskDate = management || canEditPrivateDetails ? text(payload.taskDate, 10) || existing[0].taskDate : existing[0].taskDate;
    if (nextStartDate && nextTaskDate && nextStartDate > nextTaskDate) {
      return Response.json({ error: "Start Date must be on or before Due Date. · يجب أن يكون تاريخ البداية قبل أو في تاريخ الإنجاز المتوقع." }, { status: 400 });
    }
    const updated = await db
      .update(tasks)
      .set({
        startDate: nextStartDate,
        taskDate: nextTaskDate,
        employeeName,
        employeeEmail,
        project: management || canEditPrivateDetails ? project : existing[0].project,
        title: management || canEditPrivateDetails ? title : existing[0].title,
        expectedOutput: management || canEditPrivateDetails ? text(payload.expectedOutput, 800) : existing[0].expectedOutput,
        priority: management || canEditPrivateDetails
          ? enumValue(payload.priority, priorities, existing[0].priority) as "high" | "medium" | "low"
          : existing[0].priority,
        plannedHours: management || canEditPrivateDetails ? number(payload.plannedHours) : existing[0].plannedHours,
        startTime: approving ? approvalStartTime : existing[0].startTime,
        endTime: approving ? approvalEndTime : existing[0].endTime,
        actualHours: approving ? approvalActualHours : existing[0].actualHours,
        completionPercent:
          approving
            ? 100
            : movingToPending
            ? 100
            : returningForRevision
            ? existing[0].completionBeforeReview
            : existing[0].completionPercent,
        completionBeforeReview: movingToPending && existing[0].managerCheck !== "pending"
          ? existing[0].completionPercent
          : approving && existing[0].managerCheck !== "pending"
          ? existing[0].completionPercent
          : existing[0].completionBeforeReview,
        status: approving ? "done" : employeeChanged && reassignmentAfterSubmission ? "not_started" : movingToReturned ? "needs_revision" : movingToPending ? "done" : timerPausedByReview ? "paused" : existing[0].status,
        managerCheck:
          management
            ? employeeChanged && reassignmentAfterSubmission ? "new" : requestedCheck
            : existing[0].managerCheck,
        managerNote: existing[0].managerNote,
        visibility: management && (employeeChanged || adoptingSubmittedTask || convertingPrivate) ? "team" : existing[0].visibility,
        submittedToManager: employeeChanged ? false : existing[0].submittedToManager,
        originatedByEmail: adoptingSubmittedTask ? (existing[0].originatedByEmail || existing[0].createdBy) : existing[0].originatedByEmail,
        originatedByName: adoptingSubmittedTask ? (existing[0].originatedByName || existing[0].employeeName) : existing[0].originatedByName,
        acceptedByEmail: adoptingSubmittedTask ? currentUser.email : existing[0].acceptedByEmail,
        acceptedByName: adoptingSubmittedTask ? currentUser.displayName : existing[0].acceptedByName,
        createdBy: currentUser.role === "owner"
          ? requestedCreatedBy
          : adoptingSubmittedTask ? currentUser.email : existing[0].createdBy,
        workCycle: employeeChanged && reassignmentAfterSubmission ? existing[0].workCycle + 1 : movingToReturned && existing[0].managerCheck !== "returned" ? existing[0].workCycle + 1 : existing[0].workCycle,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(tasks.id, id))
      .returning();

    if (management) {
      if (employeeEmail && (employeeChanged || convertingPrivate)) {
        await createNotifications(db, {
          recipientEmail: employeeEmail,
          type: "task_assigned",
          taskId: id,
          title: "Task assigned to you · تم إسناد مهمة إليك",
          message: `${updated[0].title} · ${updated[0].project} · تم إسناد المهمة`,
          actorName: currentUser.displayName,
        });
      } else if (employeeEmail && requestedCheck !== existing[0].managerCheck) {
        const reviewLabels = { new: "New/WIP · جديدة/قيد العمل", pending: "Pending review · بانتظار المراجعة", approved: "Approved · معتمدة", returned: "Returned · مُعادة" } as const;
        await createNotifications(db, {
          recipientEmail: employeeEmail,
          type: "review_updated",
          taskId: id,
          title: "Manager review updated · تم تحديث مراجعة المسؤول",
          message: `${updated[0].title}: ${reviewLabels[requestedCheck]}`,
          actorName: currentUser.displayName,
        });
      }
    }


    await recordActivity(db, currentUser, { action: "updated", entityType: "task", entityId: id, entityLabel: updated[0].title, projectCode: updated[0].project, details: currentUser.role === "owner" && requestedCreatedBy !== existing[0].createdBy ? `Created By changed from ${existing[0].createdBy} to ${requestedCreatedBy}` : management ? `Manager review: ${updated[0].managerCheck}` : "Task details updated" });
    const [creatorDetails] = await db.select({ displayName: users.displayName, profileImageKey: users.profileImageKey })
      .from(users)
      .where(eq(users.email, updated[0].createdBy))
      .limit(1);
    const refreshedTimeEntries = kanbanReviewUpdate
      ? await db.select().from(taskTimeEntries).where(eq(taskTimeEntries.taskId, id))
      : undefined;

    return Response.json({ task: { ...updated[0], createdByName: creatorDetails?.displayName || "Unknown user", createdByProfileImageKey: creatorDetails?.profileImageKey || "" }, timeEntries: refreshedTimeEntries, timerPaused: timerPausedByReview });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update task" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) {
      return Response.json({ error: "Invalid task id." }, { status: 400 });
    }
    const db = await getDb();
    const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!existing[0]) {
      return Response.json({ error: "Task not found." }, { status: 404 });
    }
    const ownPrivateTask = currentUser.role === "member"
      && existing[0].visibility === "private"
      && existing[0].createdBy === currentUser.email
      && existing[0].employeeEmail === currentUser.email;
    if (!isManagement(currentUser) && !ownPrivateTask) {
      return Response.json({ error: "You can delete only your own private tasks." }, { status: 403 });
    }
    if (isManagement(currentUser)) {
      if (existing[0].visibility === "private" && !existing[0].submittedToManager && existing[0].createdBy !== currentUser.email) {
        return Response.json({ error: "Task not found." }, { status: 404 });
      }
      if (!(await canManageExistingTask(db, currentUser, existing[0]))) {
        return Response.json({ error: "Managers can edit or delete only tasks they created." }, { status: 403 });
      }
    }
    await db.delete(taskComments).where(eq(taskComments.taskId, id));
    await db.delete(taskTimeEntries).where(eq(taskTimeEntries.taskId, id));
    const attachments = await db.select().from(taskAttachments).where(eq(taskAttachments.taskId, id));
    if (attachments.length) await (await getBucket()).delete(attachments.map((attachment) => attachment.objectKey));
    await db.delete(taskAttachments).where(eq(taskAttachments.taskId, id));
    await db.delete(taskSubtasks).where(eq(taskSubtasks.taskId, id));
    await db.delete(notifications).where(eq(notifications.taskId, id));
    await db.update(projectIssues).set({ convertedTaskId: null, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(projectIssues.convertedTaskId, id));
    await db.delete(tasks).where(eq(tasks.id, id));
    await recordActivity(db, currentUser, { action: "deleted", entityType: "task", entityId: id, entityLabel: existing[0].title, projectCode: existing[0].project, details: `Assigned to ${existing[0].employeeName}` });
    return Response.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to delete task" },
      { status: 500 },
    );
  }
}
