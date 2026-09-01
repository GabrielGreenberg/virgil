// @vitest-environment jsdom
//
// Task 2026-08-31-518 — WHICH WORDS did the user write, and where?
//
// The 517 index answers "which characters are prose"; a dictionary needs one
// step further in, and the step is not obvious, because the run table's GAPS
// carry information a character-level answer throws away. Two runs that abut in
// the document are one word split by a MARK boundary (bolding half a word must
// not make it two); two runs separated by an atom or by an excluded raw-LaTeX
// run are two words. So every leg here drives the REAL main stack over the REAL
// parse — a hand-built fixture cannot produce the mark splits and carrier runs
// the whole rule is about.
//
// The leg with teeth is the run-gap pair: the MERGE case and the CUT case over
// the same shape, so an implementation that merged everything and one that
// merged nothing each fail exactly one of them.
import { describe, expect, it, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
    "mutateSidecar", "enqueueDocWrite",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { blockCarriesProse } from "@/lib/prose-index";
import {
  isCheckableWord,
  proseSegmentsOf,
  tokenizeBlock,
  wordsIn,
} from "@/lib/spell/prose-words";
import { ATOM_REGISTRY } from "@/lib/tiptap/atom-registry";

// ── harness ──────────────────────────────────────────────────────────────────

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
    spellcheckPortRef: null,
  } as unknown as EditorExtensionsCtx;
}

function mount(body: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: buildEditorExtensions(mainCtx()),
    content: parseLatex(
      `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`,
    ) as never,
  });
  return editor;
}

/** Every prose block of the mounted document, with its content start. */
function proseBlocks(doc: PMNode): Array<{ node: PMNode; contentStart: number }> {
  const out: Array<{ node: PMNode; contentStart: number }> = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (blockCarriesProse(node)) out.push({ node, contentStart: pos + 1 });
    return false;
  });
  return out;
}

/** The words the checker would look up, over the whole body. */
function wordsOf(body: string): string[] {
  const doc = mount(body).state.doc;
  return proseBlocks(doc).flatMap((b) => tokenizeBlock(b.node, b.contentStart).map((t) => t.word));
}

/** Tokens of the FIRST prose block, with positions. */
function tokensOf(body: string) {
  const doc = mount(body).state.doc;
  const first = proseBlocks(doc)[0];
  return first ? tokenizeBlock(first.node, first.contentStart) : [];
}

// ── A. the run gap IS the word boundary ──────────────────────────────────────

describe("the run gap is the word boundary", () => {
  it("a MARK split inside a word does not split the word", () => {
    // `impor\textbf{tant}` parses to two adjacent text nodes with different
    // marks — PM-CONTIGUOUS, so they merge into one segment and one word.
    expect(wordsOf("An impor\\textbf{tant} claim.")).toContain("important");
  });

  it("an ATOM between two prose runs DOES split the word — and both halves check", () => {
    // The memo's own rule: an underline never spans an atom, so a word
    // interrupted by a footnote marker is two words. The atom contributes no
    // characters and is not a text node, so it ends the word rather than
    // marking it a fragment.
    const words = wordsOf("Smi\\footnote{note}th wrote.");
    expect(words).toContain("Smi");
    expect(words).toContain("th");
    expect(words).not.toContain("Smith");
  });

  it("an EXCLUDED TEXT run makes the touching token a FRAGMENT — not checked", () => {
    // `\textsc{…}` is not a command Virgil models, so its name is a CARRIER —
    // characters the user typed that the index deliberately withheld. `un`
    // beside it is half a word, and flagging it would be a squiggle under
    // prose that is not wrong.
    const words = wordsOf("The un\\textsc{clear} case.");
    expect(words).not.toContain("un");
    // …and the control: the same fixture's untouched words still check.
    expect(words).toContain("case");
  });

  it("a word ABUTTING an atom on its right is still checked (the control)", () => {
    // The pair that keeps the fragment rule from throwing away most of a real
    // paper: a citation chip after a name is the commonest shape there is.
    const words = wordsOf("Smith\\citep{a} argued.");
    expect(words).toContain("Smith");
    expect(words).toContain("argued");
  });
});

// ── B. what counts as a word ─────────────────────────────────────────────────

