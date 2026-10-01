import type { Metadata } from "next";
import "./globals.css";
import "./radar.css";
import "./saas.css";

export const metadata: Metadata = {
  title: "Market Radar | Facebook Marketplace",
  description:
    "Oportunidades recentes de compra e revenda no Facebook Marketplace. Preços, recência e riscos explicados.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
