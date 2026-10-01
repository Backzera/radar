-- Additive migration. No existing listing, financial policy or ownership is rewritten.
CREATE TABLE plans (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, max_active INTEGER NOT NULL CHECK(max_active>=0), min_interval INTEGER NOT NULL CHECK(min_interval>=60), daily_triggers INTEGER NOT NULL CHECK(daily_triggers>=0), telegram INTEGER NOT NULL DEFAULT 0 CHECK(telegram IN (0,1)));
INSERT INTO plans VALUES ('managed','Acesso administrado',5,300,5,0);
CREATE TABLE accounts (user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id), plan_id TEXT NOT NULL DEFAULT 'managed' REFERENCES plans(id), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','canceled')), preferences TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, last_scheduled_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z');
INSERT INTO accounts(user_id,created_at) SELECT id,created_at FROM users;
CREATE TABLE monitor_commands (user_id TEXT NOT NULL, request_key TEXT NOT NULL, input_hash TEXT NOT NULL, monitor_id TEXT NOT NULL, PRIMARY KEY(user_id,request_key));
CREATE TABLE search_drafts (user_id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE listing_preferences (user_id TEXT NOT NULL, listing_id TEXT NOT NULL, saved INTEGER NOT NULL DEFAULT 0, dismissed INTEGER NOT NULL DEFAULT 0, reason TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,listing_id));
CREATE TABLE feed_revisions (user_id TEXT PRIMARY KEY NOT NULL, version INTEGER NOT NULL DEFAULT 1);
INSERT INTO feed_revisions SELECT id,1 FROM users;
CREATE TABLE feed_state (user_id TEXT PRIMARY KEY NOT NULL, generation TEXT, source_version INTEGER NOT NULL DEFAULT 0, rule_version TEXT NOT NULL DEFAULT '', built_at TEXT, lease_token TEXT, lease_until TEXT);
CREATE TABLE feed_entries (user_id TEXT NOT NULL, generation TEXT NOT NULL, listing_id TEXT NOT NULL, search_text TEXT NOT NULL, price REAL, score INTEGER NOT NULL, eligible INTEGER NOT NULL, budget INTEGER NOT NULL, event TEXT NOT NULL, published_at TEXT, last_seen_at TEXT NOT NULL, monitor_ids TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(user_id,generation,listing_id));
CREATE INDEX idx_feed_rank ON feed_entries(user_id,generation,eligible DESC,score DESC,listing_id);
CREATE INDEX idx_feed_price ON feed_entries(user_id,generation,price,listing_id);
CREATE INDEX idx_feed_time ON feed_entries(user_id,generation,last_seen_at DESC,listing_id);
CREATE INDEX idx_sightings_user_listing ON monitor_sightings(user_id,listing_id);
CREATE INDEX idx_runs_monitor_time ON provider_runs(user_id,monitor_id,started_at DESC);
CREATE INDEX idx_jobs_user_due ON jobs(user_id,status,available_at);
ALTER TABLE notification_outbox ADD COLUMN lease_token TEXT;
ALTER TABLE notification_outbox ADD COLUMN lease_until TEXT;
CREATE INDEX idx_outbox_user_due ON notification_outbox(user_id,status,available_at);
ALTER TABLE provider_runs ADD COLUMN summary TEXT NOT NULL DEFAULT '{}';
CREATE TABLE notification_destinations (user_id TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel='telegram'), address TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, verified_at TEXT NOT NULL, PRIMARY KEY(user_id,channel));
CREATE UNIQUE INDEX uq_telegram_address ON notification_destinations(channel,address);
CREATE TABLE channel_tokens (token_hash TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT);
CREATE TABLE worker_heartbeats (id TEXT PRIMARY KEY NOT NULL, seen_at TEXT NOT NULL, status TEXT NOT NULL, lease_token TEXT, lease_until TEXT);
CREATE TABLE budget_reservations (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, global_key TEXT NOT NULL, tenant_key TEXT NOT NULL, created_at TEXT NOT NULL, refunded INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER reserve_budget AFTER INSERT ON budget_reservations BEGIN
 INSERT INTO rate_limits(key,window,count) VALUES(NEW.global_key,0,1) ON CONFLICT(key) DO UPDATE SET count=count+1;
 INSERT INTO rate_limits(key,window,count) VALUES(NEW.tenant_key,0,1) ON CONFLICT(key) DO UPDATE SET count=count+1;
END;
CREATE TRIGGER refund_budget AFTER UPDATE OF refunded ON budget_reservations WHEN OLD.refunded=0 AND NEW.refunded=1 BEGIN
 UPDATE rate_limits SET count=MAX(0,count-1) WHERE key=NEW.global_key OR key=NEW.tenant_key;
END;
CREATE TABLE product_events (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, event TEXT NOT NULL, subject_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX idx_product_events_account_time ON product_events(user_id,created_at);
CREATE TABLE audit_events (id TEXT PRIMARY KEY NOT NULL, actor_id TEXT NOT NULL, subject_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TRIGGER feed_listings_insert AFTER INSERT ON listings BEGIN
 INSERT INTO feed_revisions(user_id,version) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER feed_listings_update AFTER UPDATE ON listings BEGIN
 INSERT INTO feed_revisions(user_id,version) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER feed_listings_delete AFTER DELETE ON listings BEGIN
 INSERT INTO feed_revisions(user_id,version) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER feed_monitors_insert AFTER INSERT ON monitors BEGIN
 INSERT INTO feed_revisions(user_id,version) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER feed_monitors_update AFTER UPDATE ON monitors BEGIN
 INSERT INTO feed_revisions(user_id,version) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER feed_monitors_delete AFTER DELETE ON monitors BEGIN
 INSERT INTO feed_revisions(user_id,version) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER feed_purchases_insert AFTER INSERT ON purchases BEGIN
 INSERT INTO feed_revisions(user_id,version) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER feed_purchases_update AFTER UPDATE ON purchases BEGIN
 INSERT INTO feed_revisions(user_id,version) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER feed_purchases_delete AFTER DELETE ON purchases BEGIN
 INSERT INTO feed_revisions(user_id,version) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER feed_settings AFTER UPDATE OF settings ON users BEGIN
 INSERT INTO feed_revisions(user_id,version) VALUES(NEW.id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;

-- Account limits enforced within the write, not only in the interface.
CREATE TRIGGER monitors_plan_insert BEFORE INSERT ON monitors
WHEN NEW.active=1 AND NOT EXISTS(SELECT 1 FROM monitors WHERE id=NEW.id)
AND EXISTS(SELECT 1 FROM accounts a JOIN plans p ON p.id=a.plan_id WHERE a.user_id=NEW.user_id AND (a.status!='active' OR (SELECT COUNT(*) FROM monitors m WHERE m.user_id=NEW.user_id AND m.active=1)>=p.max_active))
BEGIN SELECT RAISE(ABORT,'PLAN_LIMIT'); END;
CREATE TRIGGER monitors_plan_activate BEFORE UPDATE OF active ON monitors
WHEN NEW.active=1 AND OLD.active=0
AND EXISTS(SELECT 1 FROM accounts a JOIN plans p ON p.id=a.plan_id WHERE a.user_id=NEW.user_id AND (a.status!='active' OR (SELECT COUNT(*) FROM monitors m WHERE m.user_id=NEW.user_id AND m.active=1 AND m.id!=NEW.id)>=p.max_active))
BEGIN SELECT RAISE(ABORT,'PLAN_LIMIT'); END;

-- Refuse a downgrade that would silently violate the active-search promise.
CREATE TRIGGER plans_active_downgrade BEFORE UPDATE OF max_active ON plans
WHEN EXISTS(SELECT 1 FROM accounts a WHERE a.plan_id=NEW.id AND (SELECT COUNT(*) FROM monitors m WHERE m.user_id=a.user_id AND m.active=1)>NEW.max_active)
BEGIN SELECT RAISE(ABORT,'PLAN_LIMIT'); END;
CREATE TRIGGER account_plan_downgrade BEFORE UPDATE OF plan_id ON accounts
WHEN (SELECT COUNT(*) FROM monitors m WHERE m.user_id=NEW.user_id AND m.active=1)>(SELECT max_active FROM plans WHERE id=NEW.plan_id)
BEGIN SELECT RAISE(ABORT,'PLAN_LIMIT'); END;

-- Preserve existing active searches above the initial plan without silently pausing them.
-- The administrator can review these accounts before changing their plan.
INSERT INTO plans(id,name,max_active,min_interval,daily_triggers,telegram)
SELECT 'legacy','Acesso existente: revisão administrativa',MAX(n),300,5,0
FROM (SELECT COUNT(*) n FROM monitors WHERE active=1 GROUP BY user_id) HAVING MAX(n)>5;
UPDATE accounts SET plan_id='legacy' WHERE EXISTS(SELECT 1 FROM plans WHERE id='legacy')
AND (SELECT COUNT(*) FROM monitors m WHERE m.user_id=accounts.user_id AND m.active=1)>5;