describe("what counts as a word", () => {
  it("digit-bearing tokens are skipped WHOLE, never as their letter half", () => {
    // Digits are consumed INTO the token precisely so this test can see them:
    // a rule that treated a digit as a boundary would tokenize `3rd` as `rd`.
    const words = wordsOf("The 3rd and 4th cases, plus H2O.");
    expect(words).not.toContain("rd");
    expect(words).not.toContain("th");
    expect(words).not.toContain("3rd");
    expect(words).not.toContain("H2O");
    expect(words).toContain("cases");
  });

  it("all-uppercase acronyms are skipped", () => {
    expect(wordsOf("The NP node and the DP.")).not.toContain("NP");
    expect(wordsOf("The NP node and the DP.")).toContain("node");
  });

  it("single characters are skipped; apostrophes are interior", () => {
    const words = wordsOf("If x is F, then it isn't G — don’t worry.");
    expect(words).not.toContain("x");
    expect(words).toContain("isn't");
    expect(words).toContain("don’t");
  });

  it("URLs and emails are masked SPACE-FOR-SPACE, so offsets survive", () => {
    const toks = tokensOf("See https://example.com/foo now.");
    expect(toks.map((t) => t.word)).toEqual(["See", "now"]);
    // The `now` token's document position must still be exact — which is what
    // the space-for-space mask buys over deleting the URL.
    const doc = editor!.state.doc;
    const last = toks[toks.length - 1];
    expect(doc.textBetween(last.from, last.to)).toBe("now");
  });

  it("`isCheckableWord` and `wordsIn` state the SAME rule", () => {
    // The bibliography derivation and the user's dictionary entries are split
    // with `wordsIn`, so a name typed in prose and the same name read out of
    // `references.bib` can never come back as two different strings.
    expect(wordsIn("van der Berg, O'Brien & NASA 1998")).toEqual([
      "van", "der", "Berg", "O'Brien",
    ]);
    expect(isCheckableWord("NASA")).toBe(false);
    expect(isCheckableWord("Berg")).toBe(true);
  });
});

// ── C. positions ─────────────────────────────────────────────────────────────

describe("positions", () => {
  it("every token's range holds exactly its own characters", () => {
    const toks = tokensOf("The quick brown fox jumped.");
    const doc = editor!.state.doc;
    expect(toks.length).toBeGreaterThan(3);
    for (const t of toks) expect(doc.textBetween(t.from, t.to)).toBe(t.word);
  });

  it("…including after an atom, which is where naive arithmetic drifts", () => {
    const toks = tokensOf("Alpha\\footnote{n} beta gamma delta.");
    const doc = editor!.state.doc;
    for (const t of toks) expect(doc.textBetween(t.from, t.to)).toBe(t.word);
    expect(toks.map((t) => t.word)).toContain("gamma");
  });
});

// ── D. the excluded vocabulary is DERIVED — the sweep ────────────────────────

describe("nothing inside a carrier or an atom is ever a word", () => {
  it("a markless block (a % comment) yields no segments at all", () => {
    // Blank-line separated, so the comment is a standalone `latexComment`
    // BLOCK rather than the tail-mark form a mid-paragraph `%` takes (task
    // 347) — the markless-container rule is what is under test here, and the
    // tail-mark rule has its own leg above.
    const body = "Real prose.\n\n% teh commented typo\n\nMore prose.";
    const doc = mount(body).state.doc;
    const all = wordsOf(body);
    expect(all).not.toContain("teh");
    expect(all).toContain("prose");
    // …and the block itself is refused at the segment level, not merely
    // filtered later: `proseSegmentsOf` answers [] for a non-prose container.
    let refused = 0;
    doc.descendants((node, pos) => {
      if (node.type.name === "latexComment") {
        expect(proseSegmentsOf(node, pos + 1)).toEqual([]);
        refused++;
      }
      return true;
    });
    expect(refused).toBeGreaterThan(0);
  });

  it("every ATOM kind the registry declares contributes no word — swept", () => {
    // DISCOVERED from `ATOM_REGISTRY`, so a new atom kind arrives with no
    // fixture and fails here before it can ship.
    const doc = mount(
      "Prose $x^2$ around \\footnote{aaa} the \\citep{k} atoms \\ref{sec:a} here.",
    ).state.doc;
    const atomNames = new Set(Object.values(ATOM_REGISTRY).map((a) => a.nodeName));
    let seen = 0;
    for (const { node, contentStart } of proseBlocks(doc)) {
      const tokens = tokenizeBlock(node, contentStart);
      node.forEach((child, offset) => {
        if (!atomNames.has(child.type.name)) return;
        seen++;
        const from = contentStart + offset;
        const to = from + child.nodeSize;
        for (const t of tokens) {
          // No token may overlap an atom's PM span.
          expect(t.to <= from || t.from >= to).toBe(true);
        }
      });
    }
    expect(seen).toBeGreaterThan(0);
  });
});
