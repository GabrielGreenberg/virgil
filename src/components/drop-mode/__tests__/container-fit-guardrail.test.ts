// Container-fit guardrail (task 257) — the CI half of "a between-blocks insert
// asks the container what it can hold", in the same shape as the
// keystroke-sanctity, scroll-reposition, pane-drag, editor-observer,
// cross-window-storage, transient-highlight and applied-splice guards:
//
//   SOURCE-GREP ALLOWLIST — walk `src/components/drop-mode/` and flag every SITE
//   that splices content into a transaction (the whole `insert` / `replace` /
//   `replaceWith` / `replaceRangeWith` / `replaceSelectionWith` / `step(` /
//   `insertContentAt` family, on any receiver). A site passes only if a
//   `fitNodesAtInsert(` call appears within the preceding window, or it carries
//   an inline `container-fit-exempt:` marker stating why it cannot tear a
//   container — and every file carrying such a marker must sit on
//   `PERMITTED_UNFITTED_INSERTS`.
//
// The first version of this guard was both too narrow AND too coarse, and the
// two holes conspired: it matched only `.insert(` on three receiver spellings,
// and it asked its question PER FILE. `stack-pull.ts` spliced a block slice with
// `tr.replace(pos, pos, slice)` — invisible to the detector — in a file that
// already called `fitNodesAtInsert` twice elsewhere, so it would have been
// exempt even if the detector had matched. The guard reported green while that
// door was still tearing `exampleItemList` in two. Hence: the whole splice
// family, and per-SITE proximity rather than per-file presence.
//
// WHY this needs a guard rather than care. The bug it pins was invisible at all
// four call sites, because each one looked complete on its own terms:
//
//   • `text-range-move.ts` fit the drop context — for LISTS, via a hardcoded
//     `parentKind === "bulletList" || "orderedList"` literal. Correct, tested,
//     and silent about expex: a text selection released in an example's item gap
//     spliced a bare `paragraph` into `exampleItemList` (content `exampleItem+`),
//     and ProseMirror's fitter resolved the invalidity by SPLITTING the example
//     in two — both halves keeping the SAME uuid — with the moved text stranded
//     at top level between them.
//   • `textobject.ts` fit the drop context — via the registry adapters, which
//     know expex and the sub-object containers and nothing about lists. Same
//     tear, mirrored: a paragraph released in a list-item gap split the list.
//   • `util/block-move.ts` and `stack-pull.ts` asked nothing at all.
//
// Nothing threw. `tr.insert` at an invalid position doesn't fail — the fitter
// "succeeds" by reshaping the document around the payload, so the corruption
// surfaces later as a duplicated example/list with a duplicated uuid. A test of
// the fit function alone would not have caught any of this: the fit was never
// the part that misbehaved — the part that misbehaved was a call site that
// never asked. That is what this guard watches.
//
// Adding an entry to the allowlist is a claim that the insert CANNOT tear a
// container. Inline-atom placement qualifies (it inserts an inline node at an
// inline-cursor position inside a textblock — a different question entirely).
// A new BLOCK insert never does: route it through `fitNodesAtInsert`.
//
// ── The SECOND question (task 328): did you ADOPT? ──────────────────────────
//
// Same splice-site family, one axis over. `AGENTS.md` ("The move half", rule 4)
// states the law — *a payload arrives in the target's vocabulary or not at all*
// — and until 328 the ONLY enforcement was a private helper inside
// `fitNodesAtInsert`, reachable solely THROUGH the container fit. So the two
// splices deliberately exempted from the fit above took an exemption from the
// ADOPTION with them, for free and in silence. The marker's stated reason ("an
// open slice merging with the text around a caret… no container is being
// entered") is a true statement about CONTAINERS and a false one about
// VOCABULARIES, and nothing in this file could tell the difference.
//
// What that cost: a main-doc selection — or a footnote/citation atom — released
// at an inline caret inside a card body was spliced with nodes from the SOURCE
// schema. ProseMirror compares `NodeType`s by IDENTITY, so the fitter dropped
// the payload, `replaceStep` returned null, and `Transform.replace` appended NO
// step: `steps: 0`, `docChanged: false`, no throw. The move's second
// transaction — the unconditional source delete — ran anyway. Prose gone from
// the document, nothing in the card, float closed, no error.
//
// So: an exemption is scoped to the shape it justifies (task 204's rule). A
// `container-fit-exempt:` marker does NOT satisfy the adoption question; a
// splice that skips `fitNodesAtInsert` must either call an adoption door from
// `schema-adopt.ts` or carry its OWN `schema-adopt-exempt: <why>` marker, and
// each such marker is allowlisted PER LINE (not per file — a file-scoped
// exemption would excuse the next splice added beside it, which is the drift
// both halves of this guard exist to catch).
//
// ── Following the shared splice DOOR (task 331) ─────────────────────────────
//
// `util/mapped-insert.ts` lifted the delete-then-insert splice into one
// primitive (`insertNodesAdvancing`), because the "ask the mapping, advance by
// what landed" rule was re-derived at four call sites and stale at three. A
// bare-name call is invisible to `SPLICE_CALL`, which requires a `.method(`
// receiver — so, left alone, that refactor would have QUIETLY DRAINED this
// census: every converted site would stop being a splice site and both
// questions above would go unasked for it, which is precisely the drift these
// legs exist to catch, arriving this time as a tidy-up.
//
// So the door is itself a splice call: `insertNodesAdvancing(` is in the family,
// and the primitive's own internal `tr.insert(` carries BOTH exemptions. Those
// two entries are honest ONLY because of the line above — the wrapper buys no
// exemption for its callers, it relocates the question to them, where a refusal
// can still return before the source is deleted.
//
// STATED LIMIT, shared by both questions: the region is the enclosing
// DECLARATION, so an adoption in one branch vouches for a splice in a sibling
// branch of the same function. That is deliberate — the two live specs adopt
// ABOVE their same/cross fork precisely so the vouching is honest — but it is a
// granularity, not a proof, and a future declaration whose branches disagree
// would need the adoption hoisted the same way rather than the guard relaxed.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DROP_MODE = path.resolve(HERE, ".."); // src/components/drop-mode/

