import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { projectMembers, projectNotes, projects } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse, type AppUser } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const MAX_NOTE_HTML = 250_000;
const allowedTags = new Set(["p", "div", "br", "h1", "h2", "h3", "h4", "b", "strong", "i", "em", "u", "s", "ul", "ol", "li", "blockquote", "span", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "img"]);
const allowedStyleProperties = new Set(["color", "background-color", "font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-align", "line-height", "width", "height", "min-width", "max-width", "margin-left", "margin-right", "display"]);

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeStyle(value: string) {
  return value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const separator = declaration.indexOf(":");
      if (separator < 1) return "";
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const styleValue = declaration.slice(separator + 1).trim();
      if (!allowedStyleProperties.has(property) || !styleValue || styleValue.length > 80) return "";
      if (!/^[a-z0-9#(),.%\s"'\-]+$/i.test(styleValue) || /url|expression|javascript/i.test(styleValue)) return "";
      return `${property}:${styleValue}`;
    })
    .filter(Boolean)
    .join(";");
}

function sanitizeNoteHtml(value: unknown) {
  const source = typeof value === "string" ? value.slice(0, MAX_NOTE_HTML) : "";
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, (rawTag) => {
      const match = rawTag.match(/^<\s*(\/?)\s*([a-z0-9]+)([^>]*)>$/i);
      if (!match) return "";
      const closing = Boolean(match[1]);
      const tag = match[2].toLowerCase();
      if (!allowedTags.has(tag)) return "";
      if (closing) return tag === "br" ? "" : `</${tag}>`;
      if (tag === "br") return "<br>";
      const styleMatch = match[3].match(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const style = safeStyle(styleMatch?.[1] || styleMatch?.[2] || "");
      const dirMatch = match[3].match(/\sdir\s*=\s*(?:"(rtl|ltr)"|'(rtl|ltr)')/i);
      const direction = (dirMatch?.[1] || dirMatch?.[2] || "").toLowerCase();
      if (tag === "img") {
        const srcMatch = match[3].match(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
        const src = (srcMatch?.[1] || srcMatch?.[2] || "").replace(/&amp;/g, "&");
        if (!/^\/api\/project-note-images\?key=[a-z0-9%._~/-]+$/i.test(src)) return "";
        const altMatch = match[3].match(/\salt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
        const alt = cleanText(altMatch?.[1] || altMatch?.[2] || "Project note image", 160).replace(/["<>]/g, "");
        return `<img src="${src}" alt="${alt}"${style ? ` style="${style}"` : ""}>`;
      }
      return `<${tag}${direction ? ` dir="${direction}"` : ""}${style ? ` style="${style}"` : ""}>`;
    });
}

async function canAccessProject(db: Awaited<ReturnType<typeof getDb>>, user: AppUser, projectCode: string) {
  const [project] = await db.select({ id: projects.id, code: projects.code }).from(projects).where(eq(projects.code, projectCode)).limit(1);
  if (!project) return false;
  if (user.role === "owner") return true;
  const [membership] = await db.select({ id: projectMembers.id }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.employeeEmail, user.email))).limit(1);
  return Boolean(membership);
}

async function noteById(db: Awaited<ReturnType<typeof getDb>>, id: number) {
  const [note] = await db.select().from(projectNotes).where(eq(projectNotes.id, id)).limit(1);
  return note;
}

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    const db = await getDb();
    if (Number.isInteger(id) && id > 0) {
      const note = await noteById(db, id);
      if (!note) return Response.json({ error: "Note not found." }, { status: 404 });
      if (!(await canAccessProject(db, currentUser, note.projectCode))) return Response.json({ error: "You do not have access to this project notebook." }, { status: 403 });
      return Response.json({ note }, { headers: { "Cache-Control": "private, no-store" } });
    }

    const projectCode = cleanText(url.searchParams.get("project"), 80).toUpperCase();
    if (!projectCode) return Response.json({ error: "Project is required." }, { status: 400 });
    if (!(await canAccessProject(db, currentUser, projectCode))) return Response.json({ error: "You do not have access to this project notebook." }, { status: 403 });
    const notes = await db.select({
      id: projectNotes.id,
      projectCode: projectNotes.projectCode,
      title: projectNotes.title,
      createdBy: projectNotes.createdBy,
      updatedBy: projectNotes.updatedBy,
      createdAt: projectNotes.createdAt,
      updatedAt: projectNotes.updatedAt,
    }).from(projectNotes).where(eq(projectNotes.projectCode, projectCode)).orderBy(desc(projectNotes.updatedAt), desc(projectNotes.id));
    return Response.json({ notes }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load project notes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const payload = await request.json() as Record<string, unknown>;
    const projectCode = cleanText(payload.projectCode, 80).toUpperCase();
    const title = cleanText(payload.title, 180) || "Untitled Note";
    const db = await getDb();
    if (!(await canAccessProject(db, currentUser, projectCode))) return Response.json({ error: "You do not have access to this project notebook." }, { status: 403 });
    const [note] = await db.insert(projectNotes).values({
      projectCode,
      title,
      contentHtml: sanitizeNoteHtml(payload.contentHtml) || "<p><br></p>",
      createdBy: currentUser.email,
      updatedBy: currentUser.email,
    }).returning();
    await recordActivity(db, currentUser, { action: "note_added", entityType: "project", entityLabel: note.title, projectCode, details: "Project note page created" });
    return Response.json({ note }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create the note." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const payload = await request.json() as Record<string, unknown>;
    const id = Number(payload.id);
    if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Invalid note id." }, { status: 400 });
    const db = await getDb();
    const existing = await noteById(db, id);
    if (!existing) return Response.json({ error: "Note not found." }, { status: 404 });
    if (!(await canAccessProject(db, currentUser, existing.projectCode))) return Response.json({ error: "You do not have access to this project notebook." }, { status: 403 });
    const title = cleanText(payload.title, 180);
    if (!title) return Response.json({ error: "Note title is required." }, { status: 400 });
    const [note] = await db.update(projectNotes).set({
      title,
      contentHtml: sanitizeNoteHtml(payload.contentHtml),
      updatedBy: currentUser.email,
      updatedAt: new Date().toISOString(),
    }).where(eq(projectNotes.id, id)).returning();
    await recordActivity(db, currentUser, { action: "updated", entityType: "project", entityLabel: note.title, projectCode: note.projectCode, details: "Project note page updated" });
    return Response.json({ note });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save the note." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Invalid note id." }, { status: 400 });
    const db = await getDb();
    const existing = await noteById(db, id);
    if (!existing) return Response.json({ error: "Note not found." }, { status: 404 });
    if (!(await canAccessProject(db, currentUser, existing.projectCode))) return Response.json({ error: "You do not have access to this project notebook." }, { status: 403 });
    if (currentUser.role !== "owner" && existing.createdBy.toLowerCase() !== currentUser.email.toLowerCase()) {
      return Response.json({ error: "Only the note creator or owner can delete this page." }, { status: 403 });
    }
    await db.delete(projectNotes).where(eq(projectNotes.id, id));
    await recordActivity(db, currentUser, { action: "deleted", entityType: "project", entityLabel: existing.title, projectCode: existing.projectCode, details: "Project note page deleted" });
    return Response.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete the note." }, { status: 500 });
  }
}
