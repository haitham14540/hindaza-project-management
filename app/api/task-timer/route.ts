import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { notifications, projectMembers, projects, taskSubtasks, taskTimeEntries, tasks, users } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

type Database = Awaited<ReturnType<typeof getDb>>;
type TimerAction = "start" | "pause" | "finish";

async function canAuditTask(db: Database, currentUser: Awaited<ReturnType<typeof getCurrentUser>>, task: typeof tasks.$inferSelect) {
  if (currentUser.role === "owner") return true;
  if (currentUser.role !== "manager" || !currentUser.discipline) return false;
  const [employee] = await db.select({ discipline: users.discipline }).from(users).where(eq(users.email, task.employeeEmail)).limit(1);
  if (employee?.discipline !== currentUser.discipline) return false;
  const [membership] = await db.select({ id: projectMembers.id, isProjectManager: projectMembers.isProjectManager })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projects.code, task.project), eq(projectMembers.employeeEmail, currentUser.email)))
    .limit(1);
  return Boolean(membership) && (!membership.isProjectManager || task.createdBy === currentUser.email);
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function durationSeconds(startedAt: string, endedAt: string) {
  const seconds = Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

async function refreshTaskTime(
  db: Database,
  taskId: number,
  status?: "paused" | "done",
) {
  const entries = await db
    .select()
    .from(taskTimeEntries)
    .where(eq(taskTimeEntries.taskId, taskId))
    .orderBy(asc(taskTimeEntries.startedAt), asc(taskTimeEntries.id));
  const closed = entries.filter((entry) => entry.endedAt);
  const seconds = closed.reduce((sum, entry) => sum + entry.durationSeconds, 0);
  const firstStart = entries[0]?.startedAt || "";
  const lastEnd = closed.at(-1)?.endedAt || "";
  const updated = await db
    .update(tasks)
    .set({
      actualHours: Math.round((seconds / 3600) * 100) / 100,
      startTime: firstStart ? firstStart.slice(11, 16) : "",
      endTime: lastEnd ? lastEnd.slice(11, 16) : "",
      ...(status ? { status } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tasks.id, taskId))
    .returning();
  return updated[0];
}

async function closeActiveEntries(
  db: Database,
  employeeEmail: string,
  now: string,
  onlyTaskId?: number,
) {
  const active = await db
    .select()
    .from(taskTimeEntries)
    .where(and(eq(taskTimeEntries.employeeEmail, employeeEmail), isNull(taskTimeEntries.endedAt)));
  const matches = onlyTaskId ? active.filter((entry) => entry.taskId === onlyTaskId) : active;
  const affected = new Set<number>();
  for (const entry of matches) {
    await db
      .update(taskTimeEntries)
      .set({ endedAt: now, durationSeconds: durationSeconds(entry.startedAt, now) })
      .where(eq(taskTimeEntries.id, entry.id));
    affected.add(entry.taskId);
  }
  const updatedTasks = [];
  for (const taskId of affected) {
    updatedTasks.push(await refreshTaskTime(db, taskId, "paused"));
  }
  return updatedTasks.filter(Boolean);
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (currentUser.role === "owner") {
      return Response.json({ error: "Employee access required." }, { status: 403 });
    }
    const payload = (await request.json()) as Record<string, unknown>;
    const taskId = Number(payload.taskId);
    const action = payload.action as TimerAction;
    if (!Number.isInteger(taskId) || !["start", "pause", "finish"].includes(action)) {
      return Response.json({ error: "Invalid timer action." }, { status: 400 });
    }

    const db = await getDb();
    const taskRows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    const task = taskRows[0];
    if (!task || task.employeeEmail !== currentUser.email) {
      return Response.json({ error: "This task is not assigned to you." }, { status: 403 });
    }
    const submitForReview = task.visibility === "team" || task.submittedToManager;
    if (action === "start" && task.managerCheck === "approved") {
      return Response.json({ error: "An approved task must be reopened by the manager before work can resume." }, { status: 409 });
    }
    if (action === "finish") {
      const openSubtasks = await db.select({ id: taskSubtasks.id }).from(taskSubtasks)
        .where(and(eq(taskSubtasks.taskId, taskId), eq(taskSubtasks.completed, false)));
      if (openSubtasks.length) {
        return Response.json({ error: `Complete all subtasks before ${submitForReview ? "submitting" : "finishing"} this task (${openSubtasks.length} remaining).` }, { status: 409 });
      }
    }

    const now = new Date().toISOString();
    const affectedTasks = [];

    if (action === "start") {
      const activeOnTask = await db
        .select({ id: taskTimeEntries.id })
        .from(taskTimeEntries)
        .where(and(
          eq(taskTimeEntries.taskId, taskId),
          eq(taskTimeEntries.employeeEmail, currentUser.email),
          isNull(taskTimeEntries.endedAt),
        ))
        .limit(1);
      if (!activeOnTask[0]) {
        affectedTasks.push(...await closeActiveEntries(db, currentUser.email, now));
        await db.insert(taskTimeEntries).values({ taskId, employeeEmail: currentUser.email, startedAt: now });
      }
      const started = await db
        .update(tasks)
        .set({
          status: "in_progress",
          managerCheck: "new",
          startTime: task.startTime || now.slice(11, 16),
          endTime: "",
          updatedAt: now,
        })
        .where(eq(tasks.id, taskId))
        .returning();
      affectedTasks.push(started[0]);
    }

    if (action === "pause") {
      affectedTasks.push(...await closeActiveEntries(db, currentUser.email, now, taskId));
      if (!affectedTasks.length) {
        const paused = await db.update(tasks).set({ status: "paused", updatedAt: now }).where(eq(tasks.id, taskId)).returning();
        affectedTasks.push(paused[0]);
      }
    }

    if (action === "finish") {
      await closeActiveEntries(db, currentUser.email, now, taskId);
      const finished = await refreshTaskTime(db, taskId, "done");
      const reviewed = await db
        .update(tasks)
        .set({ managerCheck: submitForReview ? "pending" : "new", updatedAt: now })
        .where(eq(tasks.id, taskId))
        .returning();
      affectedTasks.push(reviewed[0] || finished);
      if (submitForReview) {
        const managers = (await db.select({ email: users.email, role: users.role, discipline: users.discipline }).from(users).where(and(inArray(users.role, ["owner", "manager"]), eq(users.active, true))))
          .filter((manager) => manager.role === "owner" || (Boolean(currentUser.discipline) && manager.discipline === currentUser.discipline));
        if (managers.length) {
          await db.insert(notifications).values(managers.map((manager) => ({
            recipientEmail: manager.email,
            type: "task_ready_for_review" as const,
            taskId,
            title: "Task ready for review",
            message: `${task.title} · ${currentUser.displayName}`,
          })));
        }
      }
    }

    const uniqueTaskIds = [...new Set(affectedTasks.filter(Boolean).map((item) => item.id))];
    const freshTasks = [];
    const entries = [];
    for (const id of uniqueTaskIds) {
      const row = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      if (row[0]) freshTasks.push(row[0]);
      entries.push(...await db.select().from(taskTimeEntries).where(eq(taskTimeEntries.taskId, id)).orderBy(asc(taskTimeEntries.startedAt), asc(taskTimeEntries.id)));
    }
    await recordActivity(db, currentUser, { action: "timer_updated", entityType: "task", entityId: taskId, entityLabel: task.title, projectCode: task.project, details: `Timer action: ${action}` });
    return Response.json({ tasks: freshTasks, timeEntries: entries, submittedForReview: action === "finish" && submitForReview });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update task timer." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const payload = (await request.json()) as Record<string, unknown>;
    const entryId = Number(payload.entryId);
    const startedAt = validDate(payload.startedAt);
    const endedAt = validDate(payload.endedAt);
    if (!Number.isInteger(entryId) || !startedAt || !endedAt || new Date(endedAt) <= new Date(startedAt)) {
      return Response.json({ error: "Enter a valid session start and end time." }, { status: 400 });
    }
    const db = await getDb();
    const [entry] = await db.select().from(taskTimeEntries).where(eq(taskTimeEntries.id, entryId)).limit(1);
    if (!entry) return Response.json({ error: "Work session not found." }, { status: 404 });
    if (!entry.endedAt) return Response.json({ error: "Pause the active session before editing it." }, { status: 409 });
    const [task] = await db.select().from(tasks).where(eq(tasks.id, entry.taskId)).limit(1);
    if (!task) return Response.json({ error: "Task not found." }, { status: 404 });
    if (task.managerCheck === "new" && !task.submittedToManager) {
      return Response.json({ error: "Work sessions can be audited after the task is submitted for review." }, { status: 409 });
    }
    if (!(await canAuditTask(db, currentUser, task))) return Response.json({ error: "Management access required for this work session." }, { status: 403 });
    await db.update(taskTimeEntries).set({ startedAt, endedAt, durationSeconds: durationSeconds(startedAt, endedAt) }).where(eq(taskTimeEntries.id, entryId));
    const updatedTask = await refreshTaskTime(db, task.id);
    const entries = await db.select().from(taskTimeEntries).where(eq(taskTimeEntries.taskId, task.id)).orderBy(asc(taskTimeEntries.startedAt), asc(taskTimeEntries.id));
    await recordActivity(db, currentUser, { action: "timer_updated", entityType: "task", entityId: task.id, entityLabel: task.title, projectCode: task.project, details: `Work session ${entryId} corrected during review` });
    return Response.json({ tasks: [updatedTask], timeEntries: entries });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to edit work session." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const url = new URL(request.url);
    const entryId = Number(url.searchParams.get("entryId"));
    if (!Number.isInteger(entryId)) return Response.json({ error: "Invalid work session id." }, { status: 400 });
    const db = await getDb();
    const [entry] = await db.select().from(taskTimeEntries).where(eq(taskTimeEntries.id, entryId)).limit(1);
    if (!entry) return Response.json({ error: "Work session not found." }, { status: 404 });
    if (!entry.endedAt) return Response.json({ error: "Pause the active session before deleting it." }, { status: 409 });
    const [task] = await db.select().from(tasks).where(eq(tasks.id, entry.taskId)).limit(1);
    if (!task) return Response.json({ error: "Task not found." }, { status: 404 });
    if (task.managerCheck === "new" && !task.submittedToManager) {
      return Response.json({ error: "Work sessions can be audited after the task is submitted for review." }, { status: 409 });
    }
    if (!(await canAuditTask(db, currentUser, task))) return Response.json({ error: "Management access required for this work session." }, { status: 403 });
    await db.delete(taskTimeEntries).where(eq(taskTimeEntries.id, entryId));
    const updatedTask = await refreshTaskTime(db, task.id);
    const entries = await db.select().from(taskTimeEntries).where(eq(taskTimeEntries.taskId, task.id)).orderBy(asc(taskTimeEntries.startedAt), asc(taskTimeEntries.id));
    await recordActivity(db, currentUser, { action: "timer_updated", entityType: "task", entityId: task.id, entityLabel: task.title, projectCode: task.project, details: `Work session ${entryId} deleted during review` });
    return Response.json({ tasks: [updatedTask], timeEntries: entries });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete work session." }, { status: 500 });
  }
}
