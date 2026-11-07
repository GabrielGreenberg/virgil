// ONE footnote-numbering authority (task 725) — the CI half.
//
// A footnote's number is a DERIVATION over the document's footnotes in order,
// with exactly one subtlety: a `\thanks` renders `A`, so it takes `number: 0`
// and does NOT step the counter. That rule was written four times:
//
//   1. `latex-parser.ts` `numberFootnotes` — the LOAD-TIME pass. Thanks-blind.
//   2. `lib/tiptap/footnote.ts` `appendTransaction` — the live numberer. Correct.
//   3. `lib/tiptap/footnote.ts` typed-`\footnote{}` input rule. Correct.
//   4. `Editor.tsx` `EditorHandle.renumberFootnotes`. Thanks-blind, undoable,
//      no equality bail — and it ran LAST, so it overwrote (2)'s right answer.
//
// Two of the four did not know about `\thanks`, so a paper with an author note
// showed every later footnote one too high: at LOAD (copy 1, which is what the
// reader actually sees, because the editor is constructed with `content:` and
// that is not a transaction, so the live numberer never runs at mount), and
// again on the next footnote the user created (copy 4).
//
// The rule now lives in `src/lib/footnote-numbering.ts` and the three surviving
// surfaces call it. These pins hold that shape:
//
//   R1 — the rule itself: `\thanks` is 0 and does not step; the writer bails on
//        an unchanged number so a no-op renumber costs ZERO transaction steps.
//   R2 — no production module outside the owner writes a footnote's `number`
//        through `setNodeMarkup` (a second live authority).
//   R3 — no production module outside the owner steps a counter straight into a
//        `number` field (`number: counter++`) — the exact shape of all three
//        deleted copies.
//   R4 — a module that computes a footnote number at all must IMPORT the owner.
//        This is what keeps the parser honest: it may write numbers, but only
//        ones the owner handed it.
//   R5 — (task 1517) the LABEL a footnote prints has one door too:
//        `footnoteLabel`. A `\footnote[n]` override is the rule's second
//        subtlety (0, no step — R1), and before 1517 four surfaces restated
//        the label by hand and disagreed (atom/card `thanks ? "A" : number`,
//        gutter `numberOverride ? … : thanks ? "*" : number`). No production
//        module outside the owner may branch on `thanks` to a one-character
//        label, or on `numberOverride` to a display value.
//
// R2–R4 read the REAL tree (task 724's lesson: a rule stated against a
// stand-in polices nothing), and each is planted below in both directions.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { footnoteLabel, footnoteNumbersFor } from "../footnote-numbering";
import { walkFiles } from "./_source-scan";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/
const OWNER = "lib/footnote-numbering.ts";

/** Strip line + block comments so prose about numbering is never "code". */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

const WINDOW_BEFORE = 500;
const WINDOW_AFTER = 260;

/** True when `window` is talking about footnotes rather than some other
 *  numbered node (expex example blocks also carry a `number` attr). */
function footnoteContext(window: string): boolean {
  return /footnote/i.test(window);
}

