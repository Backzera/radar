"use client";
import { useEffect, useRef, useState } from "react";
import {
  HandCoins,
  ImagePlus,
  Layers,
  Merge,
  Pencil,
  Plus,
  Receipt,
  Split,
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
import {
  InstallmentsSection,
  PlanEditor,
  newPlan,
  planFromItem,
  planGap,
  planPayload,
  splitPlan,
  type PlanDraft,
} from "./installments";
import {
  QuantityInput,
  UnitsEditor,
  blankUnit,
  resizeUnits,
  unitsErrors,
  unitsPayload,
  unitsTotals,
  type UnitDraft,
} from "./units";

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
  const existing = planFromItem(item);
  const [credit, setCredit] = useState(!!existing);
  const [plan, setPlan] = useState<PlanDraft>(() => existing ?? newPlan(price, soldAt));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const invested = item.figures.investedCents;
  const profit = price === null ? null : price - (fees ?? 0) - invested;
  const discount =
    price !== null && item.askingPriceCents && price < item.askingPriceCents ? item.askingPriceCents - price : null;
  const changePrice = (v: number | null) => {
    setPrice(v);
    // A new price splits the installments again over the same plan.
    if (credit) setPlan((p) => splitPlan(v, p));
  };
  const submit = async () => {
    if (!price) {
      setErrors({ salePriceCents: "Informe o valor da venda." });
      return;
    }
    if (credit && planGap(price, plan) !== 0) {
      toast({ tone: "error", title: "As parcelas não fecham", description: "A entrada mais as parcelas precisam somar o valor da venda." });
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
          ...(credit ? { plan: planPayload(plan) } : {}),
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
          {(id) => <MoneyInput id={id} autoFocus value={price} invalid={!!errors.salePriceCents} onChange={changePrice} />}
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
        <Field
          label="Cliente"
          className="full"
          hint={credit ? "No crediário, vale colocar o nome para cobrar as parcelas." : "Quem comprou. Opcional, para seu controle."}
        >
          {(id) => <input id={id} className="input" value={buyer} onChange={(e) => setBuyer(e.target.value)} />}
        </Field>
      </div>
      <div className="segmented pay-mode" role="group" aria-label="Forma de pagamento">
        <button type="button" aria-pressed={!credit} onClick={() => setCredit(false)}>
          À vista
        </button>
        <button
          type="button"
          aria-pressed={credit}
          onClick={() => {
            setCredit(true);
            setPlan((p) => (planGap(price, p) === 0 ? p : splitPlan(price, p)));
          }}
        >
          Parcelado (crediário)
        </button>
      </div>
      {credit && <PlanEditor priceCents={price} soldAt={soldAt} plan={plan} onChange={setPlan} />}
      <div className={`callout ${profit !== null && profit < 0 ? "loss" : ""}`}>
        <span>
          Investido {formatCents(invested)}
          {discount !== null && (
            <>
              {" "}
              · desconto de {formatCents(discount)} ({Math.round((discount / item.askingPriceCents!) * 100)}%) sobre o
              preço pedido
            </>
          )}
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

function AddUnitsModal({
  item,
  open,
  onClose,
  onAdded,
}: {
  item: ItemDetail;
  open: boolean;
  onClose: () => void;
  onAdded: (item: ItemDetail, count: number) => void;
}) {
  const toast = useToast();
  const [price, setPrice] = useState<number | null>(item.purchasePriceCents);
  const [purchasedAt, setPurchasedAt] = useState(todayIn());
  const [units, setUnits] = useState<UnitDraft[]>([blankUnit()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const totals = unitsTotals(units, price);
  const submit = async () => {
    const local = unitsErrors(units);
    if (price === null) local.price = "Informe quanto pagou.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const next = await api<ItemDetail>(`inventory/${encodeURIComponent(item.id)}/units`, {
        body: { purchasedAt, units: unitsPayload(units, price) },
      });
      onAdded(next, units.length);
    } catch (error) {
      setErrors(fieldErrors(error));
      toast({ tone: "error", title: "Não foi possível adicionar", description: errorText(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Adicionar unidades de ${item.name}`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <Plus size={16} />} Adicionar {units.length} {units.length === 1 ? "unidade" : "unidades"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Quantas a mais">
          {(id) => <QuantityInput id={id} value={units.length} onChange={(n) => setUnits(resizeUnits(units, n))} />}
        </Field>
        <Field label="Valor pago por unidade" error={errors.price}>
          {(id) => <MoneyInput id={id} value={price} invalid={!!errors.price} onChange={setPrice} />}
        </Field>
        <Field label="Data da compra" className="full">
          {(id) => (
            <input id={id} type="date" className="input" max={todayIn()} value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />
          )}
        </Field>
      </div>
      <UnitsEditor
        units={units}
        onChange={setUnits}
        defaultPriceCents={price}
        askingPriceCents={item.askingPriceCents}
        purchasedAt={purchasedAt}
        errors={errors}
        startAt={(item.group?.units ?? 1) + 1}
      />
      <p className="muted" style={{ fontSize: 13 }}>
        Investido {formatCents(totals.investedCents)}
        {totals.sold ? ` · ${totals.sold} já vendida(s) por ${formatCents(totals.revenueCents)}` : ""}. Nome, categoria e
        preço pedido vêm deste produto.
      </p>
    </Modal>
  );
}

/** "Você tem 1 outro cadastro, com 4 unidades": units of one product count as one cadastro. */
function similarText(similar: ItemDetail["similar"]) {
  const products = new Set(similar.map((s) => s.groupId ?? s.id)).size;
  const units = similar.length;
  const head = `Você tem ${products} ${products === 1 ? "outro cadastro" : "outros cadastros"}`;
  return units > products ? `${head}, com ${units} unidades no total,` : head;
}

function UnitsSection({
  item,
  busy,
  onOpen,
  onAdd,
  onJoin,
  onLeave,
}: {
  item: ItemDetail;
  busy: boolean;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onJoin: () => void;
  onLeave: () => void;
}) {
  const g = item.group;
  return (
    <section className="form-section">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <h3 className="label" style={{ textTransform: "uppercase", letterSpacing: "0.07em" }}>
          <Layers size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
          {g ? `Unidades deste produto (${g.units})` : "Unidades"}
        </h3>
        <button className="btn btn-ghost btn-sm" onClick={onAdd} disabled={busy}>
          <Plus size={15} /> Adicionar unidades
        </button>
      </div>
      {g ? (
        <>
          <p className="muted" style={{ fontSize: 13.5 }}>
            {g.open} em estoque ({formatCents(g.openInvestedCents)} investidos) · {g.sold}{" "}
            {g.sold === 1 ? "vendida" : "vendidas"} por {formatCents(g.revenueCents)}
            {g.sold ? (
              <>
                {" "}
                · lucro{" "}
                <strong className={g.profitCents >= 0 ? "profit-pos" : "profit-neg"}>{formatCents(g.profitCents, { sign: true })}</strong>
              </>
            ) : null}
          </p>
          <div className="unit-table">
            {g.list.map((u, k) => (
              <button
                key={u.id}
                className="unit-line"
                aria-current={u.id === item.id ? "true" : undefined}
                onClick={() => u.id !== item.id && onOpen(u.id)}
              >
                <span className="unit-n">{k + 1}</span>
                <span className="unit-status">
                  <StatusBadge status={u.status} />
                  {u.soldTo && <small>{u.soldTo}</small>}
                </span>
                <span className="unit-money">
                  <small>Pago</small>
                  {formatCents(u.purchasePriceCents)}
                </span>
                <span className="unit-money">
                  <small>{u.status === "sold" ? "Vendida por" : "Pedindo"}</small>
                  {formatCents(u.status === "sold" ? u.salePriceCents : u.askingPriceCents)}
                </span>
                <span className={`unit-money right ${u.profitCents === null ? "" : u.profitCents >= 0 ? "profit-pos" : "profit-neg"}`}>
                  <small>Lucro</small>
                  {u.profitCents === null ? "—" : formatCents(u.profitCents, { sign: true })}
                </span>
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" style={{ justifySelf: "start" }} onClick={onLeave} disabled={busy}>
            <Split size={15} /> Separar esta unidade das outras
          </button>
        </>
      ) : (
        <p className="muted" style={{ fontSize: 13.5 }}>
          Comprou mais de um igual? Adicione as outras unidades: cada uma fica com o seu valor pago e a sua venda.
        </p>
      )}
      {item.similar.length > 0 && (
        <div className="callout">
          <span>
            {similarText(item.similar)} com o mesmo nome. São o mesmo produto?
          </span>
          <button className="btn btn-sm" onClick={onJoin} disabled={busy}>
            <Merge size={15} /> Juntar como unidades
          </button>
        </div>
      )}
    </section>
  );
}

export function ItemDetailDrawer({
  id,
  onClose,
  onChanged,
  onEdit,
  onOpen,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (item: ItemDetail) => void;
  /** Shows another unit of the same product. */
  onOpen: (id: string) => void;
}) {
  const toast = useToast();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState("");
  const [photoIndex, setPhotoIndex] = useState(0);
  const [selling, setSelling] = useState(false);
  const [addingUnits, setAddingUnits] = useState(false);
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
        title={item ? (item.group ? `Unidade ${item.group.position} de ${item.group.units}` : "Produto") : "Carregando…"}
        subtitle={item ? `Cadastrado em ${dateText(todayIn(new Date(item.createdAt)))}` : undefined}
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
              {/* A unit without photos shows the product's cover from another unit. */}
              <Photo
                key={photo?.id ?? "none"}
                id={photo?.id ?? item.group?.coverPhotoId ?? null}
                category={item.category}
                alt={item.name}
                className="gallery-main"
              />
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

            <InstallmentsSection item={item} onChange={update} />

            <UnitsSection
              item={item}
              busy={!!busy}
              onOpen={onOpen}
              onAdd={() => setAddingUnits(true)}
              onJoin={() =>
                run(
                  "join",
                  () => api<ItemDetail>(path("/group"), { body: { ids: item.similar.map((s) => s.id) } }),
                  "Cadastros juntados como unidades",
                )
              }
              onLeave={() =>
                run("leave", () => api<ItemDetail>(path("/group"), { method: "DELETE" }), "Unidade separada; agora é um produto à parte")
              }
            />

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
                    <dt>Cliente</dt>
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
      {item && addingUnits && (
        <AddUnitsModal
          item={item}
          open={addingUnits}
          onClose={() => setAddingUnits(false)}
          onAdded={(next, count) => {
            setAddingUnits(false);
            update(next);
            toast({
              tone: "success",
              title: count === 1 ? "Unidade adicionada" : `${count} unidades adicionadas`,
              description: `Agora são ${next.group?.units ?? count + 1} unidades deste produto.`,
            });
          }}
        />
      )}
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
          {item?.group
            ? `A unidade ${item.group.position} de ${item.name} será apagada com as fotos e os custos dela; as outras ${item.group.units - 1} continuam.`
            : `${item?.name} será apagado com as fotos e os custos.`}{" "}
          Isso não pode ser desfeito.
        </p>
      </Modal>
    </>
  );
}
