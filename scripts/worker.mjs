import { readLocalConfig } from "./local-config.mjs";
import { workerJobLogs } from "./worker-log.mjs";
import { setTimeout as delay } from "node:timers/promises";
const config = readLocalConfig(process.cwd(), process.env);
let parsedOrigin;
try {
  parsedOrigin = new URL(config.RADAR_API_URL ?? "http://localhost:5173");
} catch {
  throw new Error("RADAR_API_URL inválida. Informe a origem da API local.");
}
if (
  !["http:", "https:"].includes(parsedOrigin.protocol) ||
  parsedOrigin.username ||
  parsedOrigin.password ||
  parsedOrigin.search ||
  parsedOrigin.hash ||
  parsedOrigin.pathname !== "/"
)
  throw new Error(
    "RADAR_API_URL deve ser a origem da API, sem credenciais, parâmetros ou caminho.",
  );
if (
  parsedOrigin.protocol !== "https:" &&
  !["localhost", "127.0.0.1", "[::1]"].includes(parsedOrigin.hostname) &&
  config.ALLOW_INSECURE_LOCAL_WORKER_HTTP !== "true"
)
  throw new Error(
    "Worker remoto exige HTTPS. HTTP de rede local requer habilitação explícita de desenvolvimento.",
  );
const origin = parsedOrigin.origin;
const token = config.WORKER_TOKEN;
if (!token || token.length < 32 || /[^\x21-\x7e]/.test(token))
  throw new Error(
    "Configure WORKER_TOKEN com pelo menos 32 caracteres em .dev.vars/.env.",
  );
const interval = Math.max(5000, Number(config.WORKER_TICK_MS) || 10000);
let stopping = false;
let lastHeartbeat = 0;
const shutdown = new AbortController();
process.on("SIGINT", () => {
  stopping = true;
  shutdown.abort();
});
process.on("SIGTERM", () => {
  stopping = true;
  shutdown.abort();
});
console.info(
  JSON.stringify({ event: "worker_started", origin, intervalMs: interval }),
);
while (!stopping) {
  try {
    const response = await fetch(`${origin}/api/v1/worker/tick`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(config.CF_ACCESS_CLIENT_ID && config.CF_ACCESS_CLIENT_SECRET
          ? {
              "CF-Access-Client-Id": config.CF_ACCESS_CLIENT_ID,
              "CF-Access-Client-Secret": config.CF_ACCESS_CLIENT_SECRET,
            }
          : {}),
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(60000)]),
    });
    const result = await response.json();
    if (!response.ok)
      console.error(
        JSON.stringify({
          event: "worker_http_error",
          status: response.status,
          error:
            response.status === 401
              ? "Token do worker não aceito; confira a configuração e reinicie ambos os processos."
              : response.status === 403
                ? "Acesso ao worker não permitido."
                : "API recusou o tick; confira o diagnóstico local.",
        }),
      );
    else if (result.status !== "idle" || Date.now() - lastHeartbeat >= 60000) {
      console.info(
        JSON.stringify({
          event: "worker_tick",
          status: result.status,
          queued: result.queued ?? 0,
          accounts: result.accounts ?? null,
        }),
      );
      lastHeartbeat = Date.now();
    }
    if (response.ok) {
      const secrets = [
        token,
        config.BRIGHTDATA_API_KEY,
        config.CF_ACCESS_CLIENT_SECRET,
        config.TELEGRAM_BOT_TOKEN,
        config.TELEGRAM_WEBHOOK_SECRET,
      ].filter(Boolean);
      for (const entry of workerJobLogs(result, secrets)) {
        (entry.error ? console.error : console.info)(JSON.stringify(entry));
      }
    }
    if ([401, 403].includes(response.status)) {
      process.exitCode = 1;
      break;
    }
  } catch {
    if (stopping) break;
    console.error(
      JSON.stringify({
        event: "worker_connection_error",
        error:
          "Não foi possível acessar a API. Confira o servidor e RADAR_API_URL; detalhes sensíveis foram omitidos.",
      }),
    );
  }
  if (!stopping)
    await delay(interval, undefined, { signal: shutdown.signal }).catch(
      () => {},
    );
}
