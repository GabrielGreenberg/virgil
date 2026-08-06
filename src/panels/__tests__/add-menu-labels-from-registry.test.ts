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
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "__tests__" || ent.name === "node_modules") continue;
      out.push(...findPanelFiles(full));
    } else if (ent.name.endsWith("Panel.tsx")) {
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
