"use client";
import { useState } from "react";
import type { Monitor, Settings, Costs } from "../core/types";
import type { ProviderHealth } from "../providers/contract";
import { Field } from "./radar-shared";
import { ProviderFilterFields, readProviderFilters } from "./provider-filters";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { NativeSelect, NativeSelectOption as Option } from "./ui/native-select";
export const AGE_OPTIONS = [
  [15, "15 minutos"],
  [30, "30 minutos"],
  [60, "1 hora"],
  [180, "3 horas"],
  [360, "6 horas"],
  [720, "12 horas"],
  [1440, "24 horas"],
  [4320, "3 dias"],
  [10080, "7 dias"],
  [0, "Sem limite"],
] as const;
const COSTS: [keyof Costs, string][] = [
  ["fuel", "Combustível (R$)"],
  ["transport", "Transporte (R$)"],
  ["maintenance", "Manutenção (R$)"],
  ["cleaning", "Limpeza (R$)"],
  ["packaging", "Embalagem (R$)"],
  ["other", "Adicional fixo (R$)"],
  ["feePct", "Taxa sobre venda (%)"],
  ["commissionPct", "Comissão sobre venda (%)"],
];
export function MonitorForm({
  initial,
  providerHealth,
  settings,
  maxRecords = 10,
  dailyBudget = 5,
  pilot = true,
  save,
  busy,
}: {
  initial: Monitor | null;
  providerHealth?: ProviderHealth | null;
  settings?: Settings;
  maxRecords?: number;
  dailyBudget?: number;
  pilot?: boolean;
  save: (value: unknown) => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState(initial?.mode ?? "combined"),
    [method, setMethod] = useState(initial?.queryType ?? "keyword"),
    [customCosts, setCustomCosts] = useState(!!initial?.costs),
    [interval, setInterval] = useState(initial?.intervalSeconds ?? 300);
  const schema = providerHealth?.schemas?.[method];
  const moneyField = (
    name: string,
    label: string,
    value: number | null | undefined,
    required = false,
  ) => (
    <Field label={label}>
      <Input
        name={name}
        type="number"
        min="0"
        max="1000000"
        step="0.01"
        defaultValue={value ?? ""}
        required={required}
      />
    </Field>
  );
  return (
    <form
      className="form-grid operational-monitor"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget),
          num = (k: string, d = 0) => (f.get(k) ? Number(f.get(k)) : d),
          opt = (k: string) => (f.get(k) ? Number(f.get(k)) : null),
          terms = (k: string) =>
            String(f.get(k) ?? "")
              .split(/[,\n]/)
              .map((s) => s.trim())
              .filter(Boolean),
          filters = readProviderFilters(f, schema);
        save({
          name: f.get("name"),
          product: f.get("product"),
          query: String(f.get("query") ?? ""),
          queryType: method,
          searchUrl:
            method === "search_url" ? String(f.get("searchUrl")) : null,
          provider: "brightdata",
          providerFilters: filters,
          providerContractFingerprint: schema?.fingerprint,
          aliases: terms("aliases"),
          negatives: terms("negatives"),
          minPrice: initial?.minPrice ?? 0,
          maxPrice: num("maxPrice"),
          manualPrice: initial?.manualPrice ?? null,
          strongPrice: opt("strongPrice"),
          ultraPrice: opt("ultraPrice"),
          expectedQuickSalePrice: opt("expectedQuickSalePrice"),
          mode,
          minProfit: num("minProfit"),
          minRoi: num("minRoi"),
          minScore: num("minScore", 65),
          maxRisk: num("maxRisk", 35),
          minLiquidity: initial?.minLiquidity ?? 0,
          city: String(
            f.get("localCity") ?? f.get("city") ?? initial?.city ?? "",
          ),
          radiusKm: initial?.radiusKm ?? 30,
          latitude: initial?.latitude ?? null,
          longitude: initial?.longitude ?? null,
          condition: f.get("condition"),
          maxListingAgeMinutes: num("maxAge") || null,
          resultsPerSearch: num("resultsPerSearch", 10),
          intervalSeconds: interval,
          costs: customCosts
            ? Object.fromEntries(COSTS.map(([k]) => [k, num(`cost.${k}`)]))
            : null,
          active: f.get("active") === "true",
        });
      }}
    >
      <p className="wide small-note">
        Facebook · Bright Data. O primeiro ciclo cria o baseline e não emite
        alertas.
      </p>
      <Field label="Nome do monitor">
        <Input
          name="name"
          defaultValue={initial?.name}
          placeholder="iPhone 15 Curitiba"
          required
          minLength={2}
          maxLength={100}
        />
      </Field>
      <Field label="Produto">
        <Input
          name="product"
          defaultValue={initial?.product || initial?.query}
          placeholder="iPhone 15"
          required
          maxLength={150}
        />
      </Field>
      <Field label="Método">
        <NativeSelect
          value={method}
          onChange={(e) => setMethod(e.target.value as typeof method)}
        >
          <Option value="keyword">Palavra-chave</Option>
          <Option value="search_url">URL de pesquisa do Facebook</Option>
        </NativeSelect>
      </Field>
      <Field label="Palavra-chave principal">
        <Input
          name="query"
          defaultValue={initial?.query}
          placeholder="iPhone 15"
          required={method === "keyword"}
          maxLength={150}
        />
      </Field>
      {method === "search_url" && (
        <Field label="URL da pesquisa do Marketplace" wide>
          <Input
            name="searchUrl"
            type="url"
            required
            defaultValue={initial?.searchUrl ?? ""}
          />
          <small>
            Cole a página de resultados, não o link de um anúncio individual.
          </small>
        </Field>
      )}
      <ProviderFilterFields
        schema={schema}
        initial={initial?.providerFilters ?? { date_listed: "Last 24 hours" }}
      />
      {method === "search_url" && (
        <Field label="Cidade solicitada na busca">
          <Input name="city" defaultValue={initial?.city} />
          <small>
            Configure o raio na URL do Facebook; localização retornada permanece
            separada.
          </small>
        </Field>
      )}
      <Field label="Palavras relacionadas (vírgulas ou linhas)" wide>
        <Input
          name="aliases"
          defaultValue={initial?.aliases.join(", ")}
          placeholder="iphone15, iphone 15 128, apple iphone 15, ip15"
        />
      </Field>
      <Field label="Palavras negativas (vírgulas ou linhas)" wide>
        <Input
          name="negatives"
          defaultValue={
            initial?.negatives.join(", ") ??
            "somente caixa, capinha, película, peças, quebrado, icloud, entrada, parcela"
          }
        />
      </Field>
      <Field label="Restringir à cidade retornada (opcional)">
        <Input
          name="localCity"
          defaultValue={initial?.city ?? ""}
          placeholder="Deixe vazio para aceitar cidades vizinhas"
        />
        <small>
          Filtro local por nome exato. Pode excluir cidades vizinhas dentro do
          raio. O raio só é verificado localmente quando há coordenadas
          confiáveis.
        </small>
      </Field>
      <h3 className="wide">Compra e revenda</h3>
      {moneyField(
        "maxPrice",
        "Preço máximo que aceito pagar (R$)",
        initial?.maxPrice,
        true,
      )}
      {moneyField(
        "strongPrice",
        "Compra forte (R$) · opcional",
        initial?.strongPrice,
      )}
      {moneyField(
        "ultraPrice",
        "Ultra Deal (R$) · opcional",
        initial?.ultraPrice,
      )}
      <Field label="Modo de precificação">
        <NativeSelect
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <Option value="manual">Manual</Option>
          <Option value="automatic">Automático · comparáveis reais</Option>
          <Option value="combined">Híbrido · estimativa conservadora</Option>
        </NativeSelect>
      </Field>
      {moneyField(
        "expectedQuickSalePrice",
        "Venda rápida esperada (R$)",
        initial?.expectedQuickSalePrice,
        mode === "manual",
      )}
      {moneyField(
        "minProfit",
        "Lucro líquido mínimo (R$)",
        initial?.minProfit ?? 0,
      )}
      <Field label="ROI mínimo (%)">
        <Input
          name="minRoi"
          type="number"
          step="0.01"
          min="0"
          max="300"
          defaultValue={initial?.minRoi ?? settings?.minRoi ?? 20}
          required
        />
      </Field>
      <p className="small-note wide">
        Sem níveis opcionais, compra forte = 92% do teto e Ultra = 80%. Lucro,
        ROI, recência, risco e score continuam obrigatórios. Híbrido usa o menor
        valor entre sua venda esperada e a estimativa real; enquanto faltarem
        comparáveis, usa sua estimativa.
      </p>
      <Field label="Custos">
        <NativeSelect
          value={customCosts ? "custom" : "global"}
          onChange={(e) => setCustomCosts(e.target.value === "custom")}
        >
          <Option value="global">Usar custos globais configurados</Option>
          <Option value="custom">Definir custos deste monitor</Option>
        </NativeSelect>
      </Field>
      {customCosts &&
        COSTS.map(([k, label]) => (
          <Field key={k} label={label}>
            <Input
              name={`cost.${k}`}
              type="number"
              min="0"
              max={k.endsWith("Pct") ? 50 : 1000000}
              step="0.01"
              required
              defaultValue={initial?.costs?.[k] ?? settings?.[k] ?? 0}
            />
          </Field>
        ))}
      <h3 className="wide">Recência e operação</h3>
      <Field label="Idade máxima do anúncio">
        <NativeSelect
          name="maxAge"
          defaultValue={
            initial?.maxListingAgeMinutes === null
              ? 0
              : (initial?.maxListingAgeMinutes ?? 1440)
          }
        >
          {AGE_OPTIONS.map(([v, label]) => (
            <Option key={v} value={v}>
              {label}
            </Option>
          ))}
        </NativeSelect>
        <small>
          Anúncios antigos ou sem publicação confiável ficam no histórico, sem
          alerta urgente.
        </small>
      </Field>
      <Field label="Quantidade por busca">
        <NativeSelect
          name="resultsPerSearch"
          defaultValue={initial?.resultsPerSearch ?? Math.min(10, maxRecords)}
        >
          {[...new Set([Math.min(10, maxRecords), 10, 20, 25, 50])]
            .sort((a, b) => a - b)
            .map((n) => (
              <Option key={n} value={n}>
                {n}
                {n > maxRecords ? ` · execução limitada a ${maxRecords}` : ""}
              </Option>
            ))}
        </NativeSelect>
        <small>
          Limite global atual: {maxRecords}. Alterá-lo exige editar
          BRIGHTDATA_MAX_RECORDS_PER_TRIGGER no servidor.
        </small>
      </Field>
      <Field label="Verificar a cada">
        <NativeSelect
          value={interval}
          onChange={(e) => setInterval(Number(e.target.value))}
        >
          {[60, 120, 300, 600, 1800, 3600].map((n) => (
            <Option key={n} value={n}>
              {n / 60} min
            </Option>
          ))}
        </NativeSelect>
        <small>
          {Math.ceil(86400 / interval)} ciclos/dia por monitor antes de pausas;
          orçamento global: {dailyBudget}. O sistema bloqueia chamadas ao
          atingir o limite.
        </small>
      </Field>
      <Field label="Status">
        <NativeSelect
          name="active"
          defaultValue={String(initial?.active ?? true)}
        >
          <Option value="true">Ativo</Option>
          <Option value="false">Pausado</Option>
        </NativeSelect>
      </Field>
      <Field label="Opportunity Score mínimo">
        <Input
          name="minScore"
          type="number"
          min="0"
          max="100"
          defaultValue={initial?.minScore ?? settings?.minScore ?? 65}
        />
      </Field>
      <Field label="Risco máximo">
        <Input
          name="maxRisk"
          type="number"
          min="0"
          max="100"
          defaultValue={initial?.maxRisk ?? settings?.maxRisk ?? 35}
        />
      </Field>
      <Field label="Condição">
        <NativeSelect
          name="condition"
          defaultValue={initial?.condition ?? "any"}
        >
          <Option value="any">Indiferente</Option>
          <Option value="new">Novo</Option>
          <Option value="excellent">Excelente</Option>
          <Option value="used">Usado</Option>
        </NativeSelect>
      </Field>
      <p className="small-note wide">
        {pilot
          ? "Modo piloto: salvar ou ativar não inicia coleta. Use Buscar agora conscientemente; o worker conclui esse único ciclo."
          : "Agendamento automático habilitado. Monitores ativos são executados pelo worker dentro do orçamento global."}
      </p>
      <Button
        className="btn primary wide"
        disabled={busy || !schema?.compatible}
      >
        Salvar monitor
      </Button>
    </form>
  );
}
