CREATE TABLE `task_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`subtask_id` integer,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_attachments_object_key_unique` ON `task_attachments` (`object_key`);--> statement-breakpoint
CREATE INDEX `task_attachments_task_idx` ON `task_attachments` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_attachments_subtask_idx` ON `task_attachments` (`subtask_id`);--> statement-breakpoint
CREATE INDEX `task_attachments_created_idx` ON `task_attachments` (`created_at`);--> statement-breakpoint
CREATE TABLE `task_subtasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`title` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`completed_at` text,
	`completed_by` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `task_subtasks_task_idx` ON `task_subtasks` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_subtasks_completed_idx` ON `task_subtasks` (`task_id`,`completed`);