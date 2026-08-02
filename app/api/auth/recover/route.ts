import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { createSession, passwordRecord, setupKeyIsValid } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const payload = (await request.json()) as Record<string, unknown>;
    const setupKey = typeof payload.setupKey === "string" ? payload.setupKey : "";
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase().slice(0, 180) : "";
    const password = typeof payload.password === "string" ? payload.password : "";

    if (!(await setupKeyIsValid(setupKey))) {
      return Response.json({ error: "The setup key is incorrect." }, { status: 403 });
    }
    if (!email || !email.includes("@")) {
      return Response.json({ error: "Enter the manager email." }, { status: 400 });
    }
    if (password.length < 10) {
      return Response.json({ error: "The new password must be at least 10 characters." }, { status: 400 });
    }

    const db = await getDb();
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const manager = rows[0];
    if (!manager || manager.role !== "manager" || !manager.active) {
      return Response.json({ error: "An active manager account was not found for this email." }, { status: 404 });
    }

    const credentials = await passwordRecord(password);
    await db.delete(sessions).where(eq(sessions.email, email));
    await db.update(users).set(credentials).where(eq(users.email, email));
    const cookie = await createSession(email, request);

    return Response.json(
      { user: { email, displayName: manager.displayName, role: manager.role, discipline: manager.discipline } },
      { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to recover manager access." },
      { status: 500 },
    );
  }
}
