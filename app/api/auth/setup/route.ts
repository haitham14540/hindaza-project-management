import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createSession, passwordRecord, setupKeyIsValid, setupRequired } from "@/lib/auth";

export const dynamic = "force-dynamic";

const disciplines = ["Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure"] as const;

export async function POST(request: Request) {
  try {
    if (!(await setupRequired())) return Response.json({ error: "تم إعداد حساب المدير مسبقًا." }, { status: 409 });
    const payload = (await request.json()) as Record<string, unknown>;
    const setupKey = typeof payload.setupKey === "string" ? payload.setupKey : "";
    if (!(await setupKeyIsValid(setupKey))) return Response.json({ error: "رمز إعداد النظام غير صحيح." }, { status: 403 });

    const displayName = typeof payload.displayName === "string" ? payload.displayName.trim().slice(0, 120) : "";
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase().slice(0, 180) : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    const discipline = disciplines.includes(payload.discipline as (typeof disciplines)[number])
      ? (payload.discipline as (typeof disciplines)[number])
      : null;
    if (!displayName || !email || !email.includes("@") || !discipline) {
      return Response.json({ error: "أكمل الاسم والبريد والتخصص." }, { status: 400 });
    }
    if (password.length < 10) return Response.json({ error: "كلمة المرور يجب ألا تقل عن 10 أحرف." }, { status: 400 });

    const db = await getDb();
    const credentials = await passwordRecord(password);
    await db.insert(users).values({ email, displayName, role: "manager", discipline, ...credentials });
    const cookie = await createSession(email, request);
    return Response.json(
      { user: { email, displayName, role: "manager", discipline } },
      { status: 201, headers: { "Set-Cookie": cookie } },
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "تعذر إعداد حساب المدير." }, { status: 500 });
  }
}
