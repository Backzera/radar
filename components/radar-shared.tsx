"use client";
import { useState } from "react";
import { Gamepad2, Laptop, Smartphone, Radar } from "lucide-react";
import type { Analysis, Opportunity } from "../core/types";
import type { state } from "../server/service";
export type RadarState = Awaited<ReturnType<typeof state>> & {
  providerConfigured: boolean;
  providerSetup: ReturnType<
    typeof import("@/server/provider-setup").providerSetup
  >;
  telegramConfigured: boolean;
  workerConfigured: boolean;
  diagnostics: Awaited<
    ReturnType<typeof import("@/server/diagnostics").diagnostics>
  >;
};
export const money = (v: number | null | undefined) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(v);
export const pct = (n: number | null) =>
  n === null ? "—" : `${n.toFixed(1).replace(".", ",")}%`;
export const date = (s: string | null) =>
  s ? new Date(s).toLocaleString("pt-BR") : "Não informada";
export const age = (a: Analysis) =>
  a.ageMinutes === null
    ? a.freshness === "invalid"
      ? "Data inválida"
      : "Data desconhecida"
    : a.ageMinutes < 60
      ? `${a.ageMinutes} min`
      : a.ageMinutes < 1440
        ? `${Math.floor(a.ageMinutes / 60)} h`
        : `${Math.floor(a.ageMinutes / 1440)} dias`;
export { duration, availabilityLabel, freshLabels } from "./listing-evidence";
export function FacebookLink({ opportunity: o }: { opportunity: Opportunity }) {
  return o.listing.demo ? null : !o.listing.originalUrl ? (
    <span
      className="facebook-open unavailable-link"
      aria-disabled="true"
      title="URL original não fornecida pelo provider"
    >
      ABRIR NO FACEBOOK · link indisponível
    </span>
  ) : (
    <a
      className="facebook-open"
      href={o.listing.originalUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      ABRIR NO FACEBOOK ↗
    </a>
  );
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    `/api/v1/${path}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const d = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(d.error ?? "Falha na conexão");
  return d;
}
export function ProductIcon({ opportunity: o }: { opportunity: Opportunity }) {
  const [failed, setFailed] = useState(false);
  const c = o.listing.product.category,
    Icon =
      c === "Consoles" ? Gamepad2 : c === "Notebooks" ? Laptop : Smartphone;
  return (
    <div
      className={`product-icon ${c === "Consoles" ? "purple" : c === "Notebooks" ? "sand" : "blue"}`}
    >
      {!o.listing.demo && o.listing.images[0] && !failed ? (
        // Provider URLs are validated in the backend; no image proxy.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={o.listing.images[0]}
          alt={o.listing.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon size={24} strokeWidth={1.5} />
      )}
    </div>
  );
}
export function Tag({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`tag ${tone}`}>{children}</span>;
}
export function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Empty({
  title,
  text,
  icon: Icon,
}: {
  title: string;
  text: string;
  icon: typeof Radar;
}) {
  return (
    <div className="empty-state">
      <Icon size={32} strokeWidth={1.3} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function Stat({
  label,
  value,
  foot,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  foot: string;
  icon: typeof Radar;
  accent?: boolean;
}) {
  return (
    <div className="stat-card">
      <div>
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <strong className={accent ? "lime-text" : ""}>{value}</strong>
      <small>{foot}</small>
    </div>
  );
}
