import { and, eq } from "drizzle-orm";
import { getBucket, getDb } from "@/db";
import { projectMembers, projects } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse, type AppUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const CHUNK_BYTES = 512 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_IMAGE_BYTES / CHUNK_BYTES);
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type ImageManifest = {
  projectCode: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  objectKey: string;
  chunkCount: number;
};

function safeName(value: string) { return value.replace(/[^a-z0-9._-]/gi, "_").slice(0, 120) || "note-image"; }
function validUploadId(value: string) { return /^[0-9a-f-]{36}$/i.test(value); }
function manifestKey(id: string) { return `project-note-images/uploads/${id}/manifest.json`; }
function chunkKey(id: string, index: number) { return `project-note-images/uploads/${id}/chunks/${String(index).padStart(3, "0")}`; }

async function canAccessProject(db: Awaited<ReturnType<typeof getDb>>, user: AppUser, projectCode: string) {
  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, projectCode)).limit(1);
  if (!project) return false;
  if (user.role === "owner") return true;
  const [membership] = await db.select({ id: projectMembers.id }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.employeeEmail, user.email))).limit(1);
  return Boolean(membership);
}

async function readManifest(bucket: R2Bucket, uploadId: string) {
  const object = await bucket.get(manifestKey(uploadId));
  if (!object) return null;
  try { return JSON.parse(await object.text()) as ImageManifest; } catch { return null; }
}

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const key = new URL(request.url).searchParams.get("key") || "";
    const match = key.match(/^project-note-images\/([^/]+)\/[0-9a-f-]+-[a-z0-9._-]+$/i);
    if (!match) return new Response(null, { status: 404 });
    const projectCode = decodeURIComponent(match[1]).toUpperCase();
    const db = await getDb();
    if (!(await canAccessProject(db, currentUser, projectCode))) return new Response(null, { status: 404 });
    const object = await (await getBucket()).get(key);
    if (!object) return new Response(null, { status: 404 });
    return new Response(object.body, { headers: {
      "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load note image." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "start";
    const bucket = await getBucket();

    if (action === "chunk") {
      const uploadId = url.searchParams.get("uploadId") || "";
      const index = Number(url.searchParams.get("index"));
      if (!validUploadId(uploadId) || !Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) return Response.json({ error: "Invalid image chunk." }, { status: 400 });
      const manifest = await readManifest(bucket, uploadId);
      if (!manifest || manifest.uploadedBy !== currentUser.email || index >= manifest.chunkCount) return Response.json({ error: "Image upload was not found." }, { status: 404 });
      const chunk = await request.arrayBuffer();
      if (!chunk.byteLength || chunk.byteLength > CHUNK_BYTES) return Response.json({ error: "Invalid image chunk size." }, { status: 413 });
      await bucket.put(chunkKey(uploadId, index), chunk, { httpMetadata: { contentType: "application/octet-stream" } });
      return Response.json({ ok: true });
    }

    const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (action === "start") {
      const projectCode = typeof payload.projectCode === "string" ? payload.projectCode.trim().toUpperCase().slice(0, 80) : "";
      const contentType = typeof payload.contentType === "string" ? payload.contentType : "";
      const sizeBytes = Number(payload.sizeBytes);
      if (!projectCode || !imageTypes.has(contentType)) return Response.json({ error: "Choose a JPG, PNG, WEBP, or GIF image." }, { status: 400 });
      if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_IMAGE_BYTES) return Response.json({ error: "Images must not exceed 8 MB." }, { status: 413 });
      const db = await getDb();
      if (!(await canAccessProject(db, currentUser, projectCode))) return Response.json({ error: "You cannot add images to this notebook." }, { status: 403 });
      const uploadId = crypto.randomUUID();
      const objectKey = `project-note-images/${encodeURIComponent(projectCode)}/${crypto.randomUUID()}-${safeName(typeof payload.fileName === "string" ? payload.fileName : "image")}`;
      const manifest: ImageManifest = { projectCode, contentType, sizeBytes, uploadedBy: currentUser.email, objectKey, chunkCount: Math.ceil(sizeBytes / CHUNK_BYTES) };
      await bucket.put(manifestKey(uploadId), JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
      return Response.json({ uploadId, chunkBytes: CHUNK_BYTES, chunkCount: manifest.chunkCount });
    }

    if (action === "complete") {
      const uploadId = typeof payload.uploadId === "string" ? payload.uploadId : "";
      const manifest = validUploadId(uploadId) ? await readManifest(bucket, uploadId) : null;
      if (!manifest || manifest.uploadedBy !== currentUser.email) return Response.json({ error: "Image upload was not found." }, { status: 404 });
      const db = await getDb();
      if (!(await canAccessProject(db, currentUser, manifest.projectCode))) return Response.json({ error: "You cannot add images to this notebook." }, { status: 403 });
      const assembled = new Uint8Array(manifest.sizeBytes);
      const keys: string[] = [];
      let offset = 0;
      for (let index = 0; index < manifest.chunkCount; index += 1) {
        const key = chunkKey(uploadId, index);
        const object = await bucket.get(key);
        if (!object) return Response.json({ error: `Image upload is missing part ${index + 1}.` }, { status: 409 });
        const bytes = new Uint8Array(await object.arrayBuffer());
        if (offset + bytes.byteLength > assembled.length) return Response.json({ error: "Image size mismatch." }, { status: 400 });
        assembled.set(bytes, offset); offset += bytes.byteLength; keys.push(key);
      }
      if (offset !== assembled.length) return Response.json({ error: "Image size mismatch." }, { status: 400 });
      await bucket.put(manifest.objectKey, assembled, { httpMetadata: { contentType: manifest.contentType, cacheControl: "private, max-age=300" } });
      await bucket.delete([...keys, manifestKey(uploadId)]);
      return Response.json({ url: `/api/project-note-images?key=${encodeURIComponent(manifest.objectKey)}` }, { status: 201 });
    }
    return Response.json({ error: "Invalid image upload action." }, { status: 400 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to upload note image." }, { status: 500 });
  }
}
