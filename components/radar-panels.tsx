"use client";
import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  CircleHelp,
  Clock3,
  ExternalLink,
  Store as Facebook,
  Loader2,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption as Option,
} from "@/components/ui/native-select";
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { Opportunity, Settings } from "@/core/types";
import {
  Empty,
  Field,
  ProductIcon,
  Stat,
  Tag,
  age,
  date,
  freshLabels,
  availabilityLabel,
  duration,
  money,
  pct,
  type RadarState,
} from "./radar-shared";
export { MonitorForm } from "./monitor-form";
export function ListingDetail({
  opportunity: o,
  snapshots,
  feedback,
  busy,
}: {
  opportunity: Opportunity;
  snapshots: {
    price: number | null;
    availability: string;
    observed_at: string;
  }[];
  feedback: (input: unknown) => void;
  busy: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [buy, setBuy] = useState(false),
    [estimate, setEstimate] = useState(true),
    l = o.listing,
    a = o.analysis,
    p = a.pricing;
  return (
    <>
      <SheetHeader>
        <div className="eyebrow">
          <Facebook size={14} />
          FACEBOOK MARKETPLACE <Tag>{"FACEBOOK · BRIGHT DATA"}</Tag>
        </div>
        <SheetTitle>{l.product.model ?? l.title}</SheetTitle>
        <SheetDescription>
          {l.product.storage ? `${l.product.storage} GB · ` : ""}
          {l.product.edition === "digital" ? "Digital · " : ""}
          {l.product.color ?? ""} ·{" "}
          {l.returnedLocation || l.city || "Localização desconhecida"}
        </SheetDescription>
      </SheetHeader>
      <div className="detail-body">
        <div className="detail-hero">
          <div className="detail-product">
            {l.images.length && !imageFailed ? (
              // Provider image URLs are allowlisted; avoid server-side proxying of user content.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={l.images[0]}
                alt={l.title}
                referrerPolicy="no-referrer"
                onError={() => {
                  setImageFailed(true);
                }}
              />
            ) : (
              <>
                <ProductIcon opportunity={o} />
                <span>Fotografia não disponibilizada</span>
              </>
            )}
          </div>
          <p className="small-note">
            Localização solicitada: {a.requestedLocation || "Não informada"} ·
            retornada: {l.returnedLocation || l.city || "Não informada"}.
            Precisão geográfica não garantida.
          </p>
          <div className="detail-price">
            {a.monitorName && (
              <p>
                {a.monitorName} · teto {money(a.maxPurchasePrice ?? null)} ·{" "}
                {a.priceTier === "strong"
                  ? "Compra forte"
                  : a.priceTier === "ultra"
                    ? "Faixa Ultra"
                    : "Regra de compra"}
              </p>
            )}
            <Tag tone={a.freshness === "just_published" ? "green" : ""}>
              {freshLabels[a.freshness]} · {age(a)}
            </Tag>
            <span>Preço anunciado</span>
            <strong>
              {l.price === null ? "Preço indisponível" : money(l.price)}
            </strong>
            <Tag tone={l.availability === "unknown" ? "amber" : ""}>
              {availabilityLabel[l.availability]}
            </Tag>
            <span>Confiança da análise: {a.quality}%</span>
            <div className="score-pair">
              <div>
                <label>OPORTUNIDADE</label>
                <b className="lime-text">
                  {a.score}
                  <small>/100</small>
                </b>
              </div>
              <div>
                <label>RISCO</label>
                <b className={a.risk > 35 ? "amber-text" : ""}>
                  {a.risk}
                  <small>/100</small>
                </b>
              </div>
            </div>
            {!l.originalUrl ? (
              <span className="demo-original" aria-disabled="true">
                Abrir no Facebook indisponível: URL original não fornecida.
              </span>
            ) : (
              <a
                className="btn primary original-link"
                href={l.originalUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir no Facebook <ExternalLink size={15} />
              </a>
            )}
          </div>
        </div>
        <div className="detail-facts">
          <span>
            Publicado<strong>{date(l.publishedAt)}</strong>
          </span>
          <span>
            Primeiro visto<strong>{date(l.firstSeenAt)}</strong>
          </span>
          <span>
            Delay de descoberta
            <strong>{duration(a.discoveryDelaySeconds)}</strong>
          </span>
          <span>
            Última observação<strong>{date(l.lastSeenAt)}</strong>
          </span>
          <span>
            Disponibilidade
            <strong>
              {
                {
                  active: "Ativo",
                  sold: "Vendido",
                  removed: "Removido",
                  unavailable: "Indisponível",
                  unknown: "Não confirmada",
                }[l.availability]
              }
            </strong>
          </span>
        </div>
        <section className="detail-section">
          <div className="section-heading">
            <h2>Potencial de revenda</h2>
            <button
              className="text-action"
              onClick={() => setEstimate(!estimate)}
            >
              {estimate ? "Ocultar cálculo" : "Ver cálculo"}{" "}
              <CircleHelp size={14} />
            </button>
          </div>
          {p.count < 5 && (
            <p className="small-note">
              Confiança de preço baixa: faltam comparáveis reais suficientes.
            </p>
          )}
          <div className="detail-metrics">
            <span>
              Mercado (mediana)<strong>{money(p.market)}</strong>
            </span>
            <span>
              Venda rápida estimada<strong>{money(p.quickSale)}</strong>
            </span>
            <span>
              Compra recomendada<strong>{money(p.recommendedBuy)}</strong>
            </span>
            <span>
              Lucro líquido estimado
              <strong className="lime-text">{money(a.netProfit)}</strong>
            </span>
          </div>
          {estimate && (
            <div className="estimate-box">
              <p>
                {p.count} comparáveis válidos · confiança {p.confidence}%
              </p>
              <div>
                <span>
                  {p.source === "manual"
                    ? "Venda informada por você"
                    : p.source === "hybrid"
                      ? "Menor estimativa: manual / histórico real"
                      : `P25 ${money(p.p25)} × 0,97`}
                </span>
                <span>{money(p.quickSale)}</span>
              </div>
              <div>
                <span>Lucro bruto</span>
                <span>{money(a.grossProfit)}</span>
              </div>
              <div>
                <span>Custos + comissão</span>
                <span>− {money(a.totalCosts)}</span>
              </div>
              <div>
                <span>ROI sobre compra / sobre capital total</span>
                <span>
                  {pct(a.roi)} / {pct(a.capitalRoi)}
                </span>
              </div>
              <small>
                Estimativa a partir de preços anunciados. Não há prazo de venda
                comprovado.{" "}
                {p.calibrated && "Ajustada por suas vendas registradas."}
              </small>
            </div>
          )}
        </section>
        <div className="detail-split">
          <section className="detail-section">
            <h2>Por que recebeu {a.score}?</h2>
            {a.contributions.map((c) => (
              <div className="contribution" key={c.label}>
                <span>{c.label}</span>
                <b className={c.points >= 0 ? "lime-text" : "amber-text"}>
                  {c.points > 0 ? "+" : ""}
                  {c.points}
                </b>
              </div>
            ))}
          </section>
          <section className="detail-section">
            <h2>Qualidade e atenção · {a.quality}%</h2>
            {a.confidenceReasons.map((r) => (
              <p className="small-note" key={r}>
                {r}
              </p>
            ))}
            <div className="quality-line">
              <span>Produto identificado</span>
              <b>{l.product.confidence}%</b>
            </div>
            <div className="quality-line">
              <span>Recência</span>
              <b>{l.publicationConfidence}%</b>
            </div>
            <div className="quality-line">
              <span>Liquidez</span>
              <b>Não estimada</b>
            </div>
            {a.risks.map((r) => (
              <p className="risk-reason" key={r}>
                <AlertTriangle size={14} />
                {r}
              </p>
            ))}
            {a.risks.length === 0 && (
              <p className="risk-reason">
                <ShieldCheck size={15} />
                Sem anomalias detectadas pelas regras locais.
              </p>
            )}
            <p className="small-note">
              Não foi executada análise visual por IA. Risco é sinal de atenção,
              não acusação de fraude.
            </p>
          </section>
        </div>
        <section className="detail-section">
          <h2>Anúncio original</h2>
          <strong className="original-title">{l.title}</strong>
          <p className="description-text">
            {l.description || "Descrição não informada."}
          </p>
          <div className="query-chips">
            {l.product.batteryHealth !== null && (
              <Tag>Bateria {l.product.batteryHealth}%</Tag>
            )}
            {l.product.box !== null && (
              <Tag>{l.product.box ? "Com caixa" : "Sem caixa"}</Tag>
            )}
            {l.product.charger !== null && (
              <Tag>
                {l.product.charger ? "Com carregador" : "Sem carregador"}
              </Tag>
            )}
            {l.product.faceId && (
              <Tag>
                Face ID:{" "}
                {l.product.faceId === "working"
                  ? "funcionando"
                  : "com problema"}
              </Tag>
            )}
          </div>
        </section>
        <section className="detail-section">
          <h2>Comparáveis</h2>
          <p className="small-note">
            Mesma variante; outliers excluídos. Os preços abaixo são valores
            pedidos.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PRODUTO</TableHead>
                <TableHead>PREÇO</TableHead>
                <TableHead>SIMILARIDADE</TableHead>
                <TableHead>AVALIAÇÃO</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.comparables.slice(0, 15).map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.title}</TableCell>
                  <TableCell>{money(c.price)}</TableCell>
                  <TableCell>{c.similarity}%</TableCell>
                  <TableCell>
                    <Tag tone={c.included ? "green" : "amber"}>
                      {c.included ? "Incluído" : "Excluído"}
                    </Tag>
                    <small>{c.reason}</small>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!p.comparables.length && (
            <p className="small-note">
              Sem comparáveis compatíveis suficientes.
            </p>
          )}
        </section>
        <section className="detail-section">
          <h2>Histórico observado</h2>
          {snapshots.map((s, i) => (
            <div className="timeline-row" key={i}>
              <Clock3 size={14} />
              <span>{date(s.observed_at)}</span>
              <strong>{money(s.price)}</strong>
              <Tag>
                {s.availability === "active" ? "Ativo" : s.availability}
              </Tag>
            </div>
          ))}
        </section>
        <section className="detail-section">
          <h2>Sua decisão</h2>
          {a.blocked.length > 0 && (
            <div className="blocked-reasons">
              {a.blocked.map((b) => (
                <p key={b}>• {b}</p>
              ))}
            </div>
          )}
          <div className="feedback-buttons">
            <Button className="btn primary" onClick={() => setBuy(!buy)}>
              <Wallet size={16} />
              Comprei
            </Button>
            <Button
              className="btn subtle"
              disabled={busy}
              onClick={() => feedback({ listingId: l.id, type: "passed" })}
            >
              Não comprei
            </Button>
            <NativeSelect
              aria-label="Registrar problema"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value)
                  feedback({ listingId: l.id, type: e.target.value });
                e.target.value = "";
              }}
            >
              <Option value="">Sinalizar problema</Option>
              <Option value="false_positive">Falso positivo</Option>
              <Option value="bad_listing">Anúncio ruim</Option>
              <Option value="wrong_price">Preço errado</Option>
              <Option value="wrong_product">Produto identificado errado</Option>
            </NativeSelect>
          </div>
          {buy && (
            <form
              className="form-grid buy-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                feedback({
                  listingId: l.id,
                  type: "bought",
                  paid: Number(f.get("paid")),
                  costs: Number(f.get("costs")),
                  note: String(f.get("note") ?? ""),
                  ...(f.get("boughtAt")
                    ? {
                        boughtAt: new Date(
                          String(f.get("boughtAt")),
                        ).toISOString(),
                      }
                    : {}),
                });
              }}
            >
              <Field label="Preço pago (R$)">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  name="paid"
                  defaultValue={l.price ?? ""}
                  required
                />
              </Field>
              <Field label="Custos reais já incorridos (R$)">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  name="costs"
                  defaultValue={0}
                  required
                />
              </Field>
              <Field label="Data da compra (opcional)">
                <Input type="datetime-local" name="boughtAt" />
              </Field>
              <Field label="Observações" wide>
                <Input name="note" maxLength={500} />
              </Field>
              <Button className="btn primary wide" disabled={busy}>
                Registrar compra
              </Button>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
