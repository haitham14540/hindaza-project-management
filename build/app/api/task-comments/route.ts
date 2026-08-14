import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { notifications, projectMembers, projects, taskComments, tasks, users } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
const COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;

function timestampMs(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Date(normalized).getTime();
}

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
      title: tasks.title,
      project: tasks.project,
    }).from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task[0]) {
      return Response.json({ error: "Task not found." }, { status: 404 });
    }
    let projectManagerAccess = false;
    if (currentUser.role === "manager" && task[0].project !== "PERSONAL" && currentUser.discipline) {
      const [employee] = await db.select({ discipline: users.discipline }).from(users).where(eq(users.email, task[0].employeeEmail)).limit(1);
      const [membership] = await db.select({ isProjectManager: projectMembers.isProjectManager })
        .from(projectMembers).innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .where(and(eq(projects.code, task[0].project), eq(projectMembers.employeeEmail, currentUser.email))).limit(1);
      projectManagerAccess = employee?.discipline === currentUser.discipline && Boolean(membership?.isProjectManager);
    }
    const managementAccess = currentUser.role === "owner" || projectManagerAccess || (
      currentUser.role === "manager" &&
      task[0].createdBy === currentUser.email
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
    const taskDetails = task[0];
    const recipientEmail = currentUser.role === "member" ? taskDetails.createdBy : taskDetails.employeeEmail;
    if (recipientEmail && recipientEmail.toLowerCase() !== currentUser.email.toLowerCase()) {
      await db.insert(notifications).values({
        recipientEmail,
        type: "task_note_added",
        taskId,
        title: "Task note added · تمت إضافة ملاحظة على المهمة",
        message: `${taskDetails.title} · ${currentUser.displayName} · ملاحظة جديدة`,
      });
    }
    await recordActivity(db, currentUser, { action: "note_added", entityType: "task", entityId: taskId, entityLabel: taskDetails.title, projectCode: taskDetails.project, details: body });
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

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (currentUser.role !== "owner") return Response.json({ error: "Only the owner can delete task notes." }, { status: 403 });
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid note id." }, { status: 400 });
    const db = await getDb();
    const [comment] = await db.select().from(taskComments).where(eq(taskComments.id, id)).limit(1);
    if (!comment) return Response.json({ error: "Note not found." }, { status: 404 });
    const [taskDetails] = await db.select({ title: tasks.title, project: tasks.project }).from(tasks).where(eq(tasks.id, comment.taskId)).limit(1);
    await db.delete(taskComments).where(eq(taskComments.id, id));
    await db.update(tasks).set({ updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(tasks.id, comment.taskId));
    if (taskDetails) await recordActivity(db, currentUser, { action: "deleted", entityType: "task", entityId: comment.taskId, entityLabel: taskDetails.title, projectCode: taskDetails.project, details: `Note deleted: ${comment.body}` });
    return Response.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete note." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const payload = (await request.json()) as Record<string, unknown>;
    const id = Number(payload.id);
    const body = typeof payload.body === "string" ? payload.body.trim().slice(0, 2000) : "";
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid note id." }, { status: 400 });
    if (!body) return Response.json({ error: "The note cannot be empty." }, { status: 400 });

    const db = await getDb();
    const [comment] = await db.select().from(taskComments).where(eq(taskComments.id, id)).limit(1);
    if (!comment) return Response.json({ error: "Note not found." }, { status: 404 });
    if (comment.authorEmail.toLowerCase() !== currentUser.email.toLowerCase()) {
      return Response.json({ error: "Only the note author can edit it." }, { status: 403 });
    }
    const elapsed = Date.now() - timestampMs(comment.createdAt);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > COMMENT_EDIT_WINDOW_MS) {
      return Response.json({ error: "The 15-minute note editing window has expired." }, { status: 403 });
    }

    const [updated] = await db.update(taskComments).set({ body }).where(eq(taskComments.id, id)).returning();
    await db.update(tasks).set({ updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(tasks.id, comment.taskId));
    const [taskDetails] = await db.select({ title: tasks.title, project: tasks.project }).from(tasks).where(eq(tasks.id, comment.taskId)).limit(1);
    if (taskDetails) await recordActivity(db, currentUser, { action: "updated", entityType: "task", entityId: comment.taskId, entityLabel: taskDetails.title, projectCode: taskDetails.project, details: `Note edited: ${body}` });
    return Response.json({ comment: updated });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to edit note." }, { status: 500 });
  }
}
