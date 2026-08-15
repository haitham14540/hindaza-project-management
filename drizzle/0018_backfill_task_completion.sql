UPDATE `tasks`
SET `completion_percent` = 100
WHERE `status` = 'done' AND `completion_percent` = 0;
