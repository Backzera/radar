import type { Metadata } from "next";
import { AuthPage } from "@/components/brick/auth-page";
import { BRAND } from "@/components/brick/brand";
export const metadata: Metadata = { title: `Criar conta | ${BRAND.name}` };
export default function SignUpPage() {
  return <AuthPage mode="signup" />;
}
