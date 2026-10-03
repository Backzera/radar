import type { Metadata } from "next";
import { AuthPage } from "@/components/brick/auth-page";
import { BRAND } from "@/components/brick/brand";
export const metadata: Metadata = { title: `Entrar | ${BRAND.name}` };
export default function SignInPage() {
  return <AuthPage mode="login" />;
}
