import { eq } from "drizzle-orm";
import { getBucket, getDb } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const CHUNK_BYTES = 256 * 1024;
const MAX_CHUNKS = Math.ceil(MAX_IMAGE_BYTES / CHUNK_BYTES);
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

type UploadManifest = {
  targetEmail: string;
  targetName: string;
  previousKey: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  objectKey: string;
  chunkCount: number;
};

function validUploadId(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function manifestKey(uploadId: string) { return `profile-images/uploads/${uploadId}/manifest.json`; }
function chunkKey(uploadId: string, index: number) { return `profile-images/uploads/${uploadId}/chunks/${String(index).padStart(3, "0")}`; }

async function readManifest(bucket: R2Bucket, uploadId: string) {
  const object = await bucket.get(manifestKey(uploadId));
  if (!object) return null;
  try { return JSON.parse(await object.text()) as UploadManifest; } catch { return null; }
}

async function removeTemporaryUpload(bucket: R2Bucket, uploadId: string, chunkCount: number) {
  await bucket.delete([manifestKey(uploadId), ...Array.from({ length: Math.min(chunkCount, MAX_CHUNKS) }, (_, index) => chunkKey(uploadId, index))]);
}

async function removeProfileImage(currentUser: Awaited<ReturnType<typeof getCurrentUser>>, requestedEmail: string) {
  const targetEmail = requestedEmail.trim().toLowerCase() || currentUser.email;
  if (targetEmail !== currentUser.email && currentUser.role !== "owner") {
    return Response.json({ error: "Only the owner can remove another user's profile image." }, { status: 403 });
  }
  const db = await getDb();
  const [targetUser] = await db.select({ email: users.email, displayName: users.displayName, profileImageKey: users.profileImageKey }).from(users)
    .where(eq(users.email, targetEmail)).limit(1);
  if (!targetUser) return Response.json({ error: "User not found." }, { status: 404 });

  // Clear the account reference first. A failed best-effort R2 cleanup must never
  // leave the deleted image visible in the user's account.
  await db.update(users).set({ profileImageKey: "" }).where(eq(users.email, targetEmail));
  await recordActivity(db, currentUser, { action: "updated", entityType: "account", entityLabel: targetUser.displayName, details: targetEmail === currentUser.email ? "Profile image removed" : `Profile image removed by owner for ${targetEmail}` });
  if (targetUser.profileImageKey) {
    try {
      await (await getBucket()).delete(targetUser.profileImageKey);
    } catch (storageError) {
      console.error("Profile image reference cleared; R2 cleanup will be retried later", storageError);
    }
  }
  return Response.json({ ok: true, email: targetEmail, profileImageKey: "" });
}

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const requestedEmail = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() || currentUser.email;
    const db = await getDb();
    const [targetUser] = await db.select({ profileImageKey: users.profileImageKey }).from(users)
      .where(eq(users.email, requestedEmail)).limit(1);
    if (!targetUser?.profileImageKey) return new Response(null, { status: 404 });
    const object = await (await getBucket()).get(targetUser.profileImageKey);
    if (!object) return new Response(null, { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("ETag", object.httpEtag);
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(object.body, { headers });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load profile image." }, { status: 500 });
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
      if (!validUploadId(uploadId) || !Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) {
        return Response.json({ error: "Invalid profile image chunk." }, { status: 400 });
      }
      const bucket = await getBucket();
      const manifest = await readManifest(bucket, uploadId);
      if (!manifest || manifest.uploadedBy !== currentUser.email || index >= manifest.chunkCount) {
        return Response.json({ error: "Profile image upload session not found." }, { status: 404 });
      }
      const chunk = await request.arrayBuffer();
      if (!chunk.byteLength || chunk.byteLength > CHUNK_BYTES) return Response.json({ error: "Invalid profile image chunk size." }, { status: 413 });
      await bucket.put(chunkKey(uploadId, index), chunk, { httpMetadata: { contentType: "application/octet-stream" } });
      return Response.json({ ok: true });
    }

    const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (action === "remove") {
      return removeProfileImage(currentUser, typeof payload.email === "string" ? payload.email : currentUser.email);
    }

    if (action === "start") {
      const targetEmail = (typeof payload.email === "string" ? payload.email : currentUser.email).trim().toLowerCase();
      const contentType = typeof payload.contentType === "string" ? payload.contentType : "";
      const sizeBytes = Number(payload.sizeBytes);
      if (targetEmail !== currentUser.email && currentUser.role !== "owner") {
        return Response.json({ error: "Only the owner can change another user's profile image." }, { status: 403 });
      }
      const extension = ALLOWED_TYPES.get(contentType);
      if (!extension) return Response.json({ error: "Use a JPG, PNG, or WEBP image." }, { status: 400 });
      if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_IMAGE_BYTES) return Response.json({ error: "Image size must not exceed 3 MB." }, { status: 413 });
      const db = await getDb();
      const [targetUser] = await db.select({ email: users.email, displayName: users.displayName, profileImageKey: users.profileImageKey }).from(users)
        .where(eq(users.email, targetEmail)).limit(1);
      if (!targetUser) return Response.json({ error: "User not found." }, { status: 404 });
      const uploadId = crypto.randomUUID();
      const manifest: UploadManifest = {
        targetEmail,
        targetName: targetUser.displayName,
        previousKey: targetUser.profileImageKey,
        contentType,
        sizeBytes,
        uploadedBy: currentUser.email,
        objectKey: `profile-images/${encodeURIComponent(targetEmail)}/${crypto.randomUUID()}.${extension}`,
        chunkCount: Math.ceil(sizeBytes / CHUNK_BYTES),
      };
      await (await getBucket()).put(manifestKey(uploadId), JSON.stringify(manifest), { httpMetadata: { contentType: "application/json" } });
      return Response.json({ uploadId, chunkBytes: CHUNK_BYTES, chunkCount: manifest.chunkCount });
    }

    if (action === "complete" || action === "abort") {
      const uploadId = typeof payload.uploadId === "string" ? payload.uploadId : "";
      if (!validUploadId(uploadId)) return Response.json({ error: "Invalid profile image upload session." }, { status: 400 });
      const bucket = await getBucket();
      const manifest = await readManifest(bucket, uploadId);
      if (!manifest || manifest.uploadedBy !== currentUser.email) return Response.json({ error: "Profile image upload session not found." }, { status: 404 });
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
        if (offset + bytes.byteLength > assembled.byteLength) return Response.json({ error: "Uploaded image size does not match." }, { status: 400 });
        assembled.set(bytes, offset); offset += bytes.byteLength; temporaryKeys.push(key);
      }
      if (offset !== manifest.sizeBytes) return Response.json({ error: "Uploaded image size does not match." }, { status: 400 });

      await bucket.put(manifest.objectKey, assembled, {
        httpMetadata: { contentType: manifest.contentType, cacheControl: "private, no-store" },
        customMetadata: { owner: manifest.targetEmail, uploadedBy: currentUser.email },
      });
      const db = await getDb();
      await db.update(users).set({ profileImageKey: manifest.objectKey }).where(eq(users.email, manifest.targetEmail));
      await recordActivity(db, currentUser, { action: "updated", entityType: "account", entityLabel: manifest.targetName, details: manifest.targetEmail === currentUser.email ? "Profile image changed" : `Profile image changed by owner for ${manifest.targetEmail}` });
      try {
        await bucket.delete([...temporaryKeys, manifestKey(uploadId)]);
        if (manifest.previousKey && manifest.previousKey !== manifest.objectKey) await bucket.delete(manifest.previousKey);
      } catch (storageError) {
        console.error("Profile image upload completed; temporary R2 cleanup failed", storageError);
      }
      return Response.json({ profileImageKey: manifest.objectKey });
    }

    return Response.json({ error: "Invalid profile image action." }, { status: 400 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update profile image." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const requestedEmail = new URL(request.url).searchParams.get("email") || currentUser.email;
    return removeProfileImage(currentUser, requestedEmail);
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to remove profile image." }, { status: 500 });
  }
}
