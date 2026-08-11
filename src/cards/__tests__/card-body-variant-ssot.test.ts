// Card body-variant SSOT guardrail (task 290) — the static half of the
// "never hand-pick a card's body typography per card" contract.
//
// Every docked/omni panel card renders its body through `EditableCard`, whose
// `variant` prop selects the RichTextField typographic dialect ("footnote" =
// borrowed serif/15px, "note" = sans). That choice is DERIVED from the registry
// `bodyClass` via the ONE SSOT `bodyVariantForCardKind(kind)` (predicates.ts) —
// it must never be a hand-picked literal on the card, because a future
// `bodyClass` flip (as happened to Report — see the R11 comment at
// card-registry.tsx) would then silently render the wrong dialect.
//
// `assertPanelTypographyCoverage` pins the registry's `bodyClass` internally,
// but it does NOT look at the cards' JSX — so a card hardcoding `variant="…"`
// against its own `bodyClass` slips past it. This test closes that gap: it walks
// every source file that renders an `<EditableCard>`, pairs each body-`variant`
// prop with its element's `cardKind`, and asserts the passed variant equals
// `bodyVariantForCardKind(cardKind)` — as either the derived call for the card's
// OWN kind or a string literal that resolves to the same value.
//
// A future `variant="footnote"` hardcode on a `sans` card (the exact pre-290
// Archive/Footnote drift) trips this instead of shipping.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { bodyVariantForCardKind } from "@/cards/predicates";
import type { CardKind } from "@/cards/types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip test + fixture trees so the guard never scans itself.
      if (entry === "__tests__" || entry === "__fixtures__") continue;
      out.push(...walkSource(full));
    } else if (/\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// A body-`variant` prop on an EditableCard, in either sanctioned shape:
//   variant="footnote" | variant="note"                (string literal)
//   variant={bodyVariantForCardKind("<kind>")}         (derived — the SSOT)
// The button `variant="danger"|"warm"` on the suggestion cards' apply controls
// is a different prop on a different component and never matches this set.
const BODY_VARIANT_RE =
  /variant=(?:"(footnote|note)"|\{\s*bodyVariantForCardKind\(\s*"([^"]+)"\s*\)\s*\})/g;
const CARD_KIND_RE = /cardKind="([^"]+)"/g;
const EDITABLE_CARD_RE = /<EditableCard[\s/>]/g;

type Site = {
  rel: string;
  index: number;
  literal?: string; // the string-literal variant, if that shape
  derivedKind?: string; // the bodyVariantForCardKind("K") kind, if that shape
  cardKind: string; // nearest preceding cardKind="…" — the element's kind
};

function countMatches(source: string, re: RegExp): number {
  return (source.match(re) ?? []).length;
}

/** Nearest `cardKind="…"` occurring BEFORE `index` (within an EditableCard the
 *  cardKind prop always precedes the body variant), or null if none. */
function precedingCardKind(source: string, index: number): string | null {
  let found: string | null = null;
  CARD_KIND_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CARD_KIND_RE.exec(source)) && m.index < index) {
    found = m[1];
  }
  return found;
}

const files = walkSource(SRC).filter((f) =>
  /<EditableCard/.test(readFileSync(f, "utf8")),
);

const sites: Site[] = [];
let editableCardCount = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const rel = path.relative(SRC, file).split(path.sep).join("/");
  editableCardCount += countMatches(source, EDITABLE_CARD_RE);
  BODY_VARIANT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BODY_VARIANT_RE.exec(source))) {
    const cardKind = precedingCardKind(source, m.index);
    if (cardKind == null) continue; // a body variant with no owning element — impossible in practice
    sites.push({
      rel,
      index: m.index,
      literal: m[1],
      derivedKind: m[2],
      cardKind,
    });
  }
}

describe("card body-variant SSOT (task 290)", () => {
  it("finds every card's EditableCard body variant (regex didn't silently match nothing)", () => {
    // Pre-290 there were 9 EditableCard body sites (Notes, Reports×2, Cutter,
    // Revisions, Archive, Footnotes×3). If this drops the migration or a new
    // card is added, adjust — but never let it read 0.
    expect(sites.length).toBeGreaterThanOrEqual(9);
  });

  it("every EditableCard passes a recognized (SSOT-derived or literal) body variant — none omitted or hand-rolled", () => {
    // Count equality is the omission/hand-roll guard: an EditableCard that
    // ships NO variant, or one written as some other expression, won't be a
    // recognized body-variant site, so the counts diverge. Use
    // `variant={bodyVariantForCardKind("<kind>")}` like the sibling cards.
    expect(sites.length).toBe(editableCardCount);
  });

  it("every EditableCard derives its body variant from the SSOT (no hand-picked literal — pre-290 Archive/Footnote drift)", () => {
    for (const s of sites) {
      // The whole point of the migration (predicates.ts: "never hand-picked per
      // card") is that a body variant is NEVER a literal — a correct literal
      // today silently renders the wrong dialect the moment its kind's
      // `bodyClass` is flipped (as Report's once was). So a literal shape fails
      // outright, not just a divergent one.
      expect(
        s.literal,
        `${s.rel}: variant="${s.literal}" is a hand-picked literal on a cardKind="${s.cardKind}" element — replace it with variant={bodyVariantForCardKind("${s.cardKind}")} so it can never drift from the registry bodyClass SSOT`,
      ).toBeUndefined();
      // Derived shape: must derive from the card's OWN kind (not a sibling's),
      // so it can never drift from the element's bodyClass.
      expect(
        s.derivedKind,
        `${s.rel}: variant={bodyVariantForCardKind("${s.derivedKind}")} on a cardKind="${s.cardKind}" element — derive from the element's own kind`,
      ).toBe(s.cardKind);
      // And the derivation must resolve to a defined dialect for a real kind
      // (guards a typo'd kind string slipping through the union at the JSX site).
      expect(bodyVariantForCardKind(s.cardKind as CardKind)).toMatch(
        /^(footnote|note)$/,
      );
    }
  });
});