// ── The permitted unfitted-insert allowlist ─────────────────────────────────
// A file may appear here only if every one of its unfitted splice sites carries
// an inline `container-fit-exempt:` marker; the entry records why.
const PERMITTED_UNFITTED_INSERTS: Record<string, string> = {
  "util/inline-atom-move.ts":
    "INLINE atoms (footnote / citation / ref / inline math) placed at an " +
    "inline-cursor position inside a textblock — not a block-in-container " +
    "insert, so there is no wrap-or-refuse decision to make and no container " +
    "the fitter could split to accommodate them.",
  "specs/stack-pull.ts":
    "The inline-cursor branch of the text payload: an OPEN slice merging with " +
    "the text around a caret is exactly what the fitter is for. Its " +
    "between-blocks branch goes through the fit.",
  "specs/text-range-move.ts":
    "The inline-cursor move (both editor branches): an open slice at a caret, " +
    "same reasoning. Its between-blocks branch goes through the fit.",
  "specs/drop-context.ts":
    "The container-fit PROBE itself — a throwaway trial transaction, never " +
    "dispatched, built to discover what the fitter would do.",
  "util/mapped-insert.ts":
    "The shared splice DOOR (task 331). It fits nothing and claims nothing: " +
    "`insertNodesAdvancing(` is itself in SPLICE_CALL, so both questions are " +
    "asked of every CALLER — which is also the only place a refusal can " +
    "return before the source is deleted. Without that, this entry would be a " +
    "hole rather than an exemption.",
};

/**
 * The permitted UNADOPTED splices (task 328), keyed by a fragment of the LINE
 * rather than by file — a file-scoped exemption would also excuse the next
 * splice added beside it, and two of the three entries below live in the very
 * file whose cross-editor splice was the defect.
 *
 * An entry is a claim that the payload is in the TARGET editor's vocabulary by
 * CONSTRUCTION — not that adoption would be inconvenient. Anything that can
 * receive a node built by another editor calls `adoptNodeIntoSchema` /
 * `adoptSliceIntoSchema` (schema-adopt.ts) and refuses on null.
 */
