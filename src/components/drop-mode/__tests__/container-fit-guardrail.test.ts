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
};

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
  /\.(?:insert|insertContentAt|replace|replaceWith|replaceRangeWith|replaceSelectionWith|step)\(/;

/** A site is excused in place by this marker plus a stated reason. */
const EXEMPT_MARKER = /container-fit-exempt:/;

export function detectSpliceCall(line: string): boolean {
  if (isCommentLine(line)) return false;
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
}

/** Every splice site in the tree, each tagged with whether a fit governs it and
 *  whether it carries an in-place exemption. */
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
      });
    });
  }
  return sites;
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
    ];
    for (const line of shapes) expect(detectSpliceCall(line)).toBe(true);

    // String mangling is not a document splice.
    expect(detectSpliceCall(`return s.replace(/["\\\\]/g, "\\\\$&");`)).toBe(false);
    expect(detectSpliceCall(`const t = name.replace("a", "b");`)).toBe(false);
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
