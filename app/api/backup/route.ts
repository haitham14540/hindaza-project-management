import { asc, eq } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import {
  notifications,
  projectMembers,
  projects,
  taskComments,
  taskTimeEntries,
  tasks,
  users,
} from "@/db/schema";
import { createSession, getCurrentUser, unauthorizedResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

const APP_NAME = "HINDAZA Project Management";
const SCHEMA_VERSION = 2;
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const MAX_TABLE_ROWS = 100_000;
const MAX_D1_BOUND_PARAMETERS = 100;
const MAX_RESTORE_BATCH_STATEMENTS = 45;

class BackupValidationError extends Error {}

type BackupData = {
  users: Array<typeof users.$inferInsert>;
  projects: Array<typeof projects.$inferInsert>;
  projectMembers: Array<typeof projectMembers.$inferInsert>;
  tasks: Array<typeof tasks.$inferInsert>;
  taskComments: Array<typeof taskComments.$inferInsert>;
  taskTimeEntries: Array<typeof taskTimeEntries.$inferInsert>;
  notifications: Array<typeof notifications.$inferInsert>;
};

type BackupPayload = {
  app: typeof APP_NAME;
  schemaVersion: number;
  exportedAt: string;
  recordCounts: Record<keyof BackupData, number>;
  data: BackupData;
};

function fail(message: string): never {
  throw new BackupValidationError(message);
}

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function rows(value: unknown, label: string) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  if (value.length > MAX_TABLE_ROWS) fail(`${label} contains too many records.`);
  return value.map((item, index) => record(item, `${label}[${index}]`));
}

function stringField(source: Record<string, unknown>, key: string, max: number, allowEmpty = true) {
  const value = source[key];
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) {
    fail(`Invalid ${key}.`);
  }
  return value;
}

function emailField(source: Record<string, unknown>, key: string, allowEmpty = false) {
  const value = stringField(source, key, 180, allowEmpty).trim().toLowerCase();
  if (value && !value.includes("@")) fail(`Invalid ${key}.`);
  return value;
}

function enumField<const T extends readonly string[]>(source: Record<string, unknown>, key: string, allowed: T, allowEmpty = false) {
  const value = stringField(source, key, 80, allowEmpty);
  if (!(allowed as readonly string[]).includes(value)) fail(`Invalid ${key}.`);
  return value as T[number];
}

function ensureUnique<T>(items: T[], key: (item: T) => string | number, label: string) {
  const values = new Set<string | number>();
  for (const item of items) {
    const value = key(item);
    if (values.has(value)) fail(`Backup contains duplicate ${label}.`);
    values.add(value);
  }
}

function positiveInteger(source: Record<string, unknown>, key: string) {
  const value = source[key];
  if (!Number.isInteger(value) || Number(value) <= 0) fail(`Invalid ${key}.`);
  return Number(value);
}

function nonNegativeNumber(source: Record<string, unknown>, key: string) {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000_000) fail(`Invalid ${key}.`);
  return value;
}

function nonNegativeInteger(source: Record<string, unknown>, key: string) {
  const value = nonNegativeNumber(source, key);
  if (!Number.isInteger(value)) fail(`Invalid ${key}.`);
  return value;
}

function booleanField(source: Record<string, unknown>, key: string) {
  const value = source[key];
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return Boolean(value);
  return fail(`Invalid ${key}.`);
}

function nullableString(source: Record<string, unknown>, key: string, max: number) {
  const value = source[key];
  if (value === null) return null;
  return stringField(source, key, max);
}

function nullablePositiveInteger(source: Record<string, unknown>, key: string) {
  if (source[key] === null) return null;
  return positiveInteger(source, key);
}

