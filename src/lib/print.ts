/**
 * Print orchestration. Sets per-toggle `data-print-*` attributes on the
 * <html> element and a `--print-font-size` CSS variable, then calls
 * window.print(). The matching CSS lives in `src/app/globals.css` under
 * `@media print`. Cleanup runs from afterprint OR a matchMedia change
 * handler — Safari and some Chromium builds skip the former.
 *
 * ── THE LAW: what prints is the DOCUMENT, not the editor's fold state ──
 *
 * A screen-only visibility state — a folded section, a LOCKED focus band, a
 * collapsed source pod — is a statement about the editor, never about the
 * paper. None of the three was ever chosen as a print posture, and each leaked
 * a different unstated answer onto paper: a folded section printed nothing, a
 * locked band printed ONLY the band with the rest of the document silently
 * absent, and a collapsed pod printed a two-line truncated stub (task 408).
 *
 * This module OWNS print state and deliberately implements none of it, because
 * it cannot: **there are two print doors and this module is only on one.**
 * `runPrint` below stamps `html[data-printing]` + the `data-print-e-*` toggles;
 * the browser's own File → Print reaches nothing but the `beforeprint` listener
 * at the bottom of this file, which never calls `applyPrintAttrs`. So ANY
 * future print behaviour keyed on `data-printing` (or on any attribute stamped
 * here) silently does nothing for the door most people use. That is the reason
 * the fold posture lives in media queries in globals.css — `@media screen`
 * around the two hide-class declarations, `@media print` for the pod's paper
 * body — and it is a constraint on every future print change, not a note about
 * one fix. Contract: src/lib/__tests__/print-fold-posture.test.ts.
 */

import type { PanelKind } from "@/panels/_shared/types";
import {
  requestAppendices,
  releaseAppendices,
  getPrintIntent,
} from "@/lib/print-intent";

export type PrintElementKey =
  | "title"
  | "sectionNumbers"
  | "latexComments"
  | "footnoteMarkers"
  | "citations"
  | "examples"
  | "displayMath"
  | "marginalia"
  | "linkedAnchorUnderlines";

/** The printable-panel set + appendix order — the SINGLE source for which
 *  panels can print. `PrintPanelKey`, the appendix order, the PrintDialog rows,
 *  and the JSON-defaults validation all derive from this (replacing five
 *  hand-synced lists). Membership = the keys; order = `printOrder`. The default
 *  on/off lives in the promotable `print.defaults.json` sidecar (validated
 *  against these keys by the dev canary below) — NOT duplicated here.
 *  `satisfies Partial<Record<PanelKind, …>>` enforces every key is a real panel
 *  — a typo or renamed `PanelKind` errors here — AND keeps `PrintPanelKey` a
 *  provable subset of `PanelKind`. Adding a printable panel = one entry here
 *  (+ its default in the JSON); the heading/label comes from
 *  `PANEL_REGISTRY[k].label`. */
export const PRINT_PANELS = {
  footnotes:    { printOrder: 0 },
  bibliography: { printOrder: 1 },
  citations:    { printOrder: 2 },
  notes:        { printOrder: 3 },
  examples:     { printOrder: 4 },
  todo:         { printOrder: 5 },
  archive:      { printOrder: 6 },
  revisions:    { printOrder: 7 },
  cutter:       { printOrder: 8 },
  // reports was the headline A8 wart — a real card panel forgotten in all five
  // printable lists, so report cards literally could not be printed. Registry-
  // derivation makes it printable by construction.
  reports:      { printOrder: 9 },
  errors:       { printOrder: 10 },
} satisfies Partial<Record<PanelKind, { printOrder: number }>>;

/** A panel that can be printed as an appendix — a provable subset of `PanelKind`. */
export type PrintPanelKey = keyof typeof PRINT_PANELS;

/** Printable panels in appendix order. Derived (replaces the hand-kept
 *  `PANEL_ORDER` literal in PrintAppendices). */
export const PRINT_PANEL_ORDER = (Object.keys(PRINT_PANELS) as PrintPanelKey[]).sort(
  (a, b) => PRINT_PANELS[a].printOrder - PRINT_PANELS[b].printOrder,
);

export interface PrintOptions {
  elements: Record<PrintElementKey, boolean>;
  panels: Record<PrintPanelKey, boolean>;
  fontSizeRem: number;
}

export const PRINT_FONT_SIZES = [0.85, 0.95, 1.05, 1.15, 1.25] as const;
export const PRINT_FONT_LABELS = ["S", "M", "L", "XL", "XXL"] as const;

// Shipped defaults are loaded from a JSON sidecar so the personal-prefs
// promotion pipeline can rewrite them without touching TS source.
import defaultPrintOptionsJson from "./print.defaults.json";

