import { and, count, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { projectIssues, projectMembers, projects, tasks, users } from "@/db/schema";
import { getCurrentUser, isOwner, unauthorizedResponse } from "@/lib/auth";
import { recordActivity } from "@/lib/activity";
import { createNotifications } from "@/lib/notification-delivery";

export const dynamic = "force-dynamic";

const statuses = ["active", "on_hold", "completed", "archived"] as const;

function text(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function status(value: unknown) {
  return typeof value === "string" && statuses.includes(value as (typeof statuses)[number])
    ? value as (typeof statuses)[number]
    : "active";
}

function invalidProjectDates(startDate: string, targetDate: string) {
  return Boolean(startDate && targetDate && startDate >= targetDate);
}

function memberEmails(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase()).filter(Boolean))].slice(0, 500);
}

type Database = Awaited<ReturnType<typeof getDb>>;

async function validMemberEmails(db: Database, emails: string[]) {
  if (!emails.length) return [];
  const rows = await db.select({ email: users.email, role: users.role }).from(users)
    .where(and(inArray(users.email, emails), eq(users.active, true)));
  const existing = new Set(rows.filter((row) => row.role === "member" || row.role === "manager").map((row) => row.email));
  return emails.filter((email) => existing.has(email));
}

async function blockedTaskMembers(db: Database, projectCode: string, removedMembers: string[]) {
  if (!removedMembers.length) return [];
  const rows = await db.select({ employeeEmail: tasks.employeeEmail }).from(tasks)
    .where(and(eq(tasks.project, projectCode), inArray(tasks.employeeEmail, removedMembers)));
  const counts = rows.reduce<Record<string, number>>((result, task) => {
    result[task.employeeEmail] = (result[task.employeeEmail] || 0) + 1;
    return result;
  }, {});
  return removedMembers.filter((email) => counts[email] > 0).map((email) => ({ email, taskCount: counts[email] }));
}

