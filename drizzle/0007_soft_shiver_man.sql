CREATE TABLE `task_time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`employee_email` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `task_time_entries_task_idx` ON `task_time_entries` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_time_entries_employee_idx` ON `task_time_entries` (`employee_email`);--> statement-breakpoint
CREATE INDEX `task_time_entries_active_idx` ON `task_time_entries` (`employee_email`,`ended_at`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `visibility` text DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `submitted_to_manager` integer DEFAULT false NOT NULL;