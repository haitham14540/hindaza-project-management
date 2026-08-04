import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { projectMembers, projects, tasks, users } from "@/db/schema";
import { getCurrentUser, isOwner, unauthorizedResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

const statuses = ["active", "on_hold", "completed"] as const;

function text(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function status(value: unknown) {
  return typeof value === "string" && statuses.includes(value as (typeof statuses)[number])
    ? (value as (typeof statuses)[number])
    : "active";
}

function memberEmails(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))].slice(0, 500);
}

type Database = Awaited<ReturnType<typeof getDb>>;

async function validMemberEmails(db: Database, emails: string[]) {
  if (!emails.length) return [];
  const rows = await db.select({ email: users.email, role: users.role }).from(users).where(inArray(users.email, emails));
  const existing = new Set(rows.filter((row) => row.role === "member").map((row) => row.email));
  return emails.filter((email) => existing.has(email));
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!isOwner(currentUser)) {
      return Response.json({ error: "Owner access required." }, { status: 403 });
    }
    const payload = (await request.json()) as Record<string, unknown>;
    const code = text(payload.code, 30).toUpperCase();
    const name = text(payload.name, 180);
    if (!code || !name) {
      return Response.json({ error: "Project code and name are required." }, { status: 400 });
    }
    const db = await getDb();
    const requestedMembers = memberEmails(payload.memberEmails);
    const assignedMembers = await validMemberEmails(db, requestedMembers);
    if (assignedMembers.length !== requestedMembers.length) return Response.json({ error: "One or more project members are invalid." }, { status: 400 });
    const inserted = await db
      .insert(projects)
      .values({
        code,
        name,
        client: text(payload.client),
        status: status(payload.status),
        startDate: text(payload.startDate, 10),
        targetDate: text(payload.targetDate, 10),
      })
      .returning();
    if (assignedMembers.length) {
      await db.insert(projectMembers).values(assignedMembers.map((employeeEmail) => ({ projectId: inserted[0].id, employeeEmail })));
    }
    return Response.json({ project: { ...inserted[0], memberEmails: assignedMembers } }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : "Unable to create project";
    return Response.json(
      { error: message.includes("UNIQUE") ? "Project code already exists." : message },
      { status: message.includes("UNIQUE") ? 409 : 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!isOwner(currentUser)) {
      return Response.json({ error: "Owner access required." }, { status: 403 });
    }
    const payload = (await request.json()) as Record<string, unknown>;
    const id = Number(payload.id);
    if (!Number.isInteger(id)) {
      return Response.json({ error: "Invalid project id." }, { status: 400 });
    }
    const db = await getDb();
    const existing = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!existing[0]) return Response.json({ error: "Project not found." }, { status: 404 });
    const code = text(payload.code, 30).toUpperCase() || existing[0].code;
    const requestedMembers = memberEmails(payload.memberEmails);
    const assignedMembers = await validMemberEmails(db, requestedMembers);
    if (assignedMembers.length !== requestedMembers.length) return Response.json({ error: "One or more project members are invalid." }, { status: 400 });
    const updated = await db
      .update(projects)
      .set({
        code,
        name: text(payload.name, 180) || existing[0].name,
        client: text(payload.client),
        status: status(payload.status),
        startDate: text(payload.startDate, 10),
        targetDate: text(payload.targetDate, 10),
      })
      .where(eq(projects.id, id))
      .returning();
    if (code !== existing[0].code) {
      await db.update(tasks).set({ project: code, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(tasks.project, existing[0].code));
    }
    await db.delete(projectMembers).where(eq(projectMembers.projectId, id));
    if (assignedMembers.length) {
      await db.insert(projectMembers).values(assignedMembers.map((employeeEmail) => ({ projectId: id, employeeEmail })));
    }
    return Response.json({ project: { ...updated[0], memberEmails: assignedMembers } });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update project" }, { status: 500 });
  }
}
