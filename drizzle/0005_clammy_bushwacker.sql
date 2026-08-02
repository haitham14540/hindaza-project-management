CREATE TABLE `task_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`author_email` text NOT NULL,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `task_comments_task_idx` ON `task_comments` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_comments_created_idx` ON `task_comments` (`created_at`);