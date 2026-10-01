CREATE TABLE `discovery_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`scope_id` text NOT NULL,
	`external_id` text NOT NULL,
	`original_url` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`baseline` integer NOT NULL,
	`last_run_id` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_candidate_scope` ON `discovery_candidates` (`user_id`,`provider`,`scope_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_candidate_identity` ON `discovery_candidates` (`user_id`,`provider`,`external_id`);--> statement-breakpoint
ALTER TABLE `provider_runs` ADD `candidates_found` integer DEFAULT 0 NOT NULL;