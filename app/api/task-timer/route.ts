import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { notifications, taskTimeEntries, tasks, users } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Database = Awaited<ReturnType<typeof getDb>>;
type TimerAction = "start" | "pause" | "finish";

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
    if (currentUser.role !== "member") {
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
    if (action === "start" && task.managerCheck === "approved") {
      return Response.json({ error: "An approved task must be reopened by the manager before work can resume." }, { status: 409 });
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
        .set({ managerCheck: "pending", updatedAt: now })
        .where(eq(tasks.id, taskId))
        .returning();
      affectedTasks.push(reviewed[0] || finished);
      if (task.visibility === "team" || task.submittedToManager) {
        const managers = await db.select({ email: users.email }).from(users).where(and(eq(users.role, "manager"), eq(users.active, true)));
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
    return Response.json({ tasks: freshTasks, timeEntries: entries });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update task timer." },
      { status: 500 },
    );
  }
}
