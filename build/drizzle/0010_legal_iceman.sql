CREATE TABLE `issue_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_categories_name_unique` ON `issue_categories` (`name`);--> statement-breakpoint
CREATE INDEX `issue_categories_name_idx` ON `issue_categories` (`name`);