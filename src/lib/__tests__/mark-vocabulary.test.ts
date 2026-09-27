// @vitest-environment jsdom
// Task 808 — the wrapper-mark vocabulary is ONE table (mark-composition.ts's
// `WRAPPER_MARK_ROWS`), read by both inline parsers, the footnote HTML reader,
// the emit, and the requirements declaration.
//
// Before it, the emit had an SSOT and the parse side was hand-coded three
// times, and the two disagreed three ways, each pinned here:
//
//   - `strike` had no emit arm: struck text was written to the `.tex` UNSTRUCK
//     (content loss — the coverage suite recorded it as an exemption);
//   - `\textit{x}` parsed to italic and came back `\emph{x}` (source rewrite);
//   - `\textsc` (small caps) was modeled nowhere and rendered as grey raw LaTeX.
//
// Plus the composition consequence of modeling small caps: `\emph{a \textsc{b}
// c}` must stay ONE `\emph` — including after ProseMirror has re-sorted the
// run's marks by schema rank.

import { describe, expect, it, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, getSchema, type JSONContent } from "@tiptap/core";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import {
  richLatexToJson,
  richJsonToLatex,
  htmlToJson,
} from "@/lib/footnote-content";
import {
  WRAPPER_MARK_ROWS,
  SPELLING_MARK_TYPES,
  SPELLING_ATTR,
  composeInlineRun,
  type WrapperMarkRow,
} from "@/lib/mark-composition";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { canMountInCardBody, cardBodySchemaFor } from "@/lib/tiptap/borrowed-schema";
import { tokenizeBlock, proseSegmentsOf } from "@/lib/spell/prose-words";

// ── harness ──────────────────────────────────────────────────────────────────

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
    spellcheckPortRef: null,
  } as unknown as EditorExtensionsCtx;
}

const doc = (b: string, preamble = "") =>
  `\\documentclass{article}\n${preamble}\\begin{document}\n${b}\n\\end{document}\n`;

function save(tex: string): string {
  const content = parseLatex(tex);
  assignUuids(content);
  return serializeToLatex(content, extractPreambleAndPostamble(tex) ?? undefined);
}

function body(tex: string): string {
  const start = tex.indexOf("\\begin{document}");
  const end = tex.indexOf("\\end{document}");
  return tex
    .slice(start + "\\begin{document}".length, end === -1 ? undefined : end)
    .replace(/[ \t]*%!v:[0-9a-f]{4}/g, "")
    .replace(/^\n+|\s+$/g, "");
}

/** Two save cycles through the real pipeline — byte identity + fixed point. */
function mainStable(input: string) {
  const c1 = save(doc(input));
  const c2 = save(c1);
  expect(body(c1)).toBe(input);
  expect(body(c2)).toBe(input);
}

function forkStable(input: string) {
  const c1 = richJsonToLatex(richLatexToJson(input));
  const c2 = richJsonToLatex(richLatexToJson(c1));
  expect(c1).toBe(input);
  expect(c2).toBe(input);
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mountMain(input: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: buildEditorExtensions(mainCtx()),
    content: parseLatex(doc(input)) as never,
  });
  return editor;
}

function marksIn(json: JSONContent, out = new Set<string>()): Set<string> {
  for (const m of json.marks ?? []) out.add(m.type);
  for (const c of json.content ?? []) marksIn(c, out);
  return out;
}

// ── 1 · small caps ───────────────────────────────────────────────────────────

