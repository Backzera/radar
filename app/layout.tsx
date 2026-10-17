import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./app.css";
import "./landing.css";
import { BRAND } from "@/components/brick/brand";
import { withBase } from "@/components/brick/base";
import { Spotlight } from "@/components/brick/fx";

// The radar UI (components/saas) keeps its own stylesheet, saas.css, scoped
// under .saas and imported by components/radar-app.tsx.
export const metadata: Metadata = {
  title: `${BRAND.name} | ${BRAND.tagline}`,
  description: BRAND.description,
  icons: { icon: withBase("/favicon.svg"), shortcut: withBase("/favicon.svg") },
};
export const viewport: Viewport = {
  themeColor: "#050608",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* Root layout covers every route; this rule targets pages/_document. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <div className="bg" aria-hidden="true">
          <div className="bg-grid" />
          <div className="bg-glow a" />
          <div className="bg-glow b" />
          <div className="bg-scan" />
          <div className="bg-noise" />
        </div>
        <Spotlight />
        {children}
      </body>
    </html>
  );
}
