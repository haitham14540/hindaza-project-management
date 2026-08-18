ALTER TABLE `tasks` ADD `start_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `tasks_start_date_idx` ON `tasks` (`start_date`);