import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzePage,
  assertMarketplaceUrl,
  buildRequest,
  findListings,
  main,
  parseArgs,
} from "../scripts/probe-marketplace.mjs";

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
const HOUR = 3_600_000;
const URL_OK =
  "https://www.facebook.com/marketplace/cidadeteste/search?query=produto&daysSinceListed=7";
const secondsAgo = (ms) => Math.floor((NOW - ms) / 1000);

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), "market-radar-test-"));
  t.after(() => {
    if (!root.startsWith(join(tmpdir(), "market-radar-test-")))
      throw new Error("Unsafe test cleanup");
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

// Synthetic data only: nothing here comes from a real page or a real person.
function listing(id, title, extra = {}) {
  return {
    id,
    marketplace_listing_title: title,
    listing_price: {
      amount: "1500.00",
      formatted_amount: "R$1.500",
      currency: "BRL",
    },
    location: { reverse_geocode: { city: "Cidade Teste", state: "XX" } },
    creation_time: secondsAgo(3 * HOUR),
    is_sold: false,
    is_pending: false,
    primary_listing_photo: { image: { uri: "https://example.invalid/a.jpg" } },
    marketplace_listing_seller: { id: "vendedor-1" },
    ...extra,
  };
}
const block = (value) =>
  `<script type="application/json" data-sjs>${JSON.stringify(value)}</script>`;
const FIXTURE_HTML = `<html><body>
${block({
  data: {
    edges: [
      { node: { listing: listing("1001", "Produto Teste A") } },
      {
        node: {
          listing: listing("1002", "Produto Teste B", {
            listing_price: { formatted_amount: "N/A" },
            creation_time: secondsAgo(30 * HOUR),
          }),
        },
      },
      {
        node: {
          listing: listing("1003", "Produto Teste C", {
            is_sold: true,
            creation_time: secondsAgo(10 * 24 * HOUR),
          }),
        },
      },
      {
        node: {
          listing: listing("1004", "Produto Teste D", {
            creation_time: undefined,
            location: undefined,
          }),
        },
      },
    ],
  },
})}
${block({ unrelated: true })}
<script type="application/json">{"marketplace_listing_title": </script>
${block({ id: "1001", marketplace_listing_title: "Produto Teste A" })}
</body></html>`;

test("sonda: aceita só busca do Marketplace no host exato", () => {
  assert.equal(
    assertMarketplaceUrl(
      "https://www.facebook.com/marketplace/x/search?query=a",
    ),
    "https://www.facebook.com/marketplace/x/search?query=a",
  );
  for (const bad of [
    "http://www.facebook.com/marketplace/x",
    "https://facebook.com.evil.example/marketplace/x",
    "https://www.facebook.com/groups/1",
    "https://user:senha@www.facebook.com/marketplace/x",
    "https://www.facebook.com:444/marketplace/x",
    "isto não é uma URL",
  ])
    assert.throws(() => assertMarketplaceUrl(bad), bad);
});

test("sonda: opções são validadas e --js escolhe o navegador real do ScrapeNinja", () => {
  const defaults = parseArgs(["--url", URL_OK]);
  assert.deepEqual(
    [defaults.vendor, defaults.engine, defaults.country, defaults.pool],
    ["scrapeninja", "scrape", "br", "residential"],
  );
  assert.equal(parseArgs(["--js"]).engine, "js");
  assert.equal(parseArgs(["--vendor", "scrapfly", "--js"]).engine, "scrape");
  assert.equal(parseArgs(["--credit-usd", "0.001"]).creditUsd, 0.001);
  for (const bad of [
    ["--nada"],
    ["--url"],
    ["--url", "--save"],
    ["--vendor", "outro"],
    ["--engine", "x"],
    ["--pool", "mobile"],
    ["--country", "brasil"],
    ["--credit-usd", "0"],
  ])
    assert.throws(() => parseArgs(bad), bad.join(" "));
});

test("sonda: leitor extrai anúncios distintos, ignora JSON inválido e mantém a cópia mais completa", () => {
  const { listings, blocks } = findListings(FIXTURE_HTML);
  assert.deepEqual(listings.map((l) => String(l.id)).sort(), [
    "1001",
    "1002",
    "1003",
    "1004",
  ]);
  assert.equal(blocks, 2);
  assert.ok(listings.find((l) => l.id === "1001").listing_price);
});

test("sonda: análise conta preço, cidade, data, idade e vendido", () => {
  const a = analyzePage(
    { status: 200, finalUrl: URL_OK, body: FIXTURE_HTML },
    NOW,
    7,
  );
  assert.equal(a.total, 4);
  assert.equal(a.markers, 6);
  assert.equal(a.withPrice, 3);
  assert.equal(a.withCity, 3);
  assert.equal(a.withDate, 3);
  assert.equal(a.withPhoto, 4);
  assert.equal(a.soldOrPending, 1);
  assert.deepEqual(a.age, { day: 1, week: 1, older: 1, unknown: 1 });
  assert.equal(a.beyondWindow, 1);
  assert.equal(a.redirectedToLogin, false);
  assert.deepEqual(
    a.sample.map((row) => row.title),
    [
      "Produto Teste A",
      "Produto Teste B",
      "Produto Teste C",
      "Produto Teste D",
    ],
  );
  assert.equal(a.sample[0].price.label, "R$1.500");
  const blocked = analyzePage(
    {
      status: 200,
      finalUrl: "https://www.facebook.com/login/?next=%2Fmarketplace",
      body: "<html></html>",
    },
    NOW,
  );
  assert.equal(blocked.redirectedToLogin, true);
  assert.equal(blocked.total, 0);
});

test("sonda: pedido ScrapeNinja usa APIRoad, segredos só no cabeçalho e ficam fora da prévia", () => {
  const options = {
    ...parseArgs(["--url", URL_OK]),
    proxy: "http://user:proxysecret@proxy.example:8000",
  };
  const request = buildRequest(options, {
    SCRAPENINJA_KEY: "chave-ninja-teste",
  });
  assert.equal(request.url, "https://scrapeninja.apiroad.net/scrape");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers["x-apiroad-key"], "chave-ninja-teste");
  const body = JSON.parse(request.init.body);
  assert.equal(body.geo, "br");
  assert.equal(body.retryNum, 1);
  assert.equal(body.proxy, options.proxy);
  const preview = JSON.stringify(request.preview);
  assert.ok(!preview.includes("chave-ninja-teste"));
  assert.ok(!preview.includes("proxysecret"));
  assert.deepEqual(request.secrets, ["chave-ninja-teste", options.proxy]);
  const rapid = buildRequest(parseArgs(["--url", URL_OK, "--engine", "js"]), {
    SCRAPENINJA_KEY: "k",
    SCRAPENINJA_HOST: "rapidapi",
  });
  assert.equal(rapid.url, "https://scrapeninja.p.rapidapi.com/scrape-js");
  assert.equal(rapid.init.headers["x-rapidapi-key"], "k");
  assert.throws(
    () =>
      buildRequest(parseArgs(["--url", URL_OK, "--engine", "v2"]), {
        SCRAPENINJA_KEY: "k",
        SCRAPENINJA_HOST: "rapidapi",
      }),
    /APIRoad/,
  );
});

test("sonda: pedido Scrapfly é GET com a chave na URL e prévia sem chave", () => {
  const request = buildRequest(
    parseArgs(["--vendor", "scrapfly", "--url", URL_OK]),
    { SCRAPFLY_KEY: "chave-scrapfly-teste" },
  );
  const sent = new URL(request.url);
  assert.equal(sent.origin + sent.pathname, "https://api.scrapfly.io/scrape");
  assert.equal(sent.searchParams.get("key"), "chave-scrapfly-teste");
  assert.equal(sent.searchParams.get("url"), URL_OK);
  assert.equal(sent.searchParams.get("proxy_pool"), "public_residential_pool");
  assert.equal(sent.searchParams.get("country"), "br");
  assert.equal(sent.searchParams.get("render_js"), "false");
  assert.equal(sent.searchParams.get("retry"), "false");
  assert.ok(!JSON.stringify(request.preview).includes("chave-scrapfly-teste"));
  const heavy = buildRequest(
    parseArgs(["--vendor", "scrapfly", "--url", URL_OK, "--js", "--asp"]),
    { SCRAPFLY_KEY: "k" },
  );
  const params = new URL(heavy.url).searchParams;
  assert.equal(params.get("render_js"), "true");
  assert.equal(params.get("asp"), "true");
});

test("sonda: sem chave falha antes da rede e --dry-run não exige chave", async () => {
  const options = parseArgs(["--vendor", "scrapfly", "--url", URL_OK]);
  assert.throws(() => buildRequest(options, {}), /SCRAPFLY_KEY/);
  const lines = [];
  const code = await main(
    ["--vendor", "scrapfly", "--url", URL_OK, "--dry-run"],
    {},
    {
      log: (line) => lines.push(line),
      root: tmpdir(),
      fetch: () => assert.fail("dry-run não pode usar a rede"),
    },
  );
  const output = lines.join("\n");
  assert.equal(code, 0);
  assert.ok(output.includes("Simulação"));
  assert.ok(output.includes('"proxy_pool"'));
  assert.ok(!output.includes('"key"') && !output.includes("<chave>"));
});

test("sonda: ScrapeNinja completo com rede simulada, salva a página e não vaza a chave", async (t) => {
  const root = temporary(t);
  const calls = [];
  const lines = [];
  const code = await main(
    ["--vendor", "scrapeninja", "--url", URL_OK, "--save"],
    { SCRAPENINJA_KEY: "chave-ninja-teste" },
    {
      root,
      now: () => NOW,
      log: (line) => lines.push(line),
      fetch: async (url, init) => {
        calls.push({ url, headers: init.headers });
        return new Response(
          JSON.stringify({
            info: { statusCode: 200, finalUrl: URL_OK, headers: [] },
            body: FIXTURE_HTML,
          }),
          { status: 200 },
        );
      },
    },
  );
  const output = lines.join("\n");
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers["x-apiroad-key"], "chave-ninja-teste");
  assert.match(output, /Anúncios distintos extraídos: 4/);
  assert.match(output, /Preço ausente em 1 de 4/);
  assert.match(output, /1 anúncio passa de 7 dias/);
  assert.match(output, /cidades: Cidade Teste 3/);
  assert.match(output, /compare o saldo de créditos/);
  assert.ok(!output.includes("chave-ninja-teste"));
  assert.ok(existsSync(join(root, ".probe-output")));
});

