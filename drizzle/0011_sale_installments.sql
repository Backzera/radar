CREATE TABLE `sale_installments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`number` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`due_date` text NOT NULL,
	`paid_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "installment_positive" CHECK("sale_installments"."amount_cents">0)
);
--> statement-breakpoint
CREATE INDEX `idx_installments_item` ON `sale_installments` (`user_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `idx_installments_due` ON `sale_installments` (`user_id`,`paid_at`,`due_date`);