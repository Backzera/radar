ALTER TABLE `inventory_items` ADD `group_id` text;--> statement-breakpoint
CREATE INDEX `idx_inventory_user_group` ON `inventory_items` (`user_id`,`group_id`);