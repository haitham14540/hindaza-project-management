ALTER TABLE `users` ADD `profile_image_key` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `users` SET `role` = 'owner'
WHERE `email` = (
  SELECT `email` FROM `users`
  WHERE `role` = 'manager' AND `active` = 1
  ORDER BY `created_at`, `email`
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM `users` WHERE `role` = 'owner');
