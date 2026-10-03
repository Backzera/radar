"use client";
import { useEffect, useState } from "react";
import { Download, PackageCheck } from "lucide-react";
import {
  CHANNEL_LABELS,
  PERIOD_LABELS,
  formatCents,
  periodRange,
  todayIn,
  type Period,
  type Summary,
} from "@/core/brick";
import { useApi } from "./api";
import { PeriodPicker } from "./dashboard";
import { CountUp, EmptyState, Photo } from "./ui";
import type { ItemList } from "./types";

const short = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) : "—";

export function Sales({ version, onOpenItem }: { version: number; onOpenItem: (id: string) => void }) {
  const [period, setPeriod] = useState<Period>("month");
  const range = periodRange(period, todayIn());
  const summary = useApi<Summary>(`inventory/summary?period=${period}`);
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
        <div className="view-actions">
          <PeriodPicker value={period} onChange={setPeriod} />
          <a className="btn" href="/api/v1/inventory/export.csv">
            <Download size={16} /> Planilha
          </a>
        </div>
      </div>
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
                    <td className="muted">{item.saleChannel ? CHANNEL_LABELS[item.saleChannel] : "—"}</td>
                    <td className="num-cell">{formatCents(item.salePriceCents)}</td>
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
  );
}