async function notifyAddedProjectMembers(
  db: Database,
  project: { code: string; name: string },
  addedMembers: string[],
  projectManagerEmails: string[],
) {
  if (!addedMembers.length) return;
  const memberRows = await db.select({
    email: users.email,
    discipline: users.discipline,
  }).from(users).where(inArray(users.email, addedMembers));

  await createNotifications(db, memberRows.map((member) => {
    const isProjectManager = projectManagerEmails.includes(member.email);
    const projectRole = isProjectManager ? "Project Manager" : "Team Member";
    const projectRoleArabic = isProjectManager ? "مدير مشروع" : "عضو فريق";
    const permissions = isProjectManager
      ? "Manage the project team and tasks within the permitted discipline"
      : "View the project and work on assigned tasks";
    const permissionsArabic = isProjectManager
      ? "إدارة فريق المشروع والمهام ضمن التخصص المسموح"
      : "عرض المشروع والعمل على المهام المسندة";
    const discipline = member.discipline || "Not assigned";
    return {
      recipientEmail: member.email,
      type: "project_member_added" as const,
      title: "Added to project · تمت إضافتك إلى مشروع",
      message: `You were added to ${project.name} as ${projectRole}. Discipline: ${discipline}. Permissions: ${permissions}. · تمت إضافتك إلى مشروع ${project.name} بصفة ${projectRoleArabic}. التخصص: ${discipline}. الصلاحيات: ${permissionsArabic}.`,
      emailDetails: [
        { label: "Project", value: `${project.name} (${project.code})` },
        { label: "Project Role", value: projectRole },
        { label: "Discipline", value: discipline },
        { label: "Permissions", value: permissions },
      ],
    };
  }));
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!isOwner(currentUser)) return Response.json({ error: "Owner access required." }, { status: 403 });
    const payload = await request.json() as Record<string, unknown>;
    const code = text(payload.code, 30).toUpperCase();
    const name = text(payload.name, 180);
    if (!code || !name) return Response.json({ error: "Project code and name are required." }, { status: 400 });
    const startDate = text(payload.startDate, 10);
    const targetDate = text(payload.targetDate, 10);
    if (invalidProjectDates(startDate, targetDate)) return Response.json({ error: "Project start date must be before the target date." }, { status: 400 });
    const db = await getDb();
    const requestedMembers = memberEmails(payload.memberEmails);
    const assignedMembers = await validMemberEmails(db, requestedMembers);
    const requestedProjectManagers = memberEmails(payload.projectManagerEmails);
    const assignedProjectManagers = requestedProjectManagers.filter((email) => assignedMembers.includes(email));
    if (assignedMembers.length !== requestedMembers.length) return Response.json({ error: "One or more project members are invalid." }, { status: 400 });
    const inserted = await db.insert(projects).values({ code, name, client: text(payload.client), status: status(payload.status), startDate, targetDate }).returning();
    if (assignedMembers.length) await db.insert(projectMembers).values(assignedMembers.map((employeeEmail) => ({ projectId: inserted[0].id, employeeEmail, isProjectManager: assignedProjectManagers.includes(employeeEmail) })));
    await recordActivity(db, currentUser, { action: "created", entityType: "project", entityId: inserted[0].id, entityLabel: `${code} · ${name}`, projectCode: code, details: `Project created with ${assignedMembers.length} team members` });
    await notifyAddedProjectMembers(db, inserted[0], assignedMembers, assignedProjectManagers);
    return Response.json({ project: { ...inserted[0], memberEmails: assignedMembers, projectManagerEmails: assignedProjectManagers } }, { status: 201 });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    const message = error instanceof Error ? error.message : "Unable to create project";
    return Response.json({ error: message.includes("UNIQUE") ? "Project code already exists." : message }, { status: message.includes("UNIQUE") ? 409 : 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (currentUser.role !== "owner" && currentUser.role !== "manager") return Response.json({ error: "Management access required." }, { status: 403 });
    const payload = await request.json() as Record<string, unknown>;
    const id = Number(payload.id);
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid project id." }, { status: 400 });
    const db = await getDb();
    const [existing] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!existing) return Response.json({ error: "Project not found." }, { status: 404 });
    if (currentUser.role === "manager") {
      const [membership] = await db.select({ id: projectMembers.id }).from(projectMembers)
        .where(and(eq(projectMembers.projectId, id), eq(projectMembers.employeeEmail, currentUser.email))).limit(1);
      if (!membership) return Response.json({ error: "Managers can edit only projects they are assigned to." }, { status: 403 });
    }

    const currentRows = await db.select({ employeeEmail: projectMembers.employeeEmail, isProjectManager: projectMembers.isProjectManager }).from(projectMembers).where(eq(projectMembers.projectId, id));
    const currentMembers = await validMemberEmails(db, currentRows.map((row) => row.employeeEmail));
    const requestedMembers = memberEmails(payload.memberEmails);
    const validRequested = await validMemberEmails(db, requestedMembers);
    const requestedProjectManagers = memberEmails(payload.projectManagerEmails);
    let assignedMembers = validRequested;
    if (currentUser.role === "manager") {
      const candidates = [...new Set([...currentMembers, ...validRequested])];
      const rows = candidates.length ? await db.select({ email: users.email, discipline: users.discipline }).from(users).where(inArray(users.email, candidates)) : [];
      const disciplineByEmail = new Map(rows.map((row) => [row.email, row.discipline]));
      assignedMembers = [...new Set([
        ...currentMembers.filter((email) => disciplineByEmail.get(email) !== currentUser.discipline),
        ...validRequested.filter((email) => disciplineByEmail.get(email) === currentUser.discipline),
        currentUser.email,
      ])];
    }
    const removedMembers = currentMembers.filter((email) => !assignedMembers.includes(email));
    const blockedMembers = await blockedTaskMembers(db, existing.code, removedMembers);
    if (blockedMembers.length) return Response.json({ code: "MEMBER_HAS_PROJECT_TASKS", error: "لا يمكن إزالة موظف لديه مهام على هذا المشروع. غيّر الموظف المسؤول عن المهام أولًا. · Cannot remove a project member with assigned tasks. Reassign the tasks first.", projectCode: existing.code, blockedMembers }, { status: 409 });

    const code = currentUser.role === "owner" ? text(payload.code, 30).toUpperCase() || existing.code : existing.code;
    const startDate = currentUser.role === "owner" ? text(payload.startDate, 10) : existing.startDate;
    const targetDate = currentUser.role === "owner" ? text(payload.targetDate, 10) : existing.targetDate;
    if (invalidProjectDates(startDate, targetDate)) return Response.json({ error: "Project start date must be before the target date." }, { status: 400 });
    const updated = await db.update(projects).set({
      code,
      name: currentUser.role === "owner" ? text(payload.name, 180) || existing.name : existing.name,
      client: currentUser.role === "owner" ? text(payload.client) : existing.client,
      status: currentUser.role === "owner" ? status(payload.status) : existing.status,
      startDate,
      targetDate,
    }).where(eq(projects.id, id)).returning();
    if (code !== existing.code) await db.update(tasks).set({ project: code, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(tasks.project, existing.code));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, id));
    const editableProjectManagers = requestedProjectManagers.filter((email) => assignedMembers.includes(email));
    const assignedProjectManagers = currentUser.role === "owner"
      ? editableProjectManagers
      : [...new Set([
        ...currentRows.filter((row) => row.isProjectManager && row.employeeEmail !== currentUser.email).map((row) => row.employeeEmail),
        ...editableProjectManagers.filter((email) => email === currentUser.email || assignedMembers.includes(email)),
      ])].filter((email) => assignedMembers.includes(email));
    if (assignedMembers.length) await db.insert(projectMembers).values(assignedMembers.map((employeeEmail) => ({ projectId: id, employeeEmail, isProjectManager: assignedProjectManagers.includes(employeeEmail) })));
    await recordActivity(db, currentUser, { action: "updated", entityType: "project", entityId: id, entityLabel: `${code} · ${updated[0].name}`, projectCode: code, details: `${currentUser.role === "manager" ? "Discipline membership" : "Project details and membership"} updated; ${assignedMembers.length} team members` });
    const addedMembers = assignedMembers.filter((email) => !currentMembers.includes(email));
    await notifyAddedProjectMembers(db, updated[0], addedMembers, assignedProjectManagers);
    return Response.json({ project: { ...updated[0], memberEmails: assignedMembers, projectManagerEmails: assignedProjectManagers }, removedInvalidMembers: requestedMembers.length - validRequested.length });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update project" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!isOwner(currentUser)) return Response.json({ error: "Owner access required." }, { status: 403 });
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "Invalid project id." }, { status: 400 });
    const db = await getDb();
    const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const [[taskCount], [issueCount], [teamCount]] = await Promise.all([
      db.select({ total: count() }).from(tasks).where(eq(tasks.project, project.code)),
      db.select({ total: count() }).from(projectIssues).where(eq(projectIssues.projectCode, project.code)),
      db.select({ total: count() }).from(projectMembers).where(eq(projectMembers.projectId, id)),
    ]);
    const dependencies = { tasks: taskCount.total, issues: issueCount.total, team: teamCount.total, rfi: 0 };
    if (Object.values(dependencies).some((value) => value > 0)) return Response.json({ code: "PROJECT_NOT_EMPTY", error: "Project cannot be deleted until its tasks, issues, team members, and RFI records are removed. · لا يمكن حذف المشروع قبل إزالة المهام والمشاكل وأعضاء الفريق وطلبات المعلومات.", dependencies }, { status: 409 });
    await db.delete(projects).where(eq(projects.id, id));
    await recordActivity(db, currentUser, { action: "deleted", entityType: "project", entityId: id, entityLabel: `${project.code} · ${project.name}`, projectCode: project.code, details: "Empty project deleted" });
    return Response.json({ ok: true });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete project" }, { status: 500 });
  }
}
