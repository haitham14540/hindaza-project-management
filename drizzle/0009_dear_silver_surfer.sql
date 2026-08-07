CREATE TABLE `issue_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issue_id` integer NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_attachments_object_key_unique` ON `issue_attachments` (`object_key`);--> statement-breakpoint
CREATE INDEX `issue_attachments_issue_idx` ON `issue_attachments` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_attachments_created_idx` ON `issue_attachments` (`created_at`);--> statement-breakpoint
CREATE TABLE `project_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issue_number` text NOT NULL,
	`sequence` integer NOT NULL,
	`project_code` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`discipline` text NOT NULL,
	`description` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`assignee_email` text DEFAULT '' NOT NULL,
	`raised_by_email` text NOT NULL,
	`raised_by_name` text NOT NULL,
	`issue_date` text NOT NULL,
	`resolved_date` text DEFAULT '' NOT NULL,
	`comments` text DEFAULT '' NOT NULL,
	`converted_task_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_issues_issue_number_unique` ON `project_issues` (`issue_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_issues_group_sequence_idx` ON `project_issues` (`project_code`,`discipline`,`sequence`);--> statement-breakpoint
CREATE INDEX `project_issues_project_idx` ON `project_issues` (`project_code`);--> statement-breakpoint
CREATE INDEX `project_issues_status_idx` ON `project_issues` (`status`);--> statement-breakpoint
CREATE INDEX `project_issues_assignee_idx` ON `project_issues` (`assignee_email`);--> statement-breakpoint
CREATE INDEX `project_issues_created_idx` ON `project_issues` (`created_at`);