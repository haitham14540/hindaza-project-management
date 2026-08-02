import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createSession, passwordRecord, setupKeyIsValid, setupRequired } from "@/lib/auth";

export const dynamic = "force-dynamic";

const disciplines = ["Manager", "Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure"] as const;

export async function POST(request: Request) {
  try {
    if (!(await setupRequired())) return Response.json({ error: "The manager account has already been configured." }, { status: 409 });
    const payload = (await request.json()) as Record<string, unknown>;
    const setupKey = typeof payload.setupKey === "string" ? payload.setupKey : "";
    if (!(await setupKeyIsValid(setupKey))) return Response.json({ error: "The setup key is incorrect." }, { status: 403 });

    const displayName = typeof payload.displayName === "string" ? payload.displayName.trim().slice(0, 120) : "";
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase().slice(0, 180) : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    const discipline = disciplines.includes(payload.discipline as (typeof disciplines)[number])
      ? (payload.discipline as (typeof disciplines)[number])
      : null;
    if (!displayName || !email || !email.includes("@") || !discipline) {
      return Response.json({ error: "Complete the name, email, and discipline fields." }, { status: 400 });
    }
    if (password.length < 10) return Response.json({ error: "Password must be at least 10 characters." }, { status: 400 });

    const db = await getDb();
    const credentials = await passwordRecord(password);
    await db
      .insert(users)
      .values({ email, displayName, role: "manager", discipline, ...credentials })
      .onConflictDoUpdate({
        target: users.email,
        set: { displayName, role: "manager", discipline, active: true, ...credentials },
      });
    const cookie = await createSession(email, request);
    return Response.json(
      { user: { email, displayName, role: "manager", discipline } },
      { status: 201, headers: { "Set-Cookie": cookie } },
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to configure the manager account." }, { status: 500 });
  }
}
