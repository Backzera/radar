/** Brick (compra e revenda de usados): vocabulário, contas e resumo do painel. */
export const CATEGORIES = [
  "phones",
  "consoles",
  "computers",
  "tablets",
  "audio",
  "watches",
  "cameras",
  "accessories",
  "appliances",
  "tools",
  "bikes",
  "furniture",
  "other",
] as const;
export const CONDITIONS = ["new", "like_new", "used", "defective"] as const;
export const STATUSES = [
  "in_stock",
  "preparing",
  "listed",
  "reserved",
  "sold",
] as const;
export const CHANNELS = [
  "facebook",
  "olx",
  "mercadolivre",
  "instagram",
  "whatsapp",
  "store",
  "referral",
  "fair",
  "other",
] as const;
export const COST_KINDS = [
  "repair",
  "parts",
  "shipping",
  "cleaning",
  "accessory",
  "fee",
  "other",
] as const;
export const PERIODS = ["month", "last30", "year", "all"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Condition = (typeof CONDITIONS)[number];
export type Status = (typeof STATUSES)[number];
export type Channel = (typeof CHANNELS)[number];
export type CostKind = (typeof COST_KINDS)[number];
export type Period = (typeof PERIODS)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  phones: "Celulares",
  consoles: "Videogames",
  computers: "Notebooks e PCs",
  tablets: "Tablets",
  audio: "Áudio",
  watches: "Relógios",
  cameras: "Câmeras",
  accessories: "Acessórios",
  appliances: "Eletrodomésticos",
  tools: "Ferramentas",
  bikes: "Bicicletas",
  furniture: "Móveis",
  other: "Outros",
};
export const CONDITION_LABELS: Record<Condition, string> = {
  new: "Novo / lacrado",
  like_new: "Seminovo",
  used: "Usado",
  defective: "Com defeito",
};
export const STATUS_LABELS: Record<Status, string> = {
  in_stock: "Em estoque",
  preparing: "Em preparação",
  listed: "Anunciado",
  reserved: "Reservado",
  sold: "Vendido",
};
export const CHANNEL_LABELS: Record<Channel, string> = {
  facebook: "Facebook Marketplace",
  olx: "OLX",
  mercadolivre: "Mercado Livre",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  store: "Loja física",
  referral: "Indicação / conhecido",
  fair: "Feira",
  other: "Outro",
};
export const COST_LABELS: Record<CostKind, string> = {
  repair: "Conserto",
  parts: "Peças",
  shipping: "Frete / transporte",
  cleaning: "Limpeza",
  accessory: "Acessórios",
  fee: "Taxas",
  other: "Outros",
};
export const PERIOD_LABELS: Record<Period, string> = {
  month: "Este mês",
  last30: "Últimos 30 dias",
  year: "Este ano",
  all: "Tudo",
};

