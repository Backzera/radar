import { uid, type Database } from "./store";
import { listingAnalysis } from "./evaluation";
import {
  getAccount,
  reserveAccountBudget,
  refundAccountBudget,
} from "./accounts";
import { pilotConfig } from "./pilot";
import { type RuntimeConfig, HttpError } from "./security";
import { ProviderError, type MarketplaceProvider } from "../providers/contract";
interface Check {
  id: string;
  listing_id: string;
  user_id: string;
  status: string;
  result: string;
  cursor: string | null;
  trigger_started: number;
  attempts: number;
  lease_token: string;
  requested_at: string;
  checked_at: string | null;
  message: string | null;
}
export async function availabilityState(
  db: Database,
  userId: string,
  id: string,
) {
  return db
    .prepare(
      "SELECT status,result,checked_at,message FROM availability_checks WHERE user_id=? AND listing_id=? ORDER BY requested_at DESC,id DESC LIMIT 1",
    )
    .bind(userId, id)
    .first<{
      status: string;
      result: string;
      checked_at: string | null;
      message: string | null;
    }>();
}
export async function requestAvailability(
  db: Database,
  userId: string,
  id: string,
  config: RuntimeConfig,
) {
  if (
    config.AVAILABILITY_ENABLED !== "true" ||
    config.COLLECTION_ENABLED !== "true"
  )
    throw new HttpError(
      409,
      "Conferência adicional não habilitada. Confirme a disponibilidade no anúncio.",
    );
  const a = await getAccount(db, userId);
  if (a.status !== "active")
    throw new HttpError(403, "Seu acesso está pausado.");
  const o = await listingAnalysis(db, userId, id);
  if (!o.analysis.budgetEligible)
    throw new HttpError(
      422,
      "O anúncio não está mais dentro dos critérios do radar. Não consumimos uma consulta adicional.",
    );
  const prev = await db
    .prepare(
      "SELECT * FROM availability_checks WHERE user_id=? AND listing_id=? ORDER BY requested_at DESC,id DESC LIMIT 1",
    )
    .bind(userId, id)
    .first<Check>();
  if (prev?.status === "uncertain")
    throw new HttpError(
      409,
      "Uma conferência anterior ficou sem confirmação. A administração precisa conciliá-la antes de repetir.",
    );
  if (
    prev &&
    (["pending", "running"].includes(prev.status) ||
      (prev.checked_at &&
        Date.now() - Date.parse(prev.checked_at) < 15 * 60000))
  )
    return { cached: true, status: prev.status };

  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT OR IGNORE INTO availability_checks(id,user_id,listing_id,available_at,requested_at) VALUES (?,?,?,?,?)",
    )
    .bind(uid(), userId, id, now, now)
    .run();
  return { cached: false, status: "pending" };
}
export async function runAvailabilityCheck(
  db: Database,
  userId: string,
  factory: (id: string) => MarketplaceProvider,
  config: RuntimeConfig,
) {
  const now = new Date().toISOString(),
    token = uid();
  // Interrupted paid dispatch without a cursor must never be silently replayed.
  await db
    .prepare(
      "UPDATE availability_checks SET status='uncertain',message='Conferência interrompida; verificar a execução na fonte.',lease_token=NULL,lease_until=NULL WHERE user_id=? AND status='running' AND lease_until<? AND trigger_started=1 AND cursor IS NULL",
    )
    .bind(userId, now)
    .run();
  const enabled =
    config.AVAILABILITY_ENABLED === "true" &&
    config.COLLECTION_ENABLED === "true";
  const c = await db
    .prepare(
      "UPDATE availability_checks SET status='running',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=(SELECT id FROM availability_checks WHERE user_id=? AND ((status='pending' AND available_at<=?) OR (status='running' AND lease_until<?)) AND (?=1 OR cursor IS NOT NULL) ORDER BY requested_at LIMIT 1) RETURNING *",
    )
    .bind(
      token,
      new Date(Date.now() + 90000).toISOString(),
      userId,
      now,
      now,
      Number(enabled),
    )
    .first<Check>();
  if (!c) return { status: "idle" };
  const finish = async (
    status: string,
    message: string,
    result = "unknown",
  ) => {
    await db
      .prepare(
        "UPDATE availability_checks SET status=?,message=?,result=?,checked_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND user_id=? AND lease_token=?",
      )
      .bind(
        status,
        message,
        result,
        new Date().toISOString(),
        c.id,
        userId,
        token,
      )
      .run();
    return { status };
  };
  let reserved = false,
    started = !!c.trigger_started;
  try {
    const a = await getAccount(db, userId),
      o = await listingAnalysis(db, userId, c.listing_id),
      p = factory(o.listing.provider),
      pilot = pilotConfig(config);
    if (!p.checkListing)
      return finish(
        "failed",
        "A fonte não permite esta conferência. Nenhuma nova coleta foi iniciada.",
      );
    if (
      c.attempts > 120 ||
      Date.now() - Date.parse(c.requested_at) > 30 * 60000
    )
      return finish(
        "failed",
        "A conferência excedeu o prazo. Revise a execução antes de repetir.",
      );
    if (!c.cursor) {
      if (a.status !== "active" || !o.analysis.budgetEligible)
        return finish(
          "cancelled",
          "O anúncio não atende mais aos critérios. Conferência não iniciada.",
        );
      const health = await p.healthCheck();
      if (!health.ok || !health.methods?.collect_url)
        return finish(
          "failed",
          "A conferência individual não está disponível na fonte. Nenhum disparo foi realizado.",
        );
      // A separate daily cap protects discovery capacity. Source/account caps still apply.
      const count = await db
        .prepare(
          "SELECT COUNT(*) n FROM availability_checks WHERE user_id=? AND trigger_started=1 AND substr(requested_at,1,10)=substr(?,1,10)",
        )
        .bind(userId, now)
        .first<{ n: number }>();
      const cap = Math.max(
        0,
        Math.min(5, Number(config.MAX_DAILY_AVAILABILITY_CHECKS || 1) || 0),
      );
      if ((count?.n ?? 0) >= cap)
        return finish(
          "failed",
          "Limite diário de conferências atingido. Nenhuma nova consulta foi cobrada pelo aplicativo.",
        );
      reserved = await reserveAccountBudget(
        db,
        userId,
        "availability:" + c.id,
        o.listing.provider,
        pilot.maxDailyTriggers,
        a.daily_triggers,
      );
      if (!reserved)
        return finish(
          "failed",
          "Cota disponível atingida. Não iniciamos outra conferência.",
        );
      const owned = await db
        .prepare(
          "UPDATE availability_checks SET trigger_started=1,lease_until=? WHERE id=? AND user_id=? AND lease_token=? AND lease_until>? AND (SELECT COUNT(*) FROM availability_checks WHERE user_id=? AND trigger_started=1 AND substr(requested_at,1,10)=substr(?,1,10))<?",
        )
        .bind(
          new Date(Date.now() + 90000).toISOString(),
          c.id,
          userId,
          token,
          new Date().toISOString(),
          userId,
          now,
          cap,
        )
        .run();
      if (!owned.meta.changes) {
        await refundAccountBudget(db, userId, "availability:" + c.id);
        return finish(
          "failed",
          "A cota de conferências foi usada por outra execução. Não iniciamos outra consulta.",
        );
      }
      started = true;
    }
    const result = await p.checkListing({
      url: o.listing.url,
      cursor: c.cursor ?? undefined,
      reserved: true,
    });
    if (!result.complete) {
      if (!result.cursor || !/^[\w-]+$/.test(result.cursor))
        throw new Error("Conferência sem identificador.");
      await db
        .prepare(
          "UPDATE availability_checks SET status='pending',cursor=?,available_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND user_id=? AND lease_token=?",
        )
        .bind(
          result.cursor,
          new Date(Date.now() + 15000).toISOString(),
          c.id,
          userId,
          token,
        )
        .run();
      return { status: "waiting" };
    }
    const item = result.items.find(
      (l) =>
        l.externalId === o.listing.externalId &&
        l.provider === o.listing.provider,
    );
    if (!item)
      return finish(
        "completed",
        "A fonte não confirmou os dados deste anúncio. Isso não comprova que foi vendido.",
      );
    const updatedAt = new Date().toISOString();
    const updated = await db.batch([
      db
        .prepare(
          "UPDATE listings SET data=json_set(data,'$.availability',?,'$.availabilityCheckedAt',?) WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM availability_checks WHERE id=? AND lease_token=? AND lease_until>?)",
        )
        .bind(
          item.availability,
          updatedAt,
          c.listing_id,
          userId,
          c.id,
          token,
          updatedAt,
        ),
      db
        .prepare(
          "UPDATE availability_checks SET status='completed',result=?,message=?,checked_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND user_id=? AND lease_token=? AND lease_until>?",
        )
        .bind(
          item.availability,
          item.availability === "active"
            ? "Disponível segundo a resposta da fonte. Confirme com o vendedor."
            : item.availability === "unknown"
              ? "A fonte retornou dados, mas não confirmou a disponibilidade."
              : "A fonte indicou que o anúncio não está disponível.",
          updatedAt,
          c.id,
          userId,
          token,
          updatedAt,
        ),
    ]);
    return { status: updated[1].meta.changes ? "completed" : "lease_lost" };
  } catch (e) {
    if (e instanceof ProviderError && e.triggerRejected && reserved) {
      await refundAccountBudget(db, userId, "availability:" + c.id);
      return finish(
        "failed",
        "A fonte recusou a solicitação. Verifique a configuração antes de repetir.",
      );
    }
    if (c.cursor && c.attempts < 120) {
      await db
        .prepare(
          "UPDATE availability_checks SET status='pending',message='A fonte ainda não respondeu. A mesma consulta será acompanhada, sem novo disparo.',available_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND user_id=? AND lease_token=?",
        )
        .bind(new Date(Date.now() + 60000).toISOString(), c.id, userId, token)
        .run();
      return { status: "waiting" };
    }
    return finish(
      started ? "uncertain" : "failed",
      started
        ? "A confirmação ficou pendente. Não repetimos a cobrança automaticamente."
        : "Não foi possível preparar a conferência. Nenhuma nova coleta foi iniciada.",
    );
  }
}
/** Optional admin-enabled selective verification, at most one candidate per tick. */
export async function queueSelectiveCheck(
  db: Database,
  userId: string,
  config: RuntimeConfig,
) {
  if (
    config.AUTO_VERIFY_OPPORTUNITIES !== "true" ||
    config.AVAILABILITY_ENABLED !== "true" ||
    config.COLLECTION_ENABLED !== "true"
  )
    return;
  const { getFeed } = await import("./feed");
  const feed = await getFeed(db, userId, { filter: "qualified", limit: 5 });
  for (const item of feed.items) {
    const old = await availabilityState(db, userId, item.listing.id);
    if (
      old &&
      (["uncertain", "pending", "running"].includes(old.status) ||
        (old.checked_at &&
          Date.now() - Date.parse(old.checked_at) < 15 * 60000))
    )
      continue;
    try {
      await requestAvailability(db, userId, item.listing.id, config);
    } catch {
      /* Limits and uncertainty are resolved administratively, never by a blind paid retry. */
    }
    break;
  }
}