function validateBackup(value: unknown): BackupData {
  const payload = record(value, "Backup");
  if (payload.app !== APP_NAME || ![1, 2].includes(Number(payload.schemaVersion))) {
    fail("This file is not a compatible HINDAZA backup.");
  }
  const data = record(payload.data, "data");

  const restoredUsers: BackupData["users"] = rows(data.users, "users").map((item) => ({
    email: emailField(item, "email"),
    displayName: stringField(item, "displayName", 120, false),
    role: enumField(item, "role", ["owner", "manager", "member"] as const),
    discipline: enumField(item, "discipline", ["Manager", "Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure", ""] as const, true),
    passwordHash: stringField(item, "passwordHash", 256),
    passwordSalt: stringField(item, "passwordSalt", 256),
    profileImageKey: "",
    active: booleanField(item, "active"),
    createdAt: stringField(item, "createdAt", 50, false),
  }));
  if (!restoredUsers.some((user) => user.role === "owner" && user.active && user.passwordHash && user.passwordSalt)) {
    const legacyManager = restoredUsers.find((user) => user.role === "manager" && user.active && user.passwordHash && user.passwordSalt);
    if (!legacyManager) fail("The backup must contain at least one active owner or manager account.");
    legacyManager.role = "owner";
  }

  const restoredProjects: BackupData["projects"] = rows(data.projects, "projects").map((item) => ({
    id: positiveInteger(item, "id"),
    code: stringField(item, "code", 80, false),
    name: stringField(item, "name", 180, false),
    client: stringField(item, "client", 180),
    status: enumField(item, "status", ["active", "on_hold", "completed"] as const),
    startDate: stringField(item, "startDate", 10),
    targetDate: stringField(item, "targetDate", 10),
    createdAt: stringField(item, "createdAt", 50, false),
  }));

  const restoredTasks: BackupData["tasks"] = rows(data.tasks, "tasks").map((item) => ({
    id: positiveInteger(item, "id"),
    taskDate: stringField(item, "taskDate", 10, false),
    employeeName: stringField(item, "employeeName", 120, false),
    employeeEmail: emailField(item, "employeeEmail", true),
    project: stringField(item, "project", 80, false),
    title: stringField(item, "title", 180, false),
    expectedOutput: stringField(item, "expectedOutput", 2_000),
    priority: enumField(item, "priority", ["high", "medium", "low"] as const),
    plannedHours: nonNegativeNumber(item, "plannedHours"),
    startTime: stringField(item, "startTime", 20),
    endTime: stringField(item, "endTime", 20),
    actualHours: nonNegativeNumber(item, "actualHours"),
    status: enumField(item, "status", ["not_started", "in_progress", "paused", "blocked", "needs_revision", "done"] as const),
    managerCheck: enumField(item, "managerCheck", ["new", "pending", "approved", "returned"] as const),
    managerNote: stringField(item, "managerNote", 2_000),
    visibility: enumField(item, "visibility", ["team", "private"] as const),
    submittedToManager: booleanField(item, "submittedToManager"),
    createdBy: stringField(item, "createdBy", 180, false),
    createdAt: stringField(item, "createdAt", 50, false),
    updatedAt: stringField(item, "updatedAt", 50, false),
  }));

  const restoredProjectMembers: BackupData["projectMembers"] = rows(data.projectMembers, "projectMembers").map((item) => ({
    id: positiveInteger(item, "id"),
    projectId: positiveInteger(item, "projectId"),
    employeeEmail: emailField(item, "employeeEmail"),
    createdAt: stringField(item, "createdAt", 50, false),
  }));

  const restoredComments: BackupData["taskComments"] = rows(data.taskComments, "taskComments").map((item) => ({
    id: positiveInteger(item, "id"),
    taskId: positiveInteger(item, "taskId"),
    authorEmail: emailField(item, "authorEmail"),
    authorName: stringField(item, "authorName", 120, false),
    body: stringField(item, "body", 2_000, false),
    createdAt: stringField(item, "createdAt", 50, false),
  }));

  const restoredTimeEntries: BackupData["taskTimeEntries"] = rows(data.taskTimeEntries, "taskTimeEntries").map((item) => ({
    id: positiveInteger(item, "id"),
    taskId: positiveInteger(item, "taskId"),
    employeeEmail: emailField(item, "employeeEmail"),
    startedAt: stringField(item, "startedAt", 50, false),
    endedAt: nullableString(item, "endedAt", 50),
    durationSeconds: nonNegativeInteger(item, "durationSeconds"),
    createdAt: stringField(item, "createdAt", 50, false),
  }));

  const restoredNotifications: BackupData["notifications"] = rows(data.notifications, "notifications").map((item) => ({
    id: positiveInteger(item, "id"),
    recipientEmail: emailField(item, "recipientEmail"),
    type: enumField(item, "type", ["task_assigned", "review_updated", "private_task_submitted", "task_ready_for_review"] as const),
    taskId: nullablePositiveInteger(item, "taskId"),
    title: stringField(item, "title", 180, false),
    message: stringField(item, "message", 1_000),
    read: booleanField(item, "read"),
    createdAt: stringField(item, "createdAt", 50, false),
  }));

  const projectIds = new Set(restoredProjects.map((project) => project.id));
  const taskIds = new Set(restoredTasks.map((task) => task.id));
  ensureUnique(restoredUsers, (user) => user.email, "user email");
  ensureUnique(restoredProjects, (project) => project.id!, "project id");
  ensureUnique(restoredProjects, (project) => project.code, "project code");
  ensureUnique(restoredTasks, (task) => task.id!, "task id");
  ensureUnique(restoredProjectMembers, (membership) => membership.id!, "project membership id");
  ensureUnique(restoredProjectMembers, (membership) => `${membership.projectId}:${membership.employeeEmail}`, "project membership");
  ensureUnique(restoredComments, (comment) => comment.id!, "comment id");
  ensureUnique(restoredTimeEntries, (entry) => entry.id!, "time entry id");
  ensureUnique(restoredNotifications, (notification) => notification.id!, "notification id");
  if (restoredProjectMembers.some((membership) => !projectIds.has(membership.projectId))) fail("Backup contains an invalid project membership.");
  if (restoredComments.some((comment) => !taskIds.has(comment.taskId))) fail("Backup contains a note for a missing task.");
  if (restoredTimeEntries.some((entry) => !taskIds.has(entry.taskId))) fail("Backup contains a time entry for a missing task.");
  if (restoredNotifications.some((notification) => notification.taskId && !taskIds.has(notification.taskId))) fail("Backup contains a notification for a missing task.");

  return {
    users: restoredUsers,
    projects: restoredProjects,
    projectMembers: restoredProjectMembers,
    tasks: restoredTasks,
    taskComments: restoredComments,
    taskTimeEntries: restoredTimeEntries,
    notifications: restoredNotifications,
  };
}