const PERMITTED_UNADOPTED_INSERTS: ReadonlyArray<{
  file: string;
  line: string;
  why: string;
}> = [
  {
    file: "util/inline-atom-move.ts",
    line: "const tr = editor.state.tr.insert(insertPos, node);",
    why:
      "The CREATE branch ('anchor the unanchored'): `buildCreateNode` builds " +
      "the node with `placement.editor.schema` — the target's own vocabulary " +
      "— so no node crosses an editor boundary here.",
  },
  {
    file: "util/inline-atom-move.ts",
    line: "const span = insertNodesAdvancing(tr, { mapThrough: insertPos }, [node]);",
    why:
      "The SAME-EDITOR move: `resolveDrop` reaches this helper only on its " +
      "`move-within` branch, where target and source are one editor.",
  },
  {
    file: "util/mapped-insert.ts",
    line: "tr.insert(cursor, n);",
    why:
      "The shared splice door's own splice. The nodes reaching it were fitted " +
      "and adopted by the CALLER, which this census asks separately via the " +
      "`insertNodesAdvancing(` splice-call form.",
  },
  {
    file: "specs/drop-context.ts",
    line: "trialDoc = editor.state.tr.insert(insertPos, node).doc;",
    why:
      "The container-fit probe: the node was adopted by `fitNodesAtInsert` " +
      "before `fitNodeInContainer` handed it here, and this transaction is " +
      "never dispatched.",
  },
];

/**
 * A splice site is governed by what appears in its ENCLOSING TOP-LEVEL
 * DECLARATION, not by what appears anywhere in the file. The region is found by
 * scanning up to the previous line that closes one (`}` at column 0) — crude,
 * but it draws the line exactly where the guard's first version failed:
 * `stack-pull.ts` fits inside `insertParagraph` and `insertHeading`, and spliced
 * unguarded inside `insertText`, three separate top-level functions.
 */
function enclosingRegion(lines: string[], siteIdx: number): string[] {
  let start = siteIdx;
  while (start > 0 && !/^\}/.test(lines[start - 1])) start--;
  return lines.slice(start, siteIdx + 1);
}

/** Prose mentioning `tr.insert(` is not a splice. */
function isCommentLine(line: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(line);
}

/**
 * Every way ProseMirror splices content into a transaction — not just
 * `.insert(`. The narrow first version of this regex is precisely how the
 * stack-pull slice door escaped, so the family is spelled out and the receiver
 * is unconstrained.
 */
