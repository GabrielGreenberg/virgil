// @vitest-environment node
//
// TASK 664 — the SHAPE half.
//
// "This card is anchored to N paragraphs" had TWO canonical spellings on
// disk, written by the two branches of one migration module, and neither
// had a consumer that read all of it:
//
//   shape 1 — ONE link carrying `textObjectIds: [p1, p2, …]`
//   shape 2 — N links, one id each (what every live write path emits)
//
// Against shape 1 the readers asked `textObjectIds[0]` and called that "the
// card's anchor", so a card whose `p1` died in the `.tex` round-trip but
// whose `p2` was alive orphaned wholesale. Against shape 2 the relocating
// mutator had no way to know WHICH link matched, so it rewrote every link of
// the resolution's mode and lost the card's second anchor.
//
// THE LAW
//
//   `textObjectIds[0]` is not "the card's anchor". A reader that asks where
//   a card is anchored reads EVERY id; only a writer that mints or rewrites
//   a link's PRIMARY paragraph — the one its single `paragraphSnapshot`
//   pins — may name index 0, and every such site is enumerated here.
//
// Two legs:
//   A — the two readers that answer "where is this card anchored?" ITERATE.
//   B — an EXACT-COUNT census of every remaining `[0]` on the id list,
//       alias chains included (`const ids = …textObjectIds; ids[0]` spells
//       the same read without the word, and is exactly how the pre-664 tree
//       hid one of these from a naive grep). A count, not a file allowlist:
//       a file already on the list must not be able to smuggle in a fifth.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { codeOnly, commentsStripped } from "@/lib/__tests__/_source-scan";

const SRC = path.resolve(__dirname, "../..");

/**
 * Every production `.ts`/`.tsx` under `src/`, comments blanked but STRINGS
 * KEPT. `codeOnly` would blank template literals too, and `makeAnchorLink`
 * mints its link id inside one — `` `${cardId}@${textObjectIds[0] ?? ""}` ``
 * — so a string-blanking census cannot see the one site in this subsystem
 * that names index 0 from inside a template. A census blind to a live site
 * in the file it polices is the hole, not the coverage.
 */
function productionSources(): Array<{ rel: string; code: string }> {
  const out: Array<{ rel: string; code: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      out.push({
        rel: path.relative(SRC, full),
        code: commentsStripped(readFileSync(full, "utf8")),
      });
    }
  };
  walk(SRC);
  return out;
}

/**
 * Count every `[0]` index into a card's `textObjectIds` — written directly,
 * or through a chain of local aliases (`const ids = l.anchor.textObjectIds;`
 * then `const newIds = ids.slice();` then `newIds[0] = …`). The alias chase
 * is the point: the naive spelling census is the hole task 668 names on the
 * sibling suite, and this subsystem already had one of these reads hiding
 * behind a two-link alias chain.
 */
function firstIdReads(code: string): number {
  const aliases = new Set<string>();
  // Fixpoint: `const X = <anything mentioning textObjectIds or a known
  // alias>` makes X an alias for the id list.
  for (let pass = 0; pass < 8; pass++) {
    const before = aliases.size;
    const decl = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
    let m: RegExpExecArray | null;
    while ((m = decl.exec(code))) {
      const [, name, rhs] = m;
      if (aliases.has(name)) continue;
      const mentionsList =
        /\btextObjectIds\b/.test(rhs) ||
        [...aliases].some((a) => new RegExp(`\\b${a}\\b`).test(rhs));
      // `.textObjectIds[0]` on the RHS is a first-id READ, not an alias to
      // the list — it is counted below, not here.
      if (mentionsList && !/\[\s*0\s*\]/.test(rhs)) aliases.add(name);
    }
    if (aliases.size === before) break;
  }
  const names = ["textObjectIds", ...aliases];
  let count = 0;
  for (const n of names) {
    const re = new RegExp(`\\b${n}\\s*\\[\\s*0\\s*\\]`, "g");
    count += (code.match(re) ?? []).length;
  }
  return count;
}

/**
 * The EXACT set of production sites that may name index 0, with the reason
 * each is a WRITER of a link's primary paragraph rather than a reader of
 * "the card's anchor". Change a number only with the reason beside it.
 */
const SANCTIONED: Record<string, { count: number; why: string }> = {
  "links/resolve-card-anchor.ts": {
    count: 2,
    why:
      "`relocateBySnapshot` rewrites the winning link's PRIMARY paragraph " +
      "(`newIds[0] = paragraphId`) and guards idempotency on it. There is " +
      "exactly one `paragraphSnapshot` per link and it pins index 0.",
  },
  "links/links.ts": {
    count: 3,
    why:
      "`makeAnchorLink` MINTS a link id from the first paragraph " +
      "(`<cardId>@<pid>`), and the legacy test-only `reconcileModeAAnchors` " +
      "rebinds index 0 the same way `relocateBySnapshot` does.",
  },
  "links/_shared/reapply-mode-b-anchors.ts": {
    count: 1,
    why:
      "Mode B's CONTAINING paragraph. A `linkedRange` link legitimately " +
      "carries it at index 0 beside its one `textRange`; this is not a " +
      "Mode-A anchor list.",
  },
};

describe("task 664 — `textObjectIds[0]` is not 'the card's anchor'", () => {
  it("A — the two 'where is this card anchored?' readers iterate every id", () => {
    const resolver = codeOnly(
      readFileSync(path.join(SRC, "links", "resolve-card-anchor.ts"), "utf8"),
    );
    const rung1 = /--- Rung 1[\s\S]*?--- Rung 2:/.exec(
      readFileSync(path.join(SRC, "links", "resolve-card-anchor.ts"), "utf8"),
    );
    expect(rung1, "rung 1 not found — renamed? re-point this leg").toBeTruthy();
    expect(
      rung1![0],
      "Rung 1 answers WHERE a card is anchored. Reading `[0]` orphaned a " +
        "card whose first pid died and whose second was alive — while rung " +
        "2b and `getLinkedTextObjectIds` both already iterated.",
    ).toMatch(/for\s*\(\s*const\s+pid\s+of\s+link\.anchor\.textObjectIds\s*\)/);

    const orphan = /export function isModeAOrphaned[\s\S]*?\n\}/.exec(
      readFileSync(path.join(SRC, "links", "links.ts"), "utf8"),
    );
    expect(orphan, "isModeAOrphaned not found — renamed?").toBeTruthy();
    expect(
      orphan![0],
      "The orphan predicate must agree with the ladder that recovers the card.",
    ).toMatch(/for\s*\(\s*const\s+pid\s+of\s+link\.anchor\.textObjectIds\s*\)/);
    // And the resolver's own file still compiles the rung we just read.
    expect(resolver).toContain("linkIndex");
  });

  it("B — every remaining first-id site is sanctioned, by exact count", () => {
    const found: Record<string, number> = {};
    for (const { rel, code } of productionSources()) {
      const n = firstIdReads(code);
      if (n > 0) found[rel] = n;
    }
    const expected = Object.fromEntries(
      Object.entries(SANCTIONED).map(([k, v]) => [k, v.count]),
    );
    expect(
      found,
      "A new `textObjectIds[0]` (or an aliased `ids[0]`) in production is a " +
        "reader treating the first id as the card's anchor — the exact shape " +
        "this task retired. If the site genuinely WRITES a link's primary " +
        "paragraph, add it to SANCTIONED with its reason.\n" +
        Object.entries(SANCTIONED)
          .map(([k, v]) => `  ${k}: ${v.why}`)
          .join("\n"),
    ).toEqual(expected);
  });
});
