"use client";
import { useState } from "react";
import { AlertTriangle, CalendarClock, Check, Undo2 } from "lucide-react";
import { daysBetween, formatCents, todayIn } from "@/core/brick";
import { api, errorText } from "./api";
import { Field, MoneyInput, Photo, Spinner, useToast } from "./ui";
import { QuantityInput } from "./units";
import type { ItemDetail, Receivables } from "./types";

export const MAX_INSTALLMENTS = 36;
const pad = (n: number) => String(n).padStart(2, "0");
/** Same day n months later; the 31st of a short month becomes its last day. */
export function addMonths(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  const year = Math.floor(index / 12),
    month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`;
}
export const shortDate = (d: string) => d.split("-").reverse().join("/");

export interface PlanDraft {
  downPaymentCents: number | null;
  count: number;
  firstDue: string;
  rows: { amountCents: number | null; dueDate: string }[];
}
/** Splits what is left after the down payment into equal installments, a month apart. */
export function splitPlan(priceCents: number | null, plan: Omit<PlanDraft, "rows">): PlanDraft {
  const rest = Math.max(0, (priceCents ?? 0) - (plan.downPaymentCents ?? 0));
  const each = Math.floor(rest / plan.count);
  return {
    ...plan,
    rows: Array.from({ length: plan.count }, (_, k) => ({
      amountCents: k === plan.count - 1 ? rest - each * (plan.count - 1) : each,
      dueDate: addMonths(plan.firstDue, k),
    })),
  };
}
export function newPlan(priceCents: number | null, soldAt: string) {
  return splitPlan(priceCents, { downPaymentCents: null, count: 2, firstDue: addMonths(soldAt, 1) });
}
export function planFromItem(item: ItemDetail): PlanDraft | null {
  const parts = item.installments.filter((p) => p.number > 0);
  if (!parts.length) return null;
  return {
    downPaymentCents: item.installments.find((p) => p.number === 0)?.amountCents ?? null,
    count: parts.length,
    firstDue: parts[0].dueDate,
    rows: parts.map((p) => ({ amountCents: p.amountCents, dueDate: p.dueDate })),
  };
}
export const planPayload = (plan: PlanDraft) => ({
  downPaymentCents: plan.downPaymentCents ?? 0,
  installments: plan.rows.map((r) => ({ amountCents: r.amountCents ?? 0, dueDate: r.dueDate })),
});
/** How far the plan is from the sale price: 0 when it adds up. */
export const planGap = (priceCents: number | null, plan: PlanDraft) =>
  (priceCents ?? 0) - (plan.downPaymentCents ?? 0) - plan.rows.reduce((t, r) => t + (r.amountCents ?? 0), 0);

/** Down payment, number of installments and each installment's value and due date. */
export function PlanEditor({
  priceCents,
  soldAt,
  plan,
  onChange,
}: {
  priceCents: number | null;
  soldAt: string;
  plan: PlanDraft;
  onChange: (plan: PlanDraft) => void;
}) {
  const gap = planGap(priceCents, plan);
  const resplit = (patch: Partial<Omit<PlanDraft, "rows">>) => onChange(splitPlan(priceCents, { ...plan, ...patch }));
  const setRow = (k: number, patch: Partial<PlanDraft["rows"][number]>) =>
    onChange({ ...plan, rows: plan.rows.map((r, j) => (j === k ? { ...r, ...patch } : r)) });
  return (
    <div className="plan fade-in">
      <div className="form-grid">
        <Field label="Entrada" hint="O que o cliente pagou hoje. Pode ser zero.">
          {(id) => <MoneyInput id={id} value={plan.downPaymentCents} onChange={(v) => resplit({ downPaymentCents: v })} />}
        </Field>
        <Field label="Parcelas">
          {(id) => <QuantityInput id={id} value={plan.count} onChange={(n) => resplit({ count: Math.min(MAX_INSTALLMENTS, n) })} />}
        </Field>
        <Field label="1ª parcela vence em" className="full" hint="As outras vencem no mesmo dia dos meses seguintes. Dá para mudar cada uma abaixo.">
          {(id) => (
            <input id={id} type="date" className="input" min={soldAt} value={plan.firstDue} onChange={(e) => e.target.value && resplit({ firstDue: e.target.value })} />
          )}
        </Field>
      </div>
      <div className="plan-rows">
        {plan.rows.map((r, k) => (
          <div key={k} className="plan-row">
            <span className="unit-n">{k + 1}</span>
            <Field label={`Parcela ${k + 1}`}>
              {(id) => <MoneyInput id={id} value={r.amountCents} onChange={(v) => setRow(k, { amountCents: v })} />}
            </Field>
            <Field label="Vence em">
              {(id) => (
                <input id={id} type="date" className="input" min={soldAt} value={r.dueDate} onChange={(e) => e.target.value && setRow(k, { dueDate: e.target.value })} />
              )}
            </Field>
          </div>
        ))}
      </div>
      <p className={`plan-check ${gap ? "bad" : ""}`}>
        {gap === 0 ? (
          <>
            <Check size={15} /> Entrada {formatCents(plan.downPaymentCents ?? 0)} + {plan.count}{" "}
            {plan.count === 1 ? "parcela" : "parcelas"} = {formatCents(priceCents)}
          </>
        ) : (
          <>
            <AlertTriangle size={15} /> {gap > 0 ? `Faltam ${formatCents(gap)}` : `Passou ${formatCents(-gap)}`} para fechar{" "}
            {formatCents(priceCents)}.{" "}
            <button type="button" className="link" onClick={() => resplit({})}>
              Dividir de novo
            </button>
          </>
        )}
      </p>
    </div>
  );
}

export function stateText(p: { state: string; dueDate: string; paidAt: string | null }) {
  const today = todayIn();
  // The year only when it is not this one: "30/10" instead of "30/10/2026".
  const brief = (d: string) => (d.slice(0, 4) === today.slice(0, 4) ? shortDate(d.slice(5)) : shortDate(d));
  if (p.paidAt) return `Recebida em ${brief(p.paidAt)}`;
  if (p.state === "overdue") {
    const late = daysBetween(p.dueDate, today);
    return `Atrasada há ${late} ${late === 1 ? "dia" : "dias"}`;
  }
  if (p.state === "today") return "Vence hoje";
  return `Vence em ${brief(p.dueDate)}`;
}

/** The installments of one sale, with "Recebi" on each open one. */
export function InstallmentsSection({ item, onChange }: { item: ItemDetail; onChange: (item: ItemDetail) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const parts = item.installments;
  if (!parts.some((p) => p.number > 0)) return null;
  const received = parts.filter((p) => p.paidAt).reduce((t, p) => t + p.amountCents, 0);
  const mark = async (id: string, paid: boolean) => {
    setBusy(id);
    try {
      const next = await api<ItemDetail>(`inventory/${encodeURIComponent(item.id)}/installments/${encodeURIComponent(id)}`, {
        body: { paid },
      });
      onChange(next);
      toast({ tone: "success", title: paid ? "Parcela recebida" : "Recebimento desfeito" });
    } catch (e) {
      toast({ tone: "error", title: "Não foi possível concluir", description: errorText(e) });
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="form-section">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h3 className="label" style={{ textTransform: "uppercase", letterSpacing: "0.07em" }}>
          <CalendarClock size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
          Parcelas
        </h3>
      </div>
      <p className="muted" style={{ fontSize: 13.5 }}>
        Recebido {formatCents(received)} de {formatCents(item.salePriceCents)}
        {item.receivableCents ? (
          <>
            {" "}
            · falta <strong style={{ color: "var(--text)" }}>{formatCents(item.receivableCents)}</strong>
          </>
        ) : (
          " · tudo recebido"
        )}
      </p>
      <div className="unit-table">
        {parts.map((p) => (
          <div key={p.id} className={`installment-line ${p.state}`}>
            <span className="unit-n">{p.number === 0 ? "E" : p.number}</span>
            <span className="unit-money">
              <small>{p.number === 0 ? "Entrada" : `Parcela ${p.number}`}</small>
              {formatCents(p.amountCents)}
            </span>
            <span className="installment-state">{stateText(p)}</span>
            {p.number > 0 &&
              (p.paidAt ? (
                <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => mark(p.id, false)} aria-label={`Desfazer recebimento da parcela ${p.number}`}>
                  {busy === p.id ? <Spinner /> : <Undo2 size={15} />}
                </button>
              ) : (
                <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => mark(p.id, true)}>
                  {busy === p.id ? <Spinner /> : <Check size={15} />} Recebi
                </button>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Every open installment, oldest due first, for the Vendas screen. */
export function ReceivablesList({
  data,
  onOpenItem,
  onPaid,
}: {
  data: Receivables;
  onOpenItem: (id: string) => void;
  onPaid: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const mark = async (itemId: string, id: string, paid: boolean) => {
    setBusy(id);
    try {
      await api(`inventory/${encodeURIComponent(itemId)}/installments/${encodeURIComponent(id)}`, { body: { paid } });
      toast({ tone: "success", title: paid ? "Parcela recebida" : "Recebimento desfeito" });
      onPaid();
    } catch (e) {
      toast({ tone: "error", title: "Não foi possível concluir", description: errorText(e) });
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="receivables">
      {data.installments.map((p) => (
        <div key={p.id} className={`receivable-row ${p.state}`}>
          <button className="receivable-item" onClick={() => onOpenItem(p.itemId)}>
            <Photo id={p.coverPhotoId} category={p.category} alt="" />
            <span className="mini-text">
              <strong>{p.name}</strong>
              <small>
                {p.soldTo || "Cliente não informado"} · parcela {p.number} de {p.of}
              </small>
            </span>
          </button>
          <span className="receivable-money">
            <strong>{formatCents(p.amountCents)}</strong>
            <small>{stateText(p)}</small>
          </span>
          {p.paidAt ? (
            <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => mark(p.itemId, p.id, false)} aria-label="Desfazer recebimento">
              {busy === p.id ? <Spinner /> : <Undo2 size={15} />}
            </button>
          ) : (
            <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => mark(p.itemId, p.id, true)}>
              {busy === p.id ? <Spinner /> : <Check size={15} />} Recebi
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
