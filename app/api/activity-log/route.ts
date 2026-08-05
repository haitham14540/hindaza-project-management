import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { activityLogs } from "@/db/schema";
import { getCurrentUser, isOwner, unauthorizedResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!isOwner(currentUser)) return Response.json({ error: "Owner access required." }, { status: 403 });
    const db = await getDb();
    const rows = await db.select().from(activityLogs)
      .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
      .limit(1_000);
    return Response.json({ activity: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load activity log." }, { status: 500 });
  }
}
