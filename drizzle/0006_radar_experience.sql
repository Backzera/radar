-- Additive. Historical listings, budgets and previous migrations remain intact.
CREATE TABLE IF NOT EXISTS radar_activations (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 monitor_id TEXT NOT NULL, revision INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CONSTRAINT activation_state CHECK(state IN ('pending','queued','cancelled','attention')),
 job_id TEXT, message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS radar_activation_identity ON radar_activations(user_id,monitor_id,revision);
CREATE INDEX IF NOT EXISTS radar_activations_due ON radar_activations(user_id,state,created_at);
CREATE TABLE IF NOT EXISTS deal_pipeline (
 user_id TEXT NOT NULL REFERENCES users(id), listing_id TEXT NOT NULL,
 stage TEXT NOT NULL CONSTRAINT deal_stage CHECK(stage IN ('interested','negotiating','bought','for_sale','sold','passed')),
 note TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(user_id,listing_id), FOREIGN KEY(listing_id) REFERENCES listings(id)
);
CREATE INDEX IF NOT EXISTS deals_by_stage ON deal_pipeline(user_id,stage,updated_at);
CREATE TABLE IF NOT EXISTS availability_checks (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), listing_id TEXT NOT NULL REFERENCES listings(id),
 status TEXT NOT NULL DEFAULT 'pending', result TEXT NOT NULL DEFAULT 'unknown',
 cursor TEXT, trigger_started INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT, lease_until TEXT, available_at TEXT NOT NULL, requested_at TEXT NOT NULL,
 checked_at TEXT, message TEXT
);
CREATE INDEX IF NOT EXISTS availability_due ON availability_checks(user_id,status,available_at);
CREATE UNIQUE INDEX IF NOT EXISTS availability_single_active ON availability_checks(user_id,listing_id) WHERE status IN ('pending','running');
CREATE TRIGGER IF NOT EXISTS deals_feed_update AFTER UPDATE ON deal_pipeline BEGIN
 UPDATE feed_revisions SET version=version+1 WHERE user_id=NEW.user_id;
END;

-- Restores pipeline positions from existing purchases; no prices/dates are changed.
INSERT OR IGNORE INTO deal_pipeline(user_id,listing_id,stage,note,created_at,updated_at)
SELECT p.user_id,p.listing_id,CASE WHEN json_extract(p.data,'$.soldAt') IS NOT NULL THEN 'sold' ELSE 'bought' END,
COALESCE(json_extract(p.data,'$.note'),''),COALESCE(json_extract(p.data,'$.boughtAt'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),COALESCE(json_extract(p.data,'$.soldAt'),json_extract(p.data,'$.boughtAt'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))
FROM purchases p JOIN listings l ON l.id=p.listing_id AND l.user_id=p.user_id WHERE json_valid(p.data);
