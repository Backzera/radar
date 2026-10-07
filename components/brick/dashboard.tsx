"use client";
import { useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  CalendarClock,
  CircleDollarSign,
  Clock,
  Hourglass,
  PackageCheck,
  Percent,
  Plus,
  Receipt,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  PERIODS,
  PERIOD_LABELS,
  STATUSES,
  STATUS_LABELS,
  formatCents,
  type Period,
} from "@/core/brick";
import { useApi } from "./api";
import { CategoryBars, GoalMeter, ProfitColumns, Sparkline } from "./charts";
import { CountUp, EmptyState, Photo } from "./ui";
import type { InventorySummary, Me } from "./types";

export function Delta({ pct, label = "vs período anterior" }: { pct: number | null; label?: string }) {
  if (pct === null) return null;
  const up = pct >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`delta ${up ? "delta-up" : "delta-down"}`}>
      <Icon size={15} />
      {up ? "+" : ""}
      {pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%<span>{label}</span>
    </span>
  );
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Período">
      {PERIODS.map((p) => (
        <button key={p} aria-pressed={value === p} onClick={() => onChange(p)}>
          {PERIOD_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h >= 5 && h < 12 ? "Bom dia" : h >= 12 && h < 18 ? "Boa tarde" : "Boa noite";
};
const pctText = (v: number | null) =>
  v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

function Kpi({
  icon: Icon,
  label,
  children,
  foot,
  i,
  className = "span-3",
}: {
  icon: typeof Wallet;
  label: string;
  children: React.ReactNode;
  foot?: React.ReactNode;
  i: number;
  className?: string;
}) {
  return (
    <div className={`card kpi hoverable fade-up ${className}`} style={{ "--i": i } as React.CSSProperties}>
      <div className="kpi-label">
        <span className="kpi-icon">
          <Icon size={16} />
        </span>
        {label}
      </div>
      <div className="kpi-value">{children}</div>
      {foot ? <div className="kpi-foot">{foot}</div> : null}
    </div>
  );
}

export function Dashboard({
  me,
  version,
  onOpenItem,
  onNewItem,
  goTo,
}: {
  me: Me;
  version: number;
  onOpenItem: (id: string) => void;
  onNewItem: () => void;
  goTo: (view: string, params?: Record<string, string>) => void;
}) {
  const [period, setPeriod] = useState<Period>("month");
  const { data, loading, error, refresh } = useApi<InventorySummary>(`inventory/summary?period=${period}`);
  useEffect(() => {
    if (version) refresh();
  }, [version, refresh]);
  const firstName = (me.user.name ?? "").split(" ")[0];
  const head = (
    <div className="view-head fade-up">
      <div>
        <h1>
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p>Seu brick em números: o que entrou, o que está parado e quanto sobrou de verdade.</p>
      </div>
      <div className="view-actions">
        <PeriodPicker value={period} onChange={setPeriod} />
        <button className="btn btn-primary hide-mobile" onClick={onNewItem}>
          <Plus size={17} /> Novo produto
        </button>
      </div>
    </div>
  );
  if (!data) {
    return (
      <>
        {head}
        {error ? (
          <div className="card">{error}</div>
        ) : (
          <div className="dash" aria-busy={loading}>
            <div className="skeleton span-8" style={{ height: 210 }} />
            <div className="skeleton span-4" style={{ height: 210 }} />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton span-3" style={{ height: 130 }} />
            ))}
            <div className="skeleton span-8" style={{ height: 300 }} />
            <div className="skeleton span-4" style={{ height: 300 }} />
          </div>
        )}
      </>
    );
  }
  const total = STATUSES.reduce((s, k) => s + data.statusCounts[k], 0);
  if (!total) return <Welcome firstName={firstName} onNewItem={onNewItem} head={head} />;
  const s = data.sales;
  const negative = s.profitCents < 0;
  return (
    <>
      {head}
      <div className="dash">
        <section className="card hero-card span-8 fade-up gradient-border" aria-label="Lucro do período">
          <div className="hero-row">
            <span className="eyebrow">
              <TrendingUp size={15} /> Lucro líquido · {PERIOD_LABELS[period].toLowerCase()}
            </span>
            <Sparkline values={data.months.map((m) => m.profitCents)} />
          </div>
          <div>
            <div className={`hero-value ${negative ? "negative" : ""}`}>
              <CountUp value={s.profitCents} />
            </div>
            <div className="hero-row" style={{ marginTop: 12 }}>
              <Delta pct={s.profitChangePct} />
              <span className="muted">
                {s.count} {s.count === 1 ? "venda" : "vendas"} · {formatCents(s.revenueCents)} vendidos
              </span>
            </div>
          </div>
        </section>
        <section className="card span-4 fade-up" style={{ "--i": 1 } as React.CSSProperties}>
          <div className="card-head">
            <div>
              <h3>Meta do mês</h3>
              <p>Lucro líquido do mês corrente</p>
            </div>
            <Target size={18} className="muted" />
          </div>
          {data.goal ? (
            <>
              <GoalMeter goal={data.goal} />
              <p className="muted" style={{ marginTop: 14, fontSize: 13.5 }}>
                {data.goal.pct >= 100
                  ? "Meta batida! Tudo que entrar agora é lucro extra."
                  : `Faltam ${formatCents(data.goal.targetCents - data.goal.achievedCents)} para bater a meta.`}
              </p>
            </>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <p className="muted" style={{ fontSize: 13.5 }}>
                Defina quanto quer lucrar por mês e acompanhe o progresso aqui.
              </p>
              <button className="btn btn-sm" onClick={() => goTo("conta")}>
                <Target size={15} /> Definir meta
              </button>
            </div>
          )}
        </section>

        <Kpi icon={CircleDollarSign} label="Faturamento" i={2} foot={<Delta pct={s.revenueChangePct} />}>
          <CountUp value={s.revenueCents} />
        </Kpi>
        <Kpi
          icon={Receipt}
          label="Lucro médio por venda"
          i={3}
          foot={`${s.count} ${s.count === 1 ? "venda" : "vendas"} no período`}
        >
          {s.avgProfitCents === null ? "—" : <CountUp value={s.avgProfitCents} />}
        </Kpi>
        <Kpi icon={Percent} label="Margem média" i={4} foot={`ROI de ${pctText(s.roiPct)} sobre o investido`}>
          {pctText(s.marginPct)}
        </Kpi>
        <Kpi icon={Clock} label="Tempo médio de venda" i={5} foot="Da compra até a venda">
          {s.avgDaysToSell === null ? "—" : `${s.avgDaysToSell} ${s.avgDaysToSell === 1 ? "dia" : "dias"}`}
        </Kpi>

        <section className="card span-8 fade-up" style={{ "--i": 6 } as React.CSSProperties}>
          <div className="card-head">
            <div>
              <h3>Lucro por mês</h3>
              <p>Últimos 12 meses · pelo mês da venda</p>
            </div>
          </div>
          <ProfitColumns months={data.months} />
        </section>
        <section className="card span-4 fade-up" style={{ "--i": 7 } as React.CSSProperties}>
          <div className="card-head">
            <div>
              <h3>Lucro por categoria</h3>
              <p>{PERIOD_LABELS[period]}</p>
            </div>
          </div>
          {data.categories.length ? (
            <CategoryBars categories={data.categories} />
          ) : (
            <p className="muted" style={{ fontSize: 13.5 }}>
              Nenhuma venda no período. Quando vender, o lucro aparece aqui separado por categoria.
            </p>
          )}
        </section>

        {data.receivables.openCount > 0 && (
          <section className={`card span-12 fade-up receivable-strip ${data.receivables.overdueCount ? "late" : ""}`} style={{ "--i": 8 } as React.CSSProperties}>
            <div className="card-head">
              <div>
                <h3>A receber no crediário</h3>
                <p>
                  {data.receivables.openCount} {data.receivables.openCount === 1 ? "parcela em aberto" : "parcelas em aberto"} de vendas
                  parceladas
                </p>
              </div>
              <button className="btn btn-sm" onClick={() => goTo("vendas", { aba: "receber" })}>
                <CalendarClock size={15} /> Ver parcelas
              </button>
            </div>
            <div className="receivable-figures">
              <div>
                <small>Total a receber</small>
                <strong>
                  <CountUp value={data.receivables.openCents} />
                </strong>
              </div>
              <div className={data.receivables.overdueCount ? "late" : ""}>
                <small>Atrasado</small>
                <strong>{formatCents(data.receivables.overdueCents)}</strong>
                {data.receivables.overdueCount > 0 && (
                  <span>
                    {data.receivables.overdueCount} {data.receivables.overdueCount === 1 ? "parcela" : "parcelas"}
                  </span>
                )}
              </div>
              <div>
                <small>Vence este mês</small>
                <strong>{formatCents(data.receivables.dueThisMonthCents)}</strong>
              </div>
              <div>
                <small>Recebido este mês</small>
                <strong className="profit-pos">{formatCents(data.receivables.receivedThisMonthCents)}</strong>
              </div>
            </div>
          </section>
        )}
        <section className="card span-4 fade-up" style={{ "--i": 8 } as React.CSSProperties}>
          <div className="card-head">
            <div>
              <h3>Estoque agora</h3>
              <p>{data.stock.count} {data.stock.count === 1 ? "produto" : "produtos"} sem vender</p>
            </div>
            <Boxes size={18} className="muted" />
          </div>
          <div className="figures" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {/* Gross revenue if everything in stock sells at the asking price. */}
            <div className="figure big" style={{ gridColumn: "1 / -1" }}>
              <div>
                <small>Faturamento bruto do estoque</small>
                <strong>
                  <CountUp value={data.stock.askingCents} />
                </strong>
              </div>
              <small className="muted" style={{ textAlign: "right", maxWidth: 130 }}>
                se vender tudo pelo preço pedido
              </small>
            </div>
            <div className="figure">
              <small>Capital investido</small>
              <strong>
                <CountUp value={data.stock.investedCents} />
              </strong>
            </div>
            <div className="figure">
              <small>Lucro esperado</small>
              <strong className={data.stock.expectedProfitCents >= 0 ? "" : "profit-neg"}>
                <CountUp value={data.stock.expectedProfitCents} />
              </strong>
            </div>
          </div>
          {data.stock.withoutAskingPrice > 0 && (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              {data.stock.withoutAskingPrice} sem preço de venda definido ficam fora do faturamento e do lucro esperado.
            </p>
          )}
          <div className="chips" style={{ marginTop: 14, marginBottom: 0, flexWrap: "wrap" }}>
            {STATUSES.filter((st) => st !== "sold").map((st) => (
              <button key={st} className="chip" onClick={() => goTo("estoque", { status: st })}>
                {STATUS_LABELS[st]} <span className="count">{data.statusCounts[st]}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="card span-4 fade-up" style={{ "--i": 9 } as React.CSSProperties}>
          <div className="card-head">
            <div>
              <h3>Parados há mais tempo</h3>
              <p>Produtos que merecem atenção</p>
            </div>
            <Hourglass size={18} className="muted" />
          </div>
          {data.stale.length ? (
            <div className="mini-list">
              {data.stale.map((it) => (
                <button key={it.id} className="mini-item" onClick={() => onOpenItem(it.id)}>
                  <Photo id={it.coverPhotoId} category={it.category} alt="" />
                  <span className="mini-text">
                    <strong>{it.name}</strong>
                    <small>{formatCents(it.investedCents)} investidos</small>
                  </span>
                  <span className="mini-value" style={{ color: "var(--warn)" }}>
                    {it.days} dias
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13.5 }}>
              Nenhum produto parado além do prazo. Bom giro!
            </p>
          )}
        </section>
        <section className="card span-4 fade-up" style={{ "--i": 10 } as React.CSSProperties}>
          <div className="card-head">
            <div>
              <h3>Últimas vendas</h3>
              <p>Lucro de cada negócio</p>
            </div>
            <PackageCheck size={18} className="muted" />
          </div>
          {data.recentSales.length ? (
            <div className="mini-list">
              {data.recentSales.map((it) => (
                <button key={it.id} className="mini-item" onClick={() => onOpenItem(it.id)}>
                  <Photo id={it.coverPhotoId} category={it.category} alt="" />
                  <span className="mini-text">
                    <strong>{it.name}</strong>
                    <small>Vendido por {formatCents(it.salePriceCents)}</small>
                  </span>
                  <span className={`mini-value ${(it.profitCents ?? 0) >= 0 ? "profit-pos" : "profit-neg"}`}>
                    {formatCents(it.profitCents, { sign: true })}
                  </span>
                </button>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => goTo("vendas")}>
                Ver todas as vendas
              </button>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13.5 }}>
              Registre a primeira venda e o lucro aparece aqui na hora.
            </p>
          )}
        </section>
      </div>
    </>
  );
}

function Welcome({
  firstName,
  onNewItem,
  head,
}: {
  firstName: string;
  onNewItem: () => void;
  head: React.ReactNode;
}) {
  return (
    <>
      {head}
      <section className="card welcome fade-up gradient-border">
        <div>
          <span className="badge soon">Primeiros passos</span>
          <h2 style={{ marginTop: 14 }}>
            {firstName ? `${firstName}, ` : ""}vamos colocar seu brick <span className="gradient-text">no controle</span>.
          </h2>
          <p>
            Cadastre o que você comprou e acompanhe cada produto até a venda. O lucro, a margem e o tempo parado
            são calculados sozinhos.
          </p>
          <button className="btn btn-primary btn-lg" onClick={onNewItem}>
            <Plus size={18} /> Cadastrar primeiro produto
          </button>
        </div>
        <ol className="steps">
          <li>
            <div>
              <strong>Cadastre a compra</strong>
              <span>Foto, quanto pagou e onde comprou.</span>
            </div>
          </li>
          <li>
            <div>
              <strong>Lance os custos extras</strong>
              <span>Conserto, peças, frete: tudo entra na conta.</span>
            </div>
          </li>
          <li>
            <div>
              <strong>Registre a venda</strong>
              <span>Veja o lucro real, a margem e em quantos dias girou.</span>
            </div>
          </li>
        </ol>
      </section>
      <div style={{ marginTop: 16 }}>
        <EmptyState
          icon={Wallet}
          title="Seu painel aparece aqui"
          text="Assim que você cadastrar e vender, os números do mês, o gráfico e as metas ganham vida."
        />
      </div>
    </>
  );
}