const SPLICE_CALL =
  /(?:\.(?:insert|insertContentAt|replace|replaceWith|replaceRangeWith|replaceSelectionWith|step)|\binsertNodesAdvancing)\(/;

/** A site is excused in place by this marker plus a stated reason. */
const EXEMPT_MARKER = /container-fit-exempt:/;

/** The ADOPTION question's own marker — deliberately distinct, because an
 *  exemption is scoped to the shape it justifies and "no container is entered"
 *  says nothing about whose vocabulary the payload speaks. */
const ADOPT_EXEMPT_MARKER = /schema-adopt-exempt:/;

/** Either door that puts a payload into the target's vocabulary: the adoption
 *  SSOT directly, or the container fit, which calls it on every node. */
const ADOPTS = /\b(?:fitNodesAtInsert|adoptNodeIntoSchema|adoptSliceIntoSchema)\(/;

/** A DECLARATION is not a call. Only relevant for the bare-name arm of
 *  `SPLICE_CALL`: `export function insertNodesAdvancing(` would otherwise
 *  report the shared door's own signature as a splice site. */
const DECLARATION = /\bfunction\s+insertNodesAdvancing\b/;

export function detectSpliceCall(line: string): boolean {
  if (isCommentLine(line)) return false;
  if (DECLARATION.test(line)) return false;
  // `tr.insert(` and friends, but not `"".replace(/…/, …)` string mangling —
  // a string replace takes a regex or a quoted pattern as its first argument.
  if (!SPLICE_CALL.test(line)) return false;
  return !/\.replace\(\s*[/'"`]/.test(line);
}

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "__tests__" || entry === "__fixtures__") continue;
      out.push(...walkSource(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

interface SpliceSite {
  file: string;
  line: number;
  text: string;
  exempt: boolean;
  fitted: boolean;
  adoptExempt: boolean;
  adopted: boolean;
}

/** Every splice site in the tree, each tagged with whether a fit governs it,
 *  whether an adoption governs it, and which in-place exemptions it carries. */
export function spliceSites(root = DROP_MODE): SpliceSite[] {
  const sites: SpliceSite[] = [];
  for (const full of walkSource(root)) {
    const lines = readFileSync(full, "utf8").split("\n");
    const rel = path.relative(root, full).split(path.sep).join("/");
    lines.forEach((text, i) => {
      if (!detectSpliceCall(text)) return;
      const region = enclosingRegion(lines, i);
      sites.push({
        file: rel,
        line: i + 1,
        text: text.trim(),
        exempt: region.some((l) => EXEMPT_MARKER.test(l)),
        fitted: region.some((l) => /\bfitNodesAtInsert\(/.test(l)),
        adoptExempt: region.some((l) => ADOPT_EXEMPT_MARKER.test(l)),
        adopted: region.some((l) => ADOPTS.test(l)),
      });
    });
  }
  return sites;
}

/** Is this exact splice line on the per-LINE adoption allowlist? */
function isPermittedUnadopted(site: SpliceSite): boolean {
  return PERMITTED_UNADOPTED_INSERTS.some(
    (ok) => ok.file === site.file && site.text.includes(ok.line),
  );
}

describe("container-fit guardrail — every block splice asks the container", () => {
  it("no drop-mode splice site skips fitNodesAtInsert without an in-place exemption", () => {
    // If this fails: your splice can land content at a position whose parent
    // rejects it, and ProseMirror will make room by SPLITTING the enclosing
    // container — tearing one node into two that both keep its uuid. Call
    // `fitNodesAtInsert(editor, insertPos, nodes)` (specs/drop-context.ts) and
    // dispatch NOTHING on a `reject`; a between-blocks move deletes its source
    // in the same transaction, so an unrepresentable insert is content loss.
    // If the splice genuinely cannot tear anything (an inline atom at a caret),
    // say so with a `container-fit-exempt: <why>` comment above it AND list the
    // file in PERMITTED_UNFITTED_INSERTS.
    const unguarded = spliceSites()
      .filter((s) => !s.fitted && !s.exempt)
      .map((s) => `${s.file}:${s.line}  ${s.text}`);
    expect(unguarded).toEqual([]);
  });

  it("only allowlisted files carry in-place exemptions", () => {
    const exemptFiles = [
      ...new Set(spliceSites().filter((s) => s.exempt).map((s) => s.file)),
    ].sort();
    expect(exemptFiles).toEqual(Object.keys(PERMITTED_UNFITTED_INSERTS).sort());
  });

  it("every allowlist entry names a file that still exists and still splices", () => {
    for (const rel of Object.keys(PERMITTED_UNFITTED_INSERTS)) {
      const full = path.join(DROP_MODE, rel);
      expect(() => statSync(full)).not.toThrow();
      const lines = readFileSync(full, "utf8").split("\n");
      expect(lines.some(detectSpliceCall)).toBe(true);
    }
  });

  it("catches every shape that was fixed, INCLUDING the one the first regex missed", () => {
    const shapes = [
      // The pre-257 range move: a list-only literal, then a bare insert.
      `for (const n of nodes) { tr.insert(cursor, n); cursor += n.nodeSize; }`,
      // The pre-257 block-move factory: no context question at all.
      `const insertTr = targetEditor.state.tr.insert(insertPos, node);`,
      // The stack-pull SLICE door — invisible to the first detector, and the
      // reason this test exists in this shape.
      `const tr = editor.state.tr.replace(target, target, slice);`,
      // Other spellings of the same operation.
      `tr.replaceWith(pos, pos, node);`,
      `tr2.insert(cursor, node);`,
      `editor.commands.insertContentAt(pos, json);`,
      `tr.step(new ReplaceStep(pos, pos, slice));`,
      // The shared splice DOOR (task 331) — a bare-name call with no receiver.
      // If this stops matching, every converted call site silently leaves the
      // census and both questions above go unasked for it.
      `const span = insertNodesAdvancing(tr, { mapThrough: insertPos }, nodes);`,
    ];
    for (const line of shapes) expect(detectSpliceCall(line)).toBe(true);

    // String mangling is not a document splice.
    expect(detectSpliceCall(`return s.replace(/["\\\\]/g, "\\\\$&");`)).toBe(false);
    expect(detectSpliceCall(`const t = name.replace("a", "b");`)).toBe(false);
  });

  it("catches a splice that skips fitNodesAtInsert AND does not adopt", () => {
    // The task-328 defect, in its own shape: `container-fit-exempt:` alone must
    // NOT satisfy the adoption question. On the pre-fix tree this leg names
    // `specs/text-range-move.ts` (both inline-cursor splices) and
    // `util/inline-atom-move.ts`'s cross-editor insert.
    const unadopted = spliceSites()
      .filter((s) => !s.adopted)
      .filter((s) => !(s.adoptExempt && isPermittedUnadopted(s)))
      .map((s) => `${s.file}:${s.line}  ${s.text}`);
    expect(unadopted).toEqual([]);
  });

  it("only allowlisted LINES carry an adoption exemption (no stale, no new)", () => {
    const marked = spliceSites().filter((s) => s.adoptExempt && !s.adopted);
    // Every marked site is allowlisted…
    expect(
      marked.filter((s) => !isPermittedUnadopted(s)).map((s) => `${s.file}:${s.line}`),
    ).toEqual([]);
    // …and every allowlist entry still matches a real, still-unadopted site.
    for (const ok of PERMITTED_UNADOPTED_INSERTS) {
      expect(
        marked.some((s) => s.file === ok.file && s.text.includes(ok.line)),
        `stale adoption exemption: ${ok.file} — ${ok.line}`,
      ).toBe(true);
    }
  });

  it("the two exemptions are DISTINCT markers, not one excusing both questions", () => {
    // If a `container-fit-exempt:` marker satisfied the adoption question, the
    // whole class this leg guards would be invisible — that is precisely how it
    // shipped. Pinned as a property of the detectors themselves, on a synthetic
    // fixture rather than a live line (a canary must not stand on the defect).
    const fixture = [
      `function crossEditor(targetEditor, sourceEditor, insertPos, slice) {`,
      `  // container-fit-exempt: an open slice at a caret enters no container.`,
      `  const tr = targetEditor.state.tr.replace(insertPos, insertPos, slice);`,
      `}`,
    ];
    const idx = fixture.findIndex((l) => l.includes("tr.replace("));
    const region = enclosingRegion(fixture, idx);
    expect(detectSpliceCall(fixture[idx])).toBe(true);
    expect(region.some((l) => EXEMPT_MARKER.test(l))).toBe(true);
    // …and yet it neither adopts nor claims an adoption exemption.
    expect(region.some((l) => ADOPTS.test(l))).toBe(false);
    expect(region.some((l) => ADOPT_EXEMPT_MARKER.test(l))).toBe(false);
  });

  it("the region is the enclosing DECLARATION: a fit in another function does not vouch", () => {
    // The exact conspiracy that let the slice door through — a file that fits
    // in one function and splices unguarded in another.
    const lines = [
      `function fitted(editor, pos, nodes) {`,
      `  const fit = fitNodesAtInsert(editor, pos, nodes);`,
      `  if (fit.kind === "reject") return;`,
      `  tr.insert(pos, fit.nodes[0]);`,
      `}`,
      `function unfitted(editor, pos, slice) {`,
      `  const tr = editor.state.tr.replace(pos, pos, slice);`,
      `}`,
    ];
    const fittedIdx = lines.findIndex((l) => l.includes("tr.insert("));
    const unfittedIdx = lines.findIndex((l) => l.includes("tr.replace("));
    expect(detectSpliceCall(lines[fittedIdx])).toBe(true);
    expect(detectSpliceCall(lines[unfittedIdx])).toBe(true);
    expect(
      enclosingRegion(lines, fittedIdx).some((l) => /fitNodesAtInsert\(/.test(l)),
    ).toBe(true);
    expect(
      enclosingRegion(lines, unfittedIdx).some((l) => /fitNodesAtInsert\(/.test(l)),
    ).toBe(false);
  });
});
