import { clearSession, getCurrentUser } from "@/lib/auth";
import { getDb } from "@/db";
import { recordActivity } from "@/lib/activity";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const db = await getDb();
    await recordActivity(db, currentUser, { action: "logout", entityType: "account", entityLabel: currentUser.displayName, details: "Signed out" });
  } catch {
    // Clearing an expired session must still succeed.
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": await clearSession(request) } });
}
