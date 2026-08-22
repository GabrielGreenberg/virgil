// Task 396 — the CENSUS. The SSOT was never the part that could misbehave; a
// CREATE SITE THAT NEVER ASKS IT is, and that type-checks perfectly.
//
// `posHostsInlineAtom` (task 150) answers one question — *can this position host
// an INLINE atom without corrupting its container?* — and for five weeks it had
// exactly ONE production caller, the typed `$…$` input rule. Every other way an
// inline atom entered a document skipped it: the lightning grid's `$x$` and
// `Cross-ref` cells, `insertInlineAtom` (the shared door, and the only layer the
// deferred create-popover commit passes through), the slash `\footnote` insert,
// and the two native HTML5 citation drops. Measured against the real stack, an
// atom landed at an offset inside a MARKLESS verbatim block (`codeBlock` /
// `latexComment`, `content: "text*"`) TRUNCATES the block there and EJECTS its
// tail text into a fresh top-level paragraph beside the atom — so a line the user
// had commented OUT becomes live printed prose. Nothing throws; the doc is
// schema-valid; the save writes it straight through.
//
// THE INVARIANT: every production site that SPLICES an inline atom into a
// document asks the container question — by entering the shared door
// `insertInlineAtom` (which asks it), or by spelling `posHostsInlineAtom`
// itself. Allowlist EMPTY: a hit is GATE-it, never a list entry.
//
// MEMBERSHIP IS DISCOVERED, in two precise halves rather than one loose window —
// a hand list can only be missing the site that drifted, which is the whole
// finding:
//   A. a line that RESOLVES an inline-atom NodeType off a schema
//      (`schema.nodes.<atom>`) inside a declaration that also SPLICES. This is
//      the shape all five pre-396 raw sites have, and it must spell the INLINE
//      gate or the door — nothing weaker.
//   B. every splice inside a module that DECLARES an inline atom (an input rule
//      / keymap holding `this.type`, which never spells `schema.nodes.<atom>`).
//      Here EITHER container SSOT satisfies, because `math.ts` legitimately holds
//      the `displayMath` BLOCK branch too and its gate is `posHostsBlockInsert`.
//      Stated residual: a future INLINE splice in such a module guarded only by
//      the block gate would pass this half. Half A has no such give.
//
// SCOPE, stated rather than implied. This censuses the CREATE DOORS. The
// drop-mode / slice family (`inline-atom-move.ts`, `stack-pull.ts`,
// `text-range-move.ts`) is governed by its OWN census, in the file the splice
// family already lives in: `container-fit-guardrail.test.ts`'s THIRD question
// (task 414) — every splice excused from the container FIT must ask the inline
// container question in its enclosing declaration, allowlisted per LINE. This
// file's `OUT_OF_SCOPE` no longer carves that directory out; what remains in the
// list is the SSOT's own home. Half A finds nothing there today (a drop-mode
// splice resolves its type from a source node or a persisted blob, never from
// `schema.nodes.<atom>`), which is exactly why the teeth had to be a census of
// the SPLICE family rather than of the type-resolution shape — a green answer
// from this file about that directory would be a vacuous one, and saying
// otherwise would be the overstatement this whole class is about.
//
// The AFFORDANCE half of 414 — that the hit-test refuses to PAINT a caret it
// cannot honour, so the hover and the commit answer from one table — is asked of
// the live spec objects in `placement-reachability.test.ts` (every spec that can
// offer an inline caret declares `inlinePayloadFor`), and driven end to end in
// `src/components/drop-mode/__tests__/inline-cursor-container-gate.test.tsx`.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
// `strip(src, keepStrings, keepLines)` directly, not `commentsStripped`: this
// census needs BOTH — literals kept (half B's needle lives inside one) AND
// lines aligned (every hit reports `file:line`, and `commentsStripped` drops
// the newlines inside a block comment).
import { strip, codeOnlyLines } from "@/lib/__tests__/_source-scan";
const keepLiteralsAligned = (src: string) => strip(src, true, true);
import { ATOM_REGISTRY, type AtomKind } from "@/lib/tiptap/atom-registry";

