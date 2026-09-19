// Task 645 — the CENSUS for the registry's CARD-BEARING half.
//
// `ATOM_REGISTRY` is the declared SSOT for Virgil's four inline atoms. Task 232
// made the RENDERING side drift-proof (each atom's `data-type` / class comes
// from its row) and task 256 closed the CONSUMER side for those same two
// facets (`ATOM_DOM_SELECTOR`, `CARD_ATOM_DOM_SELECTOR`). One facet was left
// out of both passes: the pairing of an atom's schema node name with the attr
// that carries its entity id — `footnote`/`footnoteId`,
// `citation`/`citationId`.
//
// That pair was written out BY HAND at seven sites in four different shapes:
// twin `INLINE_ATOM_CARDS` tables in `delete-range.ts` / `duplicate-slice.ts`
// (one of them conceding the duplication in its own comment — "Kept in sync by
// colocation"), an `ATOM_ID_ATTRS = ["citationId","footnoteId","linkId"]`
// literal in a file already importing the registry, two
// `dedupInlineId("citation","citationId")` calls in the serializer, a
// `data-footnote-id`/`data-citation-id` strip list on the drag ghost, the two
// panel drop specs, and two half-sourced DOM queries that took the CLASS from
// the registry and still spelled the id attr by hand. A fifth Card-bearing atom
// kind added tomorrow would have reached NONE of them — no compile error, no
// failing test, no user-visible symptom until the day one appeared.
//
// THE INVARIANT, in two halves, because the drift has two shapes:
//   A. THE PAIR — no production file outside the registry states a card atom's
//      node name and its id attr TOGETHER (one statement / adjacent lines).
//      That conjunction is the registry's own row, restated.
//   B. THE SET — no production file outside the registry enumerates BOTH card
//      atoms' id attrs (node spelling or DOM spelling) as literals. That list
//      is `CARD_ATOM_ID_ATTRS` / `CARD_ATOM_DOM_ID_ATTRS`, restated.
//
// ALLOWLIST EMPTY on both. A hit is CONVERT-it (read `CARD_ATOMS` /
// `CARD_ATOM_REGISTRY` / `cardAtomMetaForNodeName`), never a list entry.
//
// ANTI-VACUITY. A census whose needles match nothing passes for the wrong
// reason, and this one is especially exposed: its whole job is that the tree
// contains no such site, so "zero hits" is both the pass condition AND what a
// broken needle produces. Pinned three ways: (1) each retired shape is replayed
// as a fixture and the needle must find it; (2) `atom-registry.ts` itself must
// be seen by half A's needle, proving the scan reaches real files rather than
// an empty file list; (3) the vocabulary is DERIVED from the registry, so
// deleting a row shrinks the needle visibly rather than silently.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
// `strip(src, keepStrings=true, keepLines=true)`, not `codeOnly`: every needle
// here matches INSIDE a string literal (`"footnoteId"`), so blanking literals
// would make the whole census unfalsifiable — and lines must stay aligned
// because each hit reports `file:line`.
import { strip } from "@/lib/__tests__/_source-scan";
import {
  CARD_ATOMS,
  CARD_ATOM_ID_ATTRS,
  CARD_ATOM_DOM_ID_ATTRS,
} from "@/lib/tiptap/atom-registry";

const keepLiteralsAligned = (src: string) => strip(src, true, true);

const REPO = resolve(__dirname, "../../../..");
const ROOTS = ["src", "library"];

/** The registry's own home — it DECLARES the pair rather than restating it. */
const SSOT = "src/lib/tiptap/atom-registry.ts";

const alt = (xs: ReadonlyArray<string>) =>
  xs.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

/** Every Card-bearing atom's schema node name, DERIVED. */
const NODE_NAME_ALT = alt(CARD_ATOMS.map((m) => m.nodeName));
/** …its node attr (`footnoteId`), and its DOM attr (`data-footnote-id`). */
const ID_ATTR_ALT = alt(CARD_ATOM_ID_ATTRS);
const DOM_ID_ATTR_ALT = alt(CARD_ATOM_DOM_ID_ATTRS);

/** A QUOTED occurrence — the pair is only a re-spelling when the strings are
 *  literals. `node.attrs.footnoteId` is a property READ off a node the schema
 *  already typed; it re-derives nothing and is correctly not a hit. */
const QUOTED_NODE_NAME = new RegExp(`["'\`](?:${NODE_NAME_ALT})["'\`]`);
const QUOTED_ID_ATTR = new RegExp(`["'\`](?:${ID_ATTR_ALT}|${DOM_ID_ATTR_ALT})["'\`]`);

/** Half B needs BOTH kinds' id attrs present — one alone is a single fact
 *  (which a per-kind site may legitimately hold), two is the registry's list. */
const EACH_ID_ATTR = CARD_ATOM_ID_ATTRS.map(
  (a) => new RegExp(`["'\`]${a}["'\`]`),
);
const EACH_DOM_ID_ATTR = CARD_ATOM_DOM_ID_ATTRS.map(
  (a) => new RegExp(`["'\`]${a}["'\`]`),
);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "__tests__") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => walk(join(REPO, r))).map((f) => ({
  rel: relative(REPO, f),
  src: keepLiteralsAligned(readFileSync(f, "utf8")),
}));

