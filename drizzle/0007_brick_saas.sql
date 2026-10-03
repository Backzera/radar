CREATE TABLE `auth_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`iterations` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_auth_email` ON `auth_credentials` (`email`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_auth_sessions_user` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `brick_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`monthly_goal_cents` integer,
	`stale_after_days` integer DEFAULT 30 NOT NULL,
	`selected_plan` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`amount_cents` integer NOT NULL,
	`spent_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inventory_cost_positive" CHECK("inventory_costs"."amount_cents">0)
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_costs_item` ON `inventory_costs` (`user_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`brand` text,
	`model` text,
	`condition` text NOT NULL,
	`identifier` text,
	`notes` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`purchase_price_cents` integer NOT NULL,
	`purchased_at` text NOT NULL,
	`purchase_channel` text NOT NULL,
	`purchase_from` text,
	`asking_price_cents` integer,
	`sale_price_cents` integer,
	`sale_fees_cents` integer DEFAULT 0 NOT NULL,
	`sold_at` text,
	`sale_channel` text,
	`sold_to` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_status" CHECK("inventory_items"."status" IN ('in_stock','preparing','listed','reserved','sold')),
	CONSTRAINT "inventory_sale_consistent" CHECK(("inventory_items"."status"='sold') = ("inventory_items"."sale_price_cents" IS NOT NULL AND "inventory_items"."sold_at" IS NOT NULL)),
	CONSTRAINT "inventory_purchase_nonnegative" CHECK("inventory_items"."purchase_price_cents">=0)
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_user_status` ON `inventory_items` (`user_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_inventory_user_sold` ON `inventory_items` (`user_id`,`sold_at`);--> statement-breakpoint
CREATE TABLE `inventory_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_photos_item` ON `inventory_photos` (`user_id`,`item_id`);