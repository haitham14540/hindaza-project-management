import { getDb } from "@/db";
import { activityLogs } from "@/db/schema";
import type { AppUser } from "@/lib/auth";

type ActivityAction = "created" | "updated" | "deleted" | "note_added" | "timer_updated" | "attachment_added" | "attachment_deleted" | "converted" | "login" | "logout" | "downloaded" | "restored" | "read";
type ActivityEntity = "task" | "issue" | "project" | "user" | "account" | "backup" | "notification";

export async function recordActivity(
  db: Awaited<ReturnType<typeof getDb>>,
  actor: AppUser,
  entry: {
    action: ActivityAction;
    entityType: ActivityEntity;
    entityId?: number | null;
    entityLabel: string;
    projectCode?: string;
    details?: string;
  },
) {
  await db.insert(activityLogs).values({
    actorEmail: actor.email,
    actorName: actor.displayName,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    entityLabel: entry.entityLabel.slice(0, 240),
    projectCode: (entry.projectCode || "").slice(0, 80),
    details: (entry.details || "").slice(0, 1_000),
  });
}
