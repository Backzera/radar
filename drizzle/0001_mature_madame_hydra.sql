CREATE TABLE `discovery_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`provider` text NOT NULL,
	`query_type` text NOT NULL,
	`monitor_id` text NOT NULL,
	`run_id` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`published_at` text,
	`publication_status` text NOT NULL,
	`publication_confidence` integer NOT NULL,
	`delay_seconds` real,
	`baseline` integer NOT NULL,
	`city` text NOT NULL,
	`snapshot_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_discovery_method_listing` ON `discovery_observations` (`user_id`,`provider`,`query_type`,`listing_id`);--> statement-breakpoint
CREATE INDEX `idx_discovery_user_date` ON `discovery_observations` (`user_id`,`provider`,`first_seen_at`);--> statement-breakpoint
CREATE TABLE `provider_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	`provider` text NOT NULL,
	`query_type` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`records_requested` integer NOT NULL,
	`records_received` integer DEFAULT 0 NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`duplicates` integer DEFAULT 0 NOT NULL,
	`rejected` integer DEFAULT 0 NOT NULL,
	`new_listings` integer DEFAULT 0 NOT NULL,
	`price_changes` integer DEFAULT 0 NOT NULL,
	`known_publication` integer DEFAULT 0 NOT NULL,
	`unknown_publication` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer,
	`snapshot_id` text,
	`errors` text DEFAULT '{}' NOT NULL,
	`cost_metadata` text,
	`baseline` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_provider_runs_user_date` ON `provider_runs` (`user_id`,`provider`,`started_at`);--> statement-breakpoint
CREATE TABLE `__new_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`marketplace` text NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`product_key` text,
	`fingerprint` text NOT NULL,
	`demo` integer NOT NULL,
	`data` text NOT NULL,
	`price` real,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_listings`("id", "user_id", "marketplace", "external_id", "url", "product_key", "fingerprint", "demo", "data", "price", "first_seen_at", "last_seen_at") SELECT "id", "user_id", "marketplace", "external_id", "url", "product_key", "fingerprint", "demo", "data", "price", "first_seen_at", "last_seen_at" FROM `listings`;--> statement-breakpoint
CREATE TABLE `__new_listing_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`user_id` text NOT NULL,
	`price` real,
	`availability` text NOT NULL,
	`observed_at` text NOT NULL,
	`hash` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `__new_listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_listing_snapshots`("id", "listing_id", "user_id", "price", "availability", "observed_at", "hash", "data") SELECT "id", "listing_id", "user_id", "price", "availability", "observed_at", "hash", "data" FROM `listing_snapshots`;--> statement-breakpoint
DROP TABLE `listing_snapshots`;
--> statement-breakpoint
DROP TABLE `listings`;
--> statement-breakpoint
ALTER TABLE `__new_listings` RENAME TO `listings`;
--> statement-breakpoint
ALTER TABLE `__new_listing_snapshots` RENAME TO `listing_snapshots`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_listing_external` ON `listings` (`user_id`,`marketplace`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_listing_url` ON `listings` (`user_id`,`url`);--> statement-breakpoint
CREATE INDEX `idx_listings_product` ON `listings` (`user_id`,`product_key`);--> statement-breakpoint
CREATE INDEX `idx_listings_recent` ON `listings` (`user_id`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `idx_snapshots_listing` ON `listing_snapshots` (`listing_id`,`observed_at`);--> statement-breakpoint
ALTER TABLE `provider_health` ADD `kind` text DEFAULT 'collection' NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_health` ADD `data` text;