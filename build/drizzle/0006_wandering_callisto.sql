CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient_email` text NOT NULL,
	`type` text NOT NULL,
	`task_id` integer,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_recipient_idx` ON `notifications` (`recipient_email`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_read_idx` ON `notifications` (`recipient_email`,`read`);--> statement-breakpoint
CREATE INDEX `notifications_created_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`employee_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_project_employee_idx` ON `project_members` (`project_id`,`employee_email`);--> statement-breakpoint
CREATE INDEX `project_members_employee_idx` ON `project_members` (`employee_email`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_date` text NOT NULL,
	`employee_name` text NOT NULL,
	`employee_email` text DEFAULT '' NOT NULL,
	`project` text NOT NULL,
	`title` text NOT NULL,
	`expected_output` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`planned_hours` real DEFAULT 0 NOT NULL,
	`start_time` text DEFAULT '' NOT NULL,
	`end_time` text DEFAULT '' NOT NULL,
	`actual_hours` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`manager_check` text DEFAULT 'new' NOT NULL,
	`manager_note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "task_date", "employee_name", "employee_email", "project", "title", "expected_output", "priority", "planned_hours", "start_time", "end_time", "actual_hours", "status", "manager_check", "manager_note", "created_by", "created_at", "updated_at") SELECT "id", "task_date", "employee_name", "employee_email", "project", "title", "expected_output", "priority", "planned_hours", "start_time", "end_time", "actual_hours", "status", "manager_check", "manager_note", "created_by", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `tasks_date_idx` ON `tasks` (`task_date`);--> statement-breakpoint
CREATE INDEX `tasks_employee_idx` ON `tasks` (`employee_email`);