"use client";
import { useEffect, useRef, useState } from "react";
import { CATEGORY_LABELS, formatCents, type Category, type Summary } from "@/core/brick";
import { CATEGORY_ICONS } from "./ui";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const monthLabel = (key: string, withYear = false) => {
  const [y, m] = key.split("-").map(Number);
  return withYear ? `${MONTHS[m - 1]}/${String(y).slice(2)}` : MONTHS[m - 1];
};
/** Clean axis steps: 1, 2 or 5 × 10ⁿ, in reais. */
function niceTicks(min: number, max: number, count = 4) {
  // Values are cents: a step under R$ 1 would round into repeated ticks.
  const span = Math.max(400, max - min);
  const raw = span / count;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(100, [1, 2, 5, 10].map((f) => f * power).find((s) => s >= raw)!);
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step)
    ticks.push(Math.round(v));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}
const axisMoney = (cents: number) => {
  const reais = cents / 100;
  if (Math.abs(reais) >= 1000)
    return `R$ ${(reais / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${reais.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};
/** Column path: 4px rounded data end, square at the baseline. */
function columnPath(x: number, w: number, base: number, top: number) {
  const up = top < base,
    h = Math.abs(base - top),
    r = Math.min(4, w / 2, h);
  if (h < 0.5) return "";
  return up
    ? `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`
    : `M${x},${base}V${top - r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top - r}V${base}Z`;
}

export function ProfitColumns({ months }: { months: Summary["months"] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = 236,
    pad = { top: 22, right: 8, bottom: 28, left: 64 };
  const values = months.map((m) => m.profitCents);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values, 1));
  const lo = ticks[0],
    hi = ticks[ticks.length - 1];
  const innerW = Math.max(0, width - pad.left - pad.right),
    innerH = height - pad.top - pad.bottom;
  const y = (v: number) => pad.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
  const band = innerW / months.length;
  const colW = Math.min(24, band * 0.56);
  const x = (i: number) => pad.left + band * i + (band - colW) / 2;
  const base = y(0);
  const maxIndex = values.indexOf(Math.max(...values));
  const last = months.length - 1;
  const labeled = new Set([last, ...(values[maxIndex] > 0 ? [maxIndex] : [])]);
  const current = active === null ? null : months[active];
  return (
    <div className={`chart ${active !== null ? "hovering" : ""}`} ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Lucro por mês nos últimos 12 meses">
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "baseline" : "gridline"} x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
              <text className="tick" x={pad.left - 10} y={y(t)} dy="0.32em" textAnchor="end">
                {axisMoney(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) => {
            const top = y(m.profitCents);
            return (
              <path
                key={m.month}
                className={`col ${m.profitCents >= 0 ? "up" : "down loss"} ${active === i ? "active" : ""}`}
                style={{ "--i": i } as React.CSSProperties}
                d={columnPath(x(i), colW, base, top)}
              />
            );
          })}
          {months.map((m, i) =>
            labeled.has(i) && m.profitCents !== 0 ? (
              <text
                key={`l${m.month}`}
                className="value-label"
                x={x(i) + colW / 2}
                y={m.profitCents >= 0 ? y(m.profitCents) - 7 : y(m.profitCents) + 14}
                textAnchor={i === last ? "end" : "middle"}
                dx={i === last ? colW / 2 : 0}
              >
                {axisMoney(m.profitCents)}
              </text>
            ) : null,
          )}
          {months.map((m, i) => (
            <text key={`m${m.month}`} className="tick" x={pad.left + band * i + band / 2} y={height - 8} textAnchor="middle">
              {monthLabel(m.month, i === 0 || m.month.endsWith("-01"))}
            </text>
          ))}
          {months.map((m, i) => (
            <rect
              key={`h${m.month}`}
              className="hit"
              x={pad.left + band * i}
              y={pad.top}
              width={band}
              height={innerH}
              tabIndex={0}
              aria-label={`${monthLabel(m.month, true)}: lucro ${formatCents(m.profitCents)}, ${m.count} vendas`}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
          ))}
        </svg>
      )}
      {current && active !== null && (
        <div className="tooltip" style={{ left: x(active) + colW / 2, top: Math.max(96, Math.min(y(current.profitCents), base)) }}>
          <div className="tt-title">{monthLabel(current.month, true)}</div>
          <div className="tt-row">
            <span>{current.profitCents < 0 ? "Prejuízo" : "Lucro"}</span>
            <strong>{formatCents(current.profitCents)}</strong>
          </div>
          <div className="tt-row">
            <span>Faturamento</span>
            <strong>{formatCents(current.revenueCents)}</strong>
          </div>
          <div className="tt-row">
            <span>Vendas</span>
            <strong>{current.count}</strong>
          </div>
        </div>
      )}
      <table className="sr-only">
        <caption>Lucro por mês</caption>
        <thead>
          <tr>
            <th>Mês</th>
            <th>Lucro</th>
            <th>Faturamento</th>
            <th>Vendas</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <td>{monthLabel(m.month, true)}</td>
              <td>{formatCents(m.profitCents)}</td>
              <td>{formatCents(m.revenueCents)}</td>
              <td>{m.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CategoryBars({ categories }: { categories: Summary["categories"] }) {
  const max = Math.max(1, ...categories.map((c) => Math.abs(c.profitCents)));
  return (
    <div className="bars">
      {categories.slice(0, 6).map((c, i) => {
        const Icon = CATEGORY_ICONS[c.category as Category];
        return (
          <div
            className="bar-row"
            key={c.category}
            title={`${CATEGORY_LABELS[c.category as Category]}: ${formatCents(c.profitCents)} em ${c.count} ${c.count === 1 ? "venda" : "vendas"}`}
          >
            <div className="bar-label">
              <Icon size={15} />
              <span>{CATEGORY_LABELS[c.category as Category]}</span>
            </div>
            <div className="bar-track">
              <div
                className={`bar-fill ${c.profitCents < 0 ? "negative" : ""}`}
                style={{
                  width: `${Math.max(2, (Math.abs(c.profitCents) / max) * 100)}%`,
                  "--i": i,
                } as React.CSSProperties}
              />
            </div>
            <span className="bar-value">{formatCents(c.profitCents, { compact: true })}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 12-point trend in the de-emphasis ink; the current period dot in the series color. */
export function Sparkline({ values, width = 120, height = 36 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values),
    max = Math.max(...values);
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (width - 8) + 4,
    height - 4 - ((v - min) / (max - min || 1)) * (height - 8),
  ]);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="spark" width={width} height={height} aria-hidden="true">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} />
      <circle cx={lx} cy={ly} r={4} />
    </svg>
  );
}

export function GoalMeter({ goal }: { goal: NonNullable<Summary["goal"]> }) {
  const pct = Math.min(100, goal.pct);
  return (
    <div className="meter">
      <div
        className="meter-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(goal.pct)}
        aria-label="Meta de lucro do mês"
      >
        <div className={`meter-fill ${goal.pct >= 100 ? "done" : ""}`} style={{ width: `${Math.max(pct, 1.5)}%` }} />
      </div>
      <div className="meter-row">
        <span>
          <strong>{formatCents(goal.achievedCents)}</strong> de {formatCents(goal.targetCents)}
        </span>
        <strong>{goal.pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</strong>
      </div>
    </div>
  );
}
