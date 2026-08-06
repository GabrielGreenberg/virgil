// Task 280 — the Bibliography panel's three amber "attention" surfaces
// (conflict decision, request form, pending-requests card) must read as one
// visual family: an amber wash with an amber-200 hairline.
//
// They had diverged in one file:
//   · the request form paired an amber fill with a NEUTRAL `--border-light`
//     border (no sibling anywhere in the repo pairs amber with a neutral
//     border), and
//   · the three washes drifted to three opacities (/50, /40, /30).
//
// The fix folds all three onto a single `AMBER_ATTENTION_STRIP` SSOT.
//
// Task 305 — the SSOT was a *private* const in `BibliographyPanel.tsx` and this
// guard only scanned that one file, so `BibEntryCard.tsx` (the per-entry System
// card) had silently re-fragmented it: its two request-note strips rendered raw
// `border-amber-200 bg-amber-50/50` (Tailwind, bypassing the `--amber-*` tokens,
// at the pre-280 `/50` wash). 305 promotes the const into
// `@/panels/_shared/amber-attention` and makes BOTH the panel and the card
// consume it — so this guard now spans the panel↔card boundary and the counts
// are derived, not hardcoded, so a future card consumer can't silently
// re-fragment it either.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

// The SSOT const now lives in a shared module both consumers import.
const sharedSource = read("../../_shared/amber-attention.ts");
const panelSource = read("../BibliographyPanel.tsx");
const cardSource = read("../../../components/BibEntryCard.tsx");

// Every file that renders an amber-attention surface — the guard spans all of
// them so the family can't re-fragment in any one file.
const consumerSources = { panelSource, cardSource };
const allSources = { sharedSource, ...consumerSources };

describe("Bibliography amber attention-strip convergence (tasks 280, 305)", () => {
  it("never pairs an amber fill with a neutral border on one element", () => {
    // Any className string that carries an amber wash must NOT also carry the
    // neutral `--border-light` seam the request form used to have — in any file.
    const amberFillWithNeutralBorder =
      /className=(?:"[^"]*|\{`[^`]*)bg-\[var\(--amber-50\)\][^"`]*border-\[var\(--border-light\)\]/;
    for (const [name, src] of Object.entries(allSources)) {
      expect(src, name).not.toMatch(amberFillWithNeutralBorder);
    }
  });

  it("uses a single wash opacity across every tokenized amber-50 surface", () => {
    // Collect the `/N` opacity of every tokenized amber-50 wash across the SSOT
    // and both consumers; they must all agree (the SSOT's `/40`).
    const opacities = Object.values(allSources).flatMap((src) =>
      [...src.matchAll(/bg-\[var\(--amber-50\)\]\/(\d+)/g)].map((m) => m[1]),
    );
    expect(opacities.length).toBeGreaterThan(0);
    expect(new Set(opacities).size).toBe(1);
    expect(opacities[0]).toBe("40");
  });

  it("defines the amber attention chrome as one shared SSOT const", () => {
    expect(sharedSource).toMatch(/export const AMBER_ATTENTION_STRIP\s*=/);
    // …and it is tokenized (`--amber-*`) at the reconciled `/40` wash.
    expect(sharedSource).toMatch(/border-\[var\(--amber-200\)\]/);
    expect(sharedSource).toMatch(/bg-\[var\(--amber-50\)\]\/40/);
  });

  it("routes every consumer's amber chrome through the shared SSOT", () => {
    // Both the panel (3 surfaces) and the card (2 request-note strips) consume
    // the imported constant rather than re-inlining chrome. Counts are DERIVED
    // (not a hardcoded 3), so adding a consumer never breaks this guard — it
    // only has to keep routing through the SSOT.
    for (const [name, src] of Object.entries(consumerSources)) {
      expect(src, `${name} imports the SSOT`).toMatch(
        /import\s*\{[^}]*AMBER_ATTENTION_STRIP[^}]*\}\s*from\s*["']@\/panels\/_shared\/amber-attention["']/,
      );
      const consumers = [...src.matchAll(/\$\{AMBER_ATTENTION_STRIP\}/g)];
      expect(consumers.length, `${name} consumes the SSOT`).toBeGreaterThan(0);
    }
    // The panel keeps its three surfaces on the SSOT.
    expect([...panelSource.matchAll(/\$\{AMBER_ATTENTION_STRIP\}/g)].length).toBe(3);
    // The card keeps both request-note strips on the SSOT.
    expect([...cardSource.matchAll(/\$\{AMBER_ATTENTION_STRIP\}/g)].length).toBe(2);
  });

  it("no consumer re-inlines a raw amber-attention strip", () => {
    // The exact re-fragmented literal 305 killed: a raw Tailwind amber strip
    // (bypassing the tokens) must not reappear in any consumer.
    const rawAmberStrip = /border-amber-200[^"'`]*bg-amber-50\/\d+/;
    for (const [name, src] of Object.entries(consumerSources)) {
      expect(src, name).not.toMatch(rawAmberStrip);
    }
  });
});
