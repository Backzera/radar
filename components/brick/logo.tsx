import Link from "next/link";
import { Radar } from "lucide-react";
import { BRAND } from "./brand";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="logo" href="/" aria-label={`${BRAND.name}, página inicial`}>
      <span className="logo-mark">
        <Radar size={20} strokeWidth={2.4} />
      </span>
      {!compact && (
        <span>
          <strong>{BRAND.name}</strong>
          <small>{BRAND.tagline}</small>
        </span>
      )}
    </Link>
  );
}
