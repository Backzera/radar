"use client";
import { useEffect } from "react";

/**
 * Cursor spotlight for every .card on the page: writes the pointer position
 * into --mx/--my on the hovered card and flags it with .lit, so the CSS
 * radial highlight follows the cursor without per-component wiring.
 */
export function Spotlight() {
  useEffect(() => {
    if (window.matchMedia("(hover: none)").matches) return;
    let current: HTMLElement | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;
    const paint = () => {
      frame = 0;
      if (!last) return;
      const target = last.target as Element | null;
      const card = target?.closest?.(".card") as HTMLElement | null;
      if (card !== current) {
        current?.classList.remove("lit");
        current = card;
        current?.classList.add("lit");
      }
      if (current) {
        const r = current.getBoundingClientRect();
        current.style.setProperty("--mx", `${last.clientX - r.left}px`);
        current.style.setProperty("--my", `${last.clientY - r.top}px`);
      }
    };
    const move = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const leave = () => {
      current?.classList.remove("lit");
      current = null;
    };
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      if (frame) cancelAnimationFrame(frame);
      leave();
    };
  }, []);
  return null;
}
