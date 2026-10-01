import type { ProviderHealth, ProviderMethodSchema } from "./contract";
import { radiusUnit } from "./search-policy";

export interface InputConfirmation {
  id: string;
  dataset: string;
  baseFingerprint: string;
  oneDayValue?: string | number;
  sevenDayValue?: string | number;
  radiusUnit?: "km" | "miles" | "m";
  confirmedAt: string;
}

/** Confirmation is an operator-owned supplement, not a fabricated remote
 * enum. It is scoped to the dataset AND unmodified upstream fingerprint. */
export function confirmedSchema(
  schema: ProviderMethodSchema | undefined,
  dataset: string,
  c: InputConfirmation | null | undefined,
): ProviderMethodSchema | undefined {
  if (
    !schema ||
    !c ||
    c.dataset !== dataset ||
    c.baseFingerprint !== schema.fingerprint ||
    schema.contract !== "discover_by_keyword"
  )
    return schema;
  const publicationValues: Partial<Record<"1" | "7", string | number>> = {};
  const fields = schema.fields.map((field) => {
    if (!field.supported) return field;
    if (field.name === "date_listed") {
      // Only missing enums can be supplemented. An explicit remote enum wins.
      const published =
        field.enumPublished === true ||
        field.optionsSource === "metadata" ||
        (field.options !== undefined &&
          field.optionsSource !== "account_panel");
      const options = [...(field.options ?? [])];
      for (const [key, value] of [
        ["1", c.oneDayValue],
        ["7", c.sevenDayValue],
      ] as const) {
        if (value === undefined || (published && !options.includes(value)))
          continue;
        if (
          !["text", "string", "select", "enum", "number", "integer"].includes(
            field.type,
          )
        )
          continue;
        if (
          ["number", "integer"].includes(field.type) !==
          (typeof value === "number")
        )
          continue;
        if (!options.includes(value)) options.push(value);
        publicationValues[key] = value;
      }
      if (!Object.keys(publicationValues).length) return field;
      return {
        ...field,
        options,
        inputEnabled: true,
        ...(published
          ? {}
          : { optionsSource: "account_panel" as const, issue: undefined }),
      };
    }
    if (
      field.name === "radius" &&
      !field.unit &&
      c.radiusUnit &&
      radiusUnit(c.radiusUnit)
    )
      return { ...field, unit: c.radiusUnit };
    return field;
  });
  return { ...schema, fields, publicationValues, inputConfirmationId: c.id };
}
export function confirmedHealth(
  health: ProviderHealth,
  dataset: string,
  confirmation: InputConfirmation | null | undefined,
): ProviderHealth {
  const keyword = confirmedSchema(
    health.schemas?.keyword,
    dataset,
    confirmation,
  );
  return {
    ...health,
    ...(keyword ? { schemas: { ...health.schemas, keyword } } : {}),
  };
}
