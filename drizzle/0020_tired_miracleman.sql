CREATE INDEX `project_issues_converted_task_idx` ON `project_issues` (`converted_task_id`);--> statement-breakpoint
CREATE INDEX `tasks_created_idx` ON `tasks` (`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_project_created_idx` ON `tasks` (`project`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_creator_idx` ON `tasks` (`created_by`);