/** R2 — a transaction-level write of a FOOTNOTE's `number`. */
export function detectFootnoteNumberNodeWrite(raw: string): boolean {
  const source = stripComments(raw);
  for (const m of source.matchAll(/setNodeMarkup\(/g)) {
    const i = m.index ?? 0;
    const window = source.slice(Math.max(0, i - WINDOW_BEFORE), i + WINDOW_AFTER);
    if (/number\s*:/.test(window) && footnoteContext(window)) return true;
  }
  return false;
}

/** R3 — a stepped counter written straight into a `number` field. */
export function detectFootnoteCounterStep(raw: string): boolean {
  const source = stripComments(raw);
  for (const m of source.matchAll(/number\s*:\s*(\+\+[A-Za-z_$][\w$.]*|[A-Za-z_$][\w$.]*\s*\+\+)/g)) {
    const i = m.index ?? 0;
    const window = source.slice(Math.max(0, i - WINDOW_BEFORE), i + WINDOW_AFTER);
    if (footnoteContext(window)) return true;
  }
  return false;
}

/** R4 — a COMPUTED footnote `number` (not a `0` seed, not a read of an
 *  existing `.number`, not a type annotation). */
export function detectComputedFootnoteNumber(raw: string): boolean {
  const source = stripComments(raw);
  for (const m of source.matchAll(/number\s*:/g)) {
    const i = m.index ?? 0;
    const window = source.slice(Math.max(0, i - WINDOW_BEFORE), i + WINDOW_AFTER);
    if (!footnoteContext(window)) continue;
    const value = source.slice(i + m[0].length, i + m[0].length + 80).split("\n")[0].trim();
    if (/^-?\d/.test(value)) continue; // a literal seed (`number: 0`)
    if (/^["'`]/.test(value)) continue; // a literal string
    if (/^\{\s*default\s*:/.test(value)) continue; // the schema attr spec
    if (/^(number|string|boolean|unknown)\s*(\||\)|;|,|$)/.test(value)) continue; // a type
    if (/\.\w*[Nn]umber\b/.test(value)) continue; // a READ of a number already on a node
    return true;
  }
  return false;
}

function walkSource(dir: string): string[] {
  // Skip test + fixture trees so the guard never scans itself.
  return walkFiles(dir, { skipDirs: ["__tests__", "__fixtures__"] }).filter((f) => /\.(ts|tsx)$/.test(f));
}

function flagged(detect: (s: string) => boolean): string[] {
  return walkSource(SRC)
    .map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join("/"), text: readFileSync(f, "utf8") }))
    .filter((e) => e.rel !== OWNER && detect(e.text))
    .map((e) => e.rel)
    .sort();
}

/** R5 — a hand-restated footnote label: a `thanks ? "A"`-shaped ternary (a
 *  ONE-character label — `thanks ? "Acknowledgement"` is a kind name, not a
 *  number label), or a ternary on `numberOverride` (the gutter's old shape). A
 *  `??` fallback, an optional chain or an optional property is not a ternary. */
export function detectRestatedFootnoteLabel(raw: string): boolean {
  const source = stripComments(raw);
  if (/thanks\s*\?\s*["'`][^"'`\n]?["'`]/.test(source)) return true;
  if (/numberOverride\)?\s*\?(?![?.:])/.test(source)) return true;
  return false;
}

const IMPORTS_OWNER = /from\s+["']@\/lib\/footnote-numbering["']/;

describe("R1 — the rule itself", () => {
  it("a `\\thanks` takes 0 and does not step the counter", () => {
    expect(footnoteNumbersFor([{ thanks: true }, {}, {}])).toEqual([0, 1, 2]);
    expect(footnoteNumbersFor([{}, { thanks: true }, {}])).toEqual([1, 0, 2]);
    expect(footnoteNumbersFor([{ thanks: true }, { thanks: true }])).toEqual([0, 0]);
    expect(footnoteNumbersFor([])).toEqual([]);
  });

  it("a `\\footnote[n]` override takes 0 and does not step the counter (task 1517)", () => {
    // LaTeX prints `\footnote{a}\footnote[7]{b}\footnote{c}` as 1, 7, 2.
    expect(footnoteNumbersFor([{}, { numberOverride: "7" }, {}])).toEqual([1, 0, 2]);
    expect(footnoteLabel({ numberOverride: "7", number: 0 })).toBe("7");
    expect(footnoteLabel({ thanks: true, number: 0 })).toBe("A");
    expect(footnoteLabel({ number: 2 })).toBe("2");
  });
});

describe("R5 — one label door, read off the real tree (task 1517)", () => {
  it("no other module hand-restates a footnote's label", () => {
    expect(flagged(detectRestatedFootnoteLabel)).toEqual([]);
  });

  it("the deleted restatements would be caught; kind names and fallbacks are spared", () => {
    expect(detectRestatedFootnoteLabel(`<BadgeLabel label={fn.thanks ? "A" : fn.number} />`)).toBe(true);
    expect(detectRestatedFootnoteLabel(`setTextIfChanged(dom, next.attrs.thanks ? "A" : String(n));`)).toBe(true);
    expect(
      detectRestatedFootnoteLabel(`marker: f.numberOverride ? String(f.numberOverride) : f.thanks ? "*" : String(f.number),`),
    ).toBe(true);
    expect(detectRestatedFootnoteLabel(`return attrs.thanks ? "Acknowledgement" : undefined;`)).toBe(false);
    expect(detectRestatedFootnoteLabel(`numberOverride: (node.attrs.numberOverride as string | null) ?? null,`)).toBe(false);
    expect(detectRestatedFootnoteLabel(`// thanks ? "A" : number — prose`)).toBe(false);
    expect(detectRestatedFootnoteLabel(`interface X { numberOverride?: string | null; }`)).toBe(false);
  });
});

