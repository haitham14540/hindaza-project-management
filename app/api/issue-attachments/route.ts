import { and, eq } from "drizzle-orm";
import { getBucket, getDb } from "@/db";
import { issueAttachments, projectIssues } from "@/db/schema";
import { getCurrentUser, isManagement, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;
const CHUNK_BYTES = 768 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_FILE_BYTES / CHUNK_BYTES);

type UploadManifest = {
  issueId: number;
  issueNumber: string;
  projectCode: string;
  source: "internal" | "client";
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  objectKey: string;
  chunkCount: number;
};

function safeName(name: string) {
  return name.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "attachment";
}

function validUploadId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function manifestKey(uploadId: string) {
  return `project-issues/uploads/${uploadId}/manifest.json`;
}

function chunkKey(uploadId: string, index: number) {
  return `project-issues/uploads/${uploadId}/chunks/${String(index).padStart(3, "0")}`;
}

async function readManifest(bucket: R2Bucket, uploadId: string) {
  const object = await bucket.get(manifestKey(uploadId));
  if (!object) return null;
  try { return JSON.parse(await object.text()) as UploadManifest; }
  catch { return null; }
}

async function removeTemporaryUpload(bucket: R2Bucket, uploadId: string, chunkCount: number) {
  const keys = [manifestKey(uploadId), ...Array.from({ length: Math.min(chunkCount, MAX_CHUNKS) }, (_, index) => chunkKey(uploadId, index))];
  await bucket.delete(keys);
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
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "legacy";
    const currentUser = await getCurrentUser(request);
    if (action === "chunk") {
      const uploadId = url.searchParams.get("uploadId") || "";
      const index = Number(url.searchParams.get("index"));
      if (!validUploadId(uploadId) || !Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) {
        return Response.json({ error: "Invalid upload chunk." }, { status: 400 });
      }
      const bucket = await getBucket();
      const manifest = await readManifest(bucket, uploadId);
      if (!manifest || manifest.uploadedBy !== currentUser.email || index >= manifest.chunkCount) {
        return Response.json({ error: "Upload session not found." }, { status: 404 });
      }
      const chunk = await request.arrayBuffer();
      if (!chunk.byteLength || chunk.byteLength > CHUNK_BYTES) return Response.json({ error: "Invalid upload chunk size." }, { status: 413 });
      await bucket.put(chunkKey(uploadId, index), chunk, { httpMetadata: { contentType: "application/octet-stream" } });
      return Response.json({ ok: true });
    }

    if (action === "start") {
      const payload = await request.json() as Record<string, unknown>;
      const issueId = Number(payload.issueId);
      const source = payload.source === "client" ? "client" : "internal";
      const fileName = safeName(typeof payload.fileName === "string" ? payload.fileName : "attachment");
      const contentType = typeof payload.contentType === "string" && payload.contentType ? payload.contentType.slice(0, 180) : "application/octet-stream";
      const sizeBytes = Number(payload.sizeBytes);
      if (!Number.isInteger(issueId)) return Response.json({ error: "Invalid issue id." }, { status: 400 });
      if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FILE_BYTES) return Response.json({ error: "Each attachment must not exceed 25 MB." }, { status: 413 });
      const db = await getDb();
      const [issue] = await db.select({ id: projectIssues.id, issueNumber: projectIssues.issueNumber, projectCode: projectIssues.projectCode }).from(projectIssues).where(eq(projectIssues.id, issueId)).limit(1);
      if (!issue) return Response.json({ error: "Project issue not found." }, { status: 404 });
      const existing = await db.select({ id: issueAttachments.id }).from(issueAttachments).where(and(eq(issueAttachments.issueId, issueId), eq(issueAttachments.source, source)));
      if (existing.length >= MAX_FILES) return Response.json({ error: `An issue can contain up to ${MAX_FILES} attachments.` }, { status: 400 });
      const uploadId = crypto.randomUUID();
      const chunkCount = Math.ceil(sizeBytes / CHUNK_BYTES);
      const manifest: UploadManifest = {
        issueId,
        issueNumber: issue.issueNumber,
        projectCode: issue.projectCode,
        source,
        fileName,
        contentType,
        sizeBytes,
        uploadedBy: currentUser.email,
        objectKey: `project-issues/${issueId}/${source}/${crypto.randomUUID()}-${fileName}`,
        chunkCount,
      };
      await (await getBucket()).put(manifestKey(uploadId), JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
      return Response.json({ uploadId, chunkBytes: CHUNK_BYTES, chunkCount });
    }

    if (action === "complete" || action === "abort") {
      const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
      const uploadId = typeof payload.uploadId === "string" ? payload.uploadId : "";
      if (!validUploadId(uploadId)) return Response.json({ error: "Invalid upload session." }, { status: 400 });
      const bucket = await getBucket();
      const manifest = await readManifest(bucket, uploadId);
      if (!manifest || manifest.uploadedBy !== currentUser.email) return Response.json({ error: "Upload session not found." }, { status: 404 });
      if (action === "abort") {
        await removeTemporaryUpload(bucket, uploadId, manifest.chunkCount);
        return Response.json({ ok: true });
      }

      const assembled = new Uint8Array(manifest.sizeBytes);
      const temporaryKeys: string[] = [];
      let offset = 0;
      for (let index = 0; index < manifest.chunkCount; index += 1) {
        const key = chunkKey(uploadId, index);
        const object = await bucket.get(key);
        if (!object) return Response.json({ error: `Upload is incomplete at part ${index + 1}.` }, { status: 409 });
        const bytes = new Uint8Array(await object.arrayBuffer());
        if (offset + bytes.byteLength > assembled.byteLength) return Response.json({ error: "Uploaded file size does not match." }, { status: 400 });
        assembled.set(bytes, offset);
        offset += bytes.byteLength;
        temporaryKeys.push(key);
      }
      if (offset !== manifest.sizeBytes) return Response.json({ error: "Uploaded file size does not match." }, { status: 400 });
      await bucket.put(manifest.objectKey, assembled, {
        httpMetadata: { contentType: manifest.contentType, cacheControl: "private, max-age=120" },
        customMetadata: { issueId: String(manifest.issueId), uploadedBy: currentUser.email, source: manifest.source },
      });
      const db = await getDb();
      const inserted = await db.insert(issueAttachments).values({
        issueId: manifest.issueId,
        objectKey: manifest.objectKey,
        fileName: manifest.fileName,
        contentType: manifest.contentType,
        sizeBytes: manifest.sizeBytes,
        uploadedBy: currentUser.email,
        source: manifest.source,
      }).returning();
      await recordActivity(db, currentUser, { action: "attachment_added", entityType: "issue", entityId: manifest.issueId, entityLabel: manifest.issueNumber, projectCode: manifest.projectCode, details: manifest.fileName });
      await bucket.delete([...temporaryKeys, manifestKey(uploadId)]);
      return Response.json({ attachments: inserted }, { status: 201 });
    }

    const form = await request.formData();
    const issueId = Number(form.get("issueId"));
    const source = form.get("source") === "client" ? "client" : "internal";
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (!Number.isInteger(issueId)) return Response.json({ error: "Invalid issue id." }, { status: 400 });
    if (!files.length || files.length > MAX_FILES) return Response.json({ error: `Select between 1 and ${MAX_FILES} files.` }, { status: 400 });
    if (files.some((file) => file.size > MAX_FILE_BYTES)) return Response.json({ error: "Each attachment must not exceed 25 MB." }, { status: 413 });
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
