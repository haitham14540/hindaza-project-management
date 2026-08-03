import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { notifications } from "@/db/schema";
import { getCurrentUser, unauthorizedResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const db = await getDb();
    const rows = await db.select().from(notifications)
      .where(eq(notifications.recipientEmail, currentUser.email))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(100);
    return Response.json({ notifications: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load notifications." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const payload = (await request.json()) as Record<string, unknown>;
    const db = await getDb();

    if (payload.all === true) {
      await db.update(notifications).set({ read: true }).where(eq(notifications.recipientEmail, currentUser.email));
      return Response.json({ ok: true });
    }

    const id = Number(payload.id);
    if (!Number.isInteger(id)) {
      return Response.json({ error: "Invalid notification id." }, { status: 400 });
    }
    await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.id, id), eq(notifications.recipientEmail, currentUser.email)));
    return Response.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update notifications." },
      { status: 500 },
    );
  }
}
