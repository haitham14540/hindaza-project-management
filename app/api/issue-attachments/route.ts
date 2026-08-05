import { and, eq } from "drizzle-orm";
import { getBucket, getDb } from "@/db";
import { issueAttachments, projectIssues } from "@/db/schema";
import { getCurrentUser, isManagement, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;

function safeName(name: string) {
  return name.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "attachment";
}

export async function GET(request: Request) {
  try {
    await getCurrentUser(request);
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid attachment id." }, { status: 400 });
    const db = await getDb();
    const [attachment] = await db.select().from(issueAttachments).where(eq(issueAttachments.id, id)).limit(1);
    if (!attachment) return new Response(null, { status: 404 });
    const object = await (await getBucket()).get(attachment.objectKey);
    if (!object) return new Response(null, { status: 404 });
    const headers = new Headers();
    headers.set("Content-Type", attachment.contentType || "application/octet-stream");
    headers.set("Content-Length", String(attachment.sizeBytes));
    const safeInlineTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);
    const disposition = url.searchParams.get("download") === "1" || !safeInlineTypes.has(attachment.contentType) ? "attachment" : "inline";
    headers.set("Content-Disposition", `${disposition}; filename="${safeName(attachment.fileName)}"`);
    headers.set("Cache-Control", "private, max-age=120");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(object.body, { headers });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load attachment." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const form = await request.formData();
    const issueId = Number(form.get("issueId"));
    const source = form.get("source") === "client" ? "client" : "internal";
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (!Number.isInteger(issueId)) return Response.json({ error: "Invalid issue id." }, { status: 400 });
    if (!files.length || files.length > MAX_FILES) return Response.json({ error: `Select between 1 and ${MAX_FILES} files.` }, { status: 400 });
    if (files.some((file) => file.size > MAX_FILE_BYTES)) return Response.json({ error: "Each attachment must not exceed 10 MB." }, { status: 413 });
    const db = await getDb();
    const [issue] = await db.select({ id: projectIssues.id, issueNumber: projectIssues.issueNumber, projectCode: projectIssues.projectCode }).from(projectIssues).where(eq(projectIssues.id, issueId)).limit(1);
    if (!issue) return Response.json({ error: "Project issue not found." }, { status: 404 });
    const existing = await db.select({ id: issueAttachments.id }).from(issueAttachments).where(and(eq(issueAttachments.issueId, issueId), eq(issueAttachments.source, source)));
    if (existing.length + files.length > MAX_FILES) return Response.json({ error: `An issue can contain up to ${MAX_FILES} attachments.` }, { status: 400 });

    const bucket = await getBucket();
    const values = [];
    for (const file of files) {
      const fileName = safeName(file.name);
      const objectKey = `project-issues/${issueId}/${source}/${crypto.randomUUID()}-${fileName}`;
      const contentType = file.type || "application/octet-stream";
      await bucket.put(objectKey, file.stream(), {
        httpMetadata: { contentType, cacheControl: "private, max-age=120" },
        customMetadata: { issueId: String(issueId), uploadedBy: currentUser.email, source },
      });
      values.push({ issueId, objectKey, fileName, contentType, sizeBytes: file.size, uploadedBy: currentUser.email, source });
    }
    const inserted = await db.insert(issueAttachments).values(values).returning();
    await recordActivity(db, currentUser, { action: "attachment_added", entityType: "issue", entityId: issueId, entityLabel: issue.issueNumber, projectCode: issue.projectCode, details: files.map((file) => file.name).join(", ") });
    return Response.json({ attachments: inserted }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to upload attachments." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid attachment id." }, { status: 400 });
    const db = await getDb();
    const [attachment] = await db.select().from(issueAttachments).where(eq(issueAttachments.id, id)).limit(1);
    if (!attachment) return Response.json({ error: "Attachment not found." }, { status: 404 });
    if (!isManagement(currentUser) && attachment.uploadedBy !== currentUser.email) return Response.json({ error: "You cannot delete this attachment." }, { status: 403 });
    await (await getBucket()).delete(attachment.objectKey);
    await db.delete(issueAttachments).where(eq(issueAttachments.id, id));
    const [issue] = await db.select({ issueNumber: projectIssues.issueNumber, projectCode: projectIssues.projectCode }).from(projectIssues).where(eq(projectIssues.id, attachment.issueId)).limit(1);
    if (issue) await recordActivity(db, currentUser, { action: "attachment_deleted", entityType: "issue", entityId: attachment.issueId, entityLabel: issue.issueNumber, projectCode: issue.projectCode, details: attachment.fileName });
    return Response.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete attachment." }, { status: 500 });
  }
}