test("sonda: Scrapfly lê o custo do cabeçalho e a chave pode vir do .dev.vars", async (t) => {
  const root = temporary(t);
  writeFileSync(join(root, ".dev.vars"), "SCRAPFLY_KEY=chave-do-arquivo\n");
  const lines = [];
  let sentUrl = "";
  const code = await main(
    ["--vendor", "scrapfly", "--url", URL_OK],
    {},
    {
      root,
      now: () => NOW,
      log: (line) => lines.push(line),
      fetch: async (url) => {
        sentUrl = url;
        return new Response(
          JSON.stringify({
            result: { status_code: 200, content: FIXTURE_HTML, url: URL_OK },
          }),
          { status: 200, headers: { "x-scrapfly-api-cost": "30" } },
        );
      },
    },
  );
  const output = lines.join("\n");
  assert.equal(code, 0);
  assert.equal(new URL(sentUrl).searchParams.get("key"), "chave-do-arquivo");
  assert.match(output, /30 créditos ≈ US\$ 0,0045/);
  assert.match(output, /por 1\.000 anúncios/);
  assert.ok(!output.includes("chave-do-arquivo"));
});

test("sonda: modo direct vai direto ao site, sem chave, sem cookie e sem custo", async (t) => {
  const preview = buildRequest({ vendor: "direct", url: URL_OK }, {});
  assert.equal(preview.url, URL_OK);
  assert.deepEqual(preview.secrets, []);
  assert.match(preview.init.headers["user-agent"], /Chrome/);
  assert.match(preview.init.headers["accept-language"], /pt-BR/);
  assert.ok(!Object.keys(preview.init.headers).includes("cookie"));
  const lines = [];
  let sent = "";
  const code = await main(["--vendor", "direct", "--url", URL_OK], {}, {
    root: temporary(t),
    now: () => NOW,
    log: (line) => lines.push(line),
    fetch: async (url) => {
      sent = url;
      return new Response(FIXTURE_HTML, { status: 200 });
    },
  });
  const output = lines.join("\n");
  assert.equal(code, 0);
  assert.equal(sent, URL_OK);
  assert.match(output, /Sonda do Marketplace · direct/);
  assert.match(output, /Custo: nenhum/);
  assert.ok(!output.includes("por 1.000 anúncios"));
  assert.ok(!output.includes("não informa o custo"));
});

