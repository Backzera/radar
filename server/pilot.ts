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
    maxDailyTriggers: number(
      env.MAX_DAILY_PROVIDER_TRIGGERS,
      pilot ? 5 : 50,
      pilot ? 5 : 100,
    ),
    maxRecords: number(env.BRIGHTDATA_MAX_RECORDS_PER_TRIGGER, 10, 100),
    externalAlerts: env.EXTERNAL_ALERTS_ENABLED === "true",
  };
}
export const providerBudgetKey = (provider: string, now = new Date()) =>
  `budget:provider:${provider}:${now.toISOString().slice(0, 10)}`;