describe("R2/R3/R4 — exactly one authority, read off the real tree", () => {
  it("no other module writes a footnote `number` onto a node", () => {
    expect(flagged(detectFootnoteNumberNodeWrite)).toEqual([]);
  });

  it("no other module steps a counter into a `number` field", () => {
    expect(flagged(detectFootnoteCounterStep)).toEqual([]);
  });

  it("every module that computes a footnote number imports the owner", () => {
    const offenders = walkSource(SRC)
      .map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join("/"), text: readFileSync(f, "utf8") }))
      .filter((e) => e.rel !== OWNER && detectComputedFootnoteNumber(e.text) && !IMPORTS_OWNER.test(e.text))
      .map((e) => e.rel)
      .sort();
    expect(offenders).toEqual([]);
  });

  it("the parser is the reader the last rule is about", () => {
    const parser = readFileSync(path.join(SRC, "lib/latex-parser.ts"), "utf8");
    expect(IMPORTS_OWNER.test(parser)).toBe(true);
    expect(detectComputedFootnoteNumber(parser)).toBe(true);
  });
});

describe("the detectors are planted in both directions", () => {
  const OK_SEED = `const attrs = { type: "footnote", number: 0, footnoteId: id };`;
  const OK_READ = `if (node.type.name === "footnote") info.push({ number: node.attrs.number || 0 });`;
  const OK_EXAMPLE = `if (node.type.name === "exampleBlock") tr.setNodeMarkup(pos, undefined, { ...node.attrs, number: exampleCounter++ });`;
  const OK_PROSE = `// a footnote's number: counter++ is exactly what this file must not do.`;

  const BAD_NODE_WRITE = `
    doc.descendants((node, pos) => {
      if (node.type.name === "footnote") {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, number: n });
      }
    });`;
  const BAD_COUNTER = `
    let counter = 1;
    walk((n) => { if (n.type === "footnote") n.attrs = { ...n.attrs, number: counter++ }; });`;
  const BAD_COMPUTED = `
    for (const f of footnotes) {
      if (f.type === "footnote") out.push({ ...f.attrs, number: myOwnCounter });
    }`;

  it("flags a second node-write authority", () => {
    expect(detectFootnoteNumberNodeWrite(BAD_NODE_WRITE)).toBe(true);
    expect(detectFootnoteNumberNodeWrite(OK_EXAMPLE)).toBe(false);
    expect(detectFootnoteNumberNodeWrite(OK_SEED)).toBe(false);
  });

  it("flags a second counter", () => {
    expect(detectFootnoteCounterStep(BAD_COUNTER)).toBe(true);
    expect(detectFootnoteCounterStep(OK_EXAMPLE)).toBe(false);
    expect(detectFootnoteCounterStep(OK_PROSE)).toBe(false);
  });

  it("flags a computed number, and spares seeds, reads and types", () => {
    expect(detectComputedFootnoteNumber(BAD_COMPUTED)).toBe(true);
    expect(detectComputedFootnoteNumber(OK_SEED)).toBe(false);
    expect(detectComputedFootnoteNumber(OK_READ)).toBe(false);
    expect(detectComputedFootnoteNumber(`interface FootnoteInfo { number: number; }`)).toBe(false);
  });

  it("the real deleted copy would be caught", () => {
    // `EditorHandle.renumberFootnotes`, verbatim as it stood at HEAD~.
    const DELETED = `
    renumberFootnotes(): void {
      if (!editor) return;
      const positions: { pos: number; attrs: any }[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote") positions.push({ pos, attrs: node.attrs });
        return true;
      });
      let tr = editor.state.tr;
      let counter = 1;
      for (const { pos, attrs } of positions) {
        tr = tr.setNodeMarkup(pos, undefined, { ...attrs, number: counter++ });
      }
      editor.view.dispatch(tr);
    },`;
    expect(detectFootnoteNumberNodeWrite(DELETED)).toBe(true);
    expect(detectFootnoteCounterStep(DELETED)).toBe(true);
  });
});
