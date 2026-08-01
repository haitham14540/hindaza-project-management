import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { tasks } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

const priorities = ["high", "medium", "low"] as const;
const statuses = [
  "not_started",
  "in_progress",
  "blocked",
  "needs_revision",
  "done",
] as const;
const checks = ["pending", "approved", "returned"] as const;
type TaskStatus = (typeof statuses)[number];

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
    const project = text(payload.project, 80);
    if (!title || !project) {
      return Response.json(
        { error: "Task title and project are required." },
        { status: 400 },
      );
    }

    const employeeName =
      currentUser.role === "manager"
        ? text(payload.employeeName, 120) || currentUser.displayName
        : currentUser.displayName;
    const employeeEmail =
      currentUser.role === "manager"
        ? text(payload.employeeEmail, 180).toLowerCase()
        : currentUser.email;
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
        startTime: text(payload.startTime, 5),
        endTime: text(payload.endTime, 5),
        actualHours: number(payload.actualHours),
        status: enumValue(payload.status, statuses, "not_started") as
          | "not_started"
          | "in_progress"
          | "blocked"
          | "needs_revision"
          | "done",
        managerCheck: "pending",
        managerNote: "",
        createdBy: currentUser.email,
      })
      .returning();

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
    const canEdit =
      currentUser.role === "manager" ||
      existing[0].createdBy === currentUser.email ||
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
    ) as "pending" | "approved" | "returned";
    const requestedStatus = enumValue(
      payload.status,
      statuses,
      existing[0].status,
    ) as TaskStatus;
    const status =
      currentUser.role === "manager" && requestedCheck === "approved"
        ? "done"
        : currentUser.role === "manager" && requestedCheck === "returned"
          ? "needs_revision"
          : requestedStatus;
    const updated = await db
      .update(tasks)
      .set({
        taskDate: text(payload.taskDate, 10) || existing[0].taskDate,
        employeeName:
          currentUser.role === "manager"
            ? text(payload.employeeName, 120) || existing[0].employeeName
            : existing[0].employeeName,
        employeeEmail:
          currentUser.role === "manager"
            ? text(payload.employeeEmail, 180).toLowerCase()
            : existing[0].employeeEmail,
        project,
        title,
        expectedOutput: text(payload.expectedOutput, 800),
        priority: enumValue(payload.priority, priorities, existing[0].priority) as
          | "high"
          | "medium"
          | "low",
        plannedHours: number(payload.plannedHours),
        startTime: text(payload.startTime, 5),
        endTime: text(payload.endTime, 5),
        actualHours: number(payload.actualHours),
        status,
        managerCheck:
          currentUser.role === "manager"
            ? requestedCheck
            : existing[0].managerCheck,
        managerNote:
          currentUser.role === "manager"
            ? text(payload.managerNote, 800)
            : existing[0].managerNote,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(tasks.id, id))
      .returning();

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
