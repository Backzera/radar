import type { Metadata } from "next";
import { BRAND } from "@/components/brick/brand";
import { PrivacyPage } from "@/components/brick/legal";
export const metadata: Metadata = { title: `Política de privacidade | ${BRAND.name}` };
export default function Privacy() {
  return <PrivacyPage />;
}