describe("small caps — `\\textsc{…}` is a modeled mark", () => {
  it("parses to the smallCaps mark (not the raw-LaTeX carrier)", () => {
    const marks = marksIn(parseLatex(doc("A \\textsc{Smith} b.")));
    expect(marks.has("smallCaps")).toBe(true);
    expect(marks.has("latexCommand")).toBe(false);
  });

  it("round-trips byte-identically — main and card/footnote", () => {
    mainStable("A \\textsc{Smith} b.");
    forkStable("A \\textsc{Smith} b.");
  });

  it("`{\\scshape …}` is NOT claimed — it stays raw LaTeX, bytes preserved", () => {
    mainStable("{\\scshape Smith} b.");
    expect(marksIn(parseLatex(doc("{\\scshape Smith} b."))).has("smallCaps")).toBe(false);
  });

  it("a footnote holding `\\textsc{Smith}` MOUNTS in its card body (not an empty doc)", () => {
    const json = richLatexToJson("See \\textsc{Smith}.");
    expect(marksIn(json).has("smallCaps")).toBe(true);
    expect(canMountInCardBody(json, "card").ok).toBe(true);
    expect(canMountInCardBody(json, "excerpt").ok).toBe(true);
  });

  it("toggleSmallCaps (the Mod-Shift-K command) marks it, and the saved `.tex` spells `\\textsc`", () => {
    const ed = mountMain("Alpha beta.");
    ed.commands.setTextSelection({ from: 1, to: 6 });
    ed.commands.toggleSmallCaps();
    const out = serializeToLatex(ed.getJSON() as JSONContent);
    expect(out).toContain("\\textsc{Alpha} beta.");
  });

  it("paste: `font-variant(-caps): small-caps` and `span[data-small-caps]` yield the mark (main editor)", () => {
    const ed = mountMain("x");
    for (const html of [
      '<p><span style="font-variant: small-caps">Smith</span></p>',
      '<p><span style="font-variant-caps: small-caps">Smith</span></p>',
      "<p><span data-small-caps>Smith</span></p>",
    ]) {
      const dom = new window.DOMParser().parseFromString(html, "text/html").body;
      const parsed = PMDOMParser.fromSchema(ed.schema).parse(dom);
      expect(marksIn(parsed.toJSON() as JSONContent).has("smallCaps"), html).toBe(true);
    }
  });

  it("paste: the footnote HTML reader maps the same forms", () => {
    for (const html of [
      '<p><span style="font-variant: small-caps">Smith</span></p>',
      "<p><span data-small-caps>Smith</span></p>",
    ]) {
      expect(marksIn(htmlToJson(html)).has("smallCaps"), html).toBe(true);
    }
    expect(marksIn(htmlToJson("<p><s>gone</s></p>")).has("strike")).toBe(true);
  });
});

// ── 2 · strike (content loss) ────────────────────────────────────────────────

describe("strike — no longer dropped on save", () => {
  it("a TYPED strike serializes as `\\sout{…}`, declares ulem [normalem], and re-parses to strike", () => {
    const ed = mountMain("Alpha beta.");
    ed.commands.setTextSelection({ from: 1, to: 6 });
    ed.commands.toggleStrike();
    const out = serializeToLatex(ed.getJSON() as JSONContent);
    expect(out).toContain("\\sout{Alpha} beta.");
    expect(out).toContain("\\usepackage[normalem]{ulem}");
    expect(marksIn(parseLatex(out)).has("strike")).toBe(true);
  });

  it("round-trips byte-identically — main and card/footnote", () => {
    mainStable("A \\sout{struck} b.");
    forkStable("A \\sout{struck} b.");
  });

  it("a struck FOOTNOTE declares ulem too (the footnote arm threads the declaration)", () => {
    const out = save(doc("Text\\footnote{A \\sout{struck} note}."));
    expect(out).toContain("\\sout{struck}");
    expect(out).toContain("\\usepackage[normalem]{ulem}");
  });

  it("a preamble that already loads ulem is not given a second load", () => {
    const out = save(doc("A \\sout{x}.", "\\usepackage{ulem}\n"));
    expect(out.match(/\{ulem\}/g)).toHaveLength(1);
  });
});

// ── 3 · \textit fidelity ─────────────────────────────────────────────────────

describe("`\\textit` and `\\emph` each round-trip as written", () => {
  it("main", () => {
    mainStable("A \\textit{x} b.");
    mainStable("A \\emph{x} b.");
    mainStable("\\emph{a}\\textit{b}");
  });

  it("card/footnote", () => {
    forkStable("A \\textit{x} b.");
    forkStable("A \\emph{x} b.");
  });

  it("through a live ProseMirror editor (the attr survives the schema)", () => {
    const ed = mountMain("A \\textit{x} and \\emph{y}.");
    const out = serializeToLatex(ed.getJSON() as JSONContent);
    expect(out).toContain("A \\textit{x} and \\emph{y}.");
  });

  it("a newly TYPED italic is `\\emph` (no spelling attr)", () => {
    const ed = mountMain("Alpha beta.");
    ed.commands.setTextSelection({ from: 1, to: 6 });
    ed.commands.toggleItalic();
    expect(serializeToLatex(ed.getJSON() as JSONContent)).toContain("\\emph{Alpha} beta.");
  });
});