const REPO = resolve(__dirname, "../../../..");
const ROOTS = ["src", "library"];

/** Every INLINE-atom schema node name, DERIVED from the registry — a new atom
 *  kind joins this census by declaring itself there. */
const ATOM_NODE_NAMES = Object.values(ATOM_REGISTRY).map((m) => m.nodeName);
const ATOM_ALT = ATOM_NODE_NAMES.join("|");

/** A: `…schema.nodes.<atom>` — how a non-extension site names its atom type. */
const RESOLVES_ATOM_TYPE = new RegExp(`\\bnodes\\.(?:${ATOM_ALT})\\b`);
/** B: a module that DECLARES one of the atoms (its own extension file). */
const DECLARES_ATOM = new RegExp(`name:\\s*["'](?:${ATOM_ALT})["']`);
/** A node reaching the document. */
const SPLICE =
  /\.(?:replaceWith|replaceSelectionWith|replaceRangeWith|insertContentAt|insertContent)\s*\(|\btr\.insert\s*\(|\btr\.replace\s*\(/;
/** …plus the dispatch that makes a resolved-type declaration a real create. */
const LANDS = new RegExp(`${SPLICE.source}|\\bdispatch\\s*\\(`);

const ASKS_DOOR = /insertInlineAtom\s*\(/;
const ASKS_INLINE_SSOT = /posHostsInlineAtom\s*\(/;
const ASKS_BLOCK_SSOT = /posHostsBlockInsert\s*\(/;

/** The SSOT's own home — it DECLARES the predicate rather than asking it. The
 *  drop-mode directory is NO LONGER carved out (task 414 gave it a real census
 *  of its own; see the header). */
const OUT_OF_SCOPE = ["src/text-objects/text-object-registry.ts"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "__tests__") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => walk(join(REPO, r)))
  .map((f) => ({ rel: relative(REPO, f), raw: readFileSync(f, "utf8") }))
  .filter((f) => !OUT_OF_SCOPE.some((p) => f.rel.startsWith(p)))
  // `commentsStripped`, NOT `codeOnly`: the needles match inside STRING
  // LITERALS (`name: "footnote"`), and blanking them makes half B blind — the
  // exact trap `_source-scan`'s own header documents. Line-aligned so a hit can
  // name `file:line`.
  .map((f) => ({ ...f, src: keepLiteralsAligned(f.raw) }));

interface Hit {
  rel: string;
  line: number;
  text: string;
  half: "A" | "B";
}

/** `if (…) {` and friends open a BLOCK, not a declaration — a region that
 *  stopped at one would miss a gate placed at the top of the enclosing handler,
 *  which is exactly where `citation.ts` puts the gate its two branches share. */
const BLOCK_KEYWORDS = /\b(?:if|for|while|switch|catch|try|else|do|return)\s*[({]/;
/** A function/handler/method opener: an arrow, a `function`, or a method
 *  shorthand (`handleTextInput(view, from, to, text) {`). */
const FUNCTION_OPENER = /=>\s*\{|\bfunction\b|^\s*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{\s*$/;

const indentOf = (line: string): number =>
  line.trim() === "" ? Number.MAX_SAFE_INTEGER : line.length - line.trimStart().length;

/** The nearest FUNCTION opener at a shallower indent than `line` — never a bare
 *  `if`/`try` block, which would cut a shared gate off from the branch it
 *  guards (`citation.ts` puts one gate above two branches). Capped at 200 lines. */
function openerAbove(lines: string[], idx: number): number {
  const hitIndent = indentOf(lines[idx] ?? "");
  const floor = Math.max(0, idx - 200);
  for (let i = idx - 1; i >= floor; i--) {
    const l = lines[i];
    if (indentOf(l) >= hitIndent) continue;
    if (BLOCK_KEYWORDS.test(l)) continue;
    if (FUNCTION_OPENER.test(l)) return i;
  }
  return floor;
}

/**
 * DISCOVERY window — opener → 80 lines past the hit. Generous FORWARD, because
 * half A's hit is the type RESOLUTION and its splice can sit well below it (38
 * lines in `RichTextField.tsx`'s drop handler).
 */
function discoveryRegion(src: string, line: number): string {
  const lines = src.split("\n");
  const idx = line - 1;
  return lines.slice(openerAbove(lines, idx), idx + 81).join("\n");
}

/** The line the payload actually LANDS on: the hit itself for half B (the hit IS
 *  the splice), or the first splice at/below a half-A type resolution. */
function spliceLine(src: string, hit: Hit): number {
  if (hit.half === "B") return hit.line;
  const lines = src.split("\n");
  for (let i = hit.line - 1; i < Math.min(lines.length, hit.line + 80); i++) {
    if (LANDS.test(lines[i])) return i + 1;
  }
  return hit.line;
}

/**
 * GATE window — opener → the SPLICE line, and never past it. A gate that runs
 * AFTER the insert answers nothing, so the census must not accept one: that is
 * the difference between "the region mentions the SSOT" and "the SSOT was asked
 * before the atom landed."
 */
function gateRegion(src: string, hit: Hit): string {
  const lines = src.split("\n");
  const end = spliceLine(src, hit) - 1;
  return lines.slice(openerAbove(lines, end), end + 1).join("\n");
}

function hits(): Hit[] {
  const out: Hit[] = [];
  for (const { rel, src } of FILES) {
    const lines = src.split("\n");
    const declaresAtom = DECLARES_ATOM.test(src);
    lines.forEach((line, i) => {
      const n = i + 1;
      if (RESOLVES_ATOM_TYPE.test(line) && LANDS.test(discoveryRegion(src, n))) {
        out.push({ rel, line: n, text: line.trim(), half: "A" });
        return;
      }
      if (declaresAtom && SPLICE.test(line)) {
        out.push({ rel, line: n, text: line.trim(), half: "B" });
      }
    });
  }
  return out;
}

const HITS = hits();
const SRC_BY_FILE = new Map(FILES.map((f) => [f.rel, f.src]));

describe("every inline-atom splice asks the container question (task 396)", () => {
  it("the census can SEE the sites (self-check)", () => {
    // A needle matching nothing passes the leg below vacuously.
    const files = new Set(HITS.map((h) => h.rel));
    // The five pre-396 ungated raw sites, each by the half that must find it.
    for (const [f, half] of [
      ["src/components/Editor.tsx", "A"],
      ["src/components/RichTextField.tsx", "A"],
      ["src/lib/tiptap/commands.ts", "A"],
      ["src/lib/tiptap/footnote.ts", "B"],
      ["src/lib/tiptap/citation.ts", "B"],
      ["src/lib/tiptap/math.ts", "B"],
    ] as const) {
      expect([...files], `${f} not censused`).toContain(f);
      expect(
        HITS.some((h) => h.rel === f && h.half === half),
        `${f} censused, but not by half ${half}`,
      ).toBe(true);
    }
    expect(HITS.length).toBeGreaterThanOrEqual(8);
  });

  it("ALLOWLIST EMPTY — every site asks a container SSOT before it splices", () => {
    const ungated = HITS.filter((h) => {
      const r = gateRegion(SRC_BY_FILE.get(h.rel)!, h);
      if (ASKS_DOOR.test(r) || ASKS_INLINE_SSOT.test(r)) return false;
      // Half B only: `math.ts`'s `displayMath` branch is a BLOCK atom living in
      // an inline atom's own module, and its SSOT is the block one.
      return !(h.half === "B" && ASKS_BLOCK_SSOT.test(r));
    });
    expect(
      ungated.map((h) => `[${h.half}] ${h.rel}:${h.line}  ${h.text}`),
      "an inline-atom splice that asks no container SSOT — GATE it (import " +
        "posHostsInlineAtom, or route through insertInlineAtom); never allowlist it",
    ).toEqual([]);
  });

  it("half A accepts ONLY the inline gate (a block gate is not an answer there)", () => {
    // Pins the asymmetry the header states, so a later "simplification" that
    // let half A take `posHostsBlockInsert` is a failing test rather than a
    // silent widening.
    const aHits = HITS.filter((h) => h.half === "A");
    expect(aHits.length).toBeGreaterThan(0);
    for (const h of aHits) {
      const r = gateRegion(SRC_BY_FILE.get(h.rel)!, h);
      expect(
        ASKS_DOOR.test(r) || ASKS_INLINE_SSOT.test(r),
        `${h.rel}:${h.line} must spell the INLINE gate or the door`,
      ).toBe(true);
    }
  });
});

describe("the door and the affordance read the SSOT (task 396)", () => {
  const read = (rel: string) =>
    keepLiteralsAligned(readFileSync(join(REPO, rel), "utf8"));

  it("insertInlineAtom itself spells posHostsInlineAtom", () => {
    // The door is what covers the deferred create-popover commit (a captured
    // `at` no `applies()` can see) and every FUTURE inline atom.
    expect(ASKS_INLINE_SSOT.test(read("src/lib/tiptap/insert-inline-atom.ts"))).toBe(true);
  });

  it("the two inline-atom rows take the container-aware factory, not the bare gate", () => {
    const src = read("src/lib/actions/action-registry.ts");
    // Pinned by SOURCE because a wrong `applies` type-checks perfectly: the bare
    // `blockApplies` and the factory have the SAME signature, which is exactly
    // how these two rows rode the wrong one for five weeks.
    expect(src).toMatch(/applies:\s*inlineAtomInsertApplies\("inlineMath"\)/);
    expect(src).toMatch(/applies:\s*inlineAtomInsertApplies\("labelRef"\)/);
  });

  it("the lightning CELLS ask their own row — the affordance has a consumer", () => {
    // The rows were a DEAD FACET until this: the grid greys via a hand-computed
    // `blockAtomsDisabled` (one probe of the `example` row) and the two inline
    // cells carried `disabled={!canEdit}` only, so `inlineAtomInsertApplies` had
    // ZERO production consumers and "the cells are greyed" was false. A facet
    // nothing reads is this repo's own recurring finding, one level up from the
    // one this task fixes.
    //
    // GENERALIZED (task 397): the per-id helper `rowDisabled` this leg pinned is
    // now `gridCellDisabled`, and it is no longer the exception — it is the ONE
    // door EVERY grid cell enters, both shared probes having been retired for the
    // same reason these two cells never shared one. The general form of the leg
    // (every cell asks its OWN id, allowlist EMPTY) lives in
    // `src/components/__tests__/grid-cell-applicability-census.test.ts`; what
    // stays here is the inline-atom pair specifically, so this suite still fails
    // on its own if these two rows are un-wired.
    const src = read("src/components/ActionsMenuPanel.tsx");
    expect(src).toMatch(/id="inline-math"[\s\S]{0,200}?disabled=\{gridCellDisabled\("inline-math"\)\}/);
    expect(src).toMatch(/id="ref"[\s\S]{0,200}?disabled=\{gridCellDisabled\("ref"\)\}/);
    // …and NOT via a shared probe: the two rows pass different schema node
    // names, so one probe would assert the schema answers identically.
    expect(src).toMatch(/const gridCellDisabled = \(id: ActionId\)/);
  });

  it("both native drops GATE BEFORE they MINT — ordering, which no grep of the region can see", () => {
    // A gate placed after the card mint trades the corruption for a card with no
    // atom: the same defect one layer down. Asserted as an ORDER because the
    // ALLOWLIST leg only asks whether the region SPELLS a gate.
    for (const [rel, mint] of [
      ["src/components/Editor.tsx", "onCitationDropRef.current("],
      ["src/components/RichTextField.tsx", "onCitationCreatedRef.current("],
    ] as const) {
      const src = read(rel);
      const drop = src.indexOf("MIME_CITATION");
      expect(drop, `${rel}: no MIME_CITATION branch`).toBeGreaterThan(0);
      const gateAt = src.indexOf("posHostsInlineAtom(", drop);
      const mintAt = src.indexOf(mint, drop);
      expect(gateAt, `${rel}: no gate in the drop branch`).toBeGreaterThan(0);
      expect(mintAt, `${rel}: no mint in the drop branch`).toBeGreaterThan(0);
      expect(gateAt, `${rel}: the gate must precede the card mint`).toBeLessThan(mintAt);
    }
  });

  it("mathRun's INLINE branch carries its own bail (defence in depth)", () => {
    // Its display twin has had one since task 147; the inline branch's own
    // comment used to declare itself EXEMPT on the retired premise. This leg is
    // what makes that bail non-deletable — the door already refuses, so no
    // behavioural leg can see it.
    const src = read("src/lib/actions/action-registry.ts");
    const at = src.indexOf('if (kind === "inline")');
    expect(at, "mathRun inline branch not found").toBeGreaterThan(0);
    expect(src.slice(at, at + 1200)).toMatch(ASKS_INLINE_SSOT);
  });

  it("THE REPORT IS THE PERMISSION — every card-minting caller reads `refused`", () => {
    // A refusal that a caller ignores leaves a CARD with no atom in the
    // document: the defect one layer down. The two callers that mint an entity
    // AFTER the insert must gate on the door's report. Pinned by SOURCE — a
    // caller that drops the check type-checks perfectly, and no behavioural test
    // of the door can see it.
    const layout = read("src/components/EditorLayout.tsx");
    expect(layout).toMatch(/const \w+ = insertInlineAtom\(/);
    expect(layout).toMatch(/\.refused\)\s*return;/);
    const editorSrc = read("src/components/Editor.tsx");
    // Both footnote creators (`createFootnoteFromSelection`, `createEmptyFootnote`).
    expect(editorSrc.match(/\.refused\)\s*return null;/g)?.length ?? 0).toBe(2);
  });

  it("the narrow type-only twin is NOT exported — one door, one answer", () => {
    // `blockTypeHostsInlineAtom` cannot clamp a stale caret and every real
    // consumer holds a position, so an exported narrow twin is how a call site
    // comes to ask the smaller question (AGENTS.md → "A registry earns its name
    // by being read": a sibling call is not a consumer).
    const ssot = keepLiteralsAligned(
      readFileSync(join(REPO, "src/text-objects/text-object-registry.ts"), "utf8"),
    );
    expect(ssot).not.toMatch(/export function blockTypeHostsInlineAtom/);
    expect(ssot).toMatch(/export function posHostsInlineAtom/);
  });
});

describe("the census's own vocabulary is DERIVED (task 396)", () => {
  it("every ATOM_REGISTRY kind contributes its node name", () => {
    const kinds = Object.keys(ATOM_REGISTRY) as AtomKind[];
    expect(kinds.length).toBeGreaterThanOrEqual(4);
    for (const k of kinds) {
      expect(ATOM_NODE_NAMES).toContain(ATOM_REGISTRY[k].nodeName);
    }
  });

  it("the stripper self-check: comments are blanked, literals survive", () => {
    // Half B's needle lives INSIDE a string literal; if the stripper blanked
    // literals this whole census would go silent, not red.
    const probe = keepLiteralsAligned(
      'const a = "name: \\"footnote\\""; // name: "citation"\n',
    );
    expect(probe).toContain('name:');
    expect(probe).not.toContain("citation");
    void codeOnlyLines; // (kept imported so the contrast is one edit away)
  });
});
