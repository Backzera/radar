// Feasibility probe: ONE request, through a scraping vendor, to a public
// Facebook Marketplace search page, then a report of what that page carries.
// It never touches the app database and never prints keys or proxy URLs.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readLocalConfig } from "./local-config.mjs";
import { cleanWorkerText } from "./worker-log.mjs";

const DAY = 86_400_000;
const MARKER = "marketplace_listing_title";
const JSON_BLOCK =
  /<script\b[^>]*\btype="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
const NINJA_HOSTS = {
  apiroad: "https://scrapeninja.apiroad.net",
  rapidapi: "https://scrapeninja.p.rapidapi.com",
};
const NINJA_PATHS = {
  scrape: "/scrape",
  js: "/scrape-js",
  v2: "/v2/scrape-js",
};
// Table prices consulted on 19/09/2026. Confirm them in each vendor account.
const DEFAULT_CREDIT_USD = 30 / 200_000; // Scrapfly Discovery plan
const BRIGHTDATA_USD_PER_1000 = 1.5;
const VALUE_OPTIONS = new Set([
  "vendor",
  "url",
  "file",
  "engine",
  "country",
  "pool",
  "proxy",
  "credit-usd",
]);
const FLAG_OPTIONS = new Set(["dry-run", "save", "js", "asp", "help"]);
// Plain browser headers for --vendor direct: no cookies, no session, no login.
const DIRECT_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "pt-BR,pt;q=0.9,en;q=0.5",
};

export const USAGE = `Sonda do Marketplace: 1 requisição por execução, sem tocar no banco do app.

Uso:
  npm run probe:marketplace -- --vendor scrapfly --url "<busca do Marketplace>"
  npm run probe:marketplace -- --vendor direct --url "<busca>"   (desta máquina, sem fornecedor)
  npm run probe:marketplace -- --vendor scrapeninja --url "<busca>" [--engine scrape|js|v2]
  npm run probe:marketplace -- --file pagina.html [--url "<busca>"]   (sem rede)
  npm run probe:marketplace -- --vendor scrapfly --url "<busca>" --dry-run   (não envia)

Chaves, no .dev.vars ou no ambiente: SCRAPENINJA_KEY, SCRAPFLY_KEY
  (SCRAPENINJA_HOST=rapidapi usa a RapidAPI em vez do APIRoad)
Opções: --country br · --pool residential|datacenter e --js e --asp (Scrapfly)
  --proxy <url> (ScrapeNinja, proxy próprio) · --save · --credit-usd 0.00015`;

class UsageError extends Error {}

const toCamel = (name) => name.replace(/-(\w)/g, (_, c) => c.toUpperCase());

export function parseArgs(argv) {
  const options = {
    vendor: "scrapeninja",
    engine: "scrape",
    country: "br",
    pool: "residential",
  };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].startsWith("--") ? argv[i].slice(2) : "";
    if (FLAG_OPTIONS.has(name)) options[toCamel(name)] = true;
    else if (VALUE_OPTIONS.has(name)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--"))
        throw new UsageError(`Falta o valor de --${name}.`);
      options[toCamel(name)] = value;
    } else throw new UsageError(`Opção desconhecida: ${argv[i]}`);
  }
  if (!["scrapeninja", "scrapfly", "direct"].includes(options.vendor))
    throw new UsageError("--vendor deve ser scrapeninja, scrapfly ou direct.");
  if (!Object.hasOwn(NINJA_PATHS, options.engine))
    throw new UsageError("--engine deve ser scrape, js ou v2.");
  if (!["residential", "datacenter"].includes(options.pool))
    throw new UsageError("--pool deve ser residential ou datacenter.");
  if (!/^[a-z]{2}$/i.test(options.country))
    throw new UsageError("--country deve ter duas letras, como br.");
  options.country = options.country.toLowerCase();
  if (options.creditUsd !== undefined) {
    options.creditUsd = Number(options.creditUsd);
    if (!Number.isFinite(options.creditUsd) || options.creditUsd <= 0)
      throw new UsageError("--credit-usd deve ser um número positivo.");
  }
  // --js is shorthand for the real-browser engine on ScrapeNinja.
  if (
    options.vendor === "scrapeninja" &&
    options.js &&
    options.engine === "scrape"
  )
    options.engine = "js";
  return options;
}

