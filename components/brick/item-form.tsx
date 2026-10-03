"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, ShoppingBag, Sparkles, Tag, Trash2, Wallet } from "lucide-react";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CHANNELS,
  CHANNEL_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  STATUSES,
  STATUS_LABELS,
  formatCents,
  todayIn,
  type Category,
  type Channel,
  type Condition,
} from "@/core/brick";
import { api, errorText, fieldErrors, uploadPhoto } from "./api";
import { compressPhoto } from "./media";
import { Drawer, Field, MoneyInput, Spinner, useToast } from "./ui";
import type { ItemDetail } from "./types";

/** Best guess of category and brand from what the user typed. */
const GUESSES: [RegExp, Category, string | null][] = [
  [/apple\s*watch|galaxy\s*watch|smartwatch|rel[oó]gio|garmin|amazfit/i, "watches", null],
  [/airpods/i, "audio", "Apple"],
  [/ipad/i, "tablets", "Apple"],
  [/macbook|imac|mac\s*mini/i, "computers", "Apple"],
  [/iphone/i, "phones", "Apple"],
  [/galaxy\s*tab|tablet/i, "tablets", null],
  [/galaxy|samsung/i, "phones", "Samsung"],
  [/xiaomi|redmi|poco/i, "phones", "Xiaomi"],
  [/motorola|moto\s*[geg]\d|moto\s*edge/i, "phones", "Motorola"],
  [/ps\s*[1-5]\b|playstation|dualsense/i, "consoles", "Sony"],
  [/xbox/i, "consoles", "Microsoft"],
  [/nintendo|switch/i, "consoles", "Nintendo"],
  [/notebook|laptop|pc\s*gamer|monitor|desktop/i, "computers", null],
  [/jbl|fone|headset|caixa\s*de\s*som|soundbar/i, "audio", null],
  [/c[aâ]mera|gopro|canon|nikon|lente/i, "cameras", null],
  [/bicicleta|\bbike\b/i, "bikes", null],
  [/furadeira|parafusadeira|serra|makita|bosch|esmerilhadeira/i, "tools", null],
  [/geladeira|micro-?ondas|air\s*fryer|fog[aã]o|lava|liquidificador/i, "appliances", null],
  [/sof[aá]|mesa|cadeira|guarda-roupa|rack|estante/i, "furniture", null],
  [/carregador|cabo|capa|pel[ií]cula|controle/i, "accessories", null],
  [/celular|smartphone/i, "phones", null],
];
export function guessFromName(name: string) {
  for (const [pattern, category, brand] of GUESSES)
    if (pattern.test(name)) return { category, brand };
  return null;
}

interface Draft {
  name: string;
  category: Category;
  brand: string;
  model: string;
  condition: Condition;
  identifier: string;
  notes: string;
  status: "in_stock" | "preparing" | "listed" | "reserved";
  purchasePriceCents: number | null;
  purchasedAt: string;
  purchaseChannel: Channel;
  purchaseFrom: string;
  askingPriceCents: number | null;
  sold: boolean;
  salePriceCents: number | null;
  soldAt: string;
  saleChannel: Channel;
  saleFeesCents: number | null;
}
const blank = (): Draft => ({
  name: "",
  category: "phones",
  brand: "",
  model: "",
  condition: "used",
  identifier: "",
  notes: "",
  status: "in_stock",
  purchasePriceCents: null,
  purchasedAt: todayIn(),
  purchaseChannel: "facebook",
  purchaseFrom: "",
  askingPriceCents: null,
  sold: false,
  salePriceCents: null,
  soldAt: todayIn(),
  saleChannel: "facebook",
  saleFeesCents: null,
});
const fromItem = (i: ItemDetail): Draft => ({
  ...blank(),
  name: i.name,
  category: i.category,
  brand: i.brand ?? "",
  model: i.model ?? "",
  condition: i.condition,
  identifier: i.identifier ?? "",
  notes: i.notes,
  status: i.status === "sold" ? "listed" : i.status,
  purchasePriceCents: i.purchasePriceCents,
  purchasedAt: i.purchasedAt,
  purchaseChannel: i.purchaseChannel,
  purchaseFrom: i.purchaseFrom ?? "",
  askingPriceCents: i.askingPriceCents,
});

