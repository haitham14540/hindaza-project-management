import { and, eq, isNull } from "drizzle-orm";
import { getBucket, getDb } from "@/db";
import { taskAttachments, taskSubtasks } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";
import { taskForCollaboration } from "@/lib/task-access";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;
const CHUNK_BYTES = 768 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_FILE_BYTES / CHUNK_BYTES);

type UploadManifest = {
  taskId: number;
  subtaskId: number | null;
  taskTitle: string;
  projectCode: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  objectKey: string;
  chunkCount: number;
};

function safeName(name: string) { return name.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "attachment"; }
function validUploadId(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function manifestKey(uploadId: string) { return `task-attachments/uploads/${uploadId}/manifest.json`; }
function chunkKey(uploadId: string, index: number) { return `task-attachments/uploads/${uploadId}/chunks/${String(index).padStart(3, "0")}`; }

async function readManifest(bucket: R2Bucket, uploadId: string) {
  const object = await bucket.get(manifestKey(uploadId));
  if (!object) return null;
  try { return JSON.parse(await object.text()) as UploadManifest; } catch { return null; }
}

async function removeTemporaryUpload(bucket: R2Bucket, uploadId: string, chunkCount: number) {
  await bucket.delete([manifestKey(uploadId), ...Array.from({ length: Math.min(chunkCount, MAX_CHUNKS) }, (_, index) => chunkKey(uploadId, index))]);
}

async function validSubtask(db: Awaited<ReturnType<typeof getDb>>, taskId: number, subtaskId: number | null) {
  if (subtaskId === null) return true;
  const [row] = await db.select({ id: taskSubtasks.id }).from(taskSubtasks)
    .where(and(eq(taskSubtasks.id, subtaskId), eq(taskSubtasks.taskId, taskId))).limit(1);
  return Boolean(row);
}

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid attachment id." }, { status: 400 });
    const db = await getDb();
    const [attachment] = await db.select().from(taskAttachments).where(eq(taskAttachments.id, id)).limit(1);
    if (!attachment || !(await taskForCollaboration(db, currentUser, attachment.taskId))) return new Response(null, { status: 404 });
    const object = await (await getBucket()).get(attachment.objectKey);
    if (!object) return new Response(null, { status: 404 });
    const headers = new Headers({
      "Content-Type": attachment.contentType || "application/octet-stream",
      "Content-Length": String(attachment.sizeBytes),
      "Cache-Control": "private, max-age=120",
      "X-Content-Type-Options": "nosniff",
    });
    const inlineTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"]);
    const disposition = url.searchParams.get("download") === "1" || !inlineTypes.has(attachment.contentType) ? "attachment" : "inline";
    headers.set("Content-Disposition", `${disposition}; filename="${safeName(attachment.fileName)}"`);
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
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "start";
    if (action === "chunk") {
      const uploadId = url.searchParams.get("uploadId") || "";
      const index = Number(url.searchParams.get("index"));
      if (!validUploadId(uploadId) || !Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) return Response.json({ error: "Invalid upload chunk." }, { status: 400 });
      const bucket = await getBucket();
      const manifest = await readManifest(bucket, uploadId);
      if (!manifest || manifest.uploadedBy !== currentUser.email || index >= manifest.chunkCount) return Response.json({ error: "Upload session not found." }, { status: 404 });
      const chunk = await request.arrayBuffer();
      if (!chunk.byteLength || chunk.byteLength > CHUNK_BYTES) return Response.json({ error: "Invalid upload chunk size." }, { status: 413 });
      await bucket.put(chunkKey(uploadId, index), chunk, { httpMetadata: { contentType: "application/octet-stream" } });
      return Response.json({ ok: true });
    }

    const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (action === "start") {
      const taskId = Number(payload.taskId);
      const subtaskId = payload.subtaskId === null || payload.subtaskId === undefined ? null : Number(payload.subtaskId);
      const fileName = safeName(typeof payload.fileName === "string" ? payload.fileName : "attachment");
      const contentType = typeof payload.contentType === "string" && payload.contentType ? payload.contentType.slice(0, 180) : "application/octet-stream";
      const sizeBytes = Number(payload.sizeBytes);
      if (!Number.isInteger(taskId) || (subtaskId !== null && !Number.isInteger(subtaskId))) return Response.json({ error: "Invalid task attachment target." }, { status: 400 });
      if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FILE_BYTES) return Response.json({ error: "Each attachment must not exceed 25 MB." }, { status: 413 });
      const db = await getDb();
      const task = await taskForCollaboration(db, currentUser, taskId);
      if (!task || !(await validSubtask(db, taskId, subtaskId))) return Response.json({ error: "You cannot add attachments here." }, { status: 403 });
      const existing = subtaskId === null
        ? await db.select({ id: taskAttachments.id }).from(taskAttachments).where(and(eq(taskAttachments.taskId, taskId), isNull(taskAttachments.subtaskId)))
        : await db.select({ id: taskAttachments.id }).from(taskAttachments).where(eq(taskAttachments.subtaskId, subtaskId));
      if (existing.length >= MAX_FILES) return Response.json({ error: `Up to ${MAX_FILES} attachments are allowed here.` }, { status: 400 });
      const uploadId = crypto.randomUUID();
      const manifest: UploadManifest = {
        taskId, subtaskId, taskTitle: task.title, projectCode: task.project, fileName, contentType, sizeBytes,
        uploadedBy: currentUser.email,
        objectKey: `tasks/${taskId}/${subtaskId ? `subtasks/${subtaskId}` : "attachments"}/${crypto.randomUUID()}-${fileName}`,
        chunkCount: Math.ceil(sizeBytes / CHUNK_BYTES),
      };
      await (await getBucket()).put(manifestKey(uploadId), JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
      return Response.json({ uploadId, chunkBytes: CHUNK_BYTES, chunkCount: manifest.chunkCount });
    }

    if (action === "complete" || action === "abort") {
      const uploadId = typeof payload.uploadId === "string" ? payload.uploadId : "";
      if (!validUploadId(uploadId)) return Response.json({ error: "Invalid upload session." }, { status: 400 });
      const bucket = await getBucket();
      const manifest = await readManifest(bucket, uploadId);
      if (!manifest || manifest.uploadedBy !== currentUser.email) return Response.json({ error: "Upload session not found." }, { status: 404 });
      if (action === "abort") { await removeTemporaryUpload(bucket, uploadId, manifest.chunkCount); return Response.json({ ok: true }); }
      const db = await getDb();
      if (!(await taskForCollaboration(db, currentUser, manifest.taskId))) return Response.json({ error: "You cannot add attachments here." }, { status: 403 });
      const assembled = new Uint8Array(manifest.sizeBytes);
      const temporaryKeys: string[] = [];
      let offset = 0;
      for (let index = 0; index < manifest.chunkCount; index += 1) {
        const key = chunkKey(uploadId, index);
        const object = await bucket.get(key);
        if (!object) return Response.json({ error: `Upload is incomplete at part ${index + 1}.` }, { status: 409 });
        const bytes = new Uint8Array(await object.arrayBuffer());
        if (offset + bytes.byteLength > assembled.byteLength) return Response.json({ error: "Uploaded file size does not match." }, { status: 400 });
        assembled.set(bytes, offset); offset += bytes.byteLength; temporaryKeys.push(key);
      }
      if (offset !== manifest.sizeBytes) return Response.json({ error: "Uploaded file size does not match." }, { status: 400 });
      await bucket.put(manifest.objectKey, assembled, { httpMetadata: { contentType: manifest.contentType, cacheControl: "private, max-age=120" } });
      const [attachment] = await db.insert(taskAttachments).values({
        taskId: manifest.taskId, subtaskId: manifest.subtaskId, objectKey: manifest.objectKey, fileName: manifest.fileName,
        contentType: manifest.contentType, sizeBytes: manifest.sizeBytes, uploadedBy: currentUser.email,
      }).returning();
      await recordActivity(db, currentUser, { action: "attachment_added", entityType: "task", entityId: manifest.taskId, entityLabel: manifest.taskTitle, projectCode: manifest.projectCode, details: manifest.subtaskId ? `Subtask attachment: ${manifest.fileName}` : manifest.fileName });
      await bucket.delete([...temporaryKeys, manifestKey(uploadId)]);
      return Response.json({ attachment }, { status: 201 });
    }
    return Response.json({ error: "Invalid upload action." }, { status: 400 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to upload attachment." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid attachment id." }, { status: 400 });
    const db = await getDb();
    const [attachment] = await db.select().from(taskAttachments).where(eq(taskAttachments.id, id)).limit(1);
    if (!attachment) return Response.json({ error: "Attachment not found." }, { status: 404 });
    const task = await taskForCollaboration(db, currentUser, attachment.taskId);
    if (!task) return Response.json({ error: "You cannot delete this attachment." }, { status: 403 });
    await (await getBucket()).delete(attachment.objectKey);
    await db.delete(taskAttachments).where(eq(taskAttachments.id, id));
    await recordActivity(db, currentUser, { action: "attachment_deleted", entityType: "task", entityId: task.id, entityLabel: task.title, projectCode: task.project, details: attachment.fileName });
    return Response.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete attachment." }, { status: 500 });
  }
}