interface Hit {
  rel: string;
  line: number;
  text: string;
}

/**
 * The WINDOW is three lines, not one. `nodeName: "footnote",` and
 * `idAttr: "footnoteId",` are the pair's most natural shape and they sit on
 * ADJACENT lines — the two drop specs wrote it exactly that way. A one-line
 * needle would have declared those two clean.
 */
function scan(
  files: ReadonlyArray<{ rel: string; src: string }>,
  predicate: (window: string) => boolean,
): Hit[] {
  const out: Hit[] = [];
  for (const { rel, src } of files) {
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const window = lines.slice(i, i + 3).join("\n");
      if (!predicate(window)) continue;
      out.push({ rel, line: i + 1, text: lines[i].trim() });
      // One hit per region — a 3-line window would otherwise report the same
      // pair up to three times.
      i += 2;
    }
  }
  return out;
}

const PAIRS = (w: string) => QUOTED_NODE_NAME.test(w) && QUOTED_ID_ATTR.test(w);
const ENUMERATES_SET = (w: string) =>
  EACH_ID_ATTR.every((r) => r.test(w)) || EACH_DOM_ID_ATTR.every((r) => r.test(w));

const OUTSIDE_SSOT = FILES.filter((f) => f.rel !== SSOT);

describe("the Card-bearing atom's {nodeName, idAttr} pair lives only in the registry (task 645)", () => {
  it("A · ALLOWLIST EMPTY — no production file restates the PAIR", () => {
    expect(
      scan(OUTSIDE_SSOT, PAIRS).map((h) => `${h.rel}:${h.line}  ${h.text}`),
      "a hand-paired atom node name + id attr — read it from the registry " +
        "(CARD_ATOM_REGISTRY.<kind>, cardAtomMetaForNodeName, CARD_ATOMS); " +
        "never allowlist it",
    ).toEqual([]);
  });

  it("B · ALLOWLIST EMPTY — no production file enumerates the card atoms' id attrs", () => {
    expect(
      scan(OUTSIDE_SSOT, ENUMERATES_SET).map((h) => `${h.rel}:${h.line}  ${h.text}`),
      "a hand-written list of the card atoms' id attrs — read " +
        "CARD_ATOM_ID_ATTRS / CARD_ATOM_DOM_ID_ATTRS instead; never allowlist it",
    ).toEqual([]);
  });
});

describe("the census can SEE what it forbids (task 645 — anti-vacuity)", () => {
  // Each fixture is one of the seven retired sites, verbatim in shape. If a
  // needle stops matching one of these, the corresponding ALLOWLIST-EMPTY leg
  // above has gone silent rather than green, and THIS leg is what says so.
  const RETIRED: ReadonlyArray<[string, string, "A" | "B"]> = [
    [
      "delete-range / duplicate-slice INLINE_ATOM_CARDS",
      'footnote: { cardKind: "footnote", idAttr: "footnoteId" },',
      "A",
    ],
    [
      "latex-serializer dedupInlineId",
      'dedupInlineId("citation", "citationId");',
      "A",
    ],
    [
      "panel drop spec (adjacent lines — the 3-line window)",
      'inlineAtomMoveSpec({\n  nodeName: "footnote",\n  idAttr: "footnoteId",',
      "A",
    ],
    [
      "inline-content ATOM_ID_ATTRS",
      'const ATOM_ID_ATTRS = ["citationId", "footnoteId", "linkId"] as const;',
      "B",
    ],
    [
      "inline-atom-ghost STRIP_ATTRS",
      '  "data-footnote-id",\n  "data-citation-id",\n];',
      "B",
    ],
  ];

  for (const [name, fixture, half] of RETIRED) {
    it(`half ${half} still matches: ${name}`, () => {
      const hits = scan([{ rel: "fixture.ts", src: fixture }], half === "A" ? PAIRS : ENUMERATES_SET);
      expect(hits.length, `needle ${half} no longer sees this shape`).toBeGreaterThan(0);
    });
  }

  it("the scan reaches real files — the registry itself IS a half-A hit", () => {
    // Proves `FILES` is populated and the stripper kept the literals. Without
    // this, an empty file list or a stripper that blanked strings would make
    // both ALLOWLIST-EMPTY legs pass on nothing at all.
    const ssot = FILES.find((f) => f.rel === SSOT);
    expect(ssot, `${SSOT} not scanned`).toBeDefined();
    expect(scan([ssot!], PAIRS).length).toBeGreaterThan(0);
  });

  it("the vocabulary is DERIVED — each card row contributes its own needles", () => {
    expect(CARD_ATOMS.length).toBeGreaterThanOrEqual(2);
    for (const m of CARD_ATOMS) {
      expect(NODE_NAME_ALT).toContain(m.nodeName);
      expect(CARD_ATOM_ID_ATTRS).toContain(m.idAttr);
      expect(CARD_ATOM_DOM_ID_ATTRS).toContain(m.domIdAttr);
    }
    // …and the id-less atoms are OUT: a needle that swept `labelRef` would
    // report on code that pairs nothing (it has no id attr to pair with).
    expect(CARD_ATOMS.map((m) => m.kind)).not.toContain("ref");
    expect(CARD_ATOMS.map((m) => m.kind)).not.toContain("inline-math");
  });
});