export function ItemForm({
  open,
  item,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: ItemDetail | null;
  onClose: () => void;
  onSaved: (item: ItemDetail, created: boolean) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(blank);
  const [touchedCategory, setTouchedCategory] = useState(false);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setDraft(item ? fromItem(item) : blank());
      setTouchedCategory(!!item);
      setErrors({});
      setPhotos((old) => {
        old.forEach((p) => URL.revokeObjectURL(p.url));
        return [];
      });
    });
  }, [open, item]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const addFiles = (files: FileList | File[]) => {
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    setPhotos((list) =>
      [...list, ...images.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 8),
    );
  };
  const invested = (draft.purchasePriceCents ?? 0) + (item?.costsCents ?? 0);
  const result = draft.sold
    ? draft.salePriceCents === null
      ? null
      : draft.salePriceCents - (draft.saleFeesCents ?? 0) - invested
    : draft.askingPriceCents === null
      ? null
      : draft.askingPriceCents - invested;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (draft.name.trim().length < 2) local.name = "Dê um nome ao produto.";
    if (draft.purchasePriceCents === null) local.purchasePriceCents = "Informe quanto pagou.";
    if (draft.sold && !draft.salePriceCents) local["sale.salePriceCents"] = "Informe o valor da venda.";
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setErrors({});
    const body = {
      name: draft.name.trim(),
      category: draft.category,
      brand: draft.brand.trim() || null,
      model: draft.model.trim() || null,
      condition: draft.condition,
      identifier: draft.identifier.trim() || null,
      notes: draft.notes,
      purchasePriceCents: draft.purchasePriceCents,
      purchasedAt: draft.purchasedAt,
      purchaseChannel: draft.purchaseChannel,
      purchaseFrom: draft.purchaseFrom.trim() || null,
      askingPriceCents: draft.askingPriceCents,
    };
    try {
      setBusy("Salvando…");
      let saved: ItemDetail;
      if (item) {
        saved = await api<ItemDetail>(`inventory/${encodeURIComponent(item.id)}`, {
          body: {
            ...body,
            ...(item.status === "sold" ? {} : { status: draft.status }),
            expectedVersion: item.version,
          },
        });
      } else {
        saved = await api<ItemDetail>("inventory", {
          body: {
            ...body,
            status: draft.status,
            ...(draft.sold
              ? {
                  sale: {
                    salePriceCents: draft.salePriceCents,
                    soldAt: draft.soldAt,
                    saleChannel: draft.saleChannel,
                    saleFeesCents: draft.saleFeesCents ?? 0,
                  },
                }
              : {}),
          },
        });
        for (let i = 0; i < photos.length; i++) {
          setBusy(`Enviando foto ${i + 1} de ${photos.length}…`);
          try {
            saved = await uploadPhoto<ItemDetail>(saved.id, await compressPhoto(photos[i].file));
          } catch (error) {
            toast({ tone: "error", title: "Uma foto não foi enviada", description: errorText(error) });
          }
        }
      }
      onSaved(saved, !item);
    } catch (error) {
      setErrors(fieldErrors(error));
      toast({ tone: "error", title: "Não foi possível salvar", description: errorText(error) });
    } finally {
      setBusy("");
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={item ? "Editar produto" : "Novo produto"}
      subtitle={item ? item.name : "O que você comprou para revender?"}
      footer={
        <>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" type="submit" form="item-form" disabled={!!busy}>
            {busy ? (
              <>
                <Spinner /> {busy}
              </>
            ) : item ? (
              "Salvar alterações"
            ) : (
              "Cadastrar produto"
            )}
          </button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} style={{ display: "contents" }} noValidate>
        {!item && (
          <section className="form-section">
            <h3>
              <ImagePlus size={15} /> Fotos
            </h3>
            <div
              className={`dropzone ${drag ? "drag" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                addFiles(e.dataTransfer.files);
              }}
            >
              <ImagePlus size={26} />
              <strong>Toque para tirar ou escolher fotos</strong>
              <small>Até 8 fotos. Elas são comprimidas antes do envio.</small>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {photos.length > 0 && (
              <div className="thumbs">
                {photos.map((p, i) => (
                  <div className="thumb" key={p.url}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Foto ${i + 1}`} />
                    {i === 0 && <span className="cover-tag">Capa</span>}
                    <div className="thumb-actions">
                      <span />
                      <button
                        type="button"
                        aria-label={`Remover foto ${i + 1}`}
                        onClick={() =>
                          setPhotos((list) => {
                            URL.revokeObjectURL(list[i].url);
                            return list.filter((_, j) => j !== i);
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="form-section">
          <h3>
            <Tag size={15} /> Produto
          </h3>
          <div className="form-grid">
            <Field label="Nome do produto" className="full" error={errors.name}>
              {(id) => (
                <input
                  id={id}
                  className="input"
                  placeholder="Ex.: iPhone 13 128GB azul"
                  value={draft.name}
                  autoFocus
                  aria-invalid={!!errors.name || undefined}
                  onChange={(e) => {
                    const name = e.target.value;
                    setDraft((d) => {
                      const guess = touchedCategory ? null : guessFromName(name);
                      return {
                        ...d,
                        name,
                        ...(guess ? { category: guess.category, brand: guess.brand ?? d.brand } : {}),
                      };
                    });
                  }}
                />
              )}
            </Field>
            <Field label="Categoria">
              {(id) => (
                <select
                  id={id}
                  className="select"
                  value={draft.category}
                  onChange={(e) => {
                    setTouchedCategory(true);
                    set("category", e.target.value as Category);
                  }}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Estado">
              {(id) => (
                <select
                  id={id}
                  className="select"
                  value={draft.condition}
                  onChange={(e) => set("condition", e.target.value as Condition)}
                >
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABELS[c]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Marca" error={errors.brand}>
              {(id) => (
                <input id={id} className="input" placeholder="Opcional" value={draft.brand} onChange={(e) => set("brand", e.target.value)} />
              )}
            </Field>
            <Field label="Modelo" error={errors.model}>
              {(id) => (
                <input id={id} className="input" placeholder="Opcional" value={draft.model} onChange={(e) => set("model", e.target.value)} />
              )}
            </Field>
            <Field label="IMEI ou número de série" className="full" hint="Ajuda a identificar o aparelho na garantia ou na revenda." error={errors.identifier}>
              {(id) => (
                <input id={id} className="input" placeholder="Opcional" value={draft.identifier} onChange={(e) => set("identifier", e.target.value)} />
              )}
            </Field>
          </div>
        </section>

        <section className="form-section">
          <h3>
            <ShoppingBag size={15} /> Compra
          </h3>
          <div className="form-grid">
            <Field label="Quanto você pagou" error={errors.purchasePriceCents}>
              {(id) => (
                <MoneyInput
                  id={id}
                  value={draft.purchasePriceCents}
                  invalid={!!errors.purchasePriceCents}
                  onChange={(v) => set("purchasePriceCents", v)}
                />
              )}
            </Field>
            <Field label="Data da compra" error={errors.purchasedAt}>
              {(id) => (
                <input
                  id={id}
                  type="date"
                  className="input"
                  max={todayIn()}
                  value={draft.purchasedAt}
                  onChange={(e) => set("purchasedAt", e.target.value)}
                />
              )}
            </Field>
            <Field label="Onde comprou">
              {(id) => (
                <select
                  id={id}
                  className="select"
                  value={draft.purchaseChannel}
                  onChange={(e) => set("purchaseChannel", e.target.value as Channel)}
                >
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABELS[c]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Comprado de" hint="Nome ou apelido do vendedor (opcional)." error={errors.purchaseFrom}>
              {(id) => (
                <input id={id} className="input" placeholder="Opcional" value={draft.purchaseFrom} onChange={(e) => set("purchaseFrom", e.target.value)} />
              )}
            </Field>
          </div>
        </section>

        <section className="form-section">
          <h3>
            <Wallet size={15} /> Revenda
          </h3>
          <div className="form-grid">
            <Field label="Preço que vai pedir" hint="Usado para calcular o lucro esperado." error={errors.askingPriceCents}>
              {(id) => (
                <MoneyInput id={id} value={draft.askingPriceCents} onChange={(v) => set("askingPriceCents", v)} />
              )}
            </Field>
            {!(item?.status === "sold") && (
              <Field label="Etapa">
                {(id) => (
                  <select
                    id={id}
                    className="select"
                    value={draft.status}
                    disabled={draft.sold}
                    onChange={(e) => set("status", e.target.value as Draft["status"])}
                  >
                    {STATUSES.filter((s) => s !== "sold").map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </div>
          {!item && (
            <label className="toggle-row">
              <input type="checkbox" checked={draft.sold} onChange={(e) => set("sold", e.target.checked)} />
              <span>
                <strong>Já vendi este produto</strong>
                <small>Para lançar negócios antigos e ver o histórico completo.</small>
              </span>
            </label>
          )}
          {draft.sold && (
            <div className="form-grid fade-in">
              <Field label="Valor da venda" error={errors["sale.salePriceCents"]}>
                {(id) => (
                  <MoneyInput
                    id={id}
                    value={draft.salePriceCents}
                    invalid={!!errors["sale.salePriceCents"]}
                    onChange={(v) => set("salePriceCents", v)}
                  />
                )}
              </Field>
              <Field label="Data da venda" error={errors["sale.soldAt"]}>
                {(id) => (
                  <input id={id} type="date" className="input" max={todayIn()} value={draft.soldAt} onChange={(e) => set("soldAt", e.target.value)} />
                )}
              </Field>
              <Field label="Onde vendeu">
                {(id) => (
                  <select id={id} className="select" value={draft.saleChannel} onChange={(e) => set("saleChannel", e.target.value as Channel)}>
                    {CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABELS[c]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Taxas da venda" hint="Comissão da plataforma, maquininha…">
                {(id) => <MoneyInput id={id} value={draft.saleFeesCents} onChange={(v) => set("saleFeesCents", v)} />}
              </Field>
            </div>
          )}
          {result !== null && (
            <div className={`callout fade-in ${result < 0 ? "loss" : ""}`}>
              <span>
                <Sparkles size={15} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
                {draft.sold ? "Lucro desta venda" : "Lucro esperado"}
                {item && item.costsCents > 0 ? " (já com os custos extras)" : ""}
              </span>
              <strong className={result >= 0 ? "profit-pos" : "profit-neg"}>
                {formatCents(result, { sign: true })}
              </strong>
            </div>
          )}
        </section>

        <section className="form-section">
          <Field label="Observações" error={errors.notes}>
            {(id) => (
              <textarea
                id={id}
                className="textarea"
                placeholder="Detalhes, defeitos, acessórios que acompanham, saúde da bateria…"
                value={draft.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            )}
          </Field>
        </section>
      </form>
    </Drawer>
  );
}
