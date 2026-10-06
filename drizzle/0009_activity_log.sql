CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`actor_id` text,
	`user_id` text,
	`action` text NOT NULL,
	`entity` text,
	`entity_id` text,
	`summary` text NOT NULL,
	`details` text,
	`ip` text,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `idx_activity_recent` ON `activity_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_activity_user` ON `activity_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_activity_action` ON `activity_log` (`action`,`created_at`);--> statement-breakpoint
-- History from before the audit existed, marked with "backfill" in details.
INSERT INTO `activity_log` (`id`,`created_at`,`actor_id`,`user_id`,`action`,`entity`,`entity_id`,`summary`,`details`)
SELECT 'backfill:account:' || `user_id`, `created_at`, `user_id`, `user_id`, 'account_created', 'account', `user_id`,
  'Criou a conta', json_object('backfill', 1)
FROM `auth_credentials`;
--> statement-breakpoint
INSERT INTO `activity_log` (`id`,`created_at`,`actor_id`,`user_id`,`action`,`entity`,`entity_id`,`summary`,`details`)
SELECT 'backfill:item:' || `id`, `created_at`, `user_id`, `user_id`, 'item_created', 'item', `id`,
  'Cadastrou ' || `name` || ' · compra R$ ' || replace(printf('%,d', `purchase_price_cents` / 100), ',', '.') || ',' || printf('%02d', `purchase_price_cents` % 100),
  json_object('backfill', 1, 'item', json_object('name', `name`, 'category', `category`, 'purchasePriceCents', `purchase_price_cents`, 'purchasedAt', `purchased_at`))
FROM `inventory_items`;
--> statement-breakpoint
INSERT INTO `activity_log` (`id`,`created_at`,`actor_id`,`user_id`,`action`,`entity`,`entity_id`,`summary`,`details`)
SELECT 'backfill:sale:' || `id`, `sold_at` || 'T15:00:00.000Z', `user_id`, `user_id`, 'item_sold', 'item', `id`,
  'Vendeu ' || `name` || ' por R$ ' || replace(printf('%,d', `sale_price_cents` / 100), ',', '.') || ',' || printf('%02d', `sale_price_cents` % 100),
  json_object('backfill', 1, 'item', json_object('name', `name`, 'salePriceCents', `sale_price_cents`, 'soldAt', `sold_at`))
FROM `inventory_items` WHERE `status` = 'sold' AND `sold_at` IS NOT NULL AND `sale_price_cents` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `activity_log` (`id`,`created_at`,`actor_id`,`user_id`,`action`,`entity`,`entity_id`,`summary`,`details`)
SELECT 'backfill:audit:' || `id`, `created_at`, `actor_id`,
  CASE WHEN `subject_id` = 'signup' THEN NULL ELSE `subject_id` END,
  CASE WHEN `action` LIKE 'plan_%' THEN 'admin_plan_changed' ELSE 'admin_' || `action` END,
  CASE WHEN `subject_id` = 'signup' THEN 'settings' ELSE 'account' END,
  `subject_id`,
  CASE `action`
    WHEN 'user_created' THEN 'Cadastrou o usuário'
    WHEN 'user_deleted' THEN 'Excluiu uma conta'
    WHEN 'user_blocked' THEN 'Bloqueou o acesso'
    WHEN 'user_unblocked' THEN 'Liberou o acesso'
    WHEN 'password_reset' THEN 'Redefiniu a senha'
    WHEN 'signup_opened' THEN 'Abriu o cadastro pelo site'
    WHEN 'signup_closed' THEN 'Fechou o cadastro pelo site'
    ELSE 'Mudou o plano para ' || CASE substr(`action`, 6) WHEN 'pro' THEN 'Pro' ELSE 'Essencial' END
  END,
  json_object('backfill', 1)
FROM `audit_events`
WHERE `action` IN ('user_created','user_deleted','user_blocked','user_unblocked','password_reset','signup_opened','signup_closed','plan_essencial','plan_pro');
