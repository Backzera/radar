import { UNLIMITED_DAILY_TRIGGERS } from "../core/limits";
export interface PilotConfig {
  tenantMaxDailyTriggers?: number;
  minInterval?: number;
  collectionEnabled?: boolean;
  pilot: boolean;
  maxDailyTriggers: number;
  maxRecords: number;
  externalAlerts: boolean;
}
export function pilotConfig(
  env: Record<string, string | undefined>,
): PilotConfig {
  const pilot = env.PILOT_MODE !== "false";
  const number = (v: string | undefined, defaultValue: number, max: number) =>
    v && Number.isInteger(Number(v)) && Number(v) > 0
      ? Math.min(max, Number(v))
      : defaultValue;
  return {
    pilot,
    // Sem limite de uso por padrão: o usuário busca quantas vezes quiser.
    // Um administrador pode reintroduzir um teto via MAX_DAILY_PROVIDER_TRIGGERS.
    maxDailyTriggers: number(
      env.MAX_DAILY_PROVIDER_TRIGGERS,
      UNLIMITED_DAILY_TRIGGERS,
      UNLIMITED_DAILY_TRIGGERS,
    ),
    maxRecords: number(env.BRIGHTDATA_MAX_RECORDS_PER_TRIGGER, 10, 100),
    externalAlerts: env.EXTERNAL_ALERTS_ENABLED === "true",
  };
}
export const providerBudgetKey = (provider: string, now = new Date()) =>
  `budget:provider:${provider}:${now.toISOString().slice(0, 10)}`;