export const DEFAULT_PRINT_OPTIONS: PrintOptions = defaultPrintOptionsJson as PrintOptions;

// Dev canary: the JSON sidecar's `panels` keys must match the printable set
// (PRINT_PANELS) exactly. The `as PrintOptions` cast above cannot catch a stale
// key (e.g. the removed `quotations` panel) or a missing one — make it loud.
if (process.env.NODE_ENV !== "production") {
  const declared = new Set<string>(Object.keys(PRINT_PANELS));
  for (const k of Object.keys(DEFAULT_PRINT_OPTIONS.panels)) {
    if (!declared.has(k)) {
      console.error(`[print] print.defaults.json "panels" has unknown key "${k}" — not a printable panel.`);
    }
  }
  for (const k of declared) {
    if (!(k in DEFAULT_PRINT_OPTIONS.panels)) {
      console.error(`[print] print.defaults.json "panels" is missing printable panel "${k}".`);
    }
  }
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function applyPrintAttrs(options: PrintOptions): () => void {
  const html = document.documentElement;
  html.dataset.printing = "true";
  for (const [k, v] of Object.entries(options.elements)) {
    html.setAttribute(`data-print-e-${kebab(k)}`, v ? "true" : "false");
  }
  // Panel appendices gate purely by RENDER — PrintAppendices renders only the
  // enabled panels — so no per-panel `data-print-p-*` attr / CSS allowlist is
  // needed (the former 5th hand-synced printable list; see globals.css).
  html.style.setProperty("--print-font-size", `${options.fontSizeRem}rem`);

  // Walk from the editor page up to <body>, tagging each ancestor as
  // a layout-release target and each non-chain sibling as hidden. The
  // matching @media print rules live in globals.css.
  const ancestors: HTMLElement[] = [];
  const hidden: HTMLElement[] = [];
  const editorPage = document.querySelector<HTMLElement>('[data-editor-page]');
  if (editorPage) {
    let el: HTMLElement = editorPage;
    while (el.parentElement && el !== document.body) {
      const parent = el.parentElement;
      parent.dataset.printAncestor = "true";
      ancestors.push(parent);
      for (const child of Array.from(parent.children)) {
        if (child !== el && child instanceof HTMLElement) {
          child.dataset.printHide = "true";
          hidden.push(child);
        }
      }
      el = parent;
    }
  }

  return () => {
    delete html.dataset.printing;
    for (const k of Object.keys(options.elements)) {
      html.removeAttribute(`data-print-e-${kebab(k)}`);
    }
    html.style.removeProperty("--print-font-size");
    for (const a of ancestors) delete a.dataset.printAncestor;
    for (const h of hidden) delete h.dataset.printHide;
  };
}

export async function runPrint(options: PrintOptions): Promise<void> {
  // Mount the appendix tree first and wait for its post-commit ack — the
  // appendices exist only during an active print since perf Wave 0
  // (print-intent.ts has the full story). Falls through on timeout so a
  // doc-less window still prints.
  await requestAppendices(options);

  const cleanup = applyPrintAttrs(options);

  if (document.fonts?.ready) {
    try { await document.fonts.ready; } catch {}
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    cleanup();
    releaseAppendices();
    window.removeEventListener("afterprint", finish);
    mql.removeEventListener("change", onMqlChange);
  };
  const mql = window.matchMedia("print");
  const onMqlChange = (e: MediaQueryListEvent) => {
    if (!e.matches) finish();
  };
  window.addEventListener("afterprint", finish);
  mql.addEventListener("change", onMqlChange);

  window.print();
}

// ── Native File→Print fallback ─────────────────────────────────────────
// THE SECOND DOOR. Everything `applyPrintAttrs` stamps is absent here — no
// `data-printing`, no `data-print-e-*` element toggles, no print-ancestor /
// print-hide walk — so this path prints with the DEFAULT element posture and
// no page isolation. Anything that must hold on paper regardless of door
// therefore belongs in a media query, not behind an attribute stamped above
// (see the module docstring; task 408).
//
// Cmd+P is intercepted (EditorLayout → PrintDialog → runPrint), but the
// browser's own menu item fires `beforeprint` with no chance to await a
// mount. Best-effort: activate the appendices synchronously so React can
// often commit them before the snapshot (Chromium yields between
// beforeprint and rasterization more often than not); release on
// afterprint. A missed race prints without appendices — the documented
// trade for not keeping hundreds of hidden card editors alive full-time.
if (typeof window !== "undefined") {
  window.addEventListener("beforeprint", () => {
    if (getPrintIntent().active) return; // runPrint owns this cycle
    void requestAppendices(DEFAULT_PRINT_OPTIONS);
    const off = () => {
      releaseAppendices();
      window.removeEventListener("afterprint", off);
    };
    window.addEventListener("afterprint", off);
  });
}
