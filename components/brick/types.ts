import type { InventoryItem, InventorySummary, getItem, listItems, listReceivables } from "@/server/inventory";
export type { InventoryItem, InventorySummary };
export type Receivables = Awaited<ReturnType<typeof listReceivables>>;
export type ItemDetail = Awaited<ReturnType<typeof getItem>>;
export type ItemList = Awaited<ReturnType<typeof listItems>>;
export interface Me {
  user: { id: string; name: string | null; email: string | null };
  admin: boolean;
  plan: string | null;
}
export interface Preferences {
  monthlyGoalCents: number | null;
  staleAfterDays: number;
  selectedPlan: string | null;
}
