"use client";
import { Minus, Plus } from "lucide-react";
import { CHANNELS, CHANNEL_LABELS, formatCents, todayIn, type Channel } from "@/core/brick";
import { Field, MoneyInput } from "./ui";

export const MAX_UNITS = 50;

/** One unit being typed: no price means "same as the others". */
export interface UnitDraft {
  purchasePriceCents: number | null;
  sold: boolean;
  salePriceCents: number | null;
  soldAt: string;
  saleChannel: Channel;
  soldTo: string;
  saleFeesCents: number | null;
}
export const blankUnit = (): UnitDraft => ({
  purchasePriceCents: null,
  sold: false,
  salePriceCents: null,
  soldAt: todayIn(),
  saleChannel: "whatsapp",
  soldTo: "",
  saleFeesCents: null,
});
export const resizeUnits = (units: UnitDraft[], n: number) =>
  n <= units.length ? units.slice(0, n) : [...units, ...Array.from({ length: n - units.length }, blankUnit)];

export function unitsPayload(units: UnitDraft[], defaultPriceCents: number | null) {
  return units.map((u) => ({
    purchasePriceCents: u.purchasePriceCents ?? defaultPriceCents,
    ...(u.sold
      ? {
          sale: {
            salePriceCents: u.salePriceCents,
            soldAt: u.soldAt,
            saleChannel: u.saleChannel,
            saleFeesCents: u.saleFeesCents ?? 0,
            soldTo: u.soldTo.trim() || null,
          },
        }
      : {}),
  }));
}
/** Field errors keyed like the API's ("units.1.sale.salePriceCents"). */
export function unitsErrors(units: UnitDraft[]) {
  const errors: Record<string, string> = {};
  units.forEach((u, k) => {
    if (u.sold && !u.salePriceCents) errors[`units.${k}.sale.salePriceCents`] = "Informe o valor da venda.";
  });
  return errors;
}
export function unitsTotals(units: UnitDraft[], defaultPriceCents: number | null) {
  const paid = (u: UnitDraft) => u.purchasePriceCents ?? defaultPriceCents ?? 0;
  const sold = units.filter((u) => u.sold && u.salePriceCents);
  return {
    investedCents: units.reduce((t, u) => t + paid(u), 0),
    sold: sold.length,
    revenueCents: sold.reduce((t, u) => t + u.salePriceCents!, 0),
    profitCents: sold.reduce((t, u) => t + u.salePriceCents! - (u.saleFeesCents ?? 0) - paid(u), 0),
  };
}

export function QuantityInput({
  id,
  value,
  onChange,
  min = 1,
}: {
  id?: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
}) {
  const clamp = (n: number) => Math.min(MAX_UNITS, Math.max(min, Math.round(n) || min));
  return (
    <div className="quantity">
      <button type="button" className="btn btn-icon" aria-label="Menos uma" disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>
        <Minus size={16} />
      </button>
      <input
        id={id}
        className="input"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, ""))))}
      />
      <button type="button" className="btn btn-icon" aria-label="Mais uma" disabled={value >= MAX_UNITS} onClick={() => onChange(clamp(value + 1))}>
        <Plus size={16} />
      </button>
    </div>
  );
}

/** Each unit's paid price and, when already sold, that sale (price, customer, date, channel, fees). */
export function UnitsEditor({
  units,
  onChange,
  defaultPriceCents,
  askingPriceCents,
  purchasedAt,
  errors,
  startAt = 1,
}: {
  units: UnitDraft[];
  onChange: (units: UnitDraft[]) => void;
  defaultPriceCents: number | null;
  askingPriceCents: number | null;
  purchasedAt: string;
  errors: Record<string, string>;
  startAt?: number;
}) {
  const set = (k: number, patch: Partial<UnitDraft>) =>
    onChange(units.map((u, j) => (j === k ? { ...u, ...patch } : u)));
  return (
    <div className="unit-list">
      {units.map((u, k) => {
        const paid = u.purchasePriceCents ?? defaultPriceCents;
        const discount =
          u.sold && askingPriceCents && u.salePriceCents && u.salePriceCents < askingPriceCents
            ? askingPriceCents - u.salePriceCents
            : null;
        const profit = u.sold && u.salePriceCents && paid !== null ? u.salePriceCents - (u.saleFeesCents ?? 0) - paid : null;
        const error = errors[`units.${k}.sale.salePriceCents`];
        return (
          <div key={k} className={`unit-row ${u.sold ? "sold" : ""}`}>
            <div className="unit-head">
              <strong>Unidade {startAt + k}</strong>
              <Field label="Valor pago" className="unit-paid">
                {(id) => (
                  <MoneyInput
                    id={id}
                    value={u.purchasePriceCents}
                    placeholder={defaultPriceCents === null ? "0,00" : (defaultPriceCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    onChange={(v) => set(k, { purchasePriceCents: v })}
                  />
                )}
              </Field>
              <label className="unit-sold">
                <input
                  type="checkbox"
                  checked={u.sold}
                  onChange={(e) =>
                    set(k, {
                      sold: e.target.checked,
                      salePriceCents: u.salePriceCents ?? askingPriceCents,
                      soldAt: u.soldAt < purchasedAt ? purchasedAt : u.soldAt,
                    })
                  }
                />
                Já vendida
              </label>
            </div>
            {u.sold && (
              <div className="form-grid fade-in">
                <Field label="Vendida por" error={error}>
                  {(id) => (
                    <MoneyInput id={id} value={u.salePriceCents} invalid={!!error} onChange={(v) => set(k, { salePriceCents: v })} />
                  )}
                </Field>
                <Field label="Cliente">
                  {(id) => (
                    <input id={id} className="input" placeholder="Opcional" value={u.soldTo} onChange={(e) => set(k, { soldTo: e.target.value })} />
                  )}
                </Field>
                <Field label="Data da venda">
                  {(id) => (
                    <input
                      id={id}
                      type="date"
                      className="input"
                      min={purchasedAt}
                      max={todayIn()}
                      value={u.soldAt}
                      onChange={(e) => set(k, { soldAt: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Onde vendeu">
                  {(id) => (
                    <select id={id} className="select" value={u.saleChannel} onChange={(e) => set(k, { saleChannel: e.target.value as Channel })}>
                      {CHANNELS.map((c) => (
                        <option key={c} value={c}>
                          {CHANNEL_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Taxas da venda" hint="Comissão, maquininha, frete…">
                  {(id) => <MoneyInput id={id} value={u.saleFeesCents} onChange={(v) => set(k, { saleFeesCents: v })} />}
                </Field>
                <div className="unit-result">
                  {discount !== null && <small>Desconto de {formatCents(discount)}</small>}
                  {profit !== null && (
                    <strong className={profit >= 0 ? "profit-pos" : "profit-neg"}>{formatCents(profit, { sign: true })}</strong>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
