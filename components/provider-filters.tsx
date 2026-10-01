"use client";
import type {
  ProviderHealth,
  ProviderMethodSchema,
} from "../providers/contract";
import { Input } from "./ui/input";
import { NativeSelect, NativeSelectOption as Option } from "./ui/native-select";

const labels: Record<string, string> = {
  city: "Cidade",
  radius: "Raio",
  date_listed: "Recência",
  country: "País",
};
const optionLabels: Record<string, string> = {
  "Last 24 hours": "Últimas 24 horas",
  "Last 7 days": "Últimos 7 dias",
  "Last 30 days": "Últimos 30 dias",
  All: "Todas",
};
export function readProviderFilters(
  form: FormData,
  schema?: ProviderMethodSchema,
) {
  return Object.fromEntries(
    (schema?.fields ?? [])
      .filter(
        (f) =>
          f.supported &&
          f.inputEnabled !== false &&
          !["keyword", "url"].includes(f.name),
      )
      .flatMap((f) => {
        const value = form.get(`provider.${f.name}`);
        return value === null || value === ""
          ? []
          : [
              [
                f.name,
                ["number", "integer"].includes(f.type)
                  ? Number(value)
                  : String(value),
              ],
            ];
      }),
  );
}
export function ProviderFilterFields({
  schema,
  initial = {},
  example = false,
}: {
  schema?: ProviderMethodSchema;
  initial?: Record<string, string | number>;
  example?: boolean;
}) {
  if (!schema)
    return (
      <p className="small-note wide">
        Valide a configuração em Fonte de dados para carregar Cidade, Raio,
        Recência e os demais campos publicados pela Bright Data.
      </p>
    );
  return (
    <>
      {!schema.compatible && (
        <p className="error-box wide">
          Contrato incompatível: {schema.issues.join(" ")}
        </p>
      )}
      {schema.fields
        .filter((f) => !["keyword", "url"].includes(f.name))
        .map((f) => {
          const numeric =
            ["number", "integer"].includes(f.type) || f.name === "radius";
          const exampleValue = example
            ? f.name === "city"
              ? "Curitiba"
              : f.name === "radius" &&
                  (f.min ?? 0) <= 40 &&
                  (f.max ?? Infinity) >= 40
                ? 40
                : f.name === "date_listed" &&
                    f.options?.includes("Last 24 hours")
                  ? "Last 24 hours"
                  : ""
            : "";
          const saved = initial[f.name] ?? exampleValue;
          const value =
            f.options && !f.options.some((o) => String(o) === String(saved))
              ? ""
              : saved;
          return (
            <label className="field" key={`${schema.fingerprint}:${f.name}`}>
              <span>
                {labels[f.name] ?? f.name}
                {f.name === "radius" && f.unit ? ` (${f.unit})` : ""}
                {f.required ? " *" : " (opcional)"}
              </span>
              {f.options || f.name === "date_listed" ? (
                <NativeSelect
                  name={`provider.${f.name}`}
                  defaultValue={value}
                  required={f.required}
                  disabled={!f.supported || f.inputEnabled === false}
                >
                  <Option value="">
                    {f.inputEnabled === false
                      ? "Opções não publicadas"
                      : f.required
                        ? "Selecione"
                        : "Sem filtro"}
                  </Option>
                  {f.options?.map((o) => (
                    <Option key={String(o)} value={o}>
                      {optionLabels[String(o)] ?? String(o)}
                      {optionLabels[String(o)] ? ` · ${o}` : ""}
                    </Option>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  name={`provider.${f.name}`}
                  type={numeric ? "number" : "text"}
                  defaultValue={value}
                  required={f.required}
                  disabled={!f.supported || f.inputEnabled === false}
                  min={f.min}
                  max={f.max}
                  step={f.type === "integer" ? 1 : "any"}
                  maxLength={500}
                  placeholder={f.name === "city" ? "Curitiba" : undefined}
                />
              )}
              {f.description && (
                <small className="small-note">{f.description}</small>
              )}
              {f.optionsSource === "account_panel" && (
                <small className="small-note">
                  Last 24 hours confirmado no painel da conta pelo usuário; a
                  metadata não publicou as opções.
                </small>
              )}
              {f.issue && f.inputEnabled === false && (
                <small className="small-note">
                  {f.issue} Este filtro não será enviado. Se necessário, obtenha
                  o schema completo no painel do provider.
                </small>
              )}
              {f.name === "radius" && (
                <small className="small-note">
                  {f.unit
                    ? `Unidade publicada: ${f.unit}.`
                    : "A metadata não informou a unidade; confirme-a no painel antes de preencher."}{" "}
                  {f.min === undefined && f.max === undefined
                    ? "Limites não publicados."
                    : "Limites aplicados conforme a metadata."}{" "}
                  Sem conversão automática.
                </small>
              )}
              {f.name === "city" && (
                <small className="small-note">
                  Cidade solicitada ao provider. Confira a localização retornada
                  em cada anúncio.
                </small>
              )}
              {f.name === "date_listed" && (
                <small className="small-note">
                  Filtro da consulta. Publicação, primeiro visto e discovery
                  delay continuam separados.
                </small>
              )}
              {initial[f.name] !== undefined && value === "" && (
                <small className="error-box">
                  O valor salvo deixou de existir nas opções. Selecione
                  novamente.
                </small>
              )}
            </label>
          );
        })}
      {Object.keys(initial)
        .filter((k) => !schema.fields.some((f) => f.name === k))
        .map((k) => (
          <p className="error-box wide" key={k}>
            O campo salvo {k} não existe no contrato atual. Ao salvar, revise
            sua remoção.
          </p>
        ))}
    </>
  );
}
export function ProviderSchemaSummary({
  health,
}: {
  health?: ProviderHealth | null;
}) {
  const keyword = health?.schemas?.keyword;
  const field = (name: string) => keyword?.fields.find((f) => f.name === name);
  const rows: [string, boolean, string?][] = [
    ["Discover by keyword", health?.methods?.keyword === true],
    ...["city", "radius", "date_listed"].map(
      (name): [string, boolean, string?] => [
        name === "date_listed" ? "Recência / date_listed" : labels[name],
        field(name)?.supported === true,
        field(name)?.optionsSource === "account_panel"
          ? "Campo confirmado; Last 24 hours configurado conforme o painel da conta (enum não publicado)."
          : field(name)?.issue,
      ],
    ),
    ["Discover by URL", health?.methods?.search_url === true],
    ["Collect by URL", health?.methods?.collect_url === true],
  ];
  return (
    <div className="provider-schema">
      <h3>Contrato da última validação</h3>
      {rows.map(([label, ok, issue]) => (
        <p key={label}>
          {ok ? "✓" : "—"} {label}:{" "}
          {ok
            ? issue
              ? issue
              : "Confirmado pela metadata"
            : (issue ?? "Não confirmado")}
        </p>
      ))}
      <p className="small-note">
        Collect by URL: enriquecimento automático desativado. Cada coleta de
        detalhes exigirá uma reserva adicional de orçamento.
      </p>
    </div>
  );
}
