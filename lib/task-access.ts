import { and, eq } from "drizzle-orm";
import { projectMembers, projects, tasks, users } from "@/db/schema";
import type { getDb } from "@/db";
import type { getCurrentUser } from "@/lib/auth";

type Database = Awaited<ReturnType<typeof getDb>>;
type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;
type Task = typeof tasks.$inferSelect;

export async function canCollaborateOnTask(db: Database, currentUser: CurrentUser, task: Task) {
  if (task.employeeEmail === currentUser.email) return true;
  if (currentUser.role === "owner") return true;
  if (task.createdBy === currentUser.email) return true;
  return canManageTask(db, currentUser, task);
}

export async function canManageTask(db: Database, currentUser: CurrentUser, task: Task) {
  if (currentUser.role === "owner") return true;
  if (currentUser.role !== "manager" || !currentUser.discipline) return false;
  if (task.project === "PERSONAL") {
    if (task.createdBy === currentUser.email) return true;
    if (!task.originatedByEmail || !task.submittedToManager) return false;
    const [employee] = await db.select({ discipline: users.discipline })
      .from(users)
      .where(eq(users.email, task.employeeEmail))
      .limit(1);
    return employee?.discipline === currentUser.discipline;
  }
  const [membership] = await db.select({ isProjectManager: projectMembers.isProjectManager })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projects.code, task.project), eq(projectMembers.employeeEmail, currentUser.email)))
    .limit(1);
  if (!membership) return false;
  if (task.createdBy === currentUser.email) return true;
  const [employee] = await db.select({ discipline: users.discipline })
    .from(users)
    .where(eq(users.email, task.employeeEmail))
    .limit(1);
  if (employee?.discipline !== currentUser.discipline) return false;
  return Boolean(membership.isProjectManager) || Boolean(task.originatedByEmail) || task.submittedToManager;
}

async function managerCanViewTask(db: Database, currentUser: CurrentUser, task: Task) {
  if (currentUser.role !== "manager" || !currentUser.discipline) return false;
  const [employee] = await db.select({ discipline: users.discipline })
    .from(users)
    .where(eq(users.email, task.employeeEmail))
    .limit(1);
  if (employee?.discipline !== currentUser.discipline) return false;
  if (task.project === "PERSONAL") return task.submittedToManager;
  const [membership] = await db.select({ id: projectMembers.id, isProjectManager: projectMembers.isProjectManager })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projects.code, task.project), eq(projectMembers.employeeEmail, currentUser.email)))
    .limit(1);
  return Boolean(membership) && (task.visibility === "team" || task.submittedToManager);
}

export async function canViewTask(db: Database, currentUser: CurrentUser, task: Task) {
  if (await canCollaborateOnTask(db, currentUser, task)) return true;
  if (await managerCanViewTask(db, currentUser, task)) return true;
  if (task.project === "PERSONAL" || (task.visibility === "private" && !task.submittedToManager)) return false;
  const [membership] = await db.select({ isProjectManager: projectMembers.isProjectManager })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projects.code, task.project), eq(projectMembers.employeeEmail, currentUser.email)))
    .limit(1);
  return Boolean(membership?.isProjectManager);
}

export async function taskForCollaboration(db: Database, currentUser: CurrentUser, taskId: number) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task || !(await canCollaborateOnTask(db, currentUser, task))) return null;
  return task;
}

export async function taskForView(db: Database, currentUser: CurrentUser, taskId: number) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task || !(await canViewTask(db, currentUser, task))) return null;
  return task;
}
