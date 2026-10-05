import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  settings: text("settings").notNull(),
  demoSeeded: integer("demo_seeded").notNull().default(0),
});
export const monitors = sqliteTable(
  "monitors",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    config: text("config").notNull(),
    financials: text("financials"),
    active: integer("active").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_monitors_user").on(t.userId)],
);
export const listings = sqliteTable(
  "listings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    marketplace: text("marketplace").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    productKey: text("product_key"),
    fingerprint: text("fingerprint").notNull(),
    demo: integer("demo").notNull(),
    data: text("data").notNull(),
    price: real("price"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (t) => [
    uniqueIndex("uq_listing_external").on(
      t.userId,
      t.marketplace,
      t.externalId,
    ),
    uniqueIndex("uq_listing_url").on(t.userId, t.url),
    index("idx_listings_product").on(t.userId, t.productKey),
    index("idx_listings_recent").on(t.userId, t.lastSeenAt),
  ],
);
export const snapshots = sqliteTable(
  "listing_snapshots",
  {
    id: text("id").primaryKey(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id),
    userId: text("user_id").notNull(),
    price: real("price"),
    availability: text("availability").notNull(),
    observedAt: text("observed_at").notNull(),
    hash: text("hash").notNull(),
    data: text("data").notNull(),
  },
  (t) => [index("idx_snapshots_listing").on(t.listingId, t.observedAt)],
);
export const sightings = sqliteTable(
  "monitor_sightings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    monitorId: text("monitor_id").notNull(),
    provider: text("provider").notNull(),
    revision: integer("revision").notNull(),
    listingId: text("listing_id").notNull(),
    baseline: integer("baseline").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
  },
  (t) => [
    index("idx_sightings_user_listing").on(t.userId, t.listingId),
    uniqueIndex("uq_sighting_scope").on(
      t.userId,
      t.monitorId,
      t.provider,
      t.revision,
      t.listingId,
    ),
  ],
);
export const scopes = sqliteTable(
  "monitor_scopes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    monitorId: text("monitor_id").notNull(),
    provider: text("provider").notNull(),
    revision: integer("revision").notNull(),
    baselineComplete: integer("baseline_complete").notNull().default(0),
    cursor: text("cursor"),
    nextRunAt: text("next_run_at").notNull(),
    failures: integer("failures").notNull().default(0),
    sequence: integer("sequence").notNull().default(0),
  },
  (t) => [
    uniqueIndex("uq_scope").on(t.userId, t.monitorId, t.provider, t.revision),
    index("idx_scopes_due").on(t.nextRunAt),
  ],
);
export const opportunities = sqliteTable(
  "opportunities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    listingId: text("listing_id").notNull(),
    monitorId: text("monitor_id").notNull(),
    score: integer("score").notNull(),
    data: text("data").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("uq_opportunity").on(t.userId, t.listingId, t.monitorId)],
);
export const alerts = sqliteTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    listingId: text("listing_id").notNull(),
    eventKey: text("event_key").notNull(),
    createdAt: text("created_at").notNull(),
    data: text("data").notNull(),
    read: integer("read").notNull().default(0),
  },
  (t) => [
    uniqueIndex("uq_alert_event").on(t.userId, t.eventKey),
    index("idx_alerts_user").on(t.userId, t.createdAt),
  ],
);
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    monitorId: text("monitor_id").notNull(),
    scopeId: text("scope_id").notNull(),
    status: text("status").notNull(),
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    availableAt: text("available_at").notNull(),
    leaseUntil: text("lease_until"),
    leaseToken: text("lease_token"),
    payload: text("payload").notNull(),
    error: text("error"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_jobs_ready").on(t.status, t.availableAt, t.priority),
    index("idx_jobs_user").on(t.userId),
    index("idx_jobs_user_due").on(t.userId, t.status, t.availableAt),
  ],
);
export const queries = sqliteTable(
  "search_queries",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    monitorId: text("monitor_id").notNull(),
    query: text("query").notNull(),
    runs: integer("runs").notNull().default(0),
    discoveries: integer("discoveries").notNull().default(0),
  },
  (t) => [uniqueIndex("uq_query").on(t.userId, t.monitorId, t.query)],
);
export const health = sqliteTable(
  "provider_health",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    ok: integer("ok").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    volume: integer("volume").notNull(),
    error: text("error"),
    checkedAt: text("checked_at").notNull(),
    kind: text("kind").notNull().default("collection"),
    data: text("data"),
  },
  (t) => [index("idx_health_provider").on(t.userId, t.provider, t.checkedAt)],
);
export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  listingId: text("listing_id").notNull(),
  type: text("type").notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull(),
});
export const purchases = sqliteTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    listingId: text("listing_id").notNull(),
    data: text("data").notNull(),
  },
  (t) => [uniqueIndex("uq_purchase_listing").on(t.userId, t.listingId)],
);
export const notifications = sqliteTable(
  "notification_outbox",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    alertId: text("alert_id").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: text("available_at").notNull(),
    error: text("error"),
    leaseToken: text("lease_token"),
    leaseUntil: text("lease_until"),
  },
  (t) => [
    uniqueIndex("uq_outbox_alert").on(t.alertId, t.channel),
    index("idx_outbox_user_due").on(t.userId, t.status, t.availableAt),
  ],
);
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  window: integer("window").notNull(),
  count: integer("count").notNull(),
});
export const providerRuns = sqliteTable(
  "provider_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    monitorId: text("monitor_id").notNull(),
    provider: text("provider").notNull(),
    queryType: text("query_type").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    recordsRequested: integer("records_requested").notNull(),
    candidatesFound: integer("candidates_found").notNull().default(0),
    requestSnapshot: text("request_snapshot").notNull().default("{}"),
    recordsReceived: integer("records_received").notNull().default(0),
    accepted: integer("accepted").notNull().default(0),
    duplicates: integer("duplicates").notNull().default(0),
    rejected: integer("rejected").notNull().default(0),
    newListings: integer("new_listings").notNull().default(0),
    priceChanges: integer("price_changes").notNull().default(0),
    knownPublication: integer("known_publication").notNull().default(0),
    unknownPublication: integer("unknown_publication").notNull().default(0),
    latencyMs: integer("latency_ms"),
    snapshotId: text("snapshot_id"),
    errors: text("errors").notNull().default("{}"),
    costMetadata: text("cost_metadata"),
    summary: text("summary").notNull().default("{}"),
    baseline: integer("baseline").notNull().default(0),
  },
  (t) => [
    index("idx_provider_runs_user_date").on(t.userId, t.provider, t.startedAt),
    index("idx_runs_monitor_time").on(
      t.userId,
      t.monitorId,
      sql`${t.startedAt} DESC`,
    ),
  ],
);
export const discoveryObservations = sqliteTable(
  "discovery_observations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    listingId: text("listing_id").notNull(),
    provider: text("provider").notNull(),
    queryType: text("query_type").notNull(),
    monitorId: text("monitor_id").notNull(),
    runId: text("run_id").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    publishedAt: text("published_at"),
    publicationStatus: text("publication_status").notNull(),
    publicationConfidence: integer("publication_confidence").notNull(),
    delaySeconds: real("delay_seconds"),
    baseline: integer("baseline").notNull(),
    city: text("city").notNull(),
    snapshotId: text("snapshot_id"),
  },
  (t) => [
    uniqueIndex("uq_discovery_method_listing").on(
      t.userId,
      t.provider,
      t.queryType,
      t.listingId,
    ),
    index("idx_discovery_user_date").on(t.userId, t.provider, t.firstSeenAt),
  ],
);
// URL discoveries stay separate from analysable listings until details arrive.
export const discoveryCandidates = sqliteTable(
  "discovery_candidates",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    scopeId: text("scope_id").notNull(),
    externalId: text("external_id").notNull(),
    originalUrl: text("original_url").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    baseline: integer("baseline").notNull(),
    lastRunId: text("last_run_id").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (t) => [
    uniqueIndex("uq_candidate_scope").on(
      t.userId,
      t.provider,
      t.scopeId,
      t.externalId,
    ),
    index("idx_candidate_identity").on(t.userId, t.provider, t.externalId),
  ],
);

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    maxActive: integer("max_active").notNull(),
    minInterval: integer("min_interval").notNull(),
    dailyTriggers: integer("daily_triggers").notNull(),
    telegram: integer("telegram").notNull().default(0),
  },
  (t) => [
    check("max_active_nonnegative", sql`${t.maxActive}>=0`),
    check("min_interval_limit", sql`${t.minInterval}>=60`),
    check("daily_triggers_nonnegative", sql`${t.dailyTriggers}>=0`),
    check("telegram_boolean", sql`${t.telegram} IN (0,1)`),
  ],
);

