"use client";
import { useEffect, useState } from "react";
import { Boxes, ChevronLeft, ChevronRight, Clock, Plus, Search } from "lucide-react";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CONDITION_LABELS,
  STATUSES,
  STATUS_LABELS,
  formatCents,
} from "@/core/brick";
import { useApi } from "./api";
import { EmptyState, Photo, StatusBadge } from "./ui";
import type { InventoryItem, ItemList } from "./types";

const FILTERS = [
  ["open", "Em aberto"],
  ...STATUSES.filter((s) => s !== "sold").map((s) => [s, STATUS_LABELS[s]]),
  ["sold", "Vendidos"],
  ["", "Todos"],
] as const;
const SORTS = [
  ["recent", "Atualizados recentemente"],
  ["purchased", "Data da compra"],
  ["days", "Mais tempo parado"],
  ["profit", "Maior lucro"],
  ["price", "Maior investimento"],
  ["sold", "Data da venda"],
] as const;

export function ItemCard({
  item,
  staleAfterDays,
  onOpen,
  i,
}: {
  item: InventoryItem;
  staleAfterDays: number;
  onOpen: () => void;
  i: number;
}) {
  const f = item.figures;
  const sold = item.status === "sold";
  const profit = sold ? f.profitCents : f.expectedProfitCents;
  return (
    <button
      className="card hoverable item-card fade-up"
      style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
      onClick={onOpen}
    >
      <Photo id={item.coverPhotoId} category={item.category} alt={item.name} />
      <div className="item-badges">
        <StatusBadge status={item.status} />
        {!sold && (
          <span className={`days-pill ${f.days >= staleAfterDays ? "stale" : ""}`}>
            <Clock size={12} /> {f.days} {f.days === 1 ? "dia" : "dias"}
          </span>
        )}
      </div>
      <div className="item-body">
        <div>
          <h3>{item.name}</h3>
          <div className="item-meta">
            {CATEGORY_LABELS[item.category]} · {CONDITION_LABELS[item.condition]}
          </div>
        </div>
        <div className="item-figures">
          <div>
            <small>{sold ? "Vendido por" : "Investido"}</small>
            <strong>{formatCents(sold ? item.salePriceCents : f.investedCents)}</strong>
          </div>
          <div className="right">
            <small>{sold ? "Lucro" : item.askingPriceCents ? "Lucro esperado" : "Preço de venda"}</small>
            {profit !== null ? (
              <strong className={profit >= 0 ? "profit-pos" : "profit-neg"}>
                {formatCents(profit, { sign: true })}
              </strong>
            ) : (
              <strong className="muted">Defina</strong>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

export function Inventory({
  version,
  initialStatus,
  staleAfterDays,
  onOpenItem,
  onNewItem,
}: {
  version: number;
  initialStatus: string | null;
  staleAfterDays: number;
  onOpenItem: (id: string) => void;
  onNewItem: () => void;
}) {
  const [status, setStatus] = useState(initialStatus ?? "open");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);
  const params = new URLSearchParams({ status, category, q: search, sort, page: String(page), limit: "24" });
  const { data, loading, error, refresh } = useApi<ItemList>(`inventory?${params}`);
  useEffect(() => {
    if (version) refresh();
  }, [version, refresh]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const filtered = !!(search || category);
  return (
    <>
      <div className="view-head fade-up">
        <div>
          <h1>Estoque</h1>
          <p>Tudo que você comprou, em que etapa está e quanto pode render.</p>
        </div>
        <div className="view-actions">
          <button className="btn btn-primary hide-mobile" onClick={onNewItem}>
            <Plus size={17} /> Novo produto
          </button>
        </div>
      </div>
      <div className="toolbar fade-up" style={{ "--i": 1 } as React.CSSProperties}>
        <label className="search">
          <Search size={17} />
          <span className="sr-only">Buscar no estoque</span>
          <input
            className="input"
            placeholder="Buscar por nome, modelo, IMEI…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          className="select"
          aria-label="Categoria"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todas as categorias</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Ordenar" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORTS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="chips fade-up" role="group" aria-label="Etapa" style={{ "--i": 2 } as React.CSSProperties}>
        {FILTERS.map(([value, label]) => (
          <button
            key={value || "all"}
            className="chip"
            aria-pressed={status === value}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
          >
            {label}
            {data && (
              <span className="count">
                {value === "" ? data.counts.all : data.counts[value as keyof typeof data.counts]}
              </span>
            )}
          </button>
        ))}
      </div>
      {error ? (
        <div className="card">{error}</div>
      ) : !data ? (
        <div className="grid-items" aria-busy={loading}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : !data.items.length ? (
        <div className="card">
          <EmptyState
            icon={Boxes}
            title={filtered ? "Nada encontrado" : data.counts.all ? "Nenhum produto nesta etapa" : "Seu estoque está vazio"}
            text={
              filtered
                ? "Tente outro termo de busca ou outra categoria."
                : data.counts.all
                  ? "Escolha outra etapa acima para ver seus produtos."
                  : "Cadastre o primeiro produto que você comprou para começar a acompanhar o lucro."
            }
            action={
              !filtered && !data.counts.all ? (
                <button className="btn btn-primary" onClick={onNewItem}>
                  <Plus size={17} /> Cadastrar produto
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="grid-items">
            {data.items.map((item, i) => (
              <ItemCard
                key={item.id}
                item={item}
                i={i}
                staleAfterDays={staleAfterDays}
                onOpen={() => onOpenItem(item.id)}
              />
            ))}
          </div>
          {pages > 1 && (
            <div className="load-more">
              <div className="view-actions">
                <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft size={16} /> Anterior
                </button>
                <span className="muted num" style={{ fontSize: 13 }}>
                  Página {page} de {pages}
                </span>
                <button className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Próxima <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
