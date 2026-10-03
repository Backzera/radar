import type { Metadata } from "next";
import { BrickApp } from "@/components/brick/app-shell";
import { BRAND } from "@/components/brick/brand";
export const metadata: Metadata = { title: `Painel | ${BRAND.name}` };
export default function AppPage() {
  return <BrickApp />;
}
