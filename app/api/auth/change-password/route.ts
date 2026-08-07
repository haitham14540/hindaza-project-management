import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import {
  createSession,
  getCurrentUser,
  passwordRecord,
  unauthorizedResponse,
  verifyPassword,
} from "@/lib/auth";
import { recordActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const payload = (await request.json()) as Record<string, unknown>;
    const currentPassword = typeof payload.currentPassword === "string" ? payload.currentPassword : "";
    const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";

    if (!currentPassword) {
      return Response.json({ error: "Enter your current password." }, { status: 400 });
    }
    if (newPassword.length < 10) {
      return Response.json({ error: "The new password must be at least 10 characters." }, { status: 400 });
    }
    if (newPassword === currentPassword) {
      return Response.json({ error: "Choose a password different from your current password." }, { status: 400 });
    }

    const db = await getDb();
    const rows = await db.select().from(users).where(eq(users.email, currentUser.email)).limit(1);
    const user = rows[0];
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash, user.passwordSalt))) {
      return Response.json({ error: "Current password is incorrect." }, { status: 401 });
    }

    const credentials = await passwordRecord(newPassword);
    await db.delete(sessions).where(eq(sessions.email, currentUser.email));
    await db.update(users).set(credentials).where(eq(users.email, currentUser.email));
    await recordActivity(db, currentUser, { action: "updated", entityType: "account", entityLabel: currentUser.displayName, details: "Password changed" });
    const cookie = await createSession(currentUser.email, request);

    return Response.json(
      { ok: true },
      { headers: { "Set-Cookie": cookie } },
    );
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to change password." },
      { status: 500 },
    );
  }
}
