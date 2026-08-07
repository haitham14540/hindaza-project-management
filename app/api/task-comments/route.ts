import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { taskComments, tasks, users } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const payload = (await request.json()) as Record<string, unknown>;
    const taskId = Number(payload.taskId);
    const body = typeof payload.body === "string" ? payload.body.trim().slice(0, 2000) : "";

    if (!Number.isInteger(taskId)) {
      return Response.json({ error: "Invalid task id." }, { status: 400 });
    }
    if (!body) {
      return Response.json({ error: "Write a comment before posting." }, { status: 400 });
    }

    const db = await getDb();
    const task = await db.select({
      id: tasks.id,
      employeeEmail: tasks.employeeEmail,
      createdBy: tasks.createdBy,
      visibility: tasks.visibility,
      submittedToManager: tasks.submittedToManager,
    }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task[0]) {
      return Response.json({ error: "Task not found." }, { status: 404 });
    }
    const employee = currentUser.role === "manager"
      ? await db.select({ discipline: users.discipline }).from(users).where(eq(users.email, task[0].employeeEmail)).limit(1)
      : [];
    const managementAccess = currentUser.role === "owner" || (
      currentUser.role === "manager" &&
      Boolean(currentUser.discipline) &&
      employee[0]?.discipline === currentUser.discipline
    );
    const canComment = managementAccess
      ? task[0].visibility === "team" || task[0].submittedToManager
      : task[0].employeeEmail === currentUser.email || (task[0].visibility === "private" && task[0].createdBy === currentUser.email);
    if (!canComment) {
      return Response.json({ error: "You cannot comment on this task." }, { status: 403 });
    }

    const inserted = await db
      .insert(taskComments)
      .values({
        taskId,
        authorEmail: currentUser.email,
        authorName: currentUser.displayName,
        body,
      })
      .returning();

    await db.update(tasks).set({ updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(tasks.id, taskId));
    const [taskDetails] = await db.select({ title: tasks.title, project: tasks.project }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (taskDetails) await recordActivity(db, currentUser, { action: "note_added", entityType: "task", entityId: taskId, entityLabel: taskDetails.title, projectCode: taskDetails.project, details: body });
    return Response.json({ comment: inserted[0] }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to post comment." },
      { status: 500 },
    );
  }
}