function insertStatements<T>(
  d1: D1Database,
  table: string,
  columns: string[],
  items: T[],
  values: (item: T) => Array<string | number | null | boolean>,
) {
  const chunkSize = Math.max(1, Math.floor(MAX_D1_BOUND_PARAMETERS / columns.length));
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    const chunk = items.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
    const bindings = chunk.flatMap((item) => values(item).map((value) => typeof value === "boolean" ? Number(value) : value));
    statements.push(d1.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}`).bind(...bindings));
  }
  return statements;
}

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (currentUser.role !== "owner") return Response.json({ error: "Owner access required." }, { status: 403 });
    const db = await getDb();
    const [userRows, projectRows, membershipRows, taskRows, commentRows, timeRows, notificationRows] = await Promise.all([
      db.select().from(users).orderBy(asc(users.createdAt), asc(users.email)),
      db.select().from(projects).orderBy(asc(projects.id)),
      db.select().from(projectMembers).orderBy(asc(projectMembers.id)),
      db.select().from(tasks).orderBy(asc(tasks.id)),
      db.select().from(taskComments).orderBy(asc(taskComments.id)),
      db.select().from(taskTimeEntries).orderBy(asc(taskTimeEntries.id)),
      db.select().from(notifications).orderBy(asc(notifications.id)),
    ]);
    const data: BackupData = {
      users: userRows.map((user) => ({ ...user, profileImageKey: "" })),
      projects: projectRows,
      projectMembers: membershipRows,
      tasks: taskRows,
      taskComments: commentRows,
      taskTimeEntries: timeRows,
      notifications: notificationRows,
    };
    const recordCounts = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.length])) as BackupPayload["recordCounts"];
    const payload: BackupPayload = { app: APP_NAME, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), recordCounts, data };
    const date = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="hindaza-project-management-backup-${date}.json"`,
        "Cache-Control": "no-store, max-age=0",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create backup." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (currentUser.role !== "owner") return Response.json({ error: "Owner access required." }, { status: 403 });
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BACKUP_BYTES) return Response.json({ error: "Backup file is too large." }, { status: 413 });
    const source = await request.text();
    if (new TextEncoder().encode(source).byteLength > MAX_BACKUP_BYTES) return Response.json({ error: "Backup file is too large." }, { status: 413 });
    const data = validateBackup(JSON.parse(source));
    const db = await getDb();
    const [ownerRecord] = await db.select().from(users).where(eq(users.email, currentUser.email)).limit(1);
    if (!ownerRecord) return Response.json({ error: "The current owner account could not be verified." }, { status: 401 });

    const restoredOwnerIndex = data.users.findIndex((user) => user.email === currentUser.email);
    const preservedOwner = {
      ...(restoredOwnerIndex >= 0 ? data.users[restoredOwnerIndex] : ownerRecord),
      email: ownerRecord.email,
      role: "owner" as const,
      passwordHash: ownerRecord.passwordHash,
      passwordSalt: ownerRecord.passwordSalt,
      profileImageKey: ownerRecord.profileImageKey,
      active: true,
    };
    if (restoredOwnerIndex >= 0) data.users[restoredOwnerIndex] = preservedOwner;
    else data.users.push(preservedOwner);

    const d1 = await getD1();
    const statements: D1PreparedStatement[] = [
      d1.prepare("DELETE FROM task_time_entries"),
      d1.prepare("DELETE FROM task_comments"),
      d1.prepare("DELETE FROM notifications"),
      d1.prepare("DELETE FROM project_members"),
      d1.prepare("DELETE FROM tasks"),
      d1.prepare("DELETE FROM projects"),
      d1.prepare("DELETE FROM sessions"),
      d1.prepare("DELETE FROM users"),
      ...insertStatements(d1, "users", ["email", "display_name", "role", "discipline", "password_hash", "password_salt", "profile_image_key", "active", "created_at"], data.users, (user) => [user.email, user.displayName, user.role, user.discipline, user.passwordHash, user.passwordSalt, user.profileImageKey ?? "", user.active, user.createdAt]),
      ...insertStatements(d1, "projects", ["id", "code", "name", "client", "status", "start_date", "target_date", "created_at"], data.projects, (project) => [project.id!, project.code, project.name, project.client, project.status, project.startDate, project.targetDate, project.createdAt]),
      ...insertStatements(d1, "tasks", ["id", "task_date", "employee_name", "employee_email", "project", "title", "expected_output", "priority", "planned_hours", "start_time", "end_time", "actual_hours", "status", "manager_check", "manager_note", "visibility", "submitted_to_manager", "created_by", "created_at", "updated_at"], data.tasks, (task) => [task.id!, task.taskDate, task.employeeName, task.employeeEmail, task.project, task.title, task.expectedOutput, task.priority, task.plannedHours, task.startTime, task.endTime, task.actualHours, task.status, task.managerCheck, task.managerNote, task.visibility, task.submittedToManager, task.createdBy, task.createdAt, task.updatedAt]),
      ...insertStatements(d1, "project_members", ["id", "project_id", "employee_email", "created_at"], data.projectMembers, (membership) => [membership.id!, membership.projectId, membership.employeeEmail, membership.createdAt]),
      ...insertStatements(d1, "task_comments", ["id", "task_id", "author_email", "author_name", "body", "created_at"], data.taskComments, (comment) => [comment.id!, comment.taskId, comment.authorEmail, comment.authorName, comment.body, comment.createdAt]),
      ...insertStatements(d1, "task_time_entries", ["id", "task_id", "employee_email", "started_at", "ended_at", "duration_seconds", "created_at"], data.taskTimeEntries, (entry) => [entry.id!, entry.taskId, entry.employeeEmail, entry.startedAt, entry.endedAt ?? null, entry.durationSeconds, entry.createdAt]),
      ...insertStatements(d1, "notifications", ["id", "recipient_email", "type", "task_id", "title", "message", "read", "created_at"], data.notifications, (notification) => [notification.id!, notification.recipientEmail, notification.type, notification.taskId ?? null, notification.title, notification.message, notification.read, notification.createdAt]),
    ];
    if (statements.length > MAX_RESTORE_BATCH_STATEMENTS) {
      return Response.json({ error: "This backup contains too many records for one safe restore. Please contact support before retrying." }, { status: 400 });
    }
    await d1.batch(statements);
    const sessionCookie = await createSession(currentUser.email, request);
    const recordCounts = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.length]));
    return Response.json(
      { ok: true, recordCounts, message: "Backup restored. The current owner account and password were preserved." },
      { headers: { "Set-Cookie": sessionCookie, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const unauthorized = unauthorizedResponse(error);
    if (unauthorized) return unauthorized;
    if (error instanceof SyntaxError) return Response.json({ error: "The selected file is not valid JSON." }, { status: 400 });
    if (error instanceof BackupValidationError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "The backup could not be restored. Your current data was kept unchanged." }, { status: 500 });
  }
}