// Same guard the app uses for search URLs: exact host, /marketplace/ path.
export function assertMarketplaceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(
      "URL inválida. Copie o endereço da barra do navegador.",
    );
  }
  if (
    url.protocol !== "https:" ||
    !["www.facebook.com", "facebook.com"].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/marketplace/")
  )
    throw new UsageError(
      "Use uma busca do Marketplace: https://www.facebook.com/marketplace/...",
    );
  return url.href;
}

// `url` and `init` carry the credentials; only `preview` is safe to print.
export function buildRequest(options, config, dryRun = options.dryRun) {
  const target = assertMarketplaceUrl(options.url);
  if (options.vendor === "direct")
    return {
      url: target,
      init: { method: "GET", headers: DIRECT_HEADERS },
      preview: { method: "GET", endpoint: target, headers: DIRECT_HEADERS },
      secrets: [],
    };
  const keyName =
    options.vendor === "scrapfly" ? "SCRAPFLY_KEY" : "SCRAPENINJA_KEY";
  const key = config[keyName]?.trim() || (dryRun ? "<chave>" : "");
  if (!key)
    throw new UsageError(
      `Chave ausente: defina ${keyName} no .dev.vars ou no ambiente.`,
    );
  const secrets = [key, options.proxy].filter(Boolean);
  if (options.vendor === "scrapfly") {
    const endpoint = "https://api.scrapfly.io/scrape";
    const params = {
      url: target,
      country: options.country,
      proxy_pool:
        options.pool === "datacenter"
          ? "public_datacenter_pool"
          : "public_residential_pool",
      render_js: String(Boolean(options.js)),
      asp: String(Boolean(options.asp)),
      retry: "false",
    };
    return {
      url: `${endpoint}?${new URLSearchParams({ ...params, key })}`,
      init: { method: "GET" },
      preview: { method: "GET", endpoint, params },
      secrets,
    };
  }
  const rapid = config.SCRAPENINJA_HOST === "rapidapi";
  if (rapid && options.engine === "v2")
    throw new UsageError("O motor v2 só existe pelo APIRoad.");
  const endpoint =
    NINJA_HOSTS[rapid ? "rapidapi" : "apiroad"] + NINJA_PATHS[options.engine];
  const body = {
    url: target,
    geo: options.country,
    retryNum: 1,
    timeout: 30,
    headers: ["Accept-Language: pt-BR,pt;q=0.9,en;q=0.5"],
  };
  if (options.proxy) body.proxy = options.proxy;
  return {
    url: endpoint,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(rapid
          ? {
              "x-rapidapi-key": key,
              "x-rapidapi-host": "scrapeninja.p.rapidapi.com",
            }
          : { "x-apiroad-key": key }),
      },
      body: JSON.stringify(body),
    },
    preview: {
      method: "POST",
      endpoint,
      body: { ...body, ...(options.proxy ? { proxy: "<omitido>" } : {}) },
    },
    secrets,
  };
}

export function readVendorResponse(vendor, payload, headers, requested) {
  if (vendor === "scrapfly") {
    const result = payload?.result ?? {};
    const header = Number(headers?.get?.("x-scrapfly-api-cost"));
    const context = Number(payload?.context?.cost?.total);
    const credits = [header, context].find((n) => Number.isFinite(n) && n > 0);
    return {
      status: result.status_code ?? null,
      finalUrl: typeof result.url === "string" ? result.url : requested,
      body: result.content,
      credits: credits ?? null,
    };
  }
  const info = payload?.info ?? {};
  return {
    status: info.statusCode ?? null,
    finalUrl: info.finalUrl ?? requested,
    body: payload?.body,
    credits: null,
  };
}

