CREATE TABLE `project_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_code` text NOT NULL,
	`title` text NOT NULL,
	`content_html` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_notes_project_updated_idx` ON `project_notes` (`project_code`,`updated_at`);--> statement-breakpoint
CREATE INDEX `project_notes_creator_idx` ON `project_notes` (`created_by`);