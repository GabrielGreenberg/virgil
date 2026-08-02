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
// The fix folds all three onto a single `AMBER_ATTENTION_STRIP` SSOT. This is a
// source-scan regression guard on that convergence — it pins the two defects so
// the family can't silently re-fragment, without needing to render the panel in
// all three (independently gated) states.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";

const source = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../BibliographyPanel.tsx",
  ),
  "utf8",
);

describe("Bibliography amber attention-strip convergence (task 280)", () => {
  it("never pairs an amber fill with a neutral border on one element", () => {
    // Any className string that carries an amber wash must NOT also carry the
    // neutral `--border-light` seam the request form used to have.
    const amberFillWithNeutralBorder =
      /className=(?:"[^"]*|\{`[^`]*)bg-\[var\(--amber-50\)\][^"`]*border-\[var\(--border-light\)\]/;
    expect(source).not.toMatch(amberFillWithNeutralBorder);
  });

  it("uses a single wash opacity across every amber-50 surface", () => {
    const opacities = [...source.matchAll(/bg-\[var\(--amber-50\)\]\/(\d+)/g)].map(
      (m) => m[1],
    );
    // There are amber-50 surfaces in this file; they must all agree.
    expect(opacities.length).toBeGreaterThan(0);
    expect(new Set(opacities).size).toBe(1);
  });

  it("routes the amber attention chrome through the shared SSOT constant", () => {
    expect(source).toMatch(/const AMBER_ATTENTION_STRIP\s*=/);
    // All three surfaces consume the constant rather than re-inlining chrome.
    const consumers = [...source.matchAll(/\$\{AMBER_ATTENTION_STRIP\}/g)];
    expect(consumers.length).toBe(3);
  });
});
