import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs, issueComments, notifications, projectIssues, users } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";
import { ensureIssueCommentsStorage } from "@/lib/issue-comments-storage";

export const dynamic = "force-dynamic";
const COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;

function cleanText(value: unknown, max = 2_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function timestampMs(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Date(normalized).getTime();
}

async function issueCreatorEmail(db: Awaited<ReturnType<typeof getDb>>, issueId: number) {
  const [created] = await db.select({ actorEmail: activityLogs.actorEmail })
    .from(activityLogs)
    .where(and(eq(activityLogs.entityType, "issue"), eq(activityLogs.entityId, issueId), eq(activityLogs.action, "created")))
    .orderBy(asc(activityLogs.id))
    .limit(1);
  return created?.actorEmail || "";
}

async function canComment(currentUser: Awaited<ReturnType<typeof getCurrentUser>>, issue: typeof projectIssues.$inferSelect, creatorEmail: string) {
  return currentUser.role === "owner" || currentUser.email === issue.raisedByEmail || currentUser.email === creatorEmail;
}

async function notifyCounterpart(
  db: Awaited<ReturnType<typeof getDb>>,
  currentUser: Awaited<ReturnType<typeof getCurrentUser>>,
  issue: typeof projectIssues.$inferSelect,
  creatorEmail: string,
  section: "internal" | "client",
) {
  let recipientEmail = "";
  if (currentUser.email === issue.raisedByEmail) {
    const [creator] = creatorEmail ? await db.select({ email: users.email }).from(users)
      .where(and(eq(users.email, creatorEmail), inArray(users.role, ["owner", "manager"]), eq(users.active, true))).limit(1) : [];
    recipientEmail = creator?.email || "";
  } else {
    recipientEmail = issue.raisedByEmail;
  }
  if (!recipientEmail || recipientEmail.toLowerCase() === currentUser.email.toLowerCase()) return;
  await db.insert(notifications).values({
    recipientEmail,
    type: "issue_note_added",
    issueId: issue.id,
    title: section === "client" ? "Client response note added" : "Project issue note added",
    message: `${issue.issueNumber} · ${currentUser.displayName}`,
  });
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    await ensureIssueCommentsStorage();
    const payload = await request.json() as Record<string, unknown>;
    const issueId = Number(payload.issueId);
    const section = payload.section === "client" ? "client" as const : "internal" as const;
    const body = cleanText(payload.body);
    if (!Number.isInteger(issueId)) return Response.json({ error: "Invalid issue id." }, { status: 400 });
    if (!body) return Response.json({ error: "Write a note before posting." }, { status: 400 });
    const db = await getDb();
    const [issue] = await db.select().from(projectIssues).where(eq(projectIssues.id, issueId)).limit(1);
    if (!issue) return Response.json({ error: "Project issue not found." }, { status: 404 });
    const creatorEmail = await issueCreatorEmail(db, issueId);
    if (!(await canComment(currentUser, issue, creatorEmail))) return Response.json({ error: "You cannot comment on this issue." }, { status: 403 });
    const [note] = await db.insert(issueComments).values({ issueId, section, authorEmail: currentUser.email, authorName: currentUser.displayName, body }).returning();
    await db.update(projectIssues).set({ updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(projectIssues.id, issueId));
    await notifyCounterpart(db, currentUser, issue, creatorEmail, section);
    await recordActivity(db, currentUser, { action: "note_added", entityType: "issue", entityId: issueId, entityLabel: issue.issueNumber, projectCode: issue.projectCode, details: `${section === "client" ? "Client response" : "Issue"} note: ${body}` });
    return Response.json({ note }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to post issue note." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    await ensureIssueCommentsStorage();
    const payload = await request.json() as Record<string, unknown>;
    const id = Number(payload.id);
    const body = cleanText(payload.body);
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid note id." }, { status: 400 });
    if (!body) return Response.json({ error: "The note cannot be empty." }, { status: 400 });
    const db = await getDb();
    const [note] = await db.select().from(issueComments).where(eq(issueComments.id, id)).limit(1);
    if (!note) return Response.json({ error: "Note not found." }, { status: 404 });
    if (note.authorEmail.toLowerCase() !== currentUser.email.toLowerCase()) return Response.json({ error: "Only the note author can edit it." }, { status: 403 });
    const elapsed = Date.now() - timestampMs(note.createdAt);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > COMMENT_EDIT_WINDOW_MS) return Response.json({ error: "The 15-minute note editing window has expired." }, { status: 403 });
    const [updated] = await db.update(issueComments).set({ body }).where(eq(issueComments.id, id)).returning();
    const [issue] = await db.select().from(projectIssues).where(eq(projectIssues.id, note.issueId)).limit(1);
    if (issue) {
      await db.update(projectIssues).set({ updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(projectIssues.id, note.issueId));
      await recordActivity(db, currentUser, { action: "updated", entityType: "issue", entityId: note.issueId, entityLabel: issue.issueNumber, projectCode: issue.projectCode, details: `Note edited: ${body}` });
    }
    return Response.json({ note: updated });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to edit issue note." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    await ensureIssueCommentsStorage();
    if (currentUser.role !== "owner") return Response.json({ error: "Only the owner can delete issue notes." }, { status: 403 });
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid note id." }, { status: 400 });
    const db = await getDb();
    const [note] = await db.select().from(issueComments).where(eq(issueComments.id, id)).limit(1);
    if (!note) return Response.json({ error: "Note not found." }, { status: 404 });
    const [issue] = await db.select().from(projectIssues).where(eq(projectIssues.id, note.issueId)).limit(1);
    await db.delete(issueComments).where(eq(issueComments.id, id));
    if (issue) {
      await db.update(projectIssues).set({ updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(projectIssues.id, note.issueId));
      await recordActivity(db, currentUser, { action: "deleted", entityType: "issue", entityId: note.issueId, entityLabel: issue.issueNumber, projectCode: issue.projectCode, details: `Note deleted: ${note.body}` });
    }
    return Response.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete issue note." }, { status: 500 });
  }
}
