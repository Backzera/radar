import { confirmedHealth } from "../providers/input-confirmation";
import { readInputConfirmation } from "./input-confirmation";
import { plannedInterval } from "../core/service-schedule";
import {
  nativePublicationPolicy,
  nativeRadius,
  radiusUnit,
} from "../providers/search-policy";
import type { Monitor } from "../core/types";
import { accountView } from "./accounts";
import { all, getMonitors, getSettings, type Database } from "./store";
import { pilotConfig, providerBudgetKey } from "./pilot";
import { providerSetup } from "./provider-setup";
import { authLinks, type RuntimeConfig, type Principal } from "./security";
import type { ProviderHealth } from "../providers/contract";
import { runFailureAdvice, safeDiagnosticText } from "../core/run-diagnostics";
export async function sharedContract(db: Database) {
  const r = await db
    .prepare(
      "SELECT data,checked_at FROM provider_health WHERE user_id='system:provider' AND provider='brightdata' AND kind='validation' ORDER BY checked_at DESC LIMIT 1",
    )
    .first<{ data: string; checked_at: string }>();
  if (!r || Date.now() - Date.parse(r.checked_at) > 86400000) return null;
  const data: ProviderHealth = JSON.parse(r.data);
  return data.ok
    ? confirmedHealth(
        data,
        data.dataset ?? "",
        await readInputConfirmation(db, data.dataset ?? ""),
      )
    : null;
}
export async function bootstrap(
  db: Database,
  p: Principal,
  config: RuntimeConfig,
  development = false,
) {
  const [
    account,
    monitors,
    settings,
    contract,
    runs,
    jobs,
    scopes,
    heartbeat,
    globalBudget,
  ] = await Promise.all([
    accountView(db, p.userId),
    getMonitors(db, p.userId),
    getSettings(db, p.userId),
    sharedContract(db),
    all<{
      monitor_id: string;
      status: string;
      completed_at: string | null;
      started_at: string;
      summary: string;
      id: string;
      errors: string;
      snapshot_id: string | null;
      records_received: number;
      candidates_found: number;
      last_success: string | null;
    }>(
      db,
      "SELECT id,monitor_id,status,completed_at,started_at,summary,errors,snapshot_id,records_received,candidates_found,last_success FROM (SELECT *,MAX(CASE WHEN status IN ('completed','needs_details') THEN completed_at END) OVER(PARTITION BY monitor_id) AS last_success,ROW_NUMBER() OVER(PARTITION BY monitor_id ORDER BY started_at DESC,id DESC) AS rn FROM provider_runs WHERE user_id=?) WHERE rn=1",
      p.userId,
    ),
    all<{
      id: string;
      monitor_id: string;
      scope_id: string;
      status: string;
      available_at: string;
    }>(
      db,
      "SELECT id,monitor_id,scope_id,status,available_at FROM jobs WHERE user_id=? AND status IN ('pending','running') ORDER BY created_at DESC",
      p.userId,
    ),
    all<{ monitor_id: string; revision: number; next_run_at: string }>(
      db,
      "SELECT monitor_id,revision,next_run_at FROM monitor_scopes WHERE user_id=?",
      p.userId,
    ),
    db
      .prepare(
        "SELECT seen_at,status FROM worker_heartbeats WHERE id='scheduler'",
      )
      .first<{ seen_at: string; status: string }>(),
    db
      .prepare("SELECT count FROM rate_limits WHERE key=?")
      .bind(providerBudgetKey("brightdata"))
      .first<{ count: number }>(),
  ]);
  const globalRadars = await db
    .prepare(
      "SELECT COUNT(*) n FROM monitors m JOIN accounts a ON a.user_id=m.user_id WHERE m.active=1 AND a.status='active' AND COALESCE(json_extract(m.config,'$.archived'),0)=0",
    )
    .first<{ n: number }>();
  const activeRadars = monitors.filter((m) => m.active && !m.archived).length;
  const pilot = pilotConfig(config),
    setup = providerSetup(config, development),
    // A fonte própria (scraper) fica pronta assim que o SCRAPER_URL está
    // configurado — não exige a validação manual da administração (que era um
    // resquício do contrato pago da Bright Data).
    ready = setup.ready;
  const collectionEnabled = config.COLLECTION_ENABLED === "true",
    workerHealthy =
      !!heartbeat && Date.now() - Date.parse(heartbeat.seen_at) < 120000;
  const quotaPaused =
    account.usedToday >= account.plan.dailyTriggers ||
    (globalBudget?.count ?? 0) >= pilot.maxDailyTriggers;
  const searches = monitors
    .filter((m) => m.provider === "brightdata")
    .map((m) => {
      const run = runs.find((r) => r.monitor_id === m.id),
        job = jobs.find(
          (j) =>
            j.monitor_id === m.id &&
            j.scope_id === `${m.id}:${m.provider}:${m.revision}`,
        ),
        scope = scopes.find(
          (s) => s.monitor_id === m.id && s.revision === m.revision,
        );
      const failure =
        run &&
        [
          "failed",
          "dead",
          "error",
          "uncertain",
          "retry",
          "budget_blocked",
        ].includes(run.status)
          ? runFailureAdvice(run.errors)
          : null;
      let status = "monitorando",
        message = "Aguardando a próxima busca.";
      if (m.archived) {
        status = "arquivada";
        message = "Esta busca foi arquivada.";
      } else if (!m.active) {
        status = "pausada";
        message = "Pausada por você.";
      } else if (!ready || !collectionEnabled) {
        status = "configurando";
        message =
          "A administração precisa habilitar a fonte para executar buscas.";
      } else if (job?.status === "running") {
        status = "buscando";
        message = "Uma busca está em processamento.";
      } else if (job?.status === "pending") {
        status = "buscando";
        message =
          run?.id === job.id && run.status === "waiting"
            ? "A fonte está processando a coleta. O resultado será consultado automaticamente, sem iniciar outra busca."
            : run?.id === job.id && run.status === "retry"
              ? "A tentativa não concluiu. Uma nova verificação está agendada; não é preciso clicar novamente."
              : "Solicitação na fila. O serviço de buscas vai processá-la.";
      } else if (quotaPaused) {
        status = "pausada_por_cota";
        message =
          "A cota disponível foi atingida. Não haverá novo consumo até a renovação.";
      } else if (
        run &&
        ["failed", "dead", "error", "uncertain"].includes(run.status)
      ) {
        status = "precisa_de_atencao";
        message =
          failure?.message ??
          "A última tentativa não concluiu. Consulte o diagnóstico da execução.";
      } else if (!workerHealthy) {
        status = "precisa_de_atencao";
        message = "Não recebemos atividade recente do serviço de buscas.";
      } else if (pilot.pilot && !job) {
        status = "piloto_manual";
        message =
          "Primeira busca automática ao ativar. Atualizações seguintes são manuais neste ambiente de teste.";
      } else if (!run?.last_success) {
        status = "aguardando_primeira_busca";
        message = "Aguardando a primeira busca concluída.";
      }
      if (
        ready &&
        collectionEnabled &&
        m.active &&
        !m.archived &&
        !job &&
        m.queryType !== "search_url" &&
        // Só há filtros nativos a confirmar quando a fonte declara um schema. O
        // scraper próprio não tem schema: cidade, raio e recência são filtrados
        // LOCALMENTE pelo pipeline, então não existe pendência de configuração.
        contract?.schemas?.keyword
      ) {
        const temporal = nativePublicationPolicy(
          { type: "keyword", keyword: m.query },
          contract.schemas.keyword,
          Math.min(m.maxListingAgeMinutes ?? 10080, 10080),
        );
        let inputIssue = temporal.issue;
        if (!inputIssue) {
          try {
            nativeRadius(temporal.query, contract.schemas.keyword, m.radiusKm);
          } catch (e) {
            inputIssue =
              e instanceof Error
                ? e.message
                : "Confirme os filtros da fonte na Administração.";
          }
        }
        if (inputIssue) {
          status = "configurando";
          message = inputIssue;
        }
      }
      return {
        ...publicSearchConfig(m),
        operational: {
          status,
          message,
          lastCompleted: run?.last_success ?? null,
          runId: run?.id ?? null,
          snapshotId: run?.snapshot_id ?? null,
          lastRunStatus: run?.status ?? null,
          lastError:
            failure && (!job || run?.id === job.id)
              ? {
                  message: failure.message,
                  action: failure.action,
                  phase: failure.phase,
                  // Only the authenticated owner/admin sees technical text, never raw payloads.
                  technical: p.admin
                    ? safeDiagnosticText(
                        failure.technical,
                        Object.values(config).filter(
                          (v): v is string => !!v && v.length >= 16,
                        ),
                      )
                    : null,
                }
              : null,
          candidatesFound: run?.candidates_found ?? 0,
          recordsReceived: run?.records_received ?? 0,
          nextAttempt:
            job?.status === "pending"
              ? job.available_at
              : !m.active ||
                  m.archived ||
                  !ready ||
                  !collectionEnabled ||
                  quotaPaused ||
                  pilot.pilot
                ? null
                : (job?.available_at ?? scope?.next_run_at ?? null),
          effectiveInterval: plannedInterval(
            m.intervalSeconds,
            account.plan.minInterval,
            account.plan.dailyTriggers,
            activeRadars,
            pilot.maxDailyTriggers,
            globalRadars?.n ?? 1,
          ),
          summary: run ? JSON.parse(run.summary) : null,
        },
      };
    });
  // Only capability booleans and supported client choices are public; no credentials or raw diagnostics.
  const schema = contract?.schemas?.keyword;
  return {
    session: { userId: p.userId, admin: p.admin, ...authLinks(config) },
    account,
    searches,
    settings,
    service: {
      ready,
      collectionEnabled,
      pilot: pilot.pilot,
      workerHealthy,
      workerLastSeen: heartbeat?.seen_at ?? null,
      quotaPaused,
      maxRecords: pilot.maxRecords,
      newRadarInterval: plannedInterval(
        account.plan.minInterval,
        account.plan.minInterval,
        account.plan.dailyTriggers,
        activeRadars + 1,
        pilot.maxDailyTriggers,
        (globalRadars?.n ?? 0) + 1,
      ),
      nativeRecency: nativePublicationPolicy(
        { type: "keyword", keyword: "preview" },
        contract?.schemas?.keyword,
        10080,
      ).coverage,
      nativeOneDaySupported:
        nativePublicationPolicy(
          { type: "keyword", keyword: "preview" },
          contract?.schemas?.keyword,
          1440,
        ).coverage === "native",
      nativeRadiusConfirmed: !!radiusUnit(
        schema?.fields.find((f) => f.name === "radius" && f.supported)?.unit,
      ),
      nativeRecencyDays: nativePublicationPolicy(
        { type: "keyword", keyword: "preview" },
        contract?.schemas?.keyword,
        10080,
      ).days,
      availabilityEnabled: config.AVAILABILITY_ENABLED === "true",
      methods: contract?.methods ?? { keyword: false, search_url: false },
      cityFilter: !!schema?.fields.some(
        (f) => f.name === "city" && f.supported && f.inputEnabled !== false,
      ),
      radiusFilter: !!schema?.fields.some(
        (f) =>
          ["radius", "radius_km"].includes(f.name) &&
          f.supported &&
          f.inputEnabled !== false,
      ),
    },
    now: new Date().toISOString(),
  };
}
export type Bootstrap = Awaited<ReturnType<typeof bootstrap>>;
export type SearchView = Bootstrap["searches"][number];
export function publicSearchConfig(m: Monitor) {
  const { providerContractFingerprint: _, ...publicConfig } = m;
  void _;
  return publicConfig;
}
