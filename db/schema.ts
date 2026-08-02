import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["manager", "member"] }).notNull().default("member"),
  discipline: text("discipline", {
    enum: ["Manager", "Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure", ""],
  }).notNull().default(""),
  passwordHash: text("password_hash").notNull().default(""),
  passwordSalt: text("password_salt").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    email: text("email").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("sessions_email_idx").on(table.email), index("sessions_expiry_idx").on(table.expiresAt)],
);

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  client: text("client").notNull().default(""),
  status: text("status", { enum: ["active", "on_hold", "completed"] })
    .notNull()
    .default("active"),
  startDate: text("start_date").notNull().default(""),
  targetDate: text("target_date").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const projectMembers = sqliteTable(
  "project_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id").notNull(),
    employeeEmail: text("employee_email").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("project_members_project_employee_idx").on(table.projectId, table.employeeEmail),
    index("project_members_employee_idx").on(table.employeeEmail),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskDate: text("task_date").notNull(),
    employeeName: text("employee_name").notNull(),
    employeeEmail: text("employee_email").notNull().default(""),
    project: text("project").notNull(),
    title: text("title").notNull(),
    expectedOutput: text("expected_output").notNull().default(""),
    priority: text("priority", { enum: ["high", "medium", "low"] })
      .notNull()
      .default("medium"),
    plannedHours: real("planned_hours").notNull().default(0),
    startTime: text("start_time").notNull().default(""),
    endTime: text("end_time").notNull().default(""),
    actualHours: real("actual_hours").notNull().default(0),
    status: text("status", {
      enum: ["not_started", "in_progress", "paused", "blocked", "needs_revision", "done"],
    })
      .notNull()
      .default("not_started"),
    managerCheck: text("manager_check", {
      enum: ["new", "pending", "approved", "returned"],
    })
      .notNull()
      .default("new"),
    managerNote: text("manager_note").notNull().default(""),
    visibility: text("visibility", { enum: ["team", "private"] }).notNull().default("team"),
    submittedToManager: integer("submitted_to_manager", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("tasks_date_idx").on(table.taskDate),
    index("tasks_employee_idx").on(table.employeeEmail),
  ],
);

export const taskTimeEntries = sqliteTable(
  "task_time_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id").notNull(),
    employeeEmail: text("employee_email").notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("task_time_entries_task_idx").on(table.taskId),
    index("task_time_entries_employee_idx").on(table.employeeEmail),
    index("task_time_entries_active_idx").on(table.employeeEmail, table.endedAt),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipientEmail: text("recipient_email").notNull(),
    type: text("type", { enum: ["task_assigned", "review_updated", "private_task_submitted", "task_ready_for_review"] }).notNull(),
    taskId: integer("task_id"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("notifications_recipient_idx").on(table.recipientEmail),
    index("notifications_recipient_read_idx").on(table.recipientEmail, table.read),
    index("notifications_created_idx").on(table.createdAt),
  ],
);

export const taskComments = sqliteTable(
  "task_comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id").notNull(),
    authorEmail: text("author_email").notNull(),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("task_comments_task_idx").on(table.taskId),
    index("task_comments_created_idx").on(table.createdAt),
  ],
);
