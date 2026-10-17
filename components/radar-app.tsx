"use client";
// The radar UI (components/saas), switched on by FEATURES.radar in brand.ts.
// Its stylesheet is scoped under .saas and loads with the lazy-mounted view.
import "../app/saas.css";
export { RadarShell as RadarApp } from "./saas/radar-shell";
