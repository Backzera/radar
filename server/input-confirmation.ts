import { z } from "zod";
import type { InputConfirmation } from "../providers/input-confirmation";
import { confirmedHealth } from "../providers/input-confirmation";
import type { ProviderHealth } from "../providers/contract";
import {
  exactNativeFilters,
  publicationDays,
  radiusUnit,
} from "../providers/search-policy";
import { discoveryInput } from "../providers/brightdata-schema";
import { ensureUser } from "./seed";
import { uid, type Database } from "./store";
import { HttpError } from "./security";

const valueSchema = z.union([
  z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[\p{L}\p{N} _.-]+$/u),
  z.number().finite(),
]);
const bodySchema = z
  .object({
    dataset: z.string().regex(/^gd_[a-z0-9]+$/),
    baseFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    oneDayValue: valueSchema.optional(),
    sevenDayValue: valueSchema.optional(),
    radiusUnit: z.enum(["km", "miles", "m"]).optional(),
    confirmed: z.literal(true),
  })
  .strict();
const rowId = (dataset: string) => `input-confirmation:brightdata:${dataset}`;
export async function readInputConfirmation(
  db: Database,
  dataset: string,
): Promise<InputConfirmation | null> {
  const row = await db
    .prepare(
      "SELECT data FROM provider_health WHERE id=? AND user_id='system:provider' AND provider='brightdata' AND kind='input_confirmation'",
    )
    .bind(rowId(dataset))
    .first<{ data: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.data) as InputConfirmation;
  } catch {
    return null;
  }
}

export function inputConfirmationView(
  health: ProviderHealth,
  dataset: string,
  saved: InputConfirmation | null,
) {
  const effective = confirmedHealth(health, dataset, saved);
  const raw = health.schemas?.keyword;
  const current =
    saved?.baseFingerprint === raw?.fingerprint && saved?.dataset === dataset
      ? saved
      : null;
  let input: Record<string, string | number> | null = null;
  let issue: string | null = null;
  try {
    const planned = exactNativeFilters(
      { type: "keyword", keyword: "iphone 13", filters: { city: "Curitiba" } },
      effective.schemas?.keyword,
      10080,
      30,
    );
    input = discoveryInput(effective.schemas?.keyword, planned.query);
  } catch (e) {
    issue = e instanceof Error ? e.message : "Confirme os filtros da fonte.";
  }
  return {
    dataset,
    baseFingerprint: raw?.fingerprint ?? null,
    compatible: raw?.compatible ?? false,
    fields:
      raw?.fields.filter((f) => ["radius", "date_listed"].includes(f.name)) ??
      [],
    confirmation: current,
    stale: !!saved && !current,
    example: {
      requested: {
        keyword: "iphone 13",
        city: "Curitiba",
        days: 7,
        radiusKm: 30,
      },
      input,
      issue,
      paidRequest: false,
    },
  };
}
export type InputConfirmationView = ReturnType<typeof inputConfirmationView>;

export async function saveInputConfirmation(
  db: Database,
  actor: string,
  health: ProviderHealth,
  dataset: string,
  body: unknown,
) {
  const data = bodySchema.parse(body);
  const schema = health.schemas?.keyword;
  if (
    !schema?.compatible ||
    dataset !== data.dataset ||
    schema.fingerprint !== data.baseFingerprint
  )
    throw new HttpError(
      409,
      "A configuração da fonte mudou. Atualize esta tela e confirme novamente os valores do painel.",
    );
  const date = schema.fields.find((f) => f.name === "date_listed");
  const radius = schema.fields.find((f) => f.name === "radius");
  if (
    data.oneDayValue === undefined &&
    data.sevenDayValue === undefined &&
    !data.radiusUnit
  )
    throw new HttpError(422, "Informe ao menos um filtro para confirmar.");
  if (data.oneDayValue !== undefined && data.oneDayValue === data.sevenDayValue)
    throw new HttpError(
      422,
      "24 horas e 7 dias não podem usar o mesmo valor da fonte.",
    );
  for (const [days, value] of [
    [1, data.oneDayValue],
    [7, data.sevenDayValue],
  ] as const) {
    if (value === undefined) continue;
    if (!date?.supported)
      throw new HttpError(
        422,
        "O contrato não permite configurar o período de publicação.",
      );
    const numeric = ["number", "integer"].includes(date.type);
    if (numeric !== (typeof value === "number"))
      throw new HttpError(
        422,
        "O tipo do período não corresponde ao contrato da fonte.",
      );
    if (
      (date.enumPublished || date.optionsSource === "metadata") &&
      !date.options?.includes(value)
    )
      throw new HttpError(
        422,
        "O período informado não está na lista publicada pela fonte. Não é permitido ampliar essa lista.",
      );
    const parsedDays = publicationDays(value);
    if (parsedDays !== null && parsedDays !== days)
      throw new HttpError(
        422,
        `O valor informado não representa ${days === 1 ? "24 horas" : "7 dias"}.`,
      );
  }
  if (
    data.radiusUnit &&
    (!radius?.supported ||
      (radius.unit && radiusUnit(radius.unit) !== data.radiusUnit))
  )
    throw new HttpError(
      422,
      "A unidade informada contradiz o contrato da fonte. Use a unidade publicada, sem substituir.",
    );
  const confirmation: InputConfirmation = {
    id: uid(),
    dataset,
    baseFingerprint: schema.fingerprint,
    ...(data.oneDayValue !== undefined
      ? { oneDayValue: data.oneDayValue }
      : {}),
    ...(data.sevenDayValue !== undefined
      ? { sevenDayValue: data.sevenDayValue }
      : {}),
    ...(data.radiusUnit ? { radiusUnit: data.radiusUnit } : {}),
    confirmedAt: new Date().toISOString(),
  };
  await ensureUser(db, "system:provider");
  await db.batch([
    db
      .prepare(
        "INSERT INTO provider_health(id,user_id,provider,ok,latency_ms,volume,error,checked_at,kind,data) VALUES (?,'system:provider','brightdata',1,0,0,NULL,?,'input_confirmation',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,checked_at=excluded.checked_at",
      )
      .bind(
        rowId(dataset),
        confirmation.confirmedAt,
        JSON.stringify(confirmation),
      ),
    db
      .prepare("INSERT INTO audit_events VALUES (?,?,?,?,?)")
      .bind(
        uid(),
        actor,
        dataset,
        "native_input_confirmation_saved",
        confirmation.confirmedAt,
      ),
  ]);
  return inputConfirmationView(health, dataset, confirmation);
}