// ── 4 · nesting by run ───────────────────────────────────────────────────────

describe("a wrapper shared across a run stays ONE wrapper", () => {
  it("`\\emph{see \\textsc{Smith} 1990}` and `\\emph{a \\textbf{b} c}` round-trip", () => {
    mainStable("\\emph{see \\textsc{Smith} 1990}");
    mainStable("\\emph{a \\textbf{b} c}");
    forkStable("\\emph{see \\textsc{Smith} 1990}");
  });

  it("…after ProseMirror re-sorts the marks by schema rank", () => {
    const ed = mountMain("\\emph{see \\textsc{Smith} 1990} and \\textsc{a \\emph{b} c}");
    const out = serializeToLatex(ed.getJSON() as JSONContent);
    expect(out).toContain("\\emph{see \\textsc{Smith} 1990} and \\textsc{a \\emph{b} c}");
  });

  it("the choice is order-independent (same bytes whichever order a node lists its marks)", () => {
    const run = (inner: string[]) =>
      composeInlineRun(
        [
          { text: "a ", marks: [{ type: "italic" }] },
          { text: "b", marks: inner.map((type) => ({ type })) },
          { text: " c", marks: [{ type: "italic" }] },
        ],
        { inner: (n) => n.text },
      );
    expect(run(["smallCaps", "italic"])).toBe("\\emph{a \\textsc{b} c}");
    expect(run(["italic", "smallCaps"])).toBe("\\emph{a \\textsc{b} c}");
  });
});

// ── 5 · the table agrees with the schemas ────────────────────────────────────

describe("the vocabulary table agrees with every schema that mounts it", () => {
  const main = getSchema(buildEditorExtensions(mainCtx()));
  const card = cardBodySchemaFor("card");
  const excerpt = cardBodySchemaFor("excerpt");

  for (const row of WRAPPER_MARK_ROWS as readonly WrapperMarkRow[]) {
    it(`${row.mark}: in the main + excerpt schemas; in the card schema iff the card reader may produce it`, () => {
      expect(main.marks[row.mark], "main").toBeTruthy();
      expect(excerpt.marks[row.mark], "excerpt").toBeTruthy();
      expect(!!card.marks[row.mark], "card").toBe(row.cardBody !== false);
    });
  }

  it("every multi-spelling mark carries the spelling attr in every schema", () => {
    expect(SPELLING_MARK_TYPES).toContain("italic");
    for (const schema of [main, card, excerpt]) {
      for (const t of SPELLING_MARK_TYPES) {
        expect(schema.marks[t].spec.attrs?.[SPELLING_ATTR]).toBeTruthy();
      }
    }
  });
});

// ── 6 · spell check: gloss abbreviations ─────────────────────────────────────

describe("spell check — small-caps gloss abbreviations", () => {
  function firstBlock(input: string) {
    const ed = mountMain(input);
    let found: { node: import("@tiptap/pm/model").Node; start: number } | null = null;
    ed.state.doc.descendants((node, pos) => {
      if (found || !node.isTextblock) return !found;
      found = { node, start: pos + 1 };
      return false;
    });
    return found!;
  }

  it("all-lowercase ≤4-letter small-caps tokens are skipped; longer or cased ones are checked", () => {
    const b = firstBlock("the \\textsc{nom} \\textsc{acc} \\textsc{pl} of \\textsc{Smith} \\textsc{lowercased}");
    const words = tokenizeBlock(b.node, b.start).map((t) => t.word);
    expect(words).not.toContain("nom");
    expect(words).not.toContain("acc");
    expect(words).not.toContain("pl");
    expect(words).toContain("Smith");
    expect(words).toContain("lowercased");
    expect(words).toContain("the");
  });

  it("the same short word OUTSIDE small caps is still checked", () => {
    const b = firstBlock("the nom case");
    expect(tokenizeBlock(b.node, b.start).map((t) => t.word)).toContain("nom");
  });

  it("small-caps text is still PROSE (search reads it)", () => {
    const b = firstBlock("the \\textsc{nom} case");
    expect(proseSegmentsOf(b.node, b.start).map((s) => s.text).join("")).toContain("nom");
  });
});