export const accounts = sqliteTable(
  "accounts",
  {
    userId: text("user_id")
      .primaryKey()
      .notNull()
      .references(() => users.id),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id)
      .default("managed"),
    status: text("status").notNull().default("active"),
    preferences: text("preferences").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    lastScheduledAt: text("last_scheduled_at")
      .notNull()
      .default("1970-01-01T00:00:00.000Z"),
  },
  (t) => [check("account_status", sql`${t.status} IN ('active','canceled')`)],
);

export const monitorCommands = sqliteTable(
  "monitor_commands",
  {
    userId: text("user_id").notNull(),
    requestKey: text("request_key").notNull(),
    inputHash: text("input_hash").notNull(),
    monitorId: text("monitor_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.requestKey] })],
);

export const searchDrafts = sqliteTable("search_drafts", {
  userId: text("user_id").primaryKey().notNull(),
  data: text("data").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const listingPreferences = sqliteTable(
  "listing_preferences",
  {
    userId: text("user_id").notNull(),
    listingId: text("listing_id").notNull(),
    saved: integer("saved").notNull().default(0),
    dismissed: integer("dismissed").notNull().default(0),
    reason: text("reason"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.listingId] })],
);

export const feedRevisions = sqliteTable("feed_revisions", {
  userId: text("user_id").primaryKey().notNull(),
  version: integer("version").notNull().default(1),
});

export const feedState = sqliteTable("feed_state", {
  userId: text("user_id").primaryKey().notNull(),
  generation: text("generation"),
  sourceVersion: integer("source_version").notNull().default(0),
  ruleVersion: text("rule_version").notNull().default(""),
  builtAt: text("built_at"),
  leaseToken: text("lease_token"),
  leaseUntil: text("lease_until"),
});

export const feedEntries = sqliteTable(
  "feed_entries",
  {
    userId: text("user_id").notNull(),
    generation: text("generation").notNull(),
    listingId: text("listing_id").notNull(),
    searchText: text("search_text").notNull(),
    price: real("price"),
    score: integer("score").notNull(),
    eligible: integer("eligible").notNull(),
    budget: integer("budget").notNull(),
    event: text("event").notNull(),
    publishedAt: text("published_at"),
    lastSeenAt: text("last_seen_at").notNull(),
    monitorIds: text("monitor_ids").notNull(),
    data: text("data").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.generation, t.listingId] }),
    index("idx_feed_time").on(
      t.userId,
      t.generation,
      sql`${t.lastSeenAt} DESC`,
      t.listingId,
    ),
    index("idx_feed_price").on(t.userId, t.generation, t.price, t.listingId),
    index("idx_feed_rank").on(
      t.userId,
      t.generation,
      sql`${t.eligible} DESC`,
      sql`${t.score} DESC`,
      t.listingId,
    ),
  ],
);

