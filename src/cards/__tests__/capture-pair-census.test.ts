// @vitest-environment node
//
// Task 2026-09-21-694 — the CENSUS of hand-enumerated card literals that must
// carry a CAPTURED PASSAGE.
//
// THE SHAPE THIS EXISTS TO CLOSE. Task 488 gave every Mode-B capture two forms:
// `selectedText` (plain `doc.textBetween`) and `selectedContent` (the RICH
// capture of the same instant). They are one capture in two dialects, and only
// the rich one survives a round trip — the plain string "drops marks and drops
// every inline ATOM outright, so no render-time parse can recover them"
// (`src/panels/_shared/captured-passage.tsx`).
//
// Every structural transform that rebuilds a card rebuilds it as a
// hand-enumerated LITERAL that curates its own field subset. The four morph
// converters remembered the pair and say so in prose ("a morph is not a
// re-capture"). The four CLONE literals carried `selectedText` and dropped its
// twin — for four months, invisibly, because a flattened "Original" still
// renders; it just renders `\emph{x}` as source, or an inline atom as nothing.
// Nothing downstream re-captures a clone, so the loss was permanent.
//
// That is task 099's class recurring with a new field. 099 built
// `carryCardEnvelope` so `archived` could not be forgotten; `selectedContent`
// arrived four months later and never joined it. So this guard does not assert
// four literals — the next field would evade four assertions exactly as this
// one did. It asks the STRUCTURAL question of every site: does a literal whose
// declared TARGET TYPE can hold a capture actually carry one?
//
// SCOPE IS DERIVED, NOT LISTED, on every axis:
//   - the SITES are every type-annotated card literal in `src/hooks/*.ts` plus
//     every converter in `src/cards/morphs/index.ts`;
//   - a site is a TRANSFORM (it rebuilds an EXISTING card, so it owes that
//     card's capture) iff it reads from a `source` record — which is what a
//     clone door does and what a fresh-creation literal does not. No name is
//     trusted: renaming `cloneSuggestion` changes nothing here;
//   - whether the capture question applies at all is derived from
//     `src/lib/types.ts` — the target interface either declares
//     `selectedContent?` or it does not. That is why report/note/highlight
//     literals, which carry a plain `selectedText` with no rich twin declared,
//     are out of scope for the right REASON rather than by exemption — and why
//     they are swept in automatically the day `ReportCard` grows the field.
//
// TWO QUESTIONS, because there are two ways to lose a capture. A transform
// literal must carry the PAIR (it is rebuilding a card that had one). ANY
// literal — creation included — that names the plain half must name the rich
// one, since one form alone is not a capture but a flattened line.
//
// WHAT IT CANNOT SEE, stated so nobody mistakes a pass for more than it is: it
// reads declarations, not behaviour. It proves each in-scope literal routes
// through the capture SSOT (or names both halves itself); it does not prove the
// value carried is the right one. That is the behavioural suites'
// (`useCutter-clone-envelope`, `useRevisions-clone-envelope`).

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HOOKS_DIR = join("src", "hooks");
const MORPHS = join("src", "cards", "morphs", "index.ts");
const TYPES = join("src", "lib", "types.ts");

/** BLANK (don't remove) comments, so prose ABOUT a capture — this repo
 *  documents the shapes it forbids, at length — is never read as code.
 *  Newlines are preserved so reported line numbers still point at real code. */
function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/.*$/gm, blank);
}

/** The balanced source slice starting at `from`, closed by the first bracket
 *  that returns depth to zero. */
function balanced(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      depth--;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  return src.slice(from);
}

/** Interface names in `types.ts` that DECLARE the rich half of the pair. */
function captureBearingTypes(): Set<string> {
  const src = blankComments(readFileSync(TYPES, "utf8"));
  const out = new Set<string>();
  const re = /export interface (\w+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const body = balanced(src, src.indexOf("{", m.index));
    if (/\bselectedContent\?:/.test(body)) out.add(m[1]);
  }
  return out;
}

type Site = { file: string; label: string; type: string; body: string };

