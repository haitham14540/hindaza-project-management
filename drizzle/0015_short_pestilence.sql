CREATE TABLE `issue_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issue_id` integer NOT NULL,
	`section` text DEFAULT 'internal' NOT NULL,
	`author_email` text NOT NULL,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `issue_comments_issue_idx` ON `issue_comments` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_comments_created_idx` ON `issue_comments` (`created_at`);
--> statement-breakpoint
INSERT INTO `issue_comments` (`issue_id`, `section`, `author_email`, `author_name`, `body`, `created_at`)
SELECT `id`, 'internal', `raised_by_email`, `raised_by_name`, `comments`, `updated_at`
FROM `project_issues`
WHERE trim(`comments`) <> '';
--> statement-breakpoint
INSERT INTO `issue_comments` (`issue_id`, `section`, `author_email`, `author_name`, `body`, `created_at`)
SELECT `id`, 'client', `raised_by_email`, `raised_by_name`, `client_reply`, `updated_at`
FROM `project_issues`
WHERE trim(`client_reply`) <> '';
