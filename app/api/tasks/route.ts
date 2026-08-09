import { and, eq, inArray, sql } from "drizzle-orm";
import { getBucket, getDb } from "@/db";
import { notifications, projectMembers, projects, taskAttachments, taskComments, taskSubtasks, taskTimeEntries, tasks, users } from "@/db/schema";
import { getCurrentUser, isManagement, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";

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

async function managedEmployee(db: Database, currentUser: CurrentUser, employeeEmail: string) {
  if (currentUser.role === "owner") return true;
  if (currentUser.role !== "manager" || !currentUser.discipline) return false;
  const row = await db.select({ discipline: users.discipline })
    .from(users)
    .where(and(eq(users.email, employeeEmail), eq(users.active, true)))
    .limit(1);
  return row[0]?.discipline === currentUser.discipline;
}

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
  return reviewers.filter((reviewer) => reviewer.role === "owner" || (Boolean(employee?.discipline) && reviewer.discipline === employee.discipline && memberEmails.has(reviewer.email)));
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

async function isReadOnlyProjectManager(db: Database, currentUser: CurrentUser, task: typeof tasks.$inferSelect) {
  if (currentUser.role === "owner" || task.createdBy === currentUser.email || task.project === "PERSONAL") return false;
  const [membership] = await db.select({ isProjectManager: projectMembers.isProjectManager })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projects.code, task.project), eq(projectMembers.employeeEmail, currentUser.email)))
    .limit(1);
  return Boolean(membership?.isProjectManager);
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
    const project = text(payload.project, 80) || (currentUser.role === "member" ? "PERSONAL" : "");
    if (!title || !project) {
      return Response.json(
        { error: "Task title and project are required." },
        { status: 400 },
      );
    }

    const management = isManagement(currentUser);
    const employeeName = management ? text(payload.employeeName, 120) : currentUser.displayName;
    const employeeEmail = management ? text(payload.employeeEmail, 180).toLowerCase() : currentUser.email;
    if (!employeeName || !employeeEmail) {
      return Response.json({ error: "Select an employee for this task." }, { status: 400 });
    }
    const db = await getDb();
    if (!(await isActiveProject(db, project))) {
      return Response.json({ error: "New tasks can be created only in active projects." }, { status: 409 });
    }
    if (management && !(await canManageProject(db, currentUser, project))) {
      return Response.json({ error: "Managers can create tasks only in projects they are assigned to." }, { status: 403 });
    }
    if (management && !(await assignableEmployee(db, currentUser, employeeEmail))) {
      return Response.json({ error: currentUser.role === "manager" ? "You can assign tasks only to employees in your discipline." : "Select an active employee account." }, { status: 403 });
    }
    if (!(await isProjectMember(db, project, employeeEmail))) {
      return Response.json({ error: "Select an employee assigned to this project." }, { status: 400 });
    }
    const inserted = await db
      .insert(tasks)
      .values({
        taskDate: text(payload.taskDate, 10) || new Date().toISOString().slice(0, 10),
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
        visibility: currentUser.role === "member" ? "private" : "team",
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

    if (management) {
      await db.insert(notifications).values({
        recipientEmail: employeeEmail,
        type: "task_assigned",
        taskId: inserted[0].id,
        title: "New task assigned",
        message: `${title} · ${project}`,
      });
    }

    await recordActivity(db, currentUser, { action: "created", entityType: "task", entityId: inserted[0].id, entityLabel: inserted[0].title, projectCode: inserted[0].project, details: `Created by ${currentUser.displayName} · Assigned to ${inserted[0].employeeName}` });

    return Response.json({ task: inserted[0], subtasks: createdSubtasks }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to create task" },
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
        .set({ submittedToManager: true, managerCheck: "new", updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(tasks.id, id))
        .returning();
      const managers = await relevantReviewers(db, existing[0].employeeEmail, existing[0].project);
      if (managers.length) {
        await db.insert(notifications).values(managers.map((manager) => ({
          recipientEmail: manager.email,
          type: "private_task_submitted" as const,
          taskId: id,
          title: "Private task shared for assignment",
          message: `${existing[0].title} · ${currentUser.displayName}`,
        })));
      }
      await recordActivity(db, currentUser, { action: "updated", entityType: "task", entityId: id, entityLabel: submitted[0].title, projectCode: submitted[0].project, details: "Private task shared with management" });
      return Response.json({ task: submitted[0] });
    }
    const scopedManagement = isManagement(currentUser) && await managedEmployee(db, currentUser, existing[0].employeeEmail) && await canManageProject(db, currentUser, existing[0].project) && !(await isReadOnlyProjectManager(db, currentUser, existing[0]));
    const canEdit =
      (scopedManagement && (existing[0].visibility === "team" || existing[0].submittedToManager)) ||
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
    if (management && requestedCheck === "approved" && existing[0].status !== "done") {
      return Response.json({ error: "Only a completed task can be approved." }, { status: 409 });
    }
    const employeeEmail = management
      ? text(payload.employeeEmail, 180).toLowerCase() || existing[0].employeeEmail
      : existing[0].employeeEmail;
    const employeeName = management
      ? text(payload.employeeName, 120) || existing[0].employeeName
      : existing[0].employeeName;
    if (management && employeeEmail !== existing[0].employeeEmail && !(await assignableEmployee(db, currentUser, employeeEmail))) {
      return Response.json({ error: currentUser.role === "manager" ? "You can reassign tasks only within your discipline." : "Select an active employee account." }, { status: 403 });
    }
    if ((management || canEditPrivateDetails) && !(await isProjectMember(db, project, employeeEmail))) {
      return Response.json({ error: "Select an employee assigned to this project." }, { status: 400 });
    }
    const updated = await db
      .update(tasks)
      .set({
        taskDate: management || canEditPrivateDetails ? text(payload.taskDate, 10) || existing[0].taskDate : existing[0].taskDate,
        employeeName,
        employeeEmail,
        project: management || canEditPrivateDetails ? project : existing[0].project,
        title: management || canEditPrivateDetails ? title : existing[0].title,
        expectedOutput: management || canEditPrivateDetails ? text(payload.expectedOutput, 800) : existing[0].expectedOutput,
        priority: management || canEditPrivateDetails
          ? enumValue(payload.priority, priorities, existing[0].priority) as "high" | "medium" | "low"
          : existing[0].priority,
        plannedHours: management || canEditPrivateDetails ? number(payload.plannedHours) : existing[0].plannedHours,
        startTime: existing[0].startTime,
        endTime: existing[0].endTime,
        actualHours: existing[0].actualHours,
        status: existing[0].status,
        managerCheck:
          management
            ? requestedCheck
            : existing[0].managerCheck,
        managerNote: existing[0].managerNote,
        visibility: management && employeeEmail !== existing[0].employeeEmail ? "team" : existing[0].visibility,
        submittedToManager: existing[0].submittedToManager,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(tasks.id, id))
      .returning();

    if (management) {
      if (employeeEmail && employeeEmail !== existing[0].employeeEmail) {
        await db.insert(notifications).values({
          recipientEmail: employeeEmail,
          type: "task_assigned",
          taskId: id,
          title: "Task assigned to you",
          message: `${updated[0].title} · ${updated[0].project}`,
        });
      } else if (employeeEmail && requestedCheck !== existing[0].managerCheck) {
        const reviewLabels = { new: "New/WIP", pending: "Pending review", approved: "Approved", returned: "Returned" } as const;
        await db.insert(notifications).values({
          recipientEmail: employeeEmail,
          type: "review_updated",
          taskId: id,
          title: "Manager review updated",
          message: `${updated[0].title}: ${reviewLabels[requestedCheck]}`,
        });
      }
    }


    await recordActivity(db, currentUser, { action: "updated", entityType: "task", entityId: id, entityLabel: updated[0].title, projectCode: updated[0].project, details: management ? `Manager review: ${updated[0].managerCheck}` : "Task details updated" });

    return Response.json({ task: updated[0] });
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
      if (existing[0].visibility === "private" && !existing[0].submittedToManager) {
        return Response.json({ error: "Task not found." }, { status: 404 });
      }
      if (!(await managedEmployee(db, currentUser, existing[0].employeeEmail)) || !(await canManageProject(db, currentUser, existing[0].project))) {
        return Response.json({ error: "You can manage tasks only within your discipline." }, { status: 403 });
      }
      if (await isReadOnlyProjectManager(db, currentUser, existing[0])) {
        return Response.json({ error: "Project managers can edit or delete only tasks they created." }, { status: 403 });
      }
    }
    await db.delete(taskComments).where(eq(taskComments.taskId, id));
    await db.delete(taskTimeEntries).where(eq(taskTimeEntries.taskId, id));
    const attachments = await db.select().from(taskAttachments).where(eq(taskAttachments.taskId, id));
    if (attachments.length) await (await getBucket()).delete(attachments.map((attachment) => attachment.objectKey));
    await db.delete(taskAttachments).where(eq(taskAttachments.taskId, id));
    await db.delete(taskSubtasks).where(eq(taskSubtasks.taskId, id));
    await db.delete(notifications).where(eq(notifications.taskId, id));
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
