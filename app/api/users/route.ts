import { and, count, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { projectMembers, tasks, users } from "@/db/schema";
import { getCurrentUser, isManagement, isOwner, passwordRecord, unauthorizedResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

type UserRole = "owner" | "manager" | "member";

function text(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function role(value: unknown): UserRole {
  if (value === "owner" || value === "manager") return value;
  return "member";
}

const disciplines = ["Manager", "Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure"] as const;

function discipline(value: unknown) {
  return typeof value === "string" && disciplines.includes(value as (typeof disciplines)[number])
    ? (value as (typeof disciplines)[number])
    : null;
}

function safeUser(user: typeof users.$inferSelect) {
  return {
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    discipline: user.discipline,
    profileImageKey: user.profileImageKey,
  };
}

function managementDenied(currentUser: { role: UserRole }) {
  return !isManagement(currentUser)
    ? Response.json({ error: "Manager access required." }, { status: 403 })
    : null;
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const denied = managementDenied(currentUser);
    if (denied) return denied;
    const payload = (await request.json()) as Record<string, unknown>;
    const requestedRole = role(payload.role);
    if (requestedRole === "owner" && !isOwner(currentUser)) {
      return Response.json({ error: "Only an owner can add another owner." }, { status: 403 });
    }
    const displayName = text(payload.displayName, 120);
    if (!displayName) return Response.json({ error: "Employee name is required." }, { status: 400 });
    const employeeDiscipline = discipline(payload.discipline);
    if (!employeeDiscipline) return Response.json({ error: "Employee discipline is required." }, { status: 400 });
    const email = text(payload.email).toLowerCase();
    const temporaryPassword = typeof payload.temporaryPassword === "string" ? payload.temporaryPassword : "";
    if (!email || !email.includes("@")) return Response.json({ error: "Employee email is required." }, { status: 400 });
    if (temporaryPassword.length < 10) return Response.json({ error: "Temporary password must be at least 10 characters." }, { status: 400 });
    const db = await getDb();
    const credentials = await passwordRecord(temporaryPassword);
    const inserted = await db.insert(users).values({ email, displayName, role: requestedRole, discipline: employeeDiscipline, ...credentials }).returning();
    return Response.json({ user: safeUser(inserted[0]) }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : "Unable to add employee";
    return Response.json({ error: message.includes("UNIQUE") ? "Employee email already exists." : message }, { status: message.includes("UNIQUE") ? 409 : 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const denied = managementDenied(currentUser);
    if (denied) return denied;
    const payload = (await request.json()) as Record<string, unknown>;
    const email = text(payload.email).toLowerCase();
    const displayName = text(payload.displayName, 120);
    if (!email || !displayName) return Response.json({ error: "Employee email and name are required." }, { status: 400 });
    const employeeDiscipline = discipline(payload.discipline);
    if (!employeeDiscipline) return Response.json({ error: "Employee discipline is required." }, { status: 400 });
    const db = await getDb();
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!existing[0]) return Response.json({ error: "Employee not found." }, { status: 404 });
    const requestedRole = role(payload.role);
    if ((existing[0].role === "owner" || requestedRole === "owner") && !isOwner(currentUser)) {
      return Response.json({ error: "Only an owner can manage owner accounts." }, { status: 403 });
    }
    if (email === currentUser.email && requestedRole !== currentUser.role) {
      return Response.json({ error: "You cannot change your own role." }, { status: 400 });
    }
    const temporaryPassword = typeof payload.temporaryPassword === "string" ? payload.temporaryPassword : "";
    if (temporaryPassword && temporaryPassword.length < 10) return Response.json({ error: "New password must be at least 10 characters." }, { status: 400 });
    const credentials = temporaryPassword ? await passwordRecord(temporaryPassword) : {};
    const updated = await db.update(users).set({ displayName, role: requestedRole, discipline: employeeDiscipline, ...credentials }).where(eq(users.email, email)).returning();
    if (displayName !== existing[0].displayName) {
      await db.update(tasks).set({ employeeName: displayName }).where(eq(tasks.employeeEmail, email));
    }
    return Response.json({ user: safeUser(updated[0]) });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update employee" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    const denied = managementDenied(currentUser);
    if (denied) return denied;
    const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() || "";
    if (!email || email === currentUser.email) return Response.json({ error: "This employee cannot be removed." }, { status: 400 });
    const db = await getDb();
    const target = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!target[0]) return Response.json({ error: "Employee not found." }, { status: 404 });
    if (target[0].role === "owner" && !isOwner(currentUser)) {
      return Response.json({ error: "Only an owner can remove another owner." }, { status: 403 });
    }
    if (target[0].role === "owner") {
      const [{ total: ownerCount }] = await db.select({ total: count() }).from(users).where(and(eq(users.role, "owner"), eq(users.active, true)));
      if (ownerCount <= 1) return Response.json({ error: "The last owner account cannot be removed." }, { status: 409 });
    }
    const [{ total }] = await db.select({ total: count() }).from(tasks).where(or(eq(tasks.employeeEmail, email), eq(tasks.createdBy, email)));
    if (total > 0) return Response.json({ error: "Employee has related tasks and cannot be removed." }, { status: 409 });
    await db.delete(projectMembers).where(eq(projectMembers.employeeEmail, email));
    await db.delete(users).where(eq(users.email, email));
    return Response.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to remove employee" }, { status: 500 });
  }
}
