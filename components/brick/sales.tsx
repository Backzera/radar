"use client";
import { useEffect, useState } from "react";
import { CalendarClock, Download, PackageCheck, Receipt } from "lucide-react";
import {
  CHANNEL_LABELS,
  PERIOD_LABELS,
  formatCents,
  periodRange,
  todayIn,
  type Period,
} from "@/core/brick";
import { useApi } from "./api";
import { PeriodPicker } from "./dashboard";
import { ReceivablesList } from "./installments";
import { CountUp, EmptyState, Photo } from "./ui";
import type { InventorySummary, ItemList, Receivables } from "./types";
import { withBase } from "./base";

const short = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "—";

export function Sales({
  version,
  onOpenItem,
  initialTab,
}: {
  version: number;
  onOpenItem: (id: string) => void;
  initialTab?: string | null;
}) {
  const [tab, setTab] = useState<"vendas" | "receber">(initialTab === "receber" ? "receber" : "vendas");
  const [period, setPeriod] = useState<Period>("month");
  const range = periodRange(period, todayIn());
  const summary = useApi<InventorySummary>(`inventory/summary?period=${period}`);
  const list = useApi<ItemList>(
    `inventory?${new URLSearchParams({
      status: "sold",
      sort: "sold",
      limit: "100",
      ...(period === "all" ? {} : { soldFrom: range.start, soldTo: range.end }),
    })}`,
  );
  const { refresh: refreshSummary } = summary;
  const { refresh: refreshList } = list;
  useEffect(() => {
    if (version) {
      refreshSummary();
      refreshList();
    }
  }, [version, refreshSummary, refreshList]);
  const s = summary.data?.sales;
  const tiles = s
    ? [
        ["Faturamento", <CountUp key="r" value={s.revenueCents} />],
        ["Lucro líquido", <CountUp key="p" value={s.profitCents} />],
        ["Margem média", s.marginPct === null ? "—" : `${s.marginPct.toLocaleString("pt-BR")}%`],
        ["Vendas", String(s.count)],
        ["Ticket médio", s.count ? formatCents(Math.round(s.revenueCents / s.count)) : "—"],
      ]
    : [];
  return (
    <>
      <div className="view-head fade-up">
        <div>
          <h1>Vendas</h1>
          <p>Cada negócio fechado, com o lucro que realmente sobrou.</p>
        </div>
        {tab === "vendas" && (
          <div className="view-actions">
            <PeriodPicker value={period} onChange={setPeriod} />
            <a className="btn" href={withBase("/api/v1/inventory/export.csv")}>
              <Download size={16} /> Planilha
            </a>
          </div>
        )}
      </div>
      <div className="segmented sales-tabs fade-up" role="group" aria-label="Seção">
        <button aria-pressed={tab === "vendas"} onClick={() => setTab("vendas")}>
          <Receipt size={15} /> Vendas
        </button>
        <button aria-pressed={tab === "receber"} onClick={() => setTab("receber")}>
          <CalendarClock size={15} /> A receber
          {summary.data?.receivables.openCount ? <span className="count">{summary.data.receivables.openCount}</span> : null}
        </button>
      </div>
      {tab === "vendas" ? (
        <>
      <div className="summary-strip">
        {s
          ? tiles.map(([label, value], i) => (
              <div key={String(label)} className="card kpi fade-up" style={{ "--i": i } as React.CSSProperties}>
                <div className="kpi-label">{label}</div>
                <div className="kpi-value" style={{ fontSize: 22 }}>
                  {value}
                </div>
              </div>
            ))
          : Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton" style={{ height: 96 }} />)}
      </div>
      <section className="card fade-up" style={{ "--i": 5 } as React.CSSProperties}>
        {!list.data ? (
          <div style={{ display: "grid", gap: 10 }}>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="skeleton" style={{ height: 48 }} />
            ))}
          </div>
        ) : !list.data.items.length ? (
          <EmptyState
            icon={PackageCheck}
            title={`Nenhuma venda em “${PERIOD_LABELS[period].toLowerCase()}”`}
            text="Quando você registrar uma venda num produto do estoque, ela aparece aqui com o lucro calculado."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Canal</th>
                  <th className="num-cell">Venda</th>
                  <th className="num-cell">Investido</th>
                  <th className="num-cell">Lucro</th>
                  <th className="num-cell">Margem</th>
                  <th className="num-cell">Giro</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((item) => (
                  <tr key={item.id} onClick={() => onOpenItem(item.id)}>
                    <td>
                      <div className="product-cell">
                        <Photo id={item.coverPhotoId} category={item.category} alt="" />
                        <button
                          className="btn-ghost"
                          style={{ border: 0, background: "none", padding: 0, textAlign: "left", cursor: "pointer", fontWeight: 560 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenItem(item.id);
                          }}
                        >
                          {item.name}
                        </button>
                      </div>
                    </td>
                    <td>{short(item.soldAt)}</td>
                    <td>{item.soldTo || <span className="muted">—</span>}</td>
                    <td className="muted">{item.saleChannel ? CHANNEL_LABELS[item.saleChannel] : "—"}</td>
                    <td className="num-cell">
                      {formatCents(item.salePriceCents)}
                      {item.installmentCount > 0 && (
                        <small className={item.receivableCents ? "receivable-note" : "muted"} style={{ display: "block" }}>
                          {item.receivableCents
                            ? `${item.installmentCount}x · falta ${formatCents(item.receivableCents)}`
                            : `${item.installmentCount}x · quitado`}
                        </small>
                      )}
                    </td>
                    <td className="num-cell muted">{formatCents(item.figures.investedCents)}</td>
                    <td className={`num-cell ${(item.figures.profitCents ?? 0) >= 0 ? "profit-pos" : "profit-neg"}`}>
                      <strong>{formatCents(item.figures.profitCents, { sign: true })}</strong>
                    </td>
                    <td className="num-cell">
                      {item.figures.marginPct === null ? "—" : `${item.figures.marginPct.toLocaleString("pt-BR")}%`}
                    </td>
                    <td className="num-cell muted">
                      {item.figures.days} {item.figures.days === 1 ? "dia" : "dias"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
        </>
      ) : (
        <ReceivablesPanel version={version} onOpenItem={onOpenItem} onChanged={refreshSummary} />
      )}
    </>
  );
}

const RECEIVABLE_FILTERS = [
  ["open", "Em aberto"],
  ["overdue", "Atrasadas"],
  ["paid", "Recebidas"],
] as const;
function ReceivablesPanel({
  version,
  onOpenItem,
  onChanged,
}: {
  version: number;
  onOpenItem: (id: string) => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<(typeof RECEIVABLE_FILTERS)[number][0]>("open");
  const { data, refresh } = useApi<Receivables>(`inventory/receivables?status=${status}`);
  useEffect(() => {
    if (version) refresh();
  }, [version, refresh]);
  const t = data?.totals;
  return (
    <>
      <div className="summary-strip" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        {t
          ? (
              [
                ["Total a receber", formatCents(t.openCents), `${t.openCount} ${t.openCount === 1 ? "parcela" : "parcelas"}`],
                ["Atrasado", formatCents(t.overdueCents), t.overdueCount ? `${t.overdueCount} vencida(s)` : "nada atrasado"],
                ["Vence este mês", formatCents(t.dueThisMonthCents), ""],
                ["Recebido este mês", formatCents(t.receivedThisMonthCents), ""],
              ] as const
            ).map(([label, value, foot], i) => (
              <div
                key={label}
                className={`card kpi fade-up ${label === "Atrasado" && t.overdueCount ? "kpi-late" : ""}`}
                style={{ "--i": i } as React.CSSProperties}
              >
                <div className="kpi-label">{label}</div>
                <div className="kpi-value" style={{ fontSize: 22 }}>
                  {value}
                </div>
                {foot ? <div className="kpi-foot">{foot}</div> : null}
              </div>
            ))
          : Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 96 }} />)}
      </div>
      <section className="card fade-up" style={{ "--i": 4 } as React.CSSProperties}>
        <div className="chips" role="group" aria-label="Parcelas">
          {RECEIVABLE_FILTERS.map(([value, label]) => (
            <button key={value} className="chip" aria-pressed={status === value} onClick={() => setStatus(value)}>
              {label}
            </button>
          ))}
        </div>
        {!data ? (
          <div style={{ display: "grid", gap: 10 }}>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton" style={{ height: 60 }} />
            ))}
          </div>
        ) : !data.installments.length ? (
          <EmptyState
            icon={CalendarClock}
            title={status === "paid" ? "Nenhuma parcela recebida ainda" : status === "overdue" ? "Nada atrasado" : "Nada a receber"}
            text="Quando você registrar uma venda como “Parcelado (crediário)”, as parcelas aparecem aqui com a data de vencimento."
          />
        ) : (
          <ReceivablesList
            data={data}
            onOpenItem={onOpenItem}
            onPaid={() => {
              refresh();
              onChanged();
            }}
          />
        )}
      </section>
    </>
  );
}
