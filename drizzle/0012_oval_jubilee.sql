ALTER TABLE `issue_attachments` ADD `source` text DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_issues` ADD `client_reply` text DEFAULT '' NOT NULL;