import type { Metadata } from "next";
import { BRAND } from "@/components/brick/brand";
import { TermsPage } from "@/components/brick/legal";
export const metadata: Metadata = { title: `Termos de uso | ${BRAND.name}` };
export default function Terms() {
  return <TermsPage />;
}
