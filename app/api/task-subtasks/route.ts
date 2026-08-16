import { and, eq, inArray, sql } from "drizzle-orm";
import { getBucket, getDb } from "@/db";
import { taskAttachments, taskSubtasks, tasks, users } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";
import { createNotifications } from "@/lib/notification-delivery";
import { canManageTask, taskForCollaboration } from "@/lib/task-access";

export const dynamic = "force-dynamic";

function title(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 240) : "";
}

async function canEditSubtaskTitle(db: Awaited<ReturnType<typeof getDb>>, currentUser: Awaited<ReturnType<typeof getCurrentUser>>, task: typeof tasks.$inferSelect) {
  if (task.visibility === "private" && task.createdBy === currentUser.email) return true;
  return canManageTask(db, currentUser, task);
}

async function notifyCompletion(db: Awaited<ReturnType<typeof getDb>>, task: typeof tasks.$inferSelect, actor: Awaited<ReturnType<typeof getCurrentUser>>, subtaskTitle: string) {
  if (task.visibility === "private" && !task.submittedToManager) return false;
  const [creator] = await db.select({ email: users.email, role: users.role })
    .from(users)
    .where(and(eq(users.email, task.createdBy), inArray(users.role, ["owner", "manager"]), eq(users.active, true)))
    .limit(1);
  if (!creator || creator.email === actor.email) return false;
  await createNotifications(db, {
    recipientEmail: creator.email,
    type: "subtask_completed" as const,
    taskId: task.id,
    title: "Subtask completed · اكتملت المهمة الفرعية",
    message: `${subtaskTitle} · ${task.title} · ${actor.displayName} · اكتملت`,
    actorName: actor.displayName,
  });
  return true;
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const payload = await request.json() as Record<string, unknown>;
    const taskId = Number(payload.taskId);
    const subtaskTitle = title(payload.title);
    if (!Number.isInteger(taskId) || !subtaskTitle) return Response.json({ error: "Enter a subtask title." }, { status: 400 });
    const db = await getDb();
    const task = await taskForCollaboration(db, currentUser, taskId);
    if (!task) return Response.json({ error: "You cannot add subtasks to this task." }, { status: 403 });
    const [subtask] = await db.insert(taskSubtasks).values({ taskId, title: subtaskTitle, createdBy: currentUser.email }).returning();
    await recordActivity(db, currentUser, { action: "created", entityType: "task", entityId: task.id, entityLabel: task.title, projectCode: task.project, details: `Subtask added: ${subtaskTitle}` });
    return Response.json({ subtask }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to add subtask." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const payload = await request.json() as Record<string, unknown>;
    const id = Number(payload.id);
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid subtask id." }, { status: 400 });
    const db = await getDb();
    const [existing] = await db.select().from(taskSubtasks).where(eq(taskSubtasks.id, id)).limit(1);
    if (!existing) return Response.json({ error: "Subtask not found." }, { status: 404 });
    const task = await taskForCollaboration(db, currentUser, existing.taskId);
    if (!task) return Response.json({ error: "You cannot update this subtask." }, { status: 403 });
    const completed = typeof payload.completed === "boolean" ? payload.completed : existing.completed;
    const nextTitle = payload.title === undefined ? existing.title : title(payload.title);
    if (!nextTitle) return Response.json({ error: "Enter a subtask title." }, { status: 400 });
    if (payload.title !== undefined && nextTitle !== existing.title && !(await canEditSubtaskTitle(db, currentUser, task))) {
      return Response.json({ error: "Only the owner or the manager who created the task can edit this subtask title." }, { status: 403 });
    }
    const [subtask] = await db.update(taskSubtasks).set({
      title: nextTitle,
      completed,
      completedAt: completed ? sql`CURRENT_TIMESTAMP` : null,
      completedBy: completed ? currentUser.email : "",
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(taskSubtasks.id, id)).returning();
    const managementNotified = completed && !existing.completed
      ? await notifyCompletion(db, task, currentUser, nextTitle)
      : false;
    await recordActivity(db, currentUser, { action: "updated", entityType: "task", entityId: task.id, entityLabel: task.title, projectCode: task.project, details: `${completed ? "Subtask completed" : "Subtask updated"}: ${nextTitle}` });
    return Response.json({ subtask, managementNotified });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update subtask." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid subtask id." }, { status: 400 });
    const db = await getDb();
    const [existing] = await db.select().from(taskSubtasks).where(eq(taskSubtasks.id, id)).limit(1);
    if (!existing) return Response.json({ error: "Subtask not found." }, { status: 404 });
    const task = await taskForCollaboration(db, currentUser, existing.taskId);
    if (!task) return Response.json({ error: "You cannot delete this subtask." }, { status: 403 });
    const attachments = await db.select().from(taskAttachments).where(eq(taskAttachments.subtaskId, id));
    if (attachments.length) await (await getBucket()).delete(attachments.map((attachment) => attachment.objectKey));
    await db.delete(taskAttachments).where(eq(taskAttachments.subtaskId, id));
    await db.delete(taskSubtasks).where(eq(taskSubtasks.id, id));
    await recordActivity(db, currentUser, { action: "deleted", entityType: "task", entityId: task.id, entityLabel: task.title, projectCode: task.project, details: `Subtask deleted: ${existing.title}` });
    return Response.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete subtask." }, { status: 500 });
  }
}
