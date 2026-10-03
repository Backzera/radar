"use client";
import { useEffect, useRef, useState } from "react";
import {
  HandCoins,
  ImagePlus,
  Pencil,
  Plus,
  Receipt,
  Star,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  CATEGORY_LABELS,
  CHANNELS,
  CHANNEL_LABELS,
  CONDITION_LABELS,
  COST_KINDS,
  COST_LABELS,
  STATUSES,
  STATUS_LABELS,
  formatCents,
  todayIn,
  type Channel,
  type CostKind,
  type Status,
} from "@/core/brick";
import { api, errorText, fieldErrors, uploadPhoto } from "./api";
import { compressPhoto, confetti } from "./media";
import { Drawer, Field, Modal, MoneyInput, Photo, Spinner, StatusBadge, useToast } from "./ui";
import type { ItemDetail } from "./types";

const dateText = (d: string | null) =>
  d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

function SellModal({
  item,
  open,
  onClose,
  onSold,
}: {
  item: ItemDetail;
  open: boolean;
  onClose: () => void;
  onSold: (item: ItemDetail) => void;
}) {
  const toast = useToast();
  const [price, setPrice] = useState<number | null>(item.salePriceCents ?? item.askingPriceCents);
  const [fees, setFees] = useState<number | null>(item.status === "sold" ? item.saleFeesCents : null);
  const [soldAt, setSoldAt] = useState(item.soldAt ?? todayIn());
  const [channel, setChannel] = useState<Channel>(item.saleChannel ?? item.purchaseChannel);
  const [buyer, setBuyer] = useState(item.soldTo ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const invested = item.figures.investedCents;
  const profit = price === null ? null : price - (fees ?? 0) - invested;
  const submit = async () => {
    if (!price) {
      setErrors({ salePriceCents: "Informe o valor da venda." });
      return;
    }
    setBusy(true);
    try {
      const sold = await api<ItemDetail>(`inventory/${encodeURIComponent(item.id)}/sell`, {
        body: {
          salePriceCents: price,
          saleFeesCents: fees ?? 0,
          soldAt,
          saleChannel: channel,
          soldTo: buyer.trim() || null,
        },
      });
      const rect = button.current?.getBoundingClientRect();
      if ((sold.figures.profitCents ?? 0) > 0)
        confetti(rect ? rect.left + rect.width / 2 : undefined, rect ? rect.top : undefined);
      toast({
        tone: "success",
        title: item.status === "sold" ? "Venda atualizada" : "Venda registrada!",
        description: `Lucro de ${formatCents(sold.figures.profitCents)} em ${sold.figures.days} ${sold.figures.days === 1 ? "dia" : "dias"}.`,
      });
      onSold(sold);
    } catch (error) {
      setErrors(fieldErrors(error));
      toast({ tone: "error", title: "Não foi possível registrar", description: errorText(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item.status === "sold" ? "Editar venda" : "Registrar venda"}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button ref={button} className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <HandCoins size={17} />} Confirmar venda
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Valor da venda" error={errors.salePriceCents}>
          {(id) => <MoneyInput id={id} autoFocus value={price} invalid={!!errors.salePriceCents} onChange={setPrice} />}
        </Field>
        <Field label="Taxas" hint="Comissão, maquininha, frete pago por você.">
          {(id) => <MoneyInput id={id} value={fees} onChange={setFees} />}
        </Field>
        <Field label="Data da venda" error={errors.soldAt}>
          {(id) => (
            <input id={id} type="date" className="input" min={item.purchasedAt} max={todayIn()} value={soldAt} onChange={(e) => setSoldAt(e.target.value)} />
          )}
        </Field>
        <Field label="Onde vendeu">
          {(id) => (
            <select id={id} className="select" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Comprador" className="full" hint="Opcional, para seu controle.">
          {(id) => <input id={id} className="input" value={buyer} onChange={(e) => setBuyer(e.target.value)} />}
        </Field>
      </div>
      <div className={`callout ${profit !== null && profit < 0 ? "loss" : ""}`}>
        <span>
          Investido {formatCents(invested)}
          <br />
          {profit === null ? "Informe o valor para ver o lucro" : profit >= 0 ? "Lucro desta venda" : "Prejuízo desta venda"}
        </span>
        <strong className={profit === null ? "" : profit >= 0 ? "profit-pos" : "profit-neg"}>
          {formatCents(profit, { sign: true })}
        </strong>
      </div>
    </Modal>
  );
}

function CostForm({ item, onAdded }: { item: ItemDetail; onAdded: (i: ItemDetail) => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<CostKind>("repair");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [spentAt, setSpentAt] = useState(todayIn());
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!amount) return toast({ tone: "error", title: "Informe o valor do custo." });
    setBusy(true);
    try {
      onAdded(
        await api<ItemDetail>(`inventory/${encodeURIComponent(item.id)}/costs`, {
          body: { kind, description: description.trim(), amountCents: amount, spentAt },
        }),
      );
      setDescription("");
      setAmount(null);
      toast({ tone: "success", title: "Custo lançado", description: "O lucro já foi recalculado." });
    } catch (error) {
      toast({ tone: "error", title: "Não foi possível lançar", description: errorText(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cost-form fade-in">
      <Field label="Tipo">
        {(id) => (
          <select id={id} className="select" value={kind} onChange={(e) => setKind(e.target.value as CostKind)}>
            {COST_KINDS.map((k) => (
              <option key={k} value={k}>
                {COST_LABELS[k]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Valor">{(id) => <MoneyInput id={id} value={amount} onChange={setAmount} />}</Field>
      <Field label="Descrição">
        {(id) => (
          <input id={id} className="input" placeholder="Ex.: troca de tela" value={description} onChange={(e) => setDescription(e.target.value)} />
        )}
      </Field>
      <Field label="Data">
        {(id) => <input id={id} type="date" className="input" max={todayIn()} value={spentAt} onChange={(e) => setSpentAt(e.target.value)} />}
      </Field>
      <button className="btn btn-sm" style={{ gridColumn: "1 / -1" }} onClick={add} disabled={busy}>
        {busy ? <Spinner /> : <Plus size={15} />} Adicionar custo
      </button>
    </div>
  );
}

export function ItemDetailDrawer({
  id,
  onClose,
  onChanged,
  onEdit,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (item: ItemDetail) => void;
}) {
  const toast = useToast();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState("");
  const [photoIndex, setPhotoIndex] = useState(0);
  const [selling, setSelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addingCost, setAddingCost] = useState(false);
  const [busy, setBusy] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      setItem(null);
      setError("");
      setPhotoIndex(0);
      setAddingCost(false);
    });
    api<ItemDetail>(`inventory/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(setItem)
      .catch((e) => !controller.signal.aborted && setError(errorText(e)));
    return () => controller.abort();
  }, [id]);
  const update = (next: ItemDetail) => {
    setItem(next);
    onChanged();
  };
  const run = async (label: string, action: () => Promise<ItemDetail>, success?: string) => {
    setBusy(label);
    try {
      update(await action());
      if (success) toast({ tone: "success", title: success });
    } catch (e) {
      toast({ tone: "error", title: "Não foi possível concluir", description: errorText(e) });
    } finally {
      setBusy("");
    }
  };
  const addPhotos = async (files: FileList) => {
    if (!item) return;
    let current = item;
    for (const [i, file] of [...files].entries()) {
      setBusy(`Enviando foto ${i + 1} de ${files.length}…`);
      try {
        current = await uploadPhoto<ItemDetail>(current.id, await compressPhoto(file));
        update(current);
      } catch (e) {
        toast({ tone: "error", title: "Foto não enviada", description: errorText(e) });
        break;
      }
    }
    setPhotoIndex(Math.max(0, current.photos.length - 1));
    setBusy("");
  };
  const path = (suffix = "") => `inventory/${encodeURIComponent(item!.id)}${suffix}`;
  const photo = item?.photos[Math.min(photoIndex, Math.max(0, (item?.photos.length ?? 1) - 1))];
  const sold = item?.status === "sold";
  const f = item?.figures;
  return (
    <>
      <Drawer
        open={!!id}
        onClose={onClose}
        wide
        title={item ? "Produto" : "Carregando…"}
        subtitle={item ? `Cadastrado em ${dateText(item.createdAt.slice(0, 10))}` : undefined}
        footer={
          item ? (
            <>
              <button className="btn btn-danger btn-sm" onClick={() => setDeleting(true)}>
                <Trash2 size={15} /> Excluir
              </button>
              <span style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={() => onEdit(item)}>
                <Pencil size={15} /> Editar
              </button>
              {sold ? (
                <button
                  className="btn btn-sm"
                  disabled={!!busy}
                  onClick={() => run("unsell", () => api<ItemDetail>(path("/unsell"), { body: {} }), "Venda desfeita")}
                >
                  <Undo2 size={15} /> Desfazer venda
                </button>
              ) : null}
              <button className="btn btn-primary btn-sm" onClick={() => setSelling(true)}>
                <HandCoins size={16} /> {sold ? "Editar venda" : "Registrar venda"}
              </button>
            </>
          ) : undefined
        }
      >
        {error ? (
          <p>{error}</p>
        ) : !item ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div className="skeleton" style={{ aspectRatio: "16/10" }} />
            <div className="skeleton" style={{ height: 28, width: "60%" }} />
            <div className="skeleton" style={{ height: 90 }} />
          </div>
        ) : (
          <>
            <div className="gallery fade-in">
              <Photo key={photo?.id ?? "none"} id={photo?.id ?? null} category={item.category} alt={item.name} className="gallery-main" />
              <div className="gallery-strip">
                {item.photos.map((p, i) => (
                  <button key={p.id} aria-pressed={p.id === photo?.id} aria-label={`Ver foto ${i + 1}`} onClick={() => setPhotoIndex(i)}>
                    <Photo id={p.id} category={item.category} alt="" />
                  </button>
                ))}
                {item.photos.length < 8 && (
                  <button className="add" aria-label="Adicionar foto" onClick={() => fileInput.current?.click()} disabled={!!busy}>
                    {busy.startsWith("Enviando") ? <Spinner /> : <ImagePlus size={20} />}
                  </button>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) addPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
              {photo && (
                <div className="view-actions">
                  {item.photos[0]?.id !== photo.id && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        run("cover", () => api<ItemDetail>(path(`/photos/${photo.id}/cover`), { body: {} }), "Foto definida como capa").then(() =>
                          setPhotoIndex(0),
                        )
                      }
                    >
                      <Star size={15} /> Usar como capa
                    </button>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      run("photo", () => api<ItemDetail>(path(`/photos/${photo.id}`), { method: "DELETE" }), "Foto removida").then(() =>
                        setPhotoIndex(0),
                      )
                    }
                  >
                    <Trash2 size={15} /> Remover foto
                  </button>
                  {busy && <span className="muted" style={{ fontSize: 13 }}>{busy.includes("…") ? busy : ""}</span>}
                </div>
              )}
            </div>

            <div className="detail-title">
              <h3>{item.name}</h3>
              <div className="badges">
                <StatusBadge status={item.status} />
                <span className="badge">{CATEGORY_LABELS[item.category]}</span>
                <span className="badge">{CONDITION_LABELS[item.condition]}</span>
                {item.identifier && <span className="badge mono">{item.identifier}</span>}
              </div>
            </div>

            <div className="stepper" role="group" aria-label="Etapa do produto">
              {STATUSES.map((s, i) => {
                const current = STATUSES.indexOf(item.status);
                return (
                  <button
                    key={s}
                    className={i < current ? "done" : ""}
                    aria-current={s === item.status ? "step" : undefined}
                    disabled={sold || s === item.status || !!busy}
                    title={s === "sold" ? "Use “Registrar venda”" : `Mover para ${STATUS_LABELS[s]}`}
                    onClick={() =>
                      s === "sold"
                        ? setSelling(true)
                        : run("status", () => api<ItemDetail>(path("/status"), { body: { status: s as Status } }), `Movido para ${STATUS_LABELS[s]}`)
                    }
                  >
                    <span className="step-dot" />
                    {STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>

            <div className="figures">
              {sold && f ? (
                <div className={`figure big ${(f.profitCents ?? 0) < 0 ? "loss" : ""}`}>
                  <div>
                    <small>{(f.profitCents ?? 0) >= 0 ? "Lucro líquido" : "Prejuízo"}</small>
                    <strong className={(f.profitCents ?? 0) >= 0 ? "profit-pos" : "profit-neg"}>
                      {formatCents(f.profitCents, { sign: true })}
                    </strong>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <small>Margem · ROI</small>
                    <strong style={{ fontSize: 16 }}>
                      {pct(f.marginPct)} · {pct(f.roiPct)}
                    </strong>
                  </div>
                </div>
              ) : (
                f && (
                  <div className={`figure big ${(f.expectedProfitCents ?? 0) < 0 ? "loss" : ""}`}>
                    <div>
                      <small>Lucro esperado</small>
                      <strong className={f.expectedProfitCents === null ? "muted" : f.expectedProfitCents >= 0 ? "profit-pos" : "profit-neg"}>
                        {f.expectedProfitCents === null ? "Defina o preço" : formatCents(f.expectedProfitCents, { sign: true })}
                      </strong>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <small>Pedindo</small>
                      <strong style={{ fontSize: 16 }}>{formatCents(item.askingPriceCents)}</strong>
                    </div>
                  </div>
                )
              )}
              <div className="figure">
                <small>Valor pago</small>
                <strong>{formatCents(item.purchasePriceCents)}</strong>
              </div>
              <div className="figure">
                <small>Custos extras</small>
                <strong>{formatCents(item.costsCents)}</strong>
              </div>
              <div className="figure">
                <small>Total investido</small>
                <strong>{formatCents(f?.investedCents)}</strong>
              </div>
              {sold && (
                <>
                  <div className="figure">
                    <small>Vendido por</small>
                    <strong>{formatCents(item.salePriceCents)}</strong>
                  </div>
                  <div className="figure">
                    <small>Taxas da venda</small>
                    <strong>{formatCents(item.saleFeesCents)}</strong>
                  </div>
                </>
              )}
              <div className="figure">
                <small>{sold ? "Vendido em" : "Em estoque há"}</small>
                <strong>
                  {f?.days} {f?.days === 1 ? "dia" : "dias"}
                </strong>
              </div>
            </div>

            <section className="form-section">
              <div className="card-head" style={{ marginBottom: 0 }}>
                <h3 className="label" style={{ textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  <Receipt size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
                  Custos extras
                </h3>
                <button className="btn btn-ghost btn-sm" onClick={() => setAddingCost((v) => !v)}>
                  <Plus size={15} /> {addingCost ? "Fechar" : "Lançar custo"}
                </button>
              </div>
              {addingCost && <CostForm item={item} onAdded={update} />}
              {item.costs.length ? (
                <div className="costs">
                  {item.costs.map((c) => (
                    <div className="cost-row" key={c.id}>
                      <div className="cost-text">
                        <strong>{COST_LABELS[c.kind as CostKind]}</strong>
                        <small>
                          {c.description || "Sem descrição"} · {dateText(c.spentAt)}
                        </small>
                      </div>
                      <strong className="num">{formatCents(c.amountCents)}</strong>
                      <button
                        className="btn btn-ghost btn-icon"
                        aria-label="Remover custo"
                        onClick={() => run("cost", () => api<ItemDetail>(path(`/costs/${c.id}`), { method: "DELETE" }), "Custo removido")}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                !addingCost && <p className="muted" style={{ fontSize: 13.5 }}>Nenhum custo extra. Conserto, peças e frete entram aqui.</p>
              )}
            </section>

            <dl className="info-list">
              <div>
                <dt>Comprado em</dt>
                <dd>
                  {dateText(item.purchasedAt)} · {CHANNEL_LABELS[item.purchaseChannel]}
                </dd>
              </div>
              <div>
                <dt>Comprado de</dt>
                <dd>{item.purchaseFrom || "—"}</dd>
              </div>
              {item.brand || item.model ? (
                <div>
                  <dt>Marca e modelo</dt>
                  <dd>{[item.brand, item.model].filter(Boolean).join(" · ")}</dd>
                </div>
              ) : null}
              {sold && (
                <>
                  <div>
                    <dt>Vendido em</dt>
                    <dd>
                      {dateText(item.soldAt)} · {item.saleChannel ? CHANNEL_LABELS[item.saleChannel] : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Comprador</dt>
                    <dd>{item.soldTo || "—"}</dd>
                  </div>
                </>
              )}
            </dl>
            {item.notes && (
              <div>
                <span className="label">Observações</span>
                <p style={{ whiteSpace: "pre-wrap", marginTop: 6, color: "var(--text-2)" }}>{item.notes}</p>
              </div>
            )}
          </>
        )}
      </Drawer>
      {item && selling && (
        <SellModal
          item={item}
          open={selling}
          onClose={() => setSelling(false)}
          onSold={(next) => {
            setSelling(false);
            update(next);
          }}
        />
      )}
      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Excluir produto?"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setDeleting(false)}>
              Cancelar
            </button>
            <button
              className="btn btn-danger"
              disabled={busy === "delete"}
              onClick={async () => {
                setBusy("delete");
                try {
                  await api(path(), { method: "DELETE" });
                  toast({ tone: "success", title: "Produto excluído" });
                  setDeleting(false);
                  onChanged();
                  onClose();
                } catch (e) {
                  toast({ tone: "error", title: "Não foi possível excluir", description: errorText(e) });
                } finally {
                  setBusy("");
                }
              }}
            >
              <Trash2 size={15} /> Excluir de vez
            </button>
          </>
        }
      >
        <p style={{ color: "var(--text-2)" }}>
          {item?.name} será apagado com as fotos e os custos. Isso não pode ser desfeito.
        </p>
      </Modal>
    </>
  );
}
