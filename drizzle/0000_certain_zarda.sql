CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`event_key` text NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL,
	`read` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_alert_event` ON `alerts` (`user_id`,`event_key`);--> statement-breakpoint
CREATE INDEX `idx_alerts_user` ON `alerts` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`type` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_health` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`ok` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`volume` integer NOT NULL,
	`error` text,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_health_provider` ON `provider_health` (`user_id`,`provider`,`checked_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	`scope_id` text NOT NULL,
	`status` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`available_at` text NOT NULL,
	`lease_until` text,
	`lease_token` text,
	`payload` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_ready` ON `jobs` (`status`,`available_at`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_jobs_user` ON `jobs` (`user_id`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`marketplace` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`product_key` text,
	`fingerprint` text NOT NULL,
	`demo` integer NOT NULL,
	`data` text NOT NULL,
	`price` real NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_listing_external` ON `listings` (`user_id`,`marketplace`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_listing_url` ON `listings` (`user_id`,`url`);--> statement-breakpoint
CREATE INDEX `idx_listings_product` ON `listings` (`user_id`,`product_key`);--> statement-breakpoint
CREATE INDEX `idx_listings_recent` ON `listings` (`user_id`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `monitors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`config` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_monitors_user` ON `monitors` (`user_id`);--> statement-breakpoint
CREATE TABLE `notification_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`alert_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`available_at` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_outbox_alert` ON `notification_outbox` (`alert_id`,`channel`);--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	`score` integer NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_opportunity` ON `opportunities` (`user_id`,`listing_id`,`monitor_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_purchase_listing` ON `purchases` (`user_id`,`listing_id`);--> statement-breakpoint
CREATE TABLE `search_queries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	`query` text NOT NULL,
	`runs` integer DEFAULT 0 NOT NULL,
	`discoveries` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_query` ON `search_queries` (`user_id`,`monitor_id`,`query`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `monitor_scopes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	`provider` text NOT NULL,
	`revision` integer NOT NULL,
	`baseline_complete` integer DEFAULT 0 NOT NULL,
	`cursor` text,
	`next_run_at` text NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_scope` ON `monitor_scopes` (`user_id`,`monitor_id`,`provider`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_scopes_due` ON `monitor_scopes` (`next_run_at`);--> statement-breakpoint
CREATE TABLE `monitor_sightings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	`provider` text NOT NULL,
	`revision` integer NOT NULL,
	`listing_id` text NOT NULL,
	`baseline` integer NOT NULL,
	`first_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sighting_scope` ON `monitor_sightings` (`user_id`,`monitor_id`,`provider`,`revision`,`listing_id`);--> statement-breakpoint
CREATE TABLE `listing_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`user_id` text NOT NULL,
	`price` real NOT NULL,
	`availability` text NOT NULL,
	`observed_at` text NOT NULL,
	`hash` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_snapshots_listing` ON `listing_snapshots` (`listing_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`settings` text NOT NULL,
	`demo_seeded` integer DEFAULT 0 NOT NULL
);
