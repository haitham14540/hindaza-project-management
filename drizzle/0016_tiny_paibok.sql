ALTER TABLE `task_time_entries` ADD `employee_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `task_time_entries` ADD `resumed_at` text;--> statement-breakpoint
ALTER TABLE `task_time_entries` ADD `work_cycle` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `originated_by_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `originated_by_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `accepted_by_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `accepted_by_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `work_cycle` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE `task_time_entries`
SET `employee_name` = COALESCE(
  NULLIF((SELECT `display_name` FROM `users` WHERE `users`.`email` = `task_time_entries`.`employee_email` LIMIT 1), ''),
  NULLIF((SELECT `employee_name` FROM `tasks` WHERE `tasks`.`id` = `task_time_entries`.`task_id` LIMIT 1), ''),
  `employee_email`
)
WHERE `employee_name` = '';