export const notificationDestinations = sqliteTable(
  "notification_destinations",
  {
    userId: text("user_id").notNull(),
    channel: text("channel").notNull(),
    address: text("address").notNull(),
    enabled: integer("enabled").notNull().default(1),
    verifiedAt: text("verified_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.channel] }),
    uniqueIndex("uq_telegram_address").on(t.channel, t.address),
    check("telegram_channel", sql`${t.channel}='telegram'`),
  ],
);

export const channelTokens = sqliteTable("channel_tokens", {
  tokenHash: text("token_hash").primaryKey().notNull(),
  userId: text("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
});

export const workerHeartbeats = sqliteTable("worker_heartbeats", {
  id: text("id").primaryKey().notNull(),
  seenAt: text("seen_at").notNull(),
  status: text("status").notNull(),
  leaseToken: text("lease_token"),
  leaseUntil: text("lease_until"),
});

export const budgetReservations = sqliteTable("budget_reservations", {
  id: text("id").primaryKey().notNull(),
  userId: text("user_id").notNull(),
  globalKey: text("global_key").notNull(),
  tenantKey: text("tenant_key").notNull(),
  createdAt: text("created_at").notNull(),
  refunded: integer("refunded").notNull().default(0),
});

export const productEvents = sqliteTable(
  "product_events",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    event: text("event").notNull(),
    subjectId: text("subject_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_product_events_account_time").on(t.userId, t.createdAt)],
);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey().notNull(),
  actorId: text("actor_id").notNull(),
  subjectId: text("subject_id").notNull(),
  action: text("action").notNull(),
  createdAt: text("created_at").notNull(),
});
export const radarActivations = sqliteTable(
  "radar_activations",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    monitorId: text("monitor_id").notNull(),
    revision: integer("revision").notNull(),
    state: text("state").notNull().default("pending"),
    jobId: text("job_id"),
    message: text("message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("radar_activation_identity").on(
      t.userId,
      t.monitorId,
      t.revision,
    ),
    index("radar_activations_due").on(t.userId, t.state, t.createdAt),
    check(
      "activation_state",
      sql`${t.state} IN ('pending','queued','cancelled','attention')`,
    ),
  ],
);
export const dealPipeline = sqliteTable(
  "deal_pipeline",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id),
    stage: text("stage").notNull(),
    note: text("note").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.listingId] }),
    index("deals_by_stage").on(t.userId, t.stage, t.updatedAt),
    check(
      "deal_stage",
      sql`${t.stage} IN ('interested','negotiating','bought','for_sale','sold','passed')`,
    ),
  ],
);
export const availabilityChecks = sqliteTable(
  "availability_checks",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id),
    status: text("status").notNull().default("pending"),
    result: text("result").notNull().default("unknown"),
    cursor: text("cursor"),
    triggerStarted: integer("trigger_started").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseUntil: text("lease_until"),
    availableAt: text("available_at").notNull(),
    requestedAt: text("requested_at").notNull(),
    checkedAt: text("checked_at"),
    message: text("message"),
  },
  (t) => [
    index("availability_due").on(t.userId, t.status, t.availableAt),
    uniqueIndex("availability_single_active")
      .on(t.userId, t.listingId)
      .where(sql`${t.status} IN ('pending','running')`),
  ],
);

