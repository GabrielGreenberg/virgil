// Task 2026-11-05-1476 — the CENSUS of card-kind FAMILY lists that must be
// derived from the registry, not hand-written.
//
// Six sites agreed with `CARD_REGISTRY` only by coincidence: a literal
// footnote/citation click-route table (whose comment claimed it was derived),
// a `footnote ? … : "Archive citation?"` confirm title, one `push` per
// suggestion kind in the auto-apply driver, a `!== "revision-suggestion" &&
// !== "cutter-suggestion"` chain, a hand-typed live-position kind union, and a
// Highlights-menu member list that omitted `report` with only a comment. A
// third atom or suggestion kind would have been silently missed by each.
//
// Each now derives from a registry facet or a DECLARED opt-out set. This file
// pins both halves:
//   1. VALUE pins — every derived table equals its registry source, so a fake
//      third member changes these tables or fails here, never silently.
//   2. A SOURCE scan — no code line anywhere in `src/` (tests excluded) spells
//      a two-literal `x === "A" || x === "B"` chain over members of the
//      atom-card or suggestion family. That is the shape every one of the six
//      sites had; the predicates (`isInlineAtomCardKind`, `isSuggestionKind`)
//      are the door.
//
// (Two compile-time pins need no runtime assertion: `useLivePosResolver`'s
// `ATOM_SNAPSHOT_LIST` is a mapped type over `CardAtomKind`, and the auto-apply
// driver's family table `satisfies Record<PendingChangeFamily, …>` — a new
// member fails tsc at both.)

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { matchesWithLines, strip, walkFiles } from "../../lib/__tests__/_source-scan";
import { CARD_ATOMS } from "@/lib/tiptap/atom-registry";
import { SUGGESTION_KINDS, panelForCardKind } from "@/cards/predicates";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { ATOM_CLICK_ROUTES } from "@/components/editor-layout/event-bridges/marker-clicks";
import { PENDING_CHANGE_FAMILIES } from "@/links/apply-suggestion";
import {
  ALL_HIGHLIGHT_TYPES,
  MENU_HIGHLIGHT_TYPES,
  NON_MENU_HIGHLIGHT_TYPES,
} from "@/lib/view-prefs/highlight-types";
import { VIEW_PREF_REGISTRY } from "@/lib/view-prefs/registry";

const sorted = (xs: Iterable<string>) => [...xs].sort();

describe("card-kind family tables derive from the registry (task 1476)", () => {
  it("ATOM_CLICK_ROUTES has exactly one route per Card-bearing atom, to its owning panel", () => {
    const atomKinds = CARD_ATOMS.map((m) => m.kind);
    expect(sorted(Object.keys(ATOM_CLICK_ROUTES))).toEqual(sorted(atomKinds));
    for (const kind of atomKinds) {
      expect(ATOM_CLICK_ROUTES[kind]).toEqual({
        panelId: panelForCardKind(kind),
        cardKind: kind,
      });
    }
  });

  it("every Card-bearing atom has a registry label (the archive-confirm title reads it)", () => {
    for (const { kind } of CARD_ATOMS) {
      expect(CARD_REGISTRY[kind].label, kind).toMatch(/\S/);
    }
  });

  it("PENDING_CHANGE_FAMILIES ≡ SUGGESTION_KINDS", () => {
    expect(sorted(PENDING_CHANGE_FAMILIES)).toEqual(sorted(SUGGESTION_KINDS));
  });

  it("the Highlights menu offers every highlight type except the DECLARED opt-out", () => {
    const optOut = new Set<string>(NON_MENU_HIGHLIGHT_TYPES);
    expect(MENU_HIGHLIGHT_TYPES).toEqual(ALL_HIGHLIGHT_TYPES.filter((t) => !optOut.has(t)));
    expect(VIEW_PREF_REGISTRY.hiddenHighlightTypes.members).toBe(MENU_HIGHLIGHT_TYPES);
    for (const t of NON_MENU_HIGHLIGHT_TYPES) {
      expect(ALL_HIGHLIGHT_TYPES as readonly string[]).toContain(t);
    }
  });
});

describe("CENSUS: no hand-written two-literal chain over an atom/suggestion family", () => {
  const SRC = join(__dirname, "..", "..");
  const FAMILIES: Record<string, readonly string[]> = {
    "atom-card": CARD_ATOMS.map((m) => m.kind),
    suggestion: [...SUGGESTION_KINDS],
  };

  // `x === "A" || x === "B"` / `x !== "A" && x !== "B"` — the same subject
  // compared to two string literals in one boolean chain.
  const CHAIN = /([\w.?]+)\s*[!=]==\s*"([\w-]+)"\s*(?:&&|\|\|)\s*\1\s*[!=]==\s*"([\w-]+)"/g;

  it("finds none (use isInlineAtomCardKind / isSuggestionKind)", () => {
    const files = walkFiles(SRC, { skipDirs: ["__tests__"] }).filter(
      (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
    );
    const hits: string[] = [];
    for (const file of files) {
      // Comments blanked, strings KEPT (the literals are the subject),
      // line-aligned so a hit reports its real line.
      const code = strip(readFileSync(file, "utf8"), true, true);
      for (const hit of matchesWithLines(code, CHAIN)) {
        const m = new RegExp(CHAIN.source).exec(hit.text);
        if (!m) continue;
        for (const [fam, members] of Object.entries(FAMILIES)) {
          if (members.includes(m[2]) && members.includes(m[3]) && m[2] !== m[3]) {
            hits.push(`${relative(SRC, file)}:${hit.line} [${fam}] ${hit.text}`);
          }
        }
      }
    }
    const scanned = files.length;
    expect(scanned).toBeGreaterThan(500);
    expect(hits).toEqual([]);
  });
});
