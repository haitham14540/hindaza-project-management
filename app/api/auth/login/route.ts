import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createSession, verifyPassword } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db-init";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const payload = (await request.json()) as Record<string, unknown>;
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    if (!email || !password) return Response.json({ error: "Enter your email and password." }, { status: 400 });

    const db = await getDb();
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];
    const valid = user?.active && await verifyPassword(password, user.passwordHash, user.passwordSalt);
    if (!valid) return Response.json({ error: "Incorrect email or password." }, { status: 401 });

    const cookie = await createSession(user.email, request);
    return Response.json(
      { user: { email: user.email, displayName: user.displayName, role: user.role, discipline: user.discipline } },
      { headers: { "Set-Cookie": cookie } },
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to sign in." }, { status: 500 });
  }
}