test("sonda: modo direct acusa redirecionamento para login e recusa do site", async (t) => {
  const run = async (response) => {
    const lines = [];
    const code = await main(["--vendor", "direct", "--url", URL_OK], {}, {
      root: temporary(t),
      now: () => NOW,
      log: (line) => lines.push(line),
      fetch: async () => response,
    });
    return { code, output: lines.join("\n") };
  };
  const login = await run({
    ok: true,
    status: 200,
    url: "https://www.facebook.com/login/?next=marketplace",
    text: async () => "<html>entre</html>",
    headers: new Headers(),
  });
  assert.equal(login.code, 0);
  assert.match(login.output, /BLOQUEADO/);
  const refused = await run(new Response("<html>limite</html>", { status: 429 }));
  assert.equal(refused.code, 1);
  assert.match(refused.output, /o Facebook respondeu HTTP 429/);
});

test("sonda: erro do fornecedor sai limpo, sem chave nem URL", async (t) => {
  const lines = [];
  const code = await main(
    ["--vendor", "scrapfly", "--url", URL_OK],
    { SCRAPFLY_KEY: "chave-scrapfly-teste" },
    {
      root: temporary(t),
      log: (line) => lines.push(line),
      fetch: async () =>
        new Response(
          "chave inválida chave-scrapfly-teste em https://api.scrapfly.io/scrape?key=chave-scrapfly-teste",
          { status: 401 },
        ),
    },
  );
  const output = lines.join("\n");
  assert.equal(code, 1);
  assert.match(output, /HTTP 401/);
  assert.ok(!output.includes("chave-scrapfly-teste"));
  assert.ok(!output.includes("api.scrapfly.io"));
});

