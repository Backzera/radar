"use client";
import { useState } from "react";
import { searchUrlError } from "../core/provider-query";
import {
  ProviderFilterFields,
  ProviderSchemaSummary,
  readProviderFilters,
} from "./provider-filters";
import { ProviderSetupChecklist } from "./provider-setup";
import { Activity, Wifi, Loader2, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect, NativeSelectOption as Option } from "./ui/native-select";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "./ui/table";
import {
  api,
  date,
  duration,
  Field,
  Tag,
  type RadarState,
} from "./radar-shared";
export function Providers({
  data,
  busy,
  check,
  refresh,
}: {
  data: RadarState;
  busy: boolean;
  check: () => void;
  refresh: () => Promise<void>;
}) {
  const [method, setMethod] = useState<"keyword" | "search_url">("keyword"),
    [working, setWorking] = useState(false),
    [message, setMessage] = useState("");
  const d = data.diagnostics;
  const setup = data.providerSetup;
  const schema = d.validation?.schemas?.[method];
  const jobLabel = (status: string) =>
    (
      ({
        pending: "Na fila",
        queued: "Na fila",
        running: "Em execução",
        waiting: "Aguardando fornecedor",
        processing: "Processando",
        done: "Concluído",
        completed: "Concluído",
        dead: "Falhou",
        failed: "Falhou",
        retry: "Tentativa agendada",
        budget_blocked: "Limite diário atingido",
      }) as Record<string, string>
    )[status] ?? status;
  return (
    <>
      <div className="provider-grid">
        <section className="panel provider-card">
          <h2>Facebook · Bright Data</h2>
          <div className="query-chips">
            <Tag
              tone={
                ["Healthy", "Configuration valid"].includes(d.status)
                  ? "green"
                  : "amber"
              }
            >
              {(
                {
                  Healthy: "Operacional",
                  "Configuration valid": "Configuração validada",
                  Degraded: "Atenção",
                  Error: "Erro",
                  "Not validated": "Ainda não validado",
                } as Record<string, string>
              )[d.status] ?? d.status}
            </Tag>
            <Tag>
              {setup.apiKeyConfigured
                ? "API Key configurada"
                : "API Key ausente"}
            </Tag>
            <Tag>
              {d.pilot ? "PILOTO · coleta manual" : "Agendamento habilitado"}
            </Tag>
          </div>
          <p>
            Palavra-chave com os filtros publicados pelo provider; URL de
            pesquisa para enviar os filtros escolhidos no Facebook. A
            compatibilidade é verificada no contrato da sua conta.
          </p>
          <Button className="btn primary" disabled={busy} onClick={check}>
            <Wifi size={16} /> Validar configuração · sem coleta
          </Button>
          <p className="small-note">
            {d.validation?.message ?? "Configuração ainda não validada."}
          </p>
          <ProviderSetupChecklist
            setup={setup}
            validated={!!d.validation?.ok}
            methods={d.validation?.methods}
            collectionVerified={d.collectionVerified}
            hasMonitor={data.monitors.some((m) => m.provider === "brightdata")}
          />
          <ProviderSchemaSummary health={d.validation} />
          <div className="provider-metrics">
            {[
              ["Última validação", date(d.lastValidation)],
              ["Última busca", date(d.lastSearch as string | null)],
              ["Último sucesso", date(d.lastSuccess)],
              [
                "Coleta real",
                d.collectionVerified
                  ? "Registros recebidos"
                  : "Ainda não testada",
              ],
            ].map(([k, v]) => (
              <span key={k}>
                {k}
                <strong>{v}</strong>
              </span>
            ))}
          </div>
          {d.lastError && <p className="error-box">{d.lastError}</p>}
          <p>
            Localização, horário original e disponibilidade precisam ser
            avaliados nos resultados. Não há garantia de cobertura ou de
            ordenação por recência.
          </p>
          <a
            className="text-action"
            href="https://brightdata.com/cp"
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir conta Bright Data <ExternalLink size={14} />
          </a>
        </section>
        <section className="panel provider-card">
          <h2>Testar uma única consulta</h2>
          <p>
            Os resultados válidos ficam no Radar como baseline. Este teste não
            cria monitor recorrente nem envia alertas.
          </p>
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              setWorking(true);
              setMessage("");
              const f = new FormData(e.currentTarget);
              try {
                if (method === "search_url") {
                  const error = searchUrlError(String(f.get("searchUrl")));
                  if (error) throw new Error(error);
                }
                const r = await api<{
                  status: string;
                  received?: number;
                  candidates?: number;
                  error?: string;
                }>("providers/test", {
                  queryType: method,
                  query: method === "keyword" ? String(f.get("query")) : "",
                  searchUrl:
                    method === "search_url" ? String(f.get("searchUrl")) : null,
                  limit: Number(f.get("limit")),
                  providerFilters: readProviderFilters(f, schema),
                  providerContractFingerprint: schema?.fingerprint,
                });
                setMessage(
                  r.error ??
                    (r.status === "waiting"
                      ? "Coleta iniciada; acompanhe a execução abaixo."
                      : r.candidates
                        ? `Descoberta concluída: ${r.candidates} URLs aguardando detalhes. Nenhuma coleta adicional foi iniciada.`
                        : `Estado: ${jobLabel(r.status)} · recebidos: ${r.received ?? 0}`),
                );
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                await refresh();
                setWorking(false);
              }
            }}
          >
            <Field label="Método" wide>
              <NativeSelect
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
              >
                <Option value="keyword">Palavra-chave</Option>
                <Option value="search_url">URL de pesquisa do Facebook</Option>
              </NativeSelect>
            </Field>
            <Field
              label={
                method === "keyword"
                  ? "Palavra-chave"
                  : "URL original da pesquisa"
              }
              wide
            >
              <Input
                key={method}
                name={method === "keyword" ? "query" : "searchUrl"}
                placeholder={
                  method === "keyword"
                    ? "iPhone 15"
                    : "Cole a URL copiada do Facebook Marketplace"
                }
                type={method === "keyword" ? "text" : "url"}
                defaultValue={method === "keyword" ? "iPhone 15" : ""}
                required
                maxLength={method === "keyword" ? 150 : 4096}
              />
              {method === "search_url" && (
                <p className="small-note">
                  Cole a URL da página de resultados da pesquisa do Marketplace,
                  não o link de um anúncio individual.
                </p>
              )}
            </Field>
            <ProviderFilterFields schema={schema} example />
            <Field label="Máximo de registros">
              <Input
                name="limit"
                type="number"
                min={1}
                max={d.maxRecords}
                defaultValue={Math.min(5, d.maxRecords)}
                required
              />
            </Field>
            <Button
              className="btn primary"
              disabled={
                working ||
                busy ||
                !data.providerConfigured ||
                !schema?.compatible ||
                d.usedToday >= d.maxDailyTriggers
              }
            >
              {working ? <Loader2 className="spin" /> : <Activity size={16} />}
              Executar teste limitado
            </Button>
          </form>
          {!setup.ready && (
            <p className="small-note">
              Complete API Key, dataset e confirmação de uso para habilitar o
              teste.
            </p>
          )}
          <p role="status">{message}</p>
          <div className="provider-metrics">
            <span>
              Disparos reservados hoje
              <strong>
                {d.usedToday}/{d.maxDailyTriggers}
              </strong>
            </span>
            <span>
              Registros por disparo
              <strong>Até {d.maxRecords} resultados</strong>
            </span>
          </div>
          <p className="small-note">
            Limite compartilhado pela credencial; reinicia às {d.budgetReset}. A
            coleta pode consumir créditos. GETs de configuração/progresso não
            são disparos. Telegram:{" "}
            {d.externalAlerts ? "opt-in ativado" : "desativado"}.
          </p>
          {d.usedToday >= d.maxDailyTriggers && (
            <p className="error-box">Limite diário atingido.</p>
          )}
        </section>
      </div>
      <section className="panel provider-card">
        <h2>Qualidade da descoberta real</h2>
        <div className="provider-metrics">
          {[
            ["Anúncios reais observados", d.observed],
            ["Primeiro visto nas últimas 24h", d.last24h],
            ["Registros recebidos", d.received],
            ["Novos / duplicados", `${d.newListings} / ${d.duplicates}`],
            ["Rejeitados", d.rejected],
          ].map(([k, v]) => (
            <span key={k}>
              {k}
              <strong>{v}</strong>
            </span>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                "MÉTODO",
                "OBSERVADOS",
                "PUBLICAÇÃO CONHECIDA",
                "MEDIANA",
                "P75 / P90 / P95",
                "MELHOR / PIOR",
              ].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.methods.map((m) => (
              <TableRow key={m.method}>
                <TableCell>{m.method}</TableCell>
                <TableCell>
                  {m.observed}{" "}
                  <small>
                    {m.baseline} baseline · {m.invalid} datas inválidas
                  </small>
                </TableCell>
                <TableCell>
                  {m.known}/{m.observed} (
                  {m.observed ? Math.round((m.known / m.observed) * 100) : 0}%)
                </TableCell>
                <TableCell>
                  {duration(m.medianSeconds)}
                  <small>
                    {m.samples} amostras · média {duration(m.meanSeconds)}
                  </small>
                </TableCell>
                <TableCell>
                  {duration(m.p75Seconds)} / {duration(m.p90Seconds)} /{" "}
                  {duration(m.p95Seconds)}
                </TableCell>
                <TableCell>
                  {duration(m.bestSeconds)} / {duration(m.worstSeconds)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="small-note">
          Delay por método usa a primeira observação naquele método, com
          publicação válida, fora do baseline. O detalhe do anúncio usa a
          primeira descoberta global. {d.coverage}. Janela: {d.window}.
        </p>
      </section>
      {!!d.candidates?.length && (
        <section className="panel provider-card">
          <h2>URLs aguardando detalhes</h2>
          <p>
            A descoberta retornou links válidos sem título ou detalhes. Esses
            links não recebem score ou alerta e não contam como anúncios
            completos. Nenhuma coleta adicional foi iniciada.
          </p>
          {d.candidates.map((c) => (
            <div className="channel-row" key={c.external_id}>
              <span>
                FACEBOOK · BRIGHT DATA · ID {c.external_id}
                <small>
                  Primeiro visto: {date(c.first_seen_at)} · Último visto:{" "}
                  {date(c.last_seen_at)}
                </small>
              </span>
              <a
                className="text-action"
                href={c.original_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir no Facebook
              </a>
            </div>
          ))}
        </section>
      )}
      <section className="panel provider-jobs">
        <div className="section-heading">
          <h2>Execuções e diagnóstico</h2>
          <Tag>{d.runs.length} execuções reais</Tag>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                "MONITOR / MÉTODO",
                "ESTADO",
                "PEDIDOS / RECEBIDOS",
                "ACEITOS / NOVOS / DUPLICADOS",
                "REJEITADOS",
                "LATÊNCIA / SNAPSHOT",
                "ERROS / QUALIDADE",
              ].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.runs.map((r) => (
              <TableRow key={String(r.id)}>
                <TableCell>
                  {data.monitors.find((m) => m.id === r.monitor_id)?.name ??
                    "Teste manual"}
                  <small>
                    {String(r.query_type)} · {date(String(r.started_at))}
                  </small>
                  {!!r.baseline && <Tag>BASELINE</Tag>}
                  <details>
                    <summary>Filtros solicitados</summary>
                    <pre className="request-snapshot">
                      {JSON.stringify(
                        JSON.parse(String(r.request_snapshot ?? "{}")),
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </TableCell>
                <TableCell>
                  <Tag tone={r.status === "completed" ? "green" : "amber"}>
                    {(
                      {
                        completed: "Concluído",
                        needs_details:
                          "Descoberta concluída · detalhes pendentes",
                        waiting: "Aguardando fornecedor",
                        processing: "Processando",
                        running: "Em execução",
                        retry: "Tentativa agendada",
                        failed: "Falhou",
                        budget_blocked: "Limite diário atingido",
                      } as Record<string, string>
                    )[String(r.status)] ?? String(r.status)}
                  </Tag>
                </TableCell>
                <TableCell>
                  {Number(r.records_requested)} / {Number(r.records_received)}
                  {!!Number(r.candidates_found) && (
                    <small>
                      {Number(r.candidates_found)} URLs sem detalhes
                    </small>
                  )}
                </TableCell>
                <TableCell>
                  {Number(r.accepted)} / {Number(r.new_listings)} /{" "}
                  {Number(r.duplicates)}
                </TableCell>
                <TableCell>{Number(r.rejected)}</TableCell>
                <TableCell>
                  {duration(
                    r.latency_ms === null ? null : Number(r.latency_ms) / 1000,
                  )}
                  <small className="snapshot-id">
                    {String(r.snapshot_id ?? "Sem snapshot")}
                  </small>
                </TableCell>
                <TableCell className="run-errors">
                  {Object.entries(JSON.parse(String(r.errors ?? "{}"))).map(
                    ([k, v]) => (
                      <div key={k}>
                        {k}: {String(v)}
                      </div>
                    ),
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!d.runs.length && (
          <p className="small-note">
            Nenhuma coleta real executada. Valide a configuração e faça um teste
            limitado.
          </p>
        )}
        <h3>Fila local</h3>
        {data.jobs.slice(0, 8).map((j) => (
          <div className="channel-row" key={String(j.id)}>
            <span>
              {data.monitors.find((m) => m.id === j.monitor_id)?.name ??
                "Teste manual"}
            </span>
            <Tag>
              {j.snapshot_id && j.status === "pending"
                ? "Aguardando fornecedor"
                : jobLabel(String(j.status))}
            </Tag>
            <small>{String(j.error ?? "")}</small>
          </div>
        ))}
        <p className="small-note">
          Com a página aberta, apenas jobs já solicitados são acompanhados. O
          worker independente executa a fila sem navegador; no piloto, ele não
          agenda novas coletas reais automaticamente.
        </p>
      </section>
    </>
  );
}