// Brick SaaS: own e-mail/password accounts. Sessions store only a token hash.
export const authCredentials = sqliteTable(
  "auth_credentials",
  {
    userId: text("user_id")
      .primaryKey()
      .notNull()
      .references(() => users.id),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    iterations: integer("iterations").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastLoginAt: text("last_login_at"),
  },
  (t) => [uniqueIndex("uq_auth_email").on(t.email)],
);
export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("idx_auth_sessions_user").on(t.userId)],
);
// Money is stored in cents; dates the user picks are local YYYY-MM-DD.
export const inventoryItems = sqliteTable(
  "inventory_items",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    category: text("category").notNull(),
    brand: text("brand"),
    model: text("model"),
    condition: text("condition").notNull(),
    identifier: text("identifier"),
    notes: text("notes").notNull().default(""),
    status: text("status").notNull(),
    purchasePriceCents: integer("purchase_price_cents").notNull(),
    purchasedAt: text("purchased_at").notNull(),
    purchaseChannel: text("purchase_channel").notNull(),
    purchaseFrom: text("purchase_from"),
    askingPriceCents: integer("asking_price_cents"),
    salePriceCents: integer("sale_price_cents"),
    saleFeesCents: integer("sale_fees_cents").notNull().default(0),
    soldAt: text("sold_at"),
    saleChannel: text("sale_channel"),
    soldTo: text("sold_to"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_inventory_user_status").on(t.userId, t.status, t.updatedAt),
    index("idx_inventory_user_sold").on(t.userId, t.soldAt),
    check(
      "inventory_status",
      sql`${t.status} IN ('in_stock','preparing','listed','reserved','sold')`,
    ),
    check(
      "inventory_sale_consistent",
      sql`(${t.status}='sold') = (${t.salePriceCents} IS NOT NULL AND ${t.soldAt} IS NOT NULL)`,
    ),
    check("inventory_purchase_nonnegative", sql`${t.purchasePriceCents}>=0`),
  ],
);
export const inventoryCosts = sqliteTable(
  "inventory_costs",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    itemId: text("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    description: text("description").notNull().default(""),
    amountCents: integer("amount_cents").notNull(),
    spentAt: text("spent_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_inventory_costs_item").on(t.userId, t.itemId),
    check("inventory_cost_positive", sql`${t.amountCents}>0`),
  ],
);
export const inventoryPhotos = sqliteTable(
  "inventory_photos",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    itemId: text("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_inventory_photos_item").on(t.userId, t.itemId)],
);
export const brickPreferences = sqliteTable("brick_preferences", {
  userId: text("user_id")
    .primaryKey()
    .notNull()
    .references(() => users.id),
  monthlyGoalCents: integer("monthly_goal_cents"),
  staleAfterDays: integer("stale_after_days").notNull().default(30),
  // Plan picked on the landing page; billing reads it once a gateway exists.
  selectedPlan: text("selected_plan"),
  updatedAt: text("updated_at").notNull(),
});

// Owner-controlled switches, e.g. whether the public sign-up page is open.
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey().notNull(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