test("sonda: erro do Scrapfly mostra código, motivo e custo que vêm depois do eco da configuração", async (t) => {
  const lines = [];
  const body = JSON.stringify({
    config: {
      url: URL_OK,
      key: "chave-scrapfly-teste",
      headers: { "accept-language": "pt-BR ".repeat(80) },
    },
    context: { cost: { total: 0 } },
    result: {
      status_code: 302,
      error: {
        code: "ERR::SCRAPE::BAD_UPSTREAM_RESPONSE",
        message: "The website responded with a redirect",
        retryable: false,
      },
    },
  });
  const code = await main(
    ["--vendor", "scrapfly", "--url", URL_OK],
    { SCRAPFLY_KEY: "chave-scrapfly-teste" },
    {
      root: temporary(t),
      log: (line) => lines.push(line),
      fetch: async () => new Response(body, { status: 422 }),
    },
  );
  const output = lines.join("\n");
  assert.equal(code, 1);
  assert.match(output, /HTTP 422/);
  assert.match(output, /ERR::SCRAPE::BAD_UPSTREAM_RESPONSE/);
  assert.match(output, /o site respondeu HTTP 302/);
  assert.match(output, /custo 0 créditos/);
  assert.ok(!output.includes("chave-scrapfly-teste"));
});

test("sonda: sem chave, URL de fora do Marketplace e --file não chegam à rede", async (t) => {
  const root = temporary(t);
  const noNetwork = () => assert.fail("não pode usar a rede");
  const run = async (argv) => {
    const lines = [];
    const code = await main(
      argv,
      {},
      {
        root,
        now: () => NOW,
        log: (line) => lines.push(line),
        fetch: noNetwork,
      },
    );
    return { code, output: lines.join("\n") };
  };
  const noKey = await run(["--vendor", "scrapfly", "--url", URL_OK]);
  assert.equal(noKey.code, 1);
  assert.match(noKey.output, /SCRAPFLY_KEY/);
  const outside = await run(["--url", "https://example.com/marketplace/x"]);
  assert.equal(outside.code, 1);
  assert.match(outside.output, /busca do Marketplace/);
  writeFileSync(join(root, "pagina.html"), FIXTURE_HTML);
  const local = await run(["--file", "pagina.html", "--url", URL_OK]);
  assert.equal(local.code, 0);
  assert.match(local.output, /arquivo local/);
  assert.match(local.output, /Anúncios distintos extraídos: 4/);
});
