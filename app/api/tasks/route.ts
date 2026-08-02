import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { notifications, projectMembers, projects, taskComments, taskTimeEntries, tasks, users } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";

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

    const employeeName = currentUser.role === "manager" ? text(payload.employeeName, 120) : currentUser.displayName;
    const employeeEmail = currentUser.role === "manager" ? text(payload.employeeEmail, 180).toLowerCase() : currentUser.email;
    if (!employeeName || !employeeEmail) {
      return Response.json({ error: "Select an employee for this task." }, { status: 400 });
    }
    const db = await getDb();
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

    const projectRow = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, project)).limit(1);
    if (projectRow[0]) {
      await db.insert(projectMembers).values({ projectId: projectRow[0].id, employeeEmail }).onConflictDoNothing();
    }
    if (currentUser.role === "manager") {
      await db.insert(notifications).values({
        recipientEmail: employeeEmail,
        type: "task_assigned",
        taskId: inserted[0].id,
        title: "New task assigned",
        message: `${title} · ${project}`,
      });
    }

    return Response.json({ task: inserted[0] }, { status: 201 });
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
      const managers = await db.select({ email: users.email }).from(users).where(and(eq(users.role, "manager"), eq(users.active, true)));
      if (managers.length) {
        await db.insert(notifications).values(managers.map((manager) => ({
          recipientEmail: manager.email,
          type: "private_task_submitted" as const,
          taskId: id,
          title: "Private task shared for assignment",
          message: `${existing[0].title} · ${currentUser.displayName}`,
        })));
      }
      return Response.json({ task: submitted[0] });
    }
    const canEdit =
      (currentUser.role === "manager" && (existing[0].visibility === "team" || existing[0].submittedToManager)) ||
      existing[0].employeeEmail === currentUser.email;
    if (!canEdit) {
      return Response.json({ error: "You cannot edit this task." }, { status: 403 });
    }

    const title = text(payload.title, 180) || existing[0].title;
    const project = text(payload.project, 80) || existing[0].project;
    const requestedCheck = enumValue(
      payload.managerCheck,
      checks,
      existing[0].managerCheck,
    ) as "new" | "pending" | "approved" | "returned";
    const canEditPrivateDetails = currentUser.role === "member"
      && existing[0].visibility === "private"
      && !existing[0].submittedToManager
      && existing[0].createdBy === currentUser.email;
    if (currentUser.role === "manager" && requestedCheck === "approved" && existing[0].status !== "done") {
      return Response.json({ error: "Only a completed task can be approved." }, { status: 409 });
    }
    const employeeEmail = currentUser.role === "manager"
      ? text(payload.employeeEmail, 180).toLowerCase() || existing[0].employeeEmail
      : existing[0].employeeEmail;
    const employeeName = currentUser.role === "manager"
      ? text(payload.employeeName, 120) || existing[0].employeeName
      : existing[0].employeeName;
    const updated = await db
      .update(tasks)
      .set({
        taskDate: currentUser.role === "manager" || canEditPrivateDetails ? text(payload.taskDate, 10) || existing[0].taskDate : existing[0].taskDate,
        employeeName,
        employeeEmail,
        project: currentUser.role === "manager" || canEditPrivateDetails ? project : existing[0].project,
        title: currentUser.role === "manager" || canEditPrivateDetails ? title : existing[0].title,
        expectedOutput: currentUser.role === "manager" || canEditPrivateDetails ? text(payload.expectedOutput, 800) : existing[0].expectedOutput,
        priority: currentUser.role === "manager" || canEditPrivateDetails
          ? enumValue(payload.priority, priorities, existing[0].priority) as "high" | "medium" | "low"
          : existing[0].priority,
        plannedHours: currentUser.role === "manager" || canEditPrivateDetails ? number(payload.plannedHours) : existing[0].plannedHours,
        startTime: existing[0].startTime,
        endTime: existing[0].endTime,
        actualHours: existing[0].actualHours,
        status: existing[0].status,
        managerCheck:
          currentUser.role === "manager"
            ? requestedCheck
            : existing[0].managerCheck,
        managerNote: existing[0].managerNote,
        visibility: currentUser.role === "manager" && employeeEmail !== existing[0].employeeEmail ? "team" : existing[0].visibility,
        submittedToManager: existing[0].submittedToManager,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(tasks.id, id))
      .returning();

    if (currentUser.role === "manager") {
      const projectRow = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, updated[0].project)).limit(1);
      if (projectRow[0] && employeeEmail) {
        await db.insert(projectMembers).values({ projectId: projectRow[0].id, employeeEmail }).onConflictDoNothing();
      }
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
    if (currentUser.role !== "manager") {
      return Response.json({ error: "Manager access required." }, { status: 403 });
    }
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) {
      return Response.json({ error: "Invalid task id." }, { status: 400 });
    }
    const db = await getDb();
    const existing = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    if (!existing[0] || (existing[0].visibility === "private" && !existing[0].submittedToManager)) {
      return Response.json({ error: "Task not found." }, { status: 404 });
    }
    await db.delete(taskComments).where(eq(taskComments.taskId, id));
    await db.delete(taskTimeEntries).where(eq(taskTimeEntries.taskId, id));
    await db.delete(notifications).where(eq(notifications.taskId, id));
    await db.delete(tasks).where(eq(tasks.id, id));
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