// A failed Scrapfly scrape echoes the whole config first; the reason sits in
// result.error (or at the top level for API errors), past any short excerpt.
export function describeVendorError(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  const error = payload?.result?.error ?? payload;
  const upstream = payload?.result?.status_code;
  const cost = Number(payload?.context?.cost?.total);
  const parts = [
    text(error?.code),
    text(error?.message),
    Number.isInteger(upstream) ? `o site respondeu HTTP ${upstream}` : null,
    Number.isFinite(cost) ? `custo ${cost} créditos` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

// Pre-order, so listings come out in page order.
function* walk(root, limit = 500_000) {
  const stack = [root];
  let visited = 0;
  while (stack.length && visited++ < limit) {
    const node = stack.pop();
    yield node;
    const values = Array.isArray(node) ? node : Object.values(node);
    for (let i = values.length - 1; i >= 0; i--)
      if (values[i] && typeof values[i] === "object") stack.push(values[i]);
  }
}

// Facebook ships the first batch of results as JSON inside the HTML. Walk every
// parsed block and keep objects that carry a listing title, one per listing id.
export function findListings(html) {
  const found = new Map();
  let blocks = 0;
  for (const match of html.matchAll(JSON_BLOCK)) {
    if (!match[1].includes(MARKER)) continue;
    let json;
    try {
      json = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (!json || typeof json !== "object") continue;
    blocks++;
    for (const node of walk(json)) {
      const id = node.id;
      if (
        typeof node[MARKER] !== "string" ||
        !["string", "number"].includes(typeof id)
      )
        continue;
      const previous = found.get(String(id));
      if (!previous || Object.keys(node).length > Object.keys(previous).length)
        found.set(String(id), node);
    }
  }
  return { listings: [...found.values()], blocks };
}

const text = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function readPrice(node) {
  const listing =
    node.listing_price && typeof node.listing_price === "object"
      ? node.listing_price
      : {};
  const formatted = node.formatted_price;
  const value = Number.parseFloat(listing.amount);
  const label =
    text(listing.formatted_amount) ??
    text(typeof formatted === "string" ? formatted : formatted?.text);
  const usable =
    Number.isFinite(value) || (label !== null && !/^n\/?a$/i.test(label));
  return {
    usable,
    label: usable ? label : null,
    value: Number.isFinite(value) ? value : null,
    currency: text(listing.currency),
  };
}

function readCreatedAt(node, now) {
  const raw = node.creation_time ?? node.creation_timestamp;
  const seconds =
    typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  return ms > Date.UTC(2010, 0, 1) && ms <= now + DAY ? ms : null;
}

export function describeListing(node, now = Date.now()) {
  return {
    id: String(node.id),
    title: text(node[MARKER]),
    price: readPrice(node),
    city:
      text(node.location?.reverse_geocode?.city) ??
      text(node.location?.city) ??
      text(node.location_text?.text),
    createdAtMs: readCreatedAt(node, now),
    sold: node.is_sold === true,
    pending: node.is_pending === true,
    photo: typeof node.primary_listing_photo?.image?.uri === "string",
    seller: Boolean(node.marketplace_listing_seller?.id),
  };
}

// Shows whether results really belong to the requested city.
function topCities(rows) {
  const counts = new Map();
  for (const row of rows)
    if (row.city) counts.set(row.city, (counts.get(row.city) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3);
}

export function analyzePage(
  { status, finalUrl, body },
  now = Date.now(),
  expectedDays = null,
) {
  const html = typeof body === "string" ? body : "";
  const { listings, blocks } = findListings(html);
  const rows = listings.map((node) => describeListing(node, now));
  const count = (test) => rows.filter(test).length;
  const age = (row) =>
    row.createdAtMs === null ? null : now - row.createdAtMs;
  return {
    expectedDays,
    beyondWindow: expectedDays
      ? count((row) => age(row) !== null && age(row) > expectedDays * DAY)
      : 0,
    status: status ?? null,
    bytes: Buffer.byteLength(html),
    redirectedToLogin: /\/(?:login|checkpoint)(?:[/.?]|$)/.test(finalUrl ?? ""),
    loginForm: html.includes('id="login_form"'),
    markers: html.split(MARKER).length - 1,
    blocks,
    total: rows.length,
    withPrice: count((row) => row.price.usable),
    withCity: count((row) => row.city !== null),
    withDate: count((row) => row.createdAtMs !== null),
    withPhoto: count((row) => row.photo),
    withSeller: count((row) => row.seller),
    cities: topCities(rows),
    soldOrPending: count((row) => row.sold || row.pending),
    age: {
      day: count((row) => age(row) !== null && age(row) <= DAY),
      week: count((row) => age(row) > DAY && age(row) <= 7 * DAY),
      older: count((row) => age(row) > 7 * DAY),
      unknown: count((row) => row.createdAtMs === null),
    },
    sample: rows.slice(0, 5).map((row) => ({
      title: row.title,
      price: row.price,
      city: row.city,
      ageMs: age(row),
    })),
  };
}

function humanAge(ms) {
  const minutes = Math.max(Math.floor(ms / 60_000), 0);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} dias`;
}

const money = (n, digits) =>
  n.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const anuncios = (n) => `${n} ${n === 1 ? "anúncio" : "anúncios"}`;

export function formatReport({ analysis: a, meta }) {
  const lines = [
    `Sonda do Marketplace · ${meta.vendor}`,
    `Resposta do site: HTTP ${a.status ?? "?"} · ${Math.round(a.bytes / 1024)} KB` +
      (meta.elapsedMs == null
        ? ""
        : ` · ${(meta.elapsedMs / 1000).toFixed(1)} s`),
  ];
  const direct = meta.vendor === "direct";
  const costUsd =
    direct || meta.credits == null
      ? null
      : meta.credits * (meta.creditUsd ?? DEFAULT_CREDIT_USD);
  if (direct)
    lines.push("Custo: nenhum (requisição direta desta máquina, sem fornecedor)");
  else if (costUsd !== null)
    lines.push(
      `Custo informado pelo fornecedor: ${meta.credits} créditos ≈ US$ ${money(costUsd, 4)}`,
    );
  lines.push(
    `Redirecionado para login: ${a.redirectedToLogin ? "SIM" : "não"} · formulário de login no HTML: ${a.loginForm ? "sim (pode ser só um aviso sobre a página)" : "não"}`,
    `Marcadores de anúncio no HTML: ${a.markers} · blocos JSON lidos: ${a.blocks}`,
    `Anúncios distintos extraídos: ${a.total}`,
  );
  if (a.total) {
    const of = (n) => `${n}/${a.total}`;
    lines.push(
      `  com preço ${of(a.withPrice)} · cidade ${of(a.withCity)} · data de publicação ${of(a.withDate)} · foto ${of(a.withPhoto)} · vendedor ${of(a.withSeller)} · vendido/pendente ${of(a.soldOrPending)}`,
      `  idade: até 24 h ${a.age.day} · de 1 a 7 dias ${a.age.week} · mais de 7 dias ${a.age.older} · sem data ${a.age.unknown}`,
      `  cidades: ${a.cities.map(([city, n]) => `${city} ${n}`).join(" · ") || "nenhuma informada"}`,
      "Amostra (ordem da página):",
      ...a.sample.map((row, i) => {
        const price =
          row.price.label ??
          (row.price.value === null
            ? "sem preço"
            : `${money(row.price.value, 2)} ${row.price.currency ?? ""}`.trim());
        const age =
          row.ageMs === null ? "sem data" : `há ${humanAge(row.ageMs)}`;
        return `  ${i + 1}. ${(row.title ?? "").slice(0, 60)} · ${price} · ${row.city ?? "sem cidade"} · ${age}`;
      }),
    );
    if (costUsd !== null)
      lines.push(
        `Se cada página trouxer ${a.total} anúncios: ≈ US$ ${money((costUsd / a.total) * 1000, 2)} por 1.000 anúncios (Bright Data: US$ ${money(BRIGHTDATA_USD_PER_1000, 2)} por mil).`,
      );
  }
  lines.push("", "Leitura:");
  if (a.redirectedToLogin)
    lines.push("- BLOQUEADO: o Facebook redirecionou para a página de login.");
  else if (!a.total && a.markers)
    lines.push(
      `- Há ${a.markers} marcadores de anúncio no HTML, mas o JSON não pôde ser lido. Rode de novo com --save para eu ajustar o leitor.`,
    );
  else if (!a.total)
    lines.push(
      "- Nenhum anúncio na página: provável bloqueio, página de login ou busca sem resultado. Abra a mesma URL no navegador para comparar.",
    );
  else {
    lines.push(`- Leitura ok: ${a.total} anúncios vieram nesta página.`);
    if (a.withPrice < a.total * 0.8)
      lines.push(
        `- Preço ausente em ${a.total - a.withPrice} de ${a.total}: só a busca não basta, seria preciso abrir cada anúncio (mais requisições e mais custo).`,
      );
    if (!a.withDate)
      lines.push(
        "- Nenhuma data de publicação na busca: a idade dependeria do filtro de dias do próprio site ou de abrir cada anúncio.",
      );
    else if (a.withDate < a.total)
      lines.push(`- Data ausente em ${anuncios(a.total - a.withDate)}.`);
    if (a.beyondWindow)
      lines.push(
        `- ${anuncios(a.beyondWindow)} ${a.beyondWindow === 1 ? "passa" : "passam"} de ${a.expectedDays} dias: o filtro de dias da URL não foi respeitado.`,
      );
    if (a.soldOrPending)
      lines.push(
        `- ${anuncios(a.soldOrPending)} já ${a.soldOrPending === 1 ? "vem marcado" : "vêm marcados"} como vendido/pendente.`,
      );
  }
  return lines;
}

// Returns the process exit code: 0 when the probe ran, 1 on any error.
export async function main(argv, env = process.env, deps = {}) {
  const {
    fetch: send = globalThis.fetch,
    log = console.log,
    root = process.cwd(),
    now = Date.now,
  } = deps;
  let secrets = [];
  try {
    const options = parseArgs(argv);
    if (options.help) {
      log(USAGE);
      return 0;
    }
    const config = readLocalConfig(root, env);
    let page;
    const meta = { vendor: "arquivo local", elapsedMs: null, credits: null };
    if (options.file) {
      page = {
        status: 200,
        finalUrl: options.url ?? "",
        body: readFileSync(resolve(root, options.file), "utf8"),
      };
    } else {
      if (!options.url)
        throw new UsageError(
          "Informe --url com a busca do Marketplace, ou --file com um HTML salvo.",
        );
      const request = buildRequest(options, config);
      secrets = request.secrets;
      if (options.dryRun) {
        log(JSON.stringify(request.preview, null, 2));
        log("Simulação: nenhuma requisição foi enviada.");
        return 0;
      }
      meta.vendor = options.vendor;
      meta.creditUsd = options.creditUsd;
      const started = now();
      const response = await send(request.url, {
        ...request.init,
        signal: AbortSignal.timeout(120_000),
      });
      const raw = await response.text();
      meta.elapsedMs = now() - started;
      const direct = options.vendor === "direct";
      if (!response.ok)
        throw new Error(
          `${direct ? "o Facebook" : options.vendor} respondeu HTTP ${response.status}: ${describeVendorError(raw) ?? cleanWorkerText(raw, secrets, 300)}`,
        );
      let read;
      if (direct)
        read = {
          status: response.status,
          finalUrl: response.url || options.url,
          body: raw,
          credits: 0,
        };
      else {
        let payload;
        try {
          payload = JSON.parse(raw);
        } catch {
          throw new Error("A resposta do fornecedor não é JSON.");
        }
        read = readVendorResponse(
          options.vendor,
          payload,
          response.headers,
          options.url,
        );
      }
      if (
        typeof read.body === "string" &&
        read.body.length < 500 &&
        /^https:\/\/api\.scrapfly\.io\//.test(read.body)
      )
        throw new Error(
          "O Scrapfly devolveu um link de download em vez da página (conteúdo grande demais para vir no JSON).",
        );
      meta.credits = read.credits;
      page = read;
      if (options.save) {
        const dir = join(root, ".probe-output");
        mkdirSync(dir, { recursive: true });
        const name = `${new Date(now()).toISOString().replace(/[:.]/g, "-")}-${options.vendor}.html`;
        writeFileSync(
          join(dir, name),
          typeof read.body === "string" ? read.body : "",
        );
        meta.saved = join(".probe-output", name);
      }
    }
    const expectedDays = options.url
      ? Number(
          new URL(assertMarketplaceUrl(options.url)).searchParams.get(
            "daysSinceListed",
          ),
        ) || null
      : null;
    const analysis = analyzePage(page, now(), expectedDays);
    for (const line of formatReport({ analysis, meta })) log(line);
    if (meta.saved)
      log(
        `\nPágina salva em ${meta.saved}. Contém dados públicos de terceiros: não compartilhe nem versione.`,
      );
    if (meta.credits == null && !options.file)
      log(
        "\nEste fornecedor não informa o custo na resposta: compare o saldo de créditos no painel antes e depois.",
      );
    return 0;
  } catch (error) {
    const detail =
      error instanceof UsageError
        ? error.message
        : cleanWorkerText(
            `${error?.message ?? error}${error?.cause?.code ? ` (${error.cause.code})` : ""}`,
            secrets,
            400,
          );
    log(`Erro: ${detail}`);
    if (error instanceof UsageError) log(`\n${USAGE}`);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await main(process.argv.slice(2));
