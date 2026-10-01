"use client";
import { useState } from "react";
import type { Bootstrap } from "../../server/bootstrap";
import { useResource, request, money, errorText } from "./client";
import { ListingDialog } from "./results-feed";
type Stage =
  "interested" | "negotiating" | "bought" | "for_sale" | "sold" | "passed";
const labels: Record<Stage, string> = {
  interested: "Interessado",
  negotiating: "Em negociação",
  bought: "Comprado",
  for_sale: "À venda",
  sold: "Vendido",
  passed: "Não vou comprar",
};
interface Deal {
  listingId: string;
  title: string;
  price: number | null;
  stage: Stage;
  version: number;
  note: string;
  purchase: {
    paid: number;
    costs: number;
    soldFor: number | null;
    saleFees?: number;
    additionalCosts?: number;
  } | null;
}
export function DealsPanel({
  searches,
  availabilityEnabled,
}: {
  searches: Bootstrap["searches"];
  availabilityEnabled: boolean;
}) {
  const [page, setPage] = useState(1),
    [stage, setStage] = useState(""),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const r = useResource<{
    items: Deal[];
    total: number;
    counts: { stage: Stage; n: number }[];
  }>(`deals?page=${page}&limit=25${stage ? "&stage=" + stage : ""}`);
  async function advance(d: Deal, next: "negotiating" | "for_sale") {
    setBusy(d.listingId);
    setError("");
    try {
      await request("deals/" + encodeURIComponent(d.listingId), {
        stage: next,
        note: d.note,
        expectedVersion: d.version,
      });
      r.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <section>
      <div className="saas-section-head">
        <div>
          <h2>Meus negócios</h2>
          <p>Da primeira conversa ao resultado da venda.</p>
        </div>
        <label>
          Etapa{" "}
          <select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            {Object.entries(labels).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="saas-deal-stages">
        {(
          ["interested", "negotiating", "bought", "for_sale", "sold"] as Stage[]
        ).map((s) => (
          <button
            key={s}
            aria-pressed={stage === s}
            onClick={() => {
              setStage(stage === s ? "" : s);
              setPage(1);
            }}
          >
            <strong>{r.data?.counts.find((c) => c.stage === s)?.n ?? 0}</strong>
            <span>{labels[s]}</span>
          </button>
        ))}
      </div>
      {(error || r.error) && (
        <p className="saas-error" role="alert">
          {error || r.error}
        </p>
      )}
      {r.loading && <p role="status">Carregando seus negócios…</p>}
      {r.data?.items.length === 0 && (
        <div className="saas-empty">
          <h3>O próximo negócio pode começar no radar.</h3>
          <p>
            Abra um anúncio e clique em “Tenho interesse”. Registre a compra e a
            venda somente quando acontecerem.
          </p>
        </div>
      )}
      <div className="saas-search-list">
        {r.data?.items.map((d) => (
          <article key={d.listingId} className="saas-search-card">
            <div className="saas-section-head">
              <h3>{d.title}</h3>
              <span className="saas-badge">{labels[d.stage]}</span>
            </div>
            <p>
              {d.purchase
                ? `Compra registrada: ${money(d.purchase.paid)}`
                : `Preço anunciado: ${money(d.price)}`}
            </p>
            {d.purchase?.soldFor != null && (
              <p>
                <strong>
                  Resultado registrado:{" "}
                  {money(
                    Math.round(
                      (d.purchase.soldFor -
                        d.purchase.paid -
                        d.purchase.costs -
                        (d.purchase.saleFees ?? 0) -
                        (d.purchase.additionalCosts ?? 0)) *
                        100,
                    ) / 100,
                  )}
                </strong>{" "}
                · após os custos informados
              </p>
            )}
            {d.note && <p>{d.note}</p>}
            <div className="saas-actions">
              <button onClick={() => setSelected(d.listingId)}>
                Abrir negócio
              </button>
              {d.stage === "interested" && (
                <button
                  disabled={busy === d.listingId}
                  onClick={() => void advance(d, "negotiating")}
                >
                  Comecei a negociar
                </button>
              )}
              {d.stage === "bought" && (
                <button
                  disabled={busy === d.listingId}
                  onClick={() => void advance(d, "for_sale")}
                >
                  Coloquei à venda
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!!r.data?.total && (
        <div className="saas-pagination">
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </button>
          <span>
            Página {page} de {Math.ceil(r.data.total / 25)}
          </span>
          <button
            disabled={page * 25 >= r.data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </button>
        </div>
      )}
      {selected && (
        <ListingDialog
          id={selected}
          searches={searches}
          availabilityEnabled={availabilityEnabled}
          onClose={() => setSelected("")}
          onChanged={r.refresh}
        />
      )}
    </section>
  );
}
