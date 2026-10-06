import {
  readInputConfirmation,
  inputConfirmationView,
  saveInputConfirmation,
} from "./input-confirmation";
import { qualitySummary } from "./quality";
import { z } from "zod";
import { all, getMonitors, getPurchases, uid, type Database } from "./store";
import { ensureUser } from "./seed";
import {
  authenticate,
  authLinks,
  HttpError,
  readBoundedJson,
  siteOrigin,
  type RuntimeConfig,
} from "./security";
import { bootstrap, sharedContract } from "./bootstrap";
import {
  accountMetrics,
  accountView,
  cancelAccount,
  getAccount,
  recordEvent,
  saveAccountPreferences,
} from "./accounts";
import {
  feedQuerySchema,
  getFeed,
  FeedBusy,
  saveListingPreference,
} from "./feed";
import { listingAnalysis } from "./evaluation";
import { automaticQueries } from "../core/query-strategy";
import { processActivations } from "./activations";
import { availabilityState, requestAvailability } from "./availability";
import { getDeals, saveDeal, dealFor } from "./deals";
import { saveDraft, saveSearch } from "./searches";
import { saveFeedback, saveSettings } from "./service";
import {
  createTelegramLink,
  acceptTelegramUpdate,
  disconnectTelegram,
} from "./channels";
import { enqueue } from "./worker";
import { runSchedulerTick } from "./supervisor";
import { BrightDataProvider } from "../providers/brightdata";
import { ProviderError, type MarketplaceProvider } from "../providers/contract";
import { checkProvider, diagnostics } from "./diagnostics";
import { pilotConfig } from "./pilot";
import { ProviderQueryError } from "../core/provider-query";
import { runFailureAdvice } from "../core/run-diagnostics";
import { json } from "./respond";
import { changeOwnPassword, handleAuthRoute, sessionPrincipal } from "./auth";
import { handleInventoryRoute, PHOTO_UPLOAD } from "./inventory-routes";
import { getPreferences, type MediaStore } from "./inventory";
import { handleAdminUsersRoute } from "./admin-users";
import { handleAdminAuditRoute } from "./admin-audit";
export { json };
const paging = (url: URL) =>
  z
    .object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(25),
    })
    .parse(
      Object.fromEntries(
        ["page", "limit"]
          .filter((k) => url.searchParams.has(k))
          .map((k) => [k, url.searchParams.get(k)]),
      ),
    );
