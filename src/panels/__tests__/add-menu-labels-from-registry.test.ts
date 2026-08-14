// @vitest-environment node
//
// Guard (task 306, class: label-ssot-drift): a card panel's "+Add" dropdown
// (`onAddOptions`) must DERIVE its card-type labels from the registry SSOT via
// `cardTypeLabel(kind)` — never re-hardcode the same user-facing string as a
// literal. The card overline / kind-chevron already derive from `cardTypeLabel`
// (panel-primitives.tsx); the add-menus used to carry a parallel, un-migrated
// copy of those strings. This test fails if any panel re-introduces a literal
// `label:` inside `onAddOptions` that equals a registry-owned card-type label,
// so a future label rename (e.g. renaming `revision-suggestion.label`) can never
// silently go stale in an add-menu.
//
// Genuine ACTION labels are unaffected: `BibliographyPanel`'s
// "Search library…" / "Request entry" are not any card kind's type name, so
// they don't match a registry label and correctly stay hardcoded.
//
// WIDENED (task 304, same rule one surface over): a card BODY's `placeholder`
// is the same re-hardcoding when it restates the kind's type name — "Request
// text…", "Report text.", "Task". The cutter twin proved why that matters: its
// body said "Comment text…" while its own registry label read "Request", so the
// card's overline and its empty body named the kind two different things, and
// the 304 label change would have left a fourth stale copy behind. Now every
// such placeholder interpolates `cardTypeLabel(kind)`, so a rename reaches the
// body text too.
//
// TWO STATED LIMITS. (1) This leg is NOT the guard that catches 304's original
// shape: it can only see a placeholder that names a label it should derive, and
// is structurally blind to one that names something ELSE entirely (the cutter
// "Comment text…" matched no registry label at all). The direction that catches
// that is the twin-parity census in
// `src/cards/__tests__/twin-vocabulary-parity.test.ts`. (2) The scan is every
// `.tsx` under `src/panels/`, not only card bodies — a filter/search placeholder
// that happened to spell a card-type label as a whole word would be flagged
// too. That is deliberate (a placeholder naming a card type IS the thing being
// governed, wherever it sits) and it fails LOUDLY, so the resolution is a
// judgment call at the failure rather than a hole in the census.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";

const PANELS_DIR = join(__dirname, "..");

/** Every user-visible card-type label owned by the registry SSOT. */
const REGISTRY_LABELS = new Set(
  (Object.keys(CARD_REGISTRY) as CardKind[]).map((k) => CARD_REGISTRY[k].label),
);

/** Recursively collect `*Panel.tsx` sources under src/panels/. */
function findPanelFiles(dir: string): string[] {
  return findFiles(dir, (name) => name.endsWith("Panel.tsx"));
}

/** Recursively collect every `.tsx` source under src/panels/ (tests excluded). */
function findAllPanelSources(dir: string): string[] {
  return findFiles(dir, (name) => name.endsWith(".tsx"));
}

function findFiles(dir: string, accept: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "__tests__" || ent.name === "node_modules") continue;
      out.push(...findFiles(full, accept));
    } else if (accept(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract the source slice of a `const onAddOptions = useMemo( … )` definition
 * by paren-matching from the `useMemo(` open paren (string-literal aware), so
 * the scan is scoped to the add-menu block and won't read unrelated `label:`
 * usages elsewhere in the file. Returns null when the panel has no such block.
 */
function extractOnAddOptionsBlock(src: string): string | null {
  const marker = "const onAddOptions = useMemo(";
  const at = src.indexOf(marker);
  if (at === -1) return null;
  let i = at + marker.length - 1; // index of the '(' after useMemo
  let depth = 0;
  let quote: string | null = null;
  const start = i;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") {
        i++; // skip escaped char
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

/** Every `label: "…"` / `label: '…'` string literal inside a block. */
function literalLabels(block: string): string[] {
  const out: string[] = [];
  const re = /label:\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) out.push(m[1] ?? m[2] ?? "");
  return out;
}

describe("panel +Add menus derive card-type labels from the registry SSOT", () => {
  const panelFiles = findPanelFiles(PANELS_DIR);

  it("finds the card panels with an onAddOptions block", () => {
    // Sanity: the scan actually reaches the panels (guards against a moved dir
    // silently making the class-closer below vacuous).
    const withBlock = panelFiles.filter(
      (f) => extractOnAddOptionsBlock(readFileSync(f, "utf8")) !== null,
    );
    expect(withBlock.length).toBeGreaterThanOrEqual(4);
  });

  it("no onAddOptions entry hardcodes a registry-owned card-type label as a literal", () => {
    const offenders: string[] = [];
    for (const file of panelFiles) {
      const block = extractOnAddOptionsBlock(readFileSync(file, "utf8"));
      if (!block) continue;
      for (const label of literalLabels(block)) {
        if (REGISTRY_LABELS.has(label)) {
          offenders.push(
            `${file.slice(file.indexOf("src/"))}: label: "${label}" — derive via cardTypeLabel(<kind>) instead`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no card body placeholder restates a registry-owned card-type label", () => {
    // `placeholder="…"` string literals only — a `placeholder={…}` expression is
    // already deriving (that is the compliant form this leg asks for).
    const re = /placeholder=(?:"([^"]*)"|'([^']*)')/g;
    const offenders: string[] = [];
    let seen = 0;
    for (const file of findAllPanelSources(PANELS_DIR)) {
      const src = readFileSync(file, "utf8");
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(src)) !== null) {
        const text = m[1] ?? m[2] ?? "";
        seen++;
        for (const label of REGISTRY_LABELS) {
          // Case-SENSITIVE, whole-word: "Describe the bibliography entry you
          // need…" and "Filter errors…" name a concept in prose, not the card
          // type, and correctly stay hardcoded.
          const word = new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
          if (word.test(text)) {
            offenders.push(
              `${file.slice(file.indexOf("src/"))}: placeholder="${text}" restates the "${label}" card-type label — interpolate cardTypeLabel(<kind>) instead`,
            );
          }
        }
      }
    }
    // Accepting control: the sweep really reaches the panel sources, so a
    // future directory move can't make the leg pass vacuously.
    expect(seen).toBeGreaterThanOrEqual(10);
    expect(offenders).toEqual([]);
  });

  it("the four card panels derive their add-menu labels via cardTypeLabel(...)", () => {
    const expected = [
      "Notes/NotesPanel.tsx",
      "Cutter/CutterPanel.tsx",
      "Revisions/RevisionsPanel.tsx",
      "Reports/ReportsPanel.tsx",
    ];
    for (const rel of expected) {
      const file = panelFiles.find((f) => f.endsWith(rel));
      expect(file, `panel not found: ${rel}`).toBeTruthy();
      const block = extractOnAddOptionsBlock(readFileSync(file!, "utf8"));
      expect(block, `onAddOptions block not found in ${rel}`).toBeTruthy();
      expect(
        block!.includes("cardTypeLabel("),
        `${rel} onAddOptions should derive labels via cardTypeLabel(...)`,
      ).toBe(true);
    }
  });
});