/** Every type-annotated card literal in the per-doc hooks. */
function hookLiteralSites(): Site[] {
  const out: Site[] = [];
  for (const f of readdirSync(HOOKS_DIR).filter((n) => n.endsWith(".ts"))) {
    const file = join(HOOKS_DIR, f);
    const src = blankComments(readFileSync(file, "utf8"));
    const re = /(?:const|let) (\w+):\s*(\w+)\s*=\s*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const open = src.slice(m.index).search(/[({]/);
      if (open < 0) continue;
      out.push({
        file,
        label: `${f} → ${m[1]}: ${m[2]}`,
        type: m[2],
        // From the `const` keyword, so the WRAPPING call (the SSOT) is part of
        // the site — a slice that began at the bracket would hide it.
        body: src.slice(m.index, m.index + open) + balanced(src, m.index + open),
      });
    }
  }
  return out;
}

function morphSites(): Site[] {
  const src = blankComments(readFileSync(MORPHS, "utf8"));
  const out: Site[] = [];
  const re = /function (\w+)\([^)]*\):\s*(\w+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push({
      file: MORPHS,
      label: `morphs/index.ts → ${m[1]}(): ${m[2]}`,
      type: m[2],
      body: balanced(src, src.indexOf("{", m.index + m[0].length - 1)),
    });
  }
  return out;
}

/** A literal satisfies the pair if it routes through the SSOT or names both
 *  halves itself (the morph converters' explicit spelling). */
function carriesPair(body: string): boolean {
  if (/carryCapturedPassage\s*\(/.test(body)) return true;
  return /\bselectedText:/.test(body) && /\bselectedContent:/.test(body);
}

describe("captured-passage census (task 694)", () => {
  const bearing = captureBearingTypes();
  const hookLiterals = hookLiteralSites();
  const morphs = morphSites();
  const sites = [...hookLiterals, ...morphs];

  /** A literal that rebuilds an EXISTING card: it reads a `source` record (the
   *  clone doors) or it IS a morph converter (its parameter is the card). */
  const transforms = [
    ...hookLiterals.filter((s) => /\bsource\b/.test(s.body)),
    ...morphs,
  ].filter((s) => bearing.has(s.type));

  it("derives a non-empty set of capture-bearing card types from types.ts", () => {
    // The four task-488 shapes. If this shrinks to nothing the census below is
    // vacuous, which is the failure mode a derived guard must refuse.
    expect(bearing.size).toBeGreaterThanOrEqual(4);
    expect([...bearing].sort()).toEqual(
      expect.arrayContaining([
        "CutterCommentCard",
        "CutterSuggestionCard",
        "RevisionRequestCard",
        "RevisionSuggestionCard",
      ]),
    );
  });

  it("finds every capture-bearing transform literal (the census is not empty)", () => {
    // 4 clone literals + 4 capture-bearing morph converters.
    expect(transforms.length).toBeGreaterThanOrEqual(8);
  });

  it("every transform that rebuilds a capture-bearing card carries the PAIR", () => {
    const offenders = transforms.filter((s) => !carriesPair(s.body)).map((s) => s.label);
    expect(offenders).toEqual([]);
  });

  it("no capture-bearing literal names the plain half alone", () => {
    // The exact 694 defect, asked of EVERY literal whose shape declares the
    // rich twin — creation sites included: `selectedText` without
    // `selectedContent` and without the SSOT is a capture demoted to its
    // flattened line, which no render-time parse can undo.
    const halfOnly = sites
      .filter(
        (s) =>
          bearing.has(s.type) &&
          /\bselectedText:/.test(s.body) &&
          !carriesPair(s.body),
      )
      .map((s) => s.label);
    expect(halfOnly).toEqual([]);
  });

  it("no literal writes the rich half into a shape that cannot hold it", () => {
    // The inverse: a `selectedContent:` line on a note/highlight/report literal
    // would put a key in `notes.json` that its migrator drops on next load, so
    // disk and memory would disagree for one session.
    const wrong = sites
      .filter((s) => !bearing.has(s.type) && /\bselectedContent:/.test(s.body))
      .map((s) => s.label);
    expect(wrong).toEqual([]);
  });
});