const DAY_MS = 86_400_000;
/** Data de hoje (YYYY-MM-DD) no fuso de São Paulo, independente do servidor. */
export function todayIn(now = new Date(), timeZone = "America/Sao_Paulo") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
export function daysBetween(from: string, to: string) {
  return Math.max(0, Math.round(dayNumber(to) - dayNumber(from)));
}
export function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
export function addDays(date: string, days: number) {
  return new Date((dayNumber(date) + days) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export interface ItemMoney {
  status: Status;
  purchasePriceCents: number;
  costsCents: number;
  askingPriceCents: number | null;
  salePriceCents: number | null;
  saleFeesCents: number;
  purchasedAt: string;
  soldAt: string | null;
}
export interface ItemFigures {
  investedCents: number;
  netSaleCents: number | null;
  profitCents: number | null;
  marginPct: number | null;
  roiPct: number | null;
  expectedProfitCents: number | null;
  days: number;
}
const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
/** Lucro real só existe depois da venda; antes dela, só o lucro esperado pelo preço pedido. */
export function itemFigures(item: ItemMoney, today: string): ItemFigures {
  const investedCents = item.purchasePriceCents + item.costsCents;
  const sold =
    item.status === "sold" &&
    item.salePriceCents !== null &&
    item.soldAt !== null;
  const netSaleCents = sold ? item.salePriceCents! - item.saleFeesCents : null;
  const profitCents = netSaleCents === null ? null : netSaleCents - investedCents;
  return {
    investedCents,
    netSaleCents,
    profitCents,
    marginPct: profitCents === null ? null : pct(profitCents, item.salePriceCents!),
    roiPct: profitCents === null ? null : pct(profitCents, investedCents),
    expectedProfitCents:
      sold || item.askingPriceCents === null
        ? null
        : item.askingPriceCents - investedCents,
    days: daysBetween(item.purchasedAt, sold ? item.soldAt! : today),
  };
}

export function periodRange(period: Period, today: string) {
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (period === "month") {
    const start = `${y}-${pad(m)}-01`;
    const prevYear = m === 1 ? y - 1 : y,
      prevMonth = m === 1 ? 12 : m - 1;
    return {
      start,
      end: today,
      previous: {
        start: `${prevYear}-${pad(prevMonth)}-01`,
        end: addDays(start, -1),
      },
    };
  }
  if (period === "last30") {
    const start = addDays(today, -29);
    return {
      start,
      end: today,
      previous: { start: addDays(start, -30), end: addDays(start, -1) },
    };
  }
  if (period === "year")
    return {
      start: `${y}-01-01`,
      end: today,
      previous: { start: `${y - 1}-01-01`, end: `${y - 1}${today.slice(4)}` },
    };
  return { start: "0000-01-01", end: today, previous: null };
}

export interface SummaryItem extends ItemMoney {
  id: string;
  name: string;
  category: Category;
  coverPhotoId: string | null;
}
interface SalesTotals {
  profitCents: number;
  revenueCents: number;
  investedCents: number;
  count: number;
}
function totals(sold: { figures: ItemFigures; item: SummaryItem }[]) {
  return sold.reduce<SalesTotals>(
    (t, { figures, item }) => ({
      profitCents: t.profitCents + figures.profitCents!,
      revenueCents: t.revenueCents + item.salePriceCents!,
      investedCents: t.investedCents + figures.investedCents,
      count: t.count + 1,
    }),
    { profitCents: 0, revenueCents: 0, investedCents: 0, count: 0 },
  );
}
const change = (current: number, previous: number | null) =>
  previous === null || previous === 0
    ? null
    : Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;

export function summarize(
  items: SummaryItem[],
  options: {
    period: Period;
    today: string;
    goalCents: number | null;
    staleAfterDays: number;
  },
) {
  const { today } = options;
  const rows = items.map((item) => ({
    item,
    figures: itemFigures(item, today),
  }));
  const sold = rows.filter((r) => r.figures.profitCents !== null);
  const stock = rows.filter((r) => r.figures.profitCents === null);
  const range = periodRange(options.period, today);
  const within = (r: (typeof sold)[number], start: string, end: string) =>
    r.item.soldAt! >= start && r.item.soldAt! <= end;
  const current = sold.filter((r) => within(r, range.start, range.end));
  const t = totals(current);
  const previous = range.previous
    ? totals(sold.filter((r) => within(r, range.previous!.start, range.previous!.end)))
    : null;
  const months: { month: string; profitCents: number; revenueCents: number; count: number }[] = [];
  const [y, m] = today.split("-").map(Number);
  for (let back = 11; back >= 0; back--) {
    const index = y * 12 + (m - 1) - back;
    const key = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    const inMonth = totals(sold.filter((r) => r.item.soldAt!.startsWith(key)));
    months.push({
      month: key,
      profitCents: inMonth.profitCents,
      revenueCents: inMonth.revenueCents,
      count: inMonth.count,
    });
  }
  const byCategory = new Map<Category, { profitCents: number; count: number }>();
  for (const r of current) {
    const entry = byCategory.get(r.item.category) ?? { profitCents: 0, count: 0 };
    entry.profitCents += r.figures.profitCents!;
    entry.count++;
    byCategory.set(r.item.category, entry);
  }
  const monthProfit = months.at(-1)!.profitCents;
  const brief = (r: (typeof rows)[number]) => ({
    id: r.item.id,
    name: r.item.name,
    category: r.item.category,
    coverPhotoId: r.item.coverPhotoId,
    status: r.item.status,
    days: r.figures.days,
    investedCents: r.figures.investedCents,
    profitCents: r.figures.profitCents,
    salePriceCents: r.item.salePriceCents,
    soldAt: r.item.soldAt,
  });
  const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const r of rows) statusCounts[r.item.status]++;
  return {
    period: options.period,
    range: { start: range.start, end: range.end },
    sales: {
      ...t,
      marginPct: pct(t.profitCents, t.revenueCents),
      roiPct: pct(t.profitCents, t.investedCents),
      avgDaysToSell: current.length
        ? Math.round(current.reduce((s, r) => s + r.figures.days, 0) / current.length)
        : null,
      avgProfitCents: current.length ? Math.round(t.profitCents / current.length) : null,
      profitChangePct: previous ? change(t.profitCents, previous.profitCents) : null,
      revenueChangePct: previous ? change(t.revenueCents, previous.revenueCents) : null,
    },
    stock: {
      count: stock.length,
      investedCents: stock.reduce((s, r) => s + r.figures.investedCents, 0),
      askingCents: stock.reduce((s, r) => s + (r.item.askingPriceCents ?? 0), 0),
      expectedProfitCents: stock.reduce((s, r) => s + (r.figures.expectedProfitCents ?? 0), 0),
      withoutAskingPrice: stock.filter((r) => r.item.askingPriceCents === null).length,
    },
    goal:
      options.goalCents && options.goalCents > 0
        ? {
            targetCents: options.goalCents,
            achievedCents: monthProfit,
            pct: Math.max(0, Math.round((monthProfit / options.goalCents) * 1000) / 10),
          }
        : null,
    months,
    categories: [...byCategory]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.profitCents - a.profitCents),
    stale: stock
      .filter((r) => r.figures.days >= options.staleAfterDays)
      .sort((a, b) => b.figures.days - a.figures.days)
      .slice(0, 6)
      .map(brief),
    recentSales: [...sold]
      .sort((a, b) => b.item.soldAt!.localeCompare(a.item.soldAt!))
      .slice(0, 6)
      .map(brief),
    statusCounts,
  };
}
export type Summary = ReturnType<typeof summarize>;

/** Centavos ⇄ texto em reais, sem passar por ponto flutuante na conversão. */
export function parseMoneyToCents(input: string): number | null {
  const clean = input.replace(/[^\d,.-]/g, "").trim();
  if (!clean || /-/.test(clean)) return null;
  const lastSep = Math.max(clean.lastIndexOf(","), clean.lastIndexOf("."));
  const decimals = lastSep >= 0 && clean.length - lastSep - 1 <= 2 ? clean.slice(lastSep + 1) : "";
  const whole = (decimals ? clean.slice(0, lastSep) : clean).replace(/[.,]/g, "");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(decimals)) return null;
  const cents = Number(whole || "0") * 100 + Number(decimals.padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? cents : null;
}
export function formatCents(cents: number | null | undefined, options: { sign?: boolean; compact?: boolean } = {}) {
  if (cents == null) return "—";
  const value = cents / 100;
  const text = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    ...(options.compact && Math.abs(value) >= 10_000
      ? { notation: "compact", maximumFractionDigits: 1 }
      : {}),
  }).format(value);
  return options.sign && cents > 0 ? `+${text}` : text;
}
