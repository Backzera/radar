import Link from "next/link";
import { BRAND } from "./brand";

/**
 * Brand mark: a hexagonal "lens" with a rising stroke, the shape of ágio
 * (the margin you add on resale). Pure SVG so it scales from favicon to hero.
 */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="logo-svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16 3.5 26.8 9.75v12.5L16 28.5 5.2 22.25V9.75L16 3.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <path
        d="M9.5 20.5 14 14.8l3.4 3.1 5.1-7.1"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="22.5" cy="10.8" r="1.9" fill="currentColor" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="logo" href="/" aria-label={`${BRAND.name}, página inicial`}>
      <span className="logo-mark">
        <LogoMark />
      </span>
      {!compact && (
        <span className="logo-text">
          <strong>{BRAND.name}</strong>
          <small>{BRAND.tagline}</small>
        </span>
      )}
    </Link>
  );
}