export function Analytics({ data }: { data: RadarState }) {
  const keys = [
      ...new Set(
        data.opportunities.map((o) => o.listing.product.key).filter(Boolean),
      ),
    ] as string[],
    [key, setKey] = useState(keys[0] ?? "");
  const sample = data.opportunities.filter(
      (o) => o.listing.product.key === key && !o.listing.demo,
    ),
    p = sample[0]?.analysis.pricing;
  const bins = (() => {
    const v = sample
      .map((o) => o.listing.price)
      .filter((p): p is number => p !== null);
    if (!v.length) return [];
    const lo = Math.floor(Math.min(...v) / 100) * 100,
      step = Math.max(100, Math.ceil((Math.max(...v) - lo) / 8 / 100) * 100);
    return Array.from({ length: 8 }, (_, i) => ({
      faixa: String(lo + i * step),
      anuncios: v.filter(
        (x) =>
          x >= lo + i * step &&
          (i === 7 ? x <= lo + (i + 1) * step : x < lo + (i + 1) * step),
      ).length,
    }));
  })();
  return (
    <>
      <div className="analytics-controls">
        <NativeSelect
          aria-label="Produto para análise"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        >
          {keys.map((k) => (
            <Option key={k} value={k}>
              {k.replaceAll("|", " · ").replaceAll("-", "")}
            </Option>
          ))}
        </NativeSelect>

        <Tag>{sample.length} anúncios</Tag>
      </div>
      <div className="stats-grid analytics-stats">
        <Stat
          label="Mediana anunciada"
          value={money(p?.median)}
          icon={TrendingUp}
          foot="Variantes compatíveis"
        />
        <Stat
          label="P25"
          value={money(p?.p25)}
          icon={Activity}
          foot="25º percentil"
        />
        <Stat
          label="P75"
          value={money(p?.p75)}
          icon={Activity}
          foot="75º percentil"
        />
        <Stat
          label="Confiança de preço"
          value={p ? `${p.confidence}%` : "—"}
          icon={ShieldCheck}
          foot={`${p?.count ?? 0} comparáveis válidos`}
        />
      </div>
      <div className="analytics-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Distribuição de preços</h2>
              <p>Contagem por faixa de preço pedido (R$)</p>
            </div>
          </div>
          {bins.length ? (
            <ChartContainer
              config={{ anuncios: { label: "Anúncios", color: "#b4ed70" } }}
              className="price-chart"
            >
              <BarChart data={bins}>
                <CartesianGrid vertical={false} stroke="#283033" />
                <XAxis dataKey="faixa" tickLine={false} axisLine={false} />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={30}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="anuncios"
                  fill="var(--color-anuncios)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <Empty
              icon={TrendingUp}
              title="Sem amostra real ainda"
              text="O histórico será preenchido conforme seus monitores observarem anúncios reais."
            />
          )}
        </section>
        <section className="panel analytics-method">
          <h2>Como interpretar</h2>
          <p>
            A distribuição mostra ofertas observadas, não vendas concluídas.
          </p>
          <dl>
            <dt>Venda rápida</dt>
            <dd>
              P25 × 0,97, ajustado por vendas próprias quando houver ao menos 5
              resultados da mesma variante.
            </dd>
            <dt>Outliers</dt>
            <dd>
              Preços extremos são excluídos por MAD, IQR ou faixa robusta quando
              a dispersão é zero.
            </dd>
            <dt>Liquidez</dt>
            <dd>
              Ainda sem amostra suficiente. Um anúncio desaparecido pode ter
              sido removido, não vendido.
            </dd>
          </dl>
          <Tag tone="green">Nenhuma precisão inventada</Tag>
        </section>
      </div>
    </>
  );
}
export { Providers } from "./provider-panel";
export function SettingsForm({
  settings,
  save,
  busy,
}: {
  settings: Settings;
  save: (s: Settings) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(settings),
    update = (k: keyof Settings, v: string | number) =>
      setDraft((s) => ({ ...s, [k]: v }));
  return (
    <div className="settings-layout">
      <form
        className="panel settings-panel"
        onSubmit={(e) => {
          e.preventDefault();
          save(draft);
        }}
      >
        <h2>Custos por operação</h2>
        <p>Valores usados na estimativa de lucro de todos os anúncios.</p>
        <div className="form-grid">
          {(
            [
              { key: "fuel", label: "Combustível (R$)" },
              { key: "transport", label: "Transporte (R$)" },
              { key: "maintenance", label: "Manutenção (R$)" },
              { key: "cleaning", label: "Limpeza (R$)" },
              { key: "packaging", label: "Embalagem (R$)" },
              { key: "other", label: "Outros custos (R$)" },
              { key: "feePct", label: "Taxa na venda (%)" },
              { key: "commissionPct", label: "Comissão na venda (%)" },
            ] as { key: keyof Settings; label: string }[]
          ).map((f) => (
            <Field key={f.key} label={f.label}>
              <Input
                type="number"
                min="0"
                max={f.key === "feePct" ? 90 : 1000000}
                step="0.01"
                required
                value={draft[f.key]}
                onChange={(e) => update(f.key, Number(e.target.value))}
              />
            </Field>
          ))}
        </div>
        <h2 className="settings-subheading">Estratégia para novos monitores</h2>
        <Field label="Perfil de compra">
          <NativeSelect
            value={draft.profile}
            onChange={(e) => {
              const profile = e.target.value;
              setDraft((s) => ({
                ...s,
                profile,
                ...(profile === "conservative"
                  ? { minRoi: 20, maxRisk: 30, minScore: 75 }
                  : profile === "aggressive"
                    ? { minRoi: 40, maxRisk: 60, minScore: 65 }
                    : profile === "liquidation"
                      ? { minRoi: 12, maxRisk: 25, minScore: 65 }
                      : { minRoi: 20, maxRisk: 35, minScore: 65 }),
              }));
            }}
          >
            <Option value="balanced">Equilibrado</Option>
            <Option value="conservative">Conservador</Option>
            <Option value="aggressive">Agressivo</Option>
            <Option value="liquidation">Liquidação</Option>
          </NativeSelect>
        </Field>
        <div className="form-grid settings-numbers">
          {(
            [
              { key: "minRoi", label: "ROI mínimo (%)", max: 300 },
              { key: "maxRisk", label: "Risco máximo", max: 100 },
              { key: "minScore", label: "Score mínimo", max: 100 },
              {
                key: "cooldownMinutes",
                label: "Cooldown por anúncio (min)",
                max: 1440,
              },
            ] as { key: keyof Settings; label: string; max: number }[]
          ).map((f) => (
            <Field label={f.label} key={f.key}>
              <Input
                type="number"
                min={f.key === "cooldownMinutes" ? 1 : 0}
                max={f.max}
                value={draft[f.key]}
                onChange={(e) => update(f.key, Number(e.target.value))}
              />
            </Field>
          ))}
        </div>
        <p className="small-note">
          Monitores existentes mantêm seus limites próprios. Ajuste cada monitor
          para aplicar uma nova estratégia. Liquidez mínima está nos critérios
          avançados do monitor.
        </p>
        <Button className="btn primary" disabled={busy}>
          {busy && <Loader2 className="spin" />}Salvar configuração
        </Button>
      </form>
      <aside className="panel cost-example">
        <span className="eyebrow">CUSTOS DA SUA OPERAÇÃO</span>
        <h2>Lucro após todos os custos</h2>
        <p>
          Lucro líquido = venda esperada − compra − custos fixos − taxas e
          comissões.
        </p>
        <p>
          ROI = lucro líquido ÷ preço de compra. Os valores aparecem quando
          houver um anúncio com preço confiável e uma estimativa de venda.
        </p>
        <p>
          Nenhum preço de compra ou venda é preenchido automaticamente nesta
          área.
        </p>
      </aside>
    </div>
  );
}
