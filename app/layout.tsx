import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./app.css";
import "./landing.css";
import { BRAND } from "@/components/brick/brand";
import { withBase } from "@/components/brick/base";

// The radar UI (components/saas) keeps its own stylesheets, radar.css and
// saas.css; import them there when the radar comes back.
export const metadata: Metadata = {
  title: `${BRAND.name} | ${BRAND.tagline}`,
  description: BRAND.description,
  icons: { icon: withBase("/favicon.svg"), shortcut: withBase("/favicon.svg") },
};
export const viewport: Viewport = {
  themeColor: "#060912",
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
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400..800&family=Geist+Mono:wght@400..600&display=swap"
        />
      </head>
      <body>
        <div className="aurora" aria-hidden="true">
          <div className="grid" />
        </div>
        {children}
      </body>
    </html>
  );
}
