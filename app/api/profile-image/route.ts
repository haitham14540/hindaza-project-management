import { eq } from "drizzle-orm";
import { getBucket, getDb } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser.profileImageKey) return new Response(null, { status: 404 });
    const bucket = await getBucket();
    const object = await bucket.get(currentUser.profileImageKey);
    if (!object) return new Response(null, { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", "private, max-age=300");
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
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File)) return Response.json({ error: "Select an image first." }, { status: 400 });
    const extension = ALLOWED_TYPES.get(image.type);
    if (!extension) return Response.json({ error: "Use a JPG, PNG, or WEBP image." }, { status: 400 });
    if (image.size <= 0 || image.size > MAX_IMAGE_BYTES) return Response.json({ error: "Image size must not exceed 3 MB." }, { status: 413 });

    const bucket = await getBucket();
    const key = `profile-images/${encodeURIComponent(currentUser.email)}/${crypto.randomUUID()}.${extension}`;
    await bucket.put(key, image.stream(), {
      httpMetadata: { contentType: image.type, cacheControl: "private, max-age=300" },
      customMetadata: { owner: currentUser.email },
    });
    const db = await getDb();
    await db.update(users).set({ profileImageKey: key }).where(eq(users.email, currentUser.email));
    if (currentUser.profileImageKey && currentUser.profileImageKey !== key) {
      await bucket.delete(currentUser.profileImageKey);
    }
    return Response.json({ profileImageKey: key });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update profile image." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (currentUser.profileImageKey) {
      const bucket = await getBucket();
      await bucket.delete(currentUser.profileImageKey);
      const db = await getDb();
      await db.update(users).set({ profileImageKey: "" }).where(eq(users.email, currentUser.email));
    }
    return Response.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to remove profile image." }, { status: 500 });
  }
}
