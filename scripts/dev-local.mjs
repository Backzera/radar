/** Development-only supervisor. An additive local upgrade runs with backup before startup. */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { upgradeLocal } from "./upgrade-local.mjs";
import { readLocalConfig } from "./local-config.mjs";
import { readExecutionProfile } from "./execution-profile.mjs";

export function devPlan(config, args = []) {
  let url;
  try {
    url = new URL(config.RADAR_API_URL || "http://localhost:5173");
  } catch {
    throw new Error(
      "RADAR_API_URL inválida. Para este início local, use http://localhost:5173.",
    );
  }
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "npm run dev inicia apenas no seu computador. Use RADAR_API_URL=http://localhost:5173. Para outro alvo, use dev:server e configure o worker separadamente.",
    );
  const host = url.hostname === "[::1]" ? "::1" : "127.0.0.1";
  const port = Number(url.port || 80);
  if (port < 1 || port > 65535)
    throw new Error("Defina uma porta fixa válida em RADAR_API_URL.");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (/^(?:--(?:port|hostname|host)(?:=|$)|-[pH]$)/.test(arg))
      throw new Error(
        "Configure a porta pelo RADAR_API_URL em .dev.vars. Este início local fixa a escuta em loopback.",
      );
  }
  const token = config.WORKER_TOKEN;
  const workerEnabled =
    config.LOCAL_WORKER_AUTOSTART !== "false" &&
    typeof token === "string" &&
    token.length >= 32 &&
    !/[^\x21-\x7e]/.test(token);
  // Use the exact bound address. "localhost" can resolve to another IPv6
  // listener while this child owns IPv4, so never attach by ambiguous DNS.
  const bound = new URL(url.origin);
  bound.hostname = host === "::1" ? "[::1]" : host;
  return { origin: bound.origin, host, port, args, workerEnabled };
}

async function portIsFree(host, port) {
  await new Promise((done, reject) => {
    const probe = createServer();
    probe.once("error", () =>
      reject(
        new Error(
          `A porta ${port} está em uso. Pare o npm run dev anterior antes de iniciar; não conectamos o worker a outro servidor.`,
        ),
      ),
    );
    probe.listen({ host, port, exclusive: true }, () => probe.close(done));
  });
}

export async function waitForApi(
  origin,
  { signal, timeoutMs = 120000, fetcher = fetch, intervalMs = 750 } = {},
) {
  const until = Date.now() + timeoutMs;
  while (!signal?.aborted && Date.now() < until) {
    try {
      const response = await fetcher(`${origin}/api/v1/health/ready`, {
        redirect: "error",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(3000)])
          : AbortSignal.timeout(3000),
      });
      if (response.ok && (await response.json()).status === "ready")
        return true;
      await response.body?.cancel().catch(() => {});
    } catch {
      /* Server compilation or startup is not complete yet. */
    }
    await delay(intervalMs, undefined, { signal }).catch(() => {});
  }
  return false;
}

export async function runLocalDev({
  root = process.cwd(),
  config = readLocalConfig(root, process.env),
  args = [],
  framework = fileURLToPath(new URL("./run-framework.mjs", import.meta.url)),
  worker = fileURLToPath(new URL("./worker.mjs", import.meta.url)),
  readinessTimeout = 120000,
} = {}) {
  const plan = devPlan(config, args);
  await portIsFree(plan.host, plan.port);
  await upgradeLocal(root);
  const server = spawn(
    process.execPath,
    [
      framework,
      "dev",
      ...args,
      "--hostname",
      plan.host,
      "--port",
      String(plan.port),
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    },
  );
  let workerProcess,
    stopping = false;
  const controller = new AbortController();
  const stop = () => {
    if (stopping) return;
    stopping = true;
    controller.abort();
    // Only the children created here are signalled. No global taskkill/port killing.
    workerProcess?.kill("SIGTERM");
    server.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (
        workerProcess &&
        workerProcess.exitCode === null &&
        !workerProcess.signalCode
      )
        workerProcess.kill("SIGKILL");
      if (server.exitCode === null && !server.signalCode)
        server.kill("SIGKILL");
    }, 3000);
    timer.unref();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  server.once("error", () => {
    console.error("Não foi possível iniciar o servidor local.");
    process.exitCode = 1;
    stop();
  });
  server.once("exit", (code) => {
    if (!stopping) process.exitCode = code ?? 1;
    stop();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  });
  console.info(
    `[Market Radar] Iniciando servidor local em ${plan.origin}. Ctrl+C encerra servidor e worker.`,
  );
  if (!plan.workerEnabled) {
    console.warn(
      config.LOCAL_WORKER_AUTOSTART === "false"
        ? "[Market Radar] Worker automático local desativado. Use npm run worker em outro terminal."
        : "[Market Radar] WORKER_TOKEN ausente/inválido. Execute npm run local:init e reinicie. Nenhuma configuração foi sobrescrita.",
    );
    return { server, stop };
  }
  if (
    await waitForApi(plan.origin, {
      signal: controller.signal,
      timeoutMs: readinessTimeout,
    })
  ) {
    if (stopping) return { server, stop };
    workerProcess = spawn(process.execPath, [worker], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, RADAR_API_URL: plan.origin },
    });
    workerProcess.once("error", () =>
      console.error(
        "[Market Radar] Não foi possível iniciar o worker. Use npm run worker para ver o diagnóstico.",
      ),
    );
    workerProcess.once("exit", (code) => {
      if (!stopping)
        console.error(
          `[Market Radar] Worker encerrou (código ${code ?? "sinal"}). O servidor continua aberto; confira a configuração e reinicie.`,
        );
    });
    console.info(
      "[Market Radar] Worker iniciado nesta janela. As travas COLLECTION_ENABLED, PILOT_MODE e cotas foram preservadas.",
    );
  } else if (!stopping) {
    console.error(
      "[Market Radar] A API não ficou pronta em 120 s. O worker não iniciou. Confira o terminal; migrations ausentes exigem backup e npm run db:migrate. A atualização local 2.0 é aditiva; outras migrations exigem instalação apropriada.",
    );
  }
  return { server, worker: workerProcess, stop };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2);
  if (readExecutionProfile() === "managed-linux") {
    process.argv = [
      process.execPath,
      fileURLToPath(new URL("./run-framework.mjs", import.meta.url)),
      "dev",
      ...args,
    ];
    await import("./run-framework.mjs");
  } else {
    try {
      await runLocalDev({ args });
    } catch (error) {
      console.error(
        error instanceof Error
          ? error.message
          : "Falha ao iniciar ambiente local.",
      );
      process.exitCode = 1;
    }
  }
}
