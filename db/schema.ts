import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["owner", "manager", "member"] }).notNull().default("member"),
  discipline: text("discipline", {
    enum: ["Manager", "Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure", ""],
  }).notNull().default(""),
  passwordHash: text("password_hash").notNull().default(""),
  passwordSalt: text("password_salt").notNull().default(""),
  profileImageKey: text("profile_image_key").notNull().default(""),
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
  status: text("status", { enum: ["active", "on_hold", "completed", "archived"] })
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
    isProjectManager: integer("is_project_manager", { mode: "boolean" }).notNull().default(false),
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
    startDate: text("start_date").notNull().default(""),
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
    completionPercent: integer("completion_percent").notNull().default(0),
    completionBeforeReview: integer("completion_before_review").notNull().default(0),
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
    originatedByEmail: text("originated_by_email").notNull().default(""),
    originatedByName: text("originated_by_name").notNull().default(""),
    acceptedByEmail: text("accepted_by_email").notNull().default(""),
    acceptedByName: text("accepted_by_name").notNull().default(""),
    workCycle: integer("work_cycle").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("tasks_start_date_idx").on(table.startDate),
    index("tasks_date_idx").on(table.taskDate),
    index("tasks_employee_idx").on(table.employeeEmail),
    index("tasks_created_idx").on(table.createdAt),
    index("tasks_project_created_idx").on(table.project, table.createdAt),
    index("tasks_creator_idx").on(table.createdBy),
  ],
);

export const taskTimeEntries = sqliteTable(
  "task_time_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id").notNull(),
    employeeEmail: text("employee_email").notNull(),
    employeeName: text("employee_name").notNull().default(""),
    startedAt: text("started_at").notNull(),
    resumedAt: text("resumed_at"),
    endedAt: text("ended_at"),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    workCycle: integer("work_cycle").notNull().default(1),
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
    type: text("type", { enum: ["task_assigned", "review_updated", "private_task_submitted", "task_ready_for_review", "subtask_completed", "task_note_added", "task_mentioned", "issue_created", "issue_updated", "issue_note_added", "project_member_added"] }).notNull(),
    taskId: integer("task_id"),
    issueId: integer("issue_id"),
    title: text("title").notNull(),
    message: text("message").notNull(),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("notifications_recipient_idx").on(table.recipientEmail),
    index("notifications_recipient_read_idx").on(table.recipientEmail, table.read),
    index("notifications_recipient_created_idx").on(table.recipientEmail, table.createdAt, table.id),
    index("notifications_created_idx").on(table.createdAt),
  ],
);

export const activityLogs = sqliteTable(
  "activity_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorEmail: text("actor_email").notNull(),
    actorName: text("actor_name").notNull(),
    action: text("action", { enum: ["created", "updated", "deleted", "note_added", "timer_updated", "attachment_added", "attachment_deleted", "converted", "login", "logout", "downloaded", "restored", "read"] }).notNull(),
    entityType: text("entity_type", { enum: ["task", "issue", "project", "user", "account", "backup", "notification"] }).notNull(),
    entityId: integer("entity_id"),
    entityLabel: text("entity_label").notNull(),
    projectCode: text("project_code").notNull().default(""),
    details: text("details").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("activity_logs_created_idx").on(table.createdAt),
    index("activity_logs_entity_idx").on(table.entityType, table.entityId),
    index("activity_logs_project_idx").on(table.projectCode),
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

export const taskSubtasks = sqliteTable(
  "task_subtasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id").notNull(),
    title: text("title").notNull(),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    completedAt: text("completed_at"),
    completedBy: text("completed_by").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("task_subtasks_task_idx").on(table.taskId),
    index("task_subtasks_completed_idx").on(table.taskId, table.completed),
  ],
);

export const taskAttachments = sqliteTable(
  "task_attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id").notNull(),
    subtaskId: integer("subtask_id"),
    objectKey: text("object_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("task_attachments_task_idx").on(table.taskId),
    index("task_attachments_subtask_idx").on(table.subtaskId),
    index("task_attachments_created_idx").on(table.createdAt),
  ],
);

export const projectIssues = sqliteTable(
  "project_issues",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    issueNumber: text("issue_number").notNull().unique(),
    sequence: integer("sequence").notNull(),
    projectCode: text("project_code").notNull(),
    status: text("status", { enum: ["open", "re_open", "closed"] }).notNull().default("open"),
    discipline: text("discipline", {
      enum: ["Manager", "Architecture", "ID", "Structure", "Mechanical", "Electrical", "Infrastructure"],
    }).notNull(),
    description: text("description").notNull(),
    category: text("category").notNull().default(""),
    priority: text("priority", { enum: ["low", "medium", "high", "critical"] }).notNull().default("medium"),
    assigneeEmail: text("assignee_email").notNull().default(""),
    raisedByEmail: text("raised_by_email").notNull(),
    raisedByName: text("raised_by_name").notNull(),
    issueDate: text("issue_date").notNull(),
    resolvedDate: text("resolved_date").notNull().default(""),
    comments: text("comments").notNull().default(""),
    clientReply: text("client_reply").notNull().default(""),
    convertedTaskId: integer("converted_task_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("project_issues_group_sequence_idx").on(table.projectCode, table.discipline, table.sequence),
    index("project_issues_project_idx").on(table.projectCode),
    index("project_issues_status_idx").on(table.status),
    index("project_issues_assignee_idx").on(table.assigneeEmail),
    index("project_issues_created_idx").on(table.createdAt),
    index("project_issues_converted_task_idx").on(table.convertedTaskId),
  ],
);

export const issueCategories = sqliteTable(
  "issue_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("issue_categories_name_idx").on(table.name)],
);

export const issueComments = sqliteTable(
  "issue_comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    issueId: integer("issue_id").notNull(),
    section: text("section", { enum: ["internal", "client"] }).notNull().default("internal"),
    authorEmail: text("author_email").notNull(),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("issue_comments_issue_idx").on(table.issueId),
    index("issue_comments_created_idx").on(table.createdAt),
  ],
);

export const issueAttachments = sqliteTable(
  "issue_attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    issueId: integer("issue_id").notNull(),
    objectKey: text("object_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    source: text("source", { enum: ["internal", "client"] }).notNull().default("internal"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("issue_attachments_issue_idx").on(table.issueId),
    index("issue_attachments_created_idx").on(table.createdAt),
  ],
);