export function createHandler(
  db: Database,
  config: RuntimeConfig,
  options: {
    development?: boolean;
    provider?: (id: string) => MarketplaceProvider;
    media?: MediaStore;
  } = {},
) {
  const pilot = pilotConfig(config);
  const factory =
    options.provider ??
    ((id: string) => {
      if (id !== "brightdata")
        throw new HttpError(422, "Fonte não disponível.");
      return new BrightDataProvider({
        apiKey: config.BRIGHTDATA_API_KEY,
        rightsConfirmed: config.FACEBOOK_DATA_RIGHTS_CONFIRMED,
        dataset: config.BRIGHTDATA_DATASET_ID,
        maxRecords: pilot.maxRecords,
        inputConfirmation: () =>
          readInputConfirmation(
            db,
            config.BRIGHTDATA_DATASET_ID ?? "gd_lvt9iwuh6fbcwmx1a",
          ),
      });
    });
  return async (request: Request): Promise<Response> => {
    // Everything after /api/v1, with or without a site prefix such as /brique.
    const url = new URL(request.url),
      path = url.pathname
        .slice(url.pathname.indexOf("/api/v1") + "/api/v1".length)
        .replace(/^\//, "");
    try {
      if (request.method === "GET" && path === "health/live")
        return json({ status: "ok" });
      if (!db) throw new HttpError(503, "Serviço indisponível.");
      if (request.method === "GET" && path === "health/ready") {
        try {
          await db.prepare("SELECT user_id FROM accounts LIMIT 1").first();
          return json({ status: "ready" });
        } catch {
          return json({ status: "not_ready" }, 503);
        }
      }
      if (request.method === "POST" && path === "channels/telegram/webhook")
        return json(
          await acceptTelegramUpdate(
            db,
            request,
            await readBoundedJson(request),
            config,
          ),
        );
      const publicAuth = await handleAuthRoute(db, request, path, config);
      if (publicAuth) return publicAuth;
      // The worker authenticates with its bearer token; people with a session
      // cookie. In password mode no other identity source is accepted.
      const principal = request.headers.has("authorization")
        ? await authenticate(request, config, options.development)
        : ((await sessionPrincipal(db, request, config)) ??
          (config.AUTH_MODE === "password"
            ? null
            : await authenticate(request, config, options.development)));
      if (!principal)
        return json(
          {
            error:
              "Entre para acessar seu radar. Caso o acesso ainda não esteja configurado, contate a administração.",
            ...authLinks(config),
          },
          401,
        );
      if (principal.kind === "service") {
        if (path !== "worker/tick" || request.method !== "POST")
          throw new HttpError(403, "Credencial restrita ao agendador.");
        z.object({})
          .strict()
          .parse(await readBoundedJson(request));
        return json(await runSchedulerTick(db, factory, pilot, config));
      }
      const userId = principal.userId;
      if (request.method !== "GET") {
        if (!["POST", "DELETE"].includes(request.method))
          throw new HttpError(405, "Método não permitido.");
        if (request.headers.get("origin") !== siteOrigin(request, config))
          throw new HttpError(403, "Origem da requisição inválida.");
        const type = request.headers
          .get("content-type")
          ?.split(";")[0]
          .trim();
        if (request.method === "POST" && PHOTO_UPLOAD.test(path)) {
          if (!["image/jpeg", "image/png", "image/webp"].includes(type ?? ""))
            throw new HttpError(415, "Use uma foto JPG, PNG ou WebP.");
        } else if (type !== "application/json")
          throw new HttpError(415, "Envie JSON.");
      }
      // Photos are immutable and browser-cached; a grid of them must not eat
      // the per-minute budget of real API reads.
      if (
        !(
          request.method === "GET" &&
          (path.startsWith("media/") || path.startsWith("admin/media/"))
        )
      ) {
        const window = Math.floor(Date.now() / 60000),
          rateKey = `http:${userId}:${request.method === "GET" ? "read" : "write"}`;
        const rate = await db
          .prepare(
            "INSERT INTO rate_limits(key,window,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window RETURNING count",
          )
          .bind(rateKey, window)
          .first<{ count: number }>();
        if ((rate?.count ?? 0) > (request.method === "GET" ? 120 : 30))
          throw new HttpError(429, "Muitas solicitações. Aguarde um minuto.");
        await ensureUser(db, userId);
      }
      if (path.startsWith("admin/") && !principal.admin)
        throw new HttpError(403, "Área restrita à administração.");
      if (request.method === "GET" && path === "auth/me")
        return json({
          user: {
            id: userId,
            name: principal.name ?? null,
            email: principal.email ?? null,
          },
          admin: principal.admin,
          plan: (await getPreferences(db, userId)).selectedPlan,
          ...authLinks(config),
        });
      const inventory = await handleInventoryRoute(
        db,
        userId,
        request,
        url,
        path,
        options.media,
      );
      if (inventory) return inventory;
      // Non-admins never get here for admin/ paths: the check above answers 403.
      const adminUsers = await handleAdminUsersRoute(
        db,
        principal,
        request,
        url,
        path,
        options.media,
      );
      if (adminUsers) return adminUsers;
      const adminAudit = await handleAdminAuditRoute(
        db,
        principal,
        request,
        url,
        path,
        options.media,
      );
      if (adminAudit) return adminAudit;
      if (request.method === "POST" && path === "auth/password")
        // await keeps a rejection inside this try, so it maps to its HTTP status.
        return await changeOwnPassword(db, request, config, userId, await readBoundedJson(request));
      if (request.method === "GET") {
        if (path === "bootstrap")
          return json(
            await bootstrap(db, principal, config, options.development),
          );
        if (path === "session")
          return json({ userId, admin: principal.admin, ...authLinks(config) });
        if (path === "results")
          return json(
            await getFeed(
              db,
              userId,
              feedQuerySchema.parse(Object.fromEntries(url.searchParams)),
            ),
          );
        if (path === "draft") {
          const d = await db
            .prepare("SELECT data FROM search_drafts WHERE user_id=?")
            .bind(userId)
            .first<{ data: string }>();
          return json(d ? JSON.parse(d.data) : null);
        }
        if (path === "account") return json(await accountView(db, userId));
        if (path === "account/metrics")
          return json(await accountMetrics(db, userId));
        if (path === "deals") {
          const q = paging(url);
          return json(
            await getDeals(
              db,
              userId,
              q.page,
              q.limit,
              z
                .enum([
                  "",
                  "interested",
                  "negotiating",
                  "bought",
                  "for_sale",
                  "sold",
                  "passed",
                ])
                .parse(url.searchParams.get("stage") ?? ""),
            ),
          );
        }
        if (path === "purchases") {
          const q = paging(url),
            items = await getPurchases(db, userId, true);
          return json({
            items: items.slice((q.page - 1) * q.limit, q.page * q.limit),
            total: items.length,
            ...q,
          });
        }
        if (path === "alerts") {
          const q = paging(url),
            items = await all<{
              data: string;
              read: number;
              delivery: string | null;
            }>(
              db,
              "SELECT a.data,a.read,n.status AS delivery FROM alerts a LEFT JOIN notification_outbox n ON n.alert_id=a.id AND n.user_id=a.user_id AND n.channel='telegram' WHERE a.user_id=? ORDER BY a.created_at DESC,a.id LIMIT ? OFFSET ?",
              userId,
              q.limit,
              (q.page - 1) * q.limit,
            );
          const count = await db
            .prepare("SELECT COUNT(*) AS n FROM alerts WHERE user_id=?")
            .bind(userId)
            .first<{ n: number }>();
          return json({
            items: items.map((a) => ({
              ...JSON.parse(a.data),
              read: !!a.read,
              delivery: a.delivery ?? "internal",
            })),
            total: count?.n ?? 0,
            ...q,
          });
        }
        if (path.startsWith("listings/")) {
          const id = decodeURIComponent(path.slice(9)),
            q = paging(url),
            o = await listingAnalysis(db, userId, id),
            comparables = o.analysis.pricing.comparables;
          const snapshots = await all(
            db,
            "SELECT price,availability,observed_at FROM listing_snapshots WHERE user_id=? AND listing_id=? ORDER BY observed_at DESC,id LIMIT ? OFFSET ?",
            userId,
            id,
            q.limit,
            (q.page - 1) * q.limit,
          );
          return json({
            ...o,
            analysis: {
              ...o.analysis,
              pricing: {
                ...o.analysis.pricing,
                comparables: comparables.slice(
                  (q.page - 1) * q.limit,
                  q.page * q.limit,
                ),
              },
            },
            deal: await dealFor(db, userId, id),
            availabilityCheck: await availabilityState(db, userId, id),
            comparablesTotal: comparables.length,
            snapshots,
            page: q.page,
            limit: q.limit,
          });
        }
        if (path === "events") {
          const encoder = new TextEncoder(),
            expires = Math.min(
              Date.now() + 20000,
              principal.expiresAt ?? Infinity,
            );
          let timer: ReturnType<typeof setTimeout> | undefined,
            closed = false;
          const stream = new ReadableStream({
            start(controller) {
              const stop = () => {
                if (closed) return;
                closed = true;
                clearTimeout(timer);
                request.signal.removeEventListener("abort", stop);
                try {
                  controller.close();
                } catch {}
              };
              request.signal.addEventListener("abort", stop, { once: true });
              const tick = async () => {
                if (closed) return;
                if (Date.now() >= expires || request.signal.aborted) {
                  stop();
                  return;
                }
                try {
                  const revision = await db
                    .prepare(
                      "SELECT version FROM feed_revisions WHERE user_id=?",
                    )
                    .bind(userId)
                    .first();
                  if (!closed)
                    controller.enqueue(
                      encoder.encode(
                        `event: radar\ndata: ${JSON.stringify({ revision })}\n\n`,
                      ),
                    );
                } catch {
                  stop();
                  return;
                }
                timer = setTimeout(tick, 5000);
              };
              void tick();
            },
            cancel() {
              closed = true;
              clearTimeout(timer);
            },
          });
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }
        if (path === "account/export") {
          const section = z
              .enum(["searches", "listings", "purchases", "feedback"])
              .parse(url.searchParams.get("section") ?? "searches"),
            q = paging(url);
          const table = {
            searches: "monitors",
            listings: "listings",
            purchases: "purchases",
            feedback: "feedback",
          }[section];
          const rows = await all(
            db,
            `SELECT * FROM ${table} WHERE user_id=? ORDER BY id LIMIT ? OFFSET ?`,
            userId,
            q.limit,
            (q.page - 1) * q.limit,
          );
          return json({
            section,
            items: rows,
            ...q,
            hasNext: rows.length === q.limit,
          });
        }
        if (path === "admin/provider/filters") {
          const dataset =
            config.BRIGHTDATA_DATASET_ID ?? "gd_lvt9iwuh6fbcwmx1a";
          const health = await factory("brightdata").healthCheck();
          return json(
            inputConfirmationView(
              health,
              dataset,
              await readInputConfirmation(db, dataset),
            ),
          );
        }
        if (path === "admin/status")
          return json({
            diagnostics: await diagnostics(db, userId, pilot),
            quality: await qualitySummary(db, userId),
            contract: await sharedContract(db),
            plans: await all(db, "SELECT * FROM plans ORDER BY id"),
            worker: await all(
              db,
              "SELECT id,seen_at,status FROM worker_heartbeats",
            ),
          });
      }
      if (request.method === "POST") {
        const body = await readBoundedJson(request);
        if (path === "searches" || path.startsWith("searches/")) {
          const envelope = z
              .object({
                config: z.record(z.unknown()),
                requestKey: z.string().optional(),
                activate: z.boolean().optional(),
                expectedVersion: z.number().optional(),
              })
              .strict()
              .parse(body),
            id =
              path === "searches"
                ? undefined
                : decodeURIComponent(path.slice(9));
          const contract = await sharedContract(db),
            cfg = envelope.config;
          if (
            !id ||
            Object.hasOwn(cfg, "product") ||
            Object.hasOwn(cfg, "query")
          ) {
            const text = String(cfg.product || cfg.query || "").trim();
            if (text && cfg.queryType !== "search_url") {
              const aliases = automaticQueries(text);
              cfg.query = aliases[0];
              cfg.aliases = aliases.slice(1);
            }
          }
          if (!id && cfg.maxListingAgeMinutes == null)
            cfg.maxListingAgeMinutes = 10080;
          if (
            !id ||
            Object.hasOwn(cfg, "city") ||
            Object.hasOwn(cfg, "queryType")
          ) {
            const existing = id
              ? (await getMonitors(db, userId)).find((m) => m.id === id)
              : undefined;
            if (id && !existing) throw new Error("NOT_FOUND");
            const keyword =
                (cfg.queryType ?? existing?.queryType) !== "search_url",
              schema = keyword
                ? contract?.schemas?.keyword
                : contract?.schemas?.search_url;
            const fields = schema?.fields ?? [];
            if (schema?.compatible) {
              cfg.providerContractFingerprint = schema.fingerprint;
              const filters = {
                ...((cfg.providerFilters as Record<string, string | number>) ??
                  existing?.providerFilters ??
                  {}),
              };
              if (
                keyword &&
                typeof cfg.city === "string" &&
                cfg.city &&
                fields.some(
                  (f) =>
                    f.name === "city" &&
                    f.supported &&
                    f.inputEnabled !== false,
                )
              )
                filters.city = cfg.city;
              cfg.providerFilters = filters;
            }
          }
          const result = await saveSearch(db, userId, envelope, id);
          if (!result.replayed && result.monitor.city)
            await db
              .prepare(
                "UPDATE accounts SET preferences=json_set(preferences,'$.city',?,'$.radiusKm',?) WHERE user_id=?",
              )
              .bind(result.monitor.city, result.monitor.radiusKm, userId)
              .run();
          if (
            envelope.activate &&
            config.COLLECTION_ENABLED === "true" &&
            contract
          )
            await processActivations(db, userId);
          if (
            !envelope.activate &&
            !result.replayed &&
            !pilot.pilot &&
            config.COLLECTION_ENABLED === "true" &&
            contract
          )
            await enqueue(db, userId, false, {
              pilot: false,
              monitorId: result.monitor.id,
              one: true,
            });
          return json(result, id || result.replayed ? 200 : 201);
        }
        if (path === "draft") return json(await saveDraft(db, userId, body));
        if (path === "draft/delete") {
          z.object({}).strict().parse(body);
          await db
            .prepare("DELETE FROM search_drafts WHERE user_id=?")
            .bind(userId)
            .run();
          return json({ deleted: true });
        }
        if (path.startsWith("availability/")) {
          z.object({ confirmConsumption: z.literal(true) })
            .strict()
            .parse(body);
          return json(
            await requestAvailability(
              db,
              userId,
              decodeURIComponent(path.slice(13)),
              config,
            ),
            202,
          );
        }
        if (path.startsWith("deals/"))
          return json(
            await saveDeal(db, userId, decodeURIComponent(path.slice(6)), body),
          );
        if (path === "preferences")
          return json(await saveAccountPreferences(db, userId, body));
        if (path === "settings")
          return json(await saveSettings(db, userId, body));
        if (path === "feedback") {
          const result = await saveFeedback(db, userId, body);
          await recordEvent(db, userId, "feedback_recorded");
          return json(result);
        }
        if (path.startsWith("listing-preferences/")) {
          const id = decodeURIComponent(path.slice(20));
          return json(await saveListingPreference(db, userId, id, body));
        }
        if (path === "alerts/read") {
          z.object({}).strict().parse(body);
          await db
            .prepare("UPDATE alerts SET read=1 WHERE user_id=?")
            .bind(userId)
            .run();
          return json({ saved: true });
        }
        if (path === "channels/telegram/link")
          return json(await createTelegramLink(db, userId, config));
        if (path === "channels/telegram/disconnect")
          return json(await disconnectTelegram(db, userId));
        if (path === "account/cancel") {
          const d = z
            .object({ confirmation: z.literal("CANCELAR ACESSO") })
            .strict()
            .parse(body);
          return json(await cancelAccount(db, userId, d.confirmation));
        }
        if (path === "scan") {
          const d = z
              .object({
                monitorId: z.string().min(1).max(200),
                confirmConsumption: z.literal(true),
              })
              .strict()
              .parse(body),
            a = await getAccount(db, userId);
          if (a.status !== "active")
            throw new HttpError(403, "Acesso cancelado.");
          const b = await bootstrap(db, principal, config, options.development);
          if (!b.service.collectionEnabled || !b.service.ready)
            throw new HttpError(
              503,
              "A fonte ainda não foi habilitada para buscas.",
            );
          if (b.service.quotaPaused)
            throw new HttpError(429, "Cota disponível esgotada.");
          const monitor = (await getMonitors(db, userId)).find(
            (m) => m.id === d.monitorId && m.active && !m.archived,
          );
          if (!monitor) throw new HttpError(404, "Busca ativa não encontrada.");
          const queued = await enqueue(db, userId, true, {
            pilot: pilot.pilot,
            one: true,
            monitorId: monitor.id,
          });
          return json(
            {
              queued,
              message: queued
                ? "Solicitação registrada. O serviço de buscas continuará o processamento."
                : "Nenhuma solicitação adicional foi criada. Já há uma busca pendente ou um prazo de espera; confira a próxima tentativa.",
            },
            queued ? 202 : 200,
          );
        }
        if (path === "admin/provider/check") {
          z.object({}).strict().parse(body);
          await ensureUser(db, "system:provider");
          return json(
            await checkProvider(db, "system:provider", factory("brightdata")),
          );
        }
        if (path === "admin/provider/filters") {
          const dataset =
            config.BRIGHTDATA_DATASET_ID ?? "gd_lvt9iwuh6fbcwmx1a";
          const provider = factory("brightdata");
          const health = await provider.healthCheck();
          const result = await saveInputConfirmation(
            db,
            userId,
            health,
            dataset,
            body,
          );
          await checkProvider(db, "system:provider", provider);
          return json(result);
        }
        if (path === "admin/plans") {
          const d = z
            .object({
              id: z.string().regex(/^[a-z0-9-]{1,40}$/),
              name: z.string().min(2).max(80),
              maxActive: z.number().int().min(0).max(100),
              minInterval: z.number().int().min(60).max(3600),
              dailyTriggers: z.number().int().min(0).max(100),
              telegram: z.boolean(),
            })
            .strict()
            .parse(body);
          await db.batch([
            db
              .prepare(
                "INSERT INTO plans VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,max_active=excluded.max_active,min_interval=excluded.min_interval,daily_triggers=excluded.daily_triggers,telegram=excluded.telegram",
              )
              .bind(
                d.id,
                d.name,
                d.maxActive,
                d.minInterval,
                d.dailyTriggers,
                Number(d.telegram),
              ),
            db
              .prepare("INSERT INTO audit_events VALUES (?,?,?,?,?)")
              .bind(
                uid(),
                userId,
                d.id,
                "plan_updated",
                new Date().toISOString(),
              ),
          ]);
          return json({ saved: true });
        }
        if (path === "admin/accounts/plan") {
          const d = z
            .object({
              accountId: z.string().max(300),
              planId: z.string().max(40),
            })
            .strict()
            .parse(body);
          if (
            !(await db
              .prepare("SELECT user_id FROM accounts WHERE user_id=?")
              .bind(d.accountId)
              .first())
          )
            throw new Error("NOT_FOUND");
          if (
            !(await db
              .prepare("SELECT id FROM plans WHERE id=?")
              .bind(d.planId)
              .first())
          )
            throw new HttpError(422, "Plano não encontrado.");
          await db.batch([
            db
              .prepare("UPDATE accounts SET plan_id=? WHERE user_id=?")
              .bind(d.planId, d.accountId),
            db
              .prepare("INSERT INTO audit_events VALUES (?,?,?,?,?)")
              .bind(
                uid(),
                userId,
                d.accountId,
                "account_plan_changed",
                new Date().toISOString(),
              ),
          ]);
          return json({ saved: true });
        }
      }
      throw new HttpError(404, "Rota não encontrada.");
    } catch (error) {
      if (error instanceof HttpError)
        return json({ error: error.message }, error.status);
      if (error instanceof z.ZodError)
        return json(
          {
            error: "Revise os campos informados.",
            fields: error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          },
          422,
        );
      if (error instanceof FeedBusy) return json({ error: error.message }, 503);
      if (
        error instanceof ProviderError ||
        error instanceof ProviderQueryError
      ) {
        const detail = runFailureAdvice({ message: error.message });
        return json({ error: `${detail.message} ${detail.action}` }, 503);
      }
      const message = error instanceof Error ? error.message : "";
      if (message === "NOT_FOUND")
        return json({ error: "Registro não encontrado." }, 404);
      if (message === "CONFLICT")
        return json(
          {
            error:
              "Esta busca mudou em outra janela. Recarregue antes de editar.",
          },
          409,
        );
      if (message.includes("PLAN_LIMIT"))
        return json(
          {
            error:
              "Limite de buscas ativas atingido. Pause uma busca antes de ativar outra.",
          },
          409,
        );
      const reference = uid();
      console.error(JSON.stringify({ event: "api_error", reference }));
      return json(
        {
          error:
            "Não foi possível concluir. Os dados salvos foram preservados.",
          reference,
        },
        500,
      );
    }
  };
}
