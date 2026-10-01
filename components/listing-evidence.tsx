import type { Opportunity } from "../core/types";
export const duration = (seconds: number | null) =>
  seconds === null
    ? "Indisponível"
    : seconds < 60
      ? `${Math.round(seconds)}s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m${Math.floor(seconds % 60)}s`
        : seconds < 86400
          ? `${(seconds / 3600).toFixed(1)}h`
          : `${(seconds / 86400).toFixed(1)} dias`;
export const availabilityLabel = {
  active: "Ativo",
  sold: "Vendido",
  removed: "Removido",
  unavailable: "Indisponível",
  unknown: "Disponibilidade não confirmada",
};
export const freshLabels = {
  just_published: "Recém-publicado",
  recent: "Recente",
  old: "Antigo",
  unknown: "Data desconhecida",
  invalid: "Data inválida",
};
const date = (s: string | null) =>
  s ? new Date(s).toLocaleString("pt-BR") : "Não informada";
export function ListingEvidence({
  opportunity: o,
}: {
  opportunity: Opportunity;
}) {
  return (
    <div className="listing-evidence">
      <div className="listing-tags">
        <span className={`tag ${o.listing.demo ? "" : "blue"}`}>
          FACEBOOK · BRIGHT DATA
        </span>
        <span
          className={`tag ${o.listing.availability === "unknown" ? "amber" : ""}`}
        >
          {availabilityLabel[o.listing.availability]}
        </span>
      </div>
      <small>
        Publicado: {date(o.listing.publishedAt)} ·{" "}
        {freshLabels[o.analysis.freshness]}
      </small>
      <small>
        Primeiro visto: {date(o.listing.firstSeenAt)} · Delay:{" "}
        {duration(o.analysis.discoveryDelaySeconds)}
      </small>
      {o.analysis.maxPurchasePrice !== undefined && (
        <small>
          Teto:{" "}
          {new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL",
          }).format(o.analysis.maxPurchasePrice)}{" "}
          · {o.analysis.monitorName}
        </small>
      )}
      {o.analysis.blocked.includes("Fora da janela de oportunidade") && (
        <span className="tag amber">Fora da janela de oportunidade</span>
      )}
      {o.listing.price === null && (
        <span className="tag amber">Preço indisponível</span>
      )}
    </div>
  );
}
