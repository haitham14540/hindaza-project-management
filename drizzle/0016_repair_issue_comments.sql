CREATE TABLE IF NOT EXISTS `issue_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issue_id` integer NOT NULL,
	`section` text DEFAULT 'internal' NOT NULL,
	`author_email` text NOT NULL,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `issue_comments_issue_idx` ON `issue_comments` (`issue_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `issue_comments_created_idx` ON `issue_comments` (`created_at`);
--> statement-breakpoint
INSERT INTO `issue_comments` (`issue_id`, `section`, `author_email`, `author_name`, `body`, `created_at`)
SELECT `project_issues`.`id`, 'internal', `project_issues`.`raised_by_email`, `project_issues`.`raised_by_name`, `project_issues`.`comments`, `project_issues`.`updated_at`
FROM `project_issues`
WHERE trim(`project_issues`.`comments`) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM `issue_comments` AS `note`
    WHERE `note`.`issue_id` = `project_issues`.`id`
      AND `note`.`section` = 'internal'
      AND `note`.`body` = `project_issues`.`comments`
  );
--> statement-breakpoint
INSERT INTO `issue_comments` (`issue_id`, `section`, `author_email`, `author_name`, `body`, `created_at`)
SELECT `project_issues`.`id`, 'client', `project_issues`.`raised_by_email`, `project_issues`.`raised_by_name`, `project_issues`.`client_reply`, `project_issues`.`updated_at`
FROM `project_issues`
WHERE trim(`project_issues`.`client_reply`) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM `issue_comments` AS `note`
    WHERE `note`.`issue_id` = `project_issues`.`id`
      AND `note`.`section` = 'client'
      AND `note`.`body` = `project_issues`.`client_reply`
  );
