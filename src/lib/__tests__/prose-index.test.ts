// @vitest-environment jsdom
//
// Task 2026-08-31-517 — the shared PROSE INDEX.
//
// Three parts of Virgil each answered HALF of "which characters are prose, and
// where are they": the word counter (categories, no positions), the raw-LaTeX
// highlighter (positions, no prose test), the Search index (positions, no
// LaTeX awareness). Nothing knew both, so searching `emph` matched command
// names and matched inside `%` comment blocks.
//
// WHY NO PRE-517 SUITE COULD SEE THIS. Every search fixture in the repo is
// plain prose — `search-live-position.test.ts` drives paragraphs, headings and
// inline ATOMS, which is the one non-prose shape the old index already handled
// — so a carrier run or a markless block reaching the index is unrepresentable
// in all of them. The legs here therefore drive the REAL
// `buildEditorExtensions("main")` stack over the REAL parse, so the marks under
// test are the ones the parser actually produces rather than ones a fixture
// asserts into existence.
//
// The legs with teeth are the SWEEPS and the CENSUS. The walk was never the
// part that could misbehave — a hand list of excluded node names is, and it
// type-checks perfectly. So the excluded vocabulary is asked of the SSOTs
// (`ATOM_REGISTRY`, `RAW_LATEX_MARK_NAMES`, the live schema's `markSet`) and a
// new atom / carrier / verbatim kind arrives with no fixture and fails the
// coverage leg before it can ship.
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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import {
  CARRIER_MARK_NAMES,
  LATEX_COMMAND_MARK,
  RAW_LATEX_MARK_NAMES,
} from "@/lib/latex-lexer";
import { ATOM_REGISTRY } from "@/lib/tiptap/atom-registry";
import {
  blockCarriesProse,
  buildProseIndex,
  collectProseRuns,
  inlineIsProse,
  proseOffsetToPos,
  spanAtOffset,
} from "@/lib/prose-index";
import {
  codeOnly,
  commentsStripped,
  swallowedLines,
  trackedFiles,
  REPO_ROOT,
} from "@/lib/__tests__/_source-scan";

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
  } as unknown as EditorExtensionsCtx;
}

/** The REAL main stack over the REAL parse of `body`. */
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

const proseOf = (body: string) => buildProseIndex(mount(body).state.doc).text;

/** Every node type name the live main schema registers. */
function schemaTypeNames(ed: Editor): string[] {
  return Object.keys(ed.state.schema.nodes);
}

// ── A. the prose test itself ─────────────────────────────────────────────────

describe("what the index calls prose", () => {
  it("plain prose is the whole of it — the accepting control", () => {
    expect(proseOf("Some ordinary prose here.")).toBe("Some ordinary prose here.");
  });

  it("an UNMODELED command's run contributes nothing — the 513 acceptance", () => {
    // `\foobar{…}` is not a command Virgil models, so the parser marks the whole
    // run `latexCommand`. Searching `foobar` must therefore find no main text.
    const text = proseOf("Before \\foobar{inside} after.");
    expect(text).not.toContain("foobar");
    expect(text).toContain("Before ");
    expect(text).toContain(" after.");
  });

  it("a MODELED command's payload is still prose", () => {
    // `\emph{…}` becomes an italic MARK, not a carrier — so the words survive
    // and only the command name is gone. This is the pair that makes the leg
    // above a prose test rather than a "drop anything with a backslash" test.
    const text = proseOf("Some \\emph{italic} text.");
    expect(text).toBe("Some italic text.");
    expect(text).not.toContain("emph");
  });

  it("an inline `\\verb` run contributes nothing", () => {
    const text = proseOf("Type \\verb|emph| now.");
    expect(text).not.toContain("emph");
    expect(text).toContain("Type ");
  });

  it("a `%` comment TAIL contributes nothing", () => {
    const text = proseOf("Live prose. % emph reminder");
    expect(text).toContain("Live prose.");
    expect(text).not.toContain("emph reminder");
  });

  it("a `%` comment BLOCK is not there at all — no span, no separator", () => {
    const ed = mount("First para.\n\n% emph reminder line\n\nSecond para.");
    const { text, spans } = buildProseIndex(ed.state.doc);
    expect(text).not.toContain("emph");
    // Two prose blocks joined by ONE "\n" — the comment block produced no span
    // and no separator of its own, so it is absent rather than present-and-empty.
    expect(text).toBe("First para.\nSecond para.");
    expect(spans).toHaveLength(2);
  });

  it("a verbatim environment's bytes contribute nothing", () => {
    const text = proseOf("Before.\n\n\\begin{verbatim}\nemph inside\n\\end{verbatim}\n\nAfter.");
    expect(text).not.toContain("emph inside");
    expect(text).toBe("Before.\nAfter.");
  });

  it("a heading and a figure CAPTION are prose", () => {
    // `figureBlock` is not a schema atom and its `figureCaption` child holds
    // the user's words — the one shape that needed a decision rather than a
    // rule, and it falls out of the rules correctly.
    const ed = mount(
      "\\section{Ordinary heading}\n\nBody.\n\n" +
        "\\begin{figure}\n\\includegraphics{a.png}\n\\caption{A real caption}\n\\end{figure}",
    );
    const { text } = buildProseIndex(ed.state.doc);
    expect(text).toContain("Ordinary heading");
    expect(text).toContain("A real caption");
  });
});

// ── B. positions ─────────────────────────────────────────────────────────────

describe("positions survive the exclusion", () => {
  it("an offset AFTER a skipped carrier maps to the right PM position", () => {
    const ed = mount("Before \\foobar{inside} after.");
    const { text, spans } = buildProseIndex(ed.state.doc);
    const at = text.indexOf("after.");
    expect(at).toBeGreaterThan(-1);
    const span = spanAtOffset(spans, at);
    expect(span).not.toBeNull();
    const pos = proseOffsetToPos(span!, at, "start");
    // The characters the position names ARE the ones the offset named.
    expect(ed.state.doc.textBetween(pos, pos + 6)).toBe("after.");
  });

  it("every prose character round-trips offset → PM position → character", () => {
    // The property, not a hand-computed pixel: a table whose two coordinate
    // systems have drifted cannot satisfy it anywhere.
    const ed = mount(
      "Alpha \\foobar{skip} beta.\n\n" +
        "% a comment line\n\n" +
        "Gamma \\emph{delta} epsilon. % tail",
    );
    const { text, spans } = buildProseIndex(ed.state.doc);
    let checked = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") continue; // the inter-block separator has no character
      const span = spanAtOffset(spans, i);
      expect(span, `no span at offset ${i}`).not.toBeNull();
      const pos = proseOffsetToPos(span!, i, "start");
      expect(ed.state.doc.textBetween(pos, pos + 1), `offset ${i}`).toBe(text[i]);
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it("runs are char-contiguous and PM-DISJOINT across a skipped carrier", () => {
    // The gap IS the contract: it is what a consumer that must not span an
    // excluded thing (a spell squiggle) reads.
    const ed = mount("Before \\foobar{inside} after.");
    const { spans } = buildProseIndex(ed.state.doc);
    const runs = spans[0].runs;
    expect(runs.length).toBeGreaterThan(1);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].charStart).toBe(runs[i - 1].charStart + runs[i - 1].len);
      expect(runs[i].pmStart).toBeGreaterThan(runs[i - 1].pmStart + runs[i - 1].len);
    }
  });

  it("`collectProseRuns` answers for ONE block, at the same positions", () => {
    // The per-block entry point a squiggle refresh reads (task 518). It must
    // agree with the whole-doc walk or the two derivations have forked.
    const ed = mount("Alpha \\foobar{skip} beta.");
    const { spans } = buildProseIndex(ed.state.doc);
    const span = spans[0];
    const block = ed.state.doc.nodeAt(span.contentStart - 1)!;
    const per = collectProseRuns(block, span.contentStart, span.textStart);
    expect(per.runs).toEqual(span.runs);
  });
});

// ── C. the vocabulary is DERIVED — the sweeps ────────────────────────────────

describe("the excluded vocabulary is derived, not listed", () => {
  it("EVERY inline atom in ATOM_REGISTRY contributes zero characters", () => {
    // Swept FROM the registry, so a fifth atom kind is covered by declaration.
    const ed = mount("x");
    const schema = ed.state.schema;
    for (const meta of Object.values(ATOM_REGISTRY)) {
      const type = schema.nodes[meta.nodeName];
      expect(type, `schema has no node ${meta.nodeName}`).toBeTruthy();
      const node = type.createAndFill() ?? type.create();
      expect(inlineIsProse(node), `${meta.nodeName} counted as prose`).toBe(false);
    }
  });

  it("EVERY raw-LaTeX mark name excludes its run", () => {
    // Swept FROM `RAW_LATEX_MARK_NAMES` — the derived union of the carrier
    // table plus the command mark — so a fourth carrier joins by declaring a
    // row and needs no fixture here.
    const ed = mount("x");
    const schema = ed.state.schema;
    expect(RAW_LATEX_MARK_NAMES.length).toBeGreaterThanOrEqual(3);
    for (const name of RAW_LATEX_MARK_NAMES) {
      const markType = schema.marks[name];
      expect(markType, `schema has no mark ${name}`).toBeTruthy();
      const marked = schema.text("emph", [markType.create()]);
      expect(inlineIsProse(marked), `${name} counted as prose`).toBe(false);
      // …and the same text WITHOUT it is prose — so the leg cannot pass by
      // calling everything non-prose.
      expect(inlineIsProse(schema.text("emph"))).toBe(true);
    }
  });

  it("EVERY markless textblock the schema declares is excluded, and no other", () => {
    // The block half, asked of the LIVE schema rather than of a name list: a
    // node that admits no marks can never wear a carrier, so Virgil has no way
    // to say which of its characters are raw LaTeX — which is what verbatim
    // means. A new markless kind is covered by shipping.
    const ed = mount("x");
    const schema = ed.state.schema;
    const markless: string[] = [];
    const proseBlocks: string[] = [];
    for (const name of schemaTypeNames(ed)) {
      const type = schema.nodes[name];
      if (!type.isTextblock) continue;
      const node = type.createAndFill() ?? type.create();
      (blockCarriesProse(node) ? proseBlocks : markless).push(name);
    }
    // Today's markless textblocks — pinned so a change is a DECISION.
    expect(markless.sort()).toEqual(["codeBlock", "latexComment"]);
    // …and the prose side is non-empty and holds the shapes the legs above use.
    expect(proseBlocks).toContain("paragraph");
    expect(proseBlocks).toContain("heading");
    expect(proseBlocks).toContain("figureCaption");
  });

  it("markless and `code` are the SAME set — two spellings of one fact (task 512)", () => {
    // The rule above ("a node that admits no marks is a byte-literal
    // container") is Virgil's spelling. `code` is the FRAMEWORK's spelling of
    // the identical fact, and it is the one TipTap's input-rule runner actually
    // reads (`$from.parent.type.spec.code`). Declaring one without the other is
    // how they came to disagree: `latexComment` said `marks: ""` and not
    // `code`, so every type-time transform fired inside a `%` comment —
    // typography wrote curly quotes into the comment's own source bytes, and
    // StarterKit's `code` mark rule DELETED a typed backtick pair outright.
    //
    // Pinning them as ONE SET is what stops the next verbatim node kind from
    // shipping with the same hole: a markless textblock is gated by DECLARING
    // itself, and a `code` textblock that started admitting marks fails here
    // rather than silently becoming a prose container the index still skips.
    const ed = mount("x");
    const schema = ed.state.schema;
    const markless: string[] = [];
    const codeSpec: string[] = [];
    for (const name of schemaTypeNames(ed)) {
      const type = schema.nodes[name];
      if (!type.isTextblock) continue;
      const node = type.createAndFill() ?? type.create();
      if (!blockCarriesProse(node)) markless.push(name);
      if (type.spec.code) codeSpec.push(name);
    }
    expect(codeSpec.sort()).toEqual(markless.sort());
    expect(markless.length).toBeGreaterThan(0);
  });

  it("each byte-literal container's WHITESPACE answer is pinned (task 512)", () => {
    // ProseMirror derives it — `spec.whitespace || (spec.code ? "pre" : "normal")`
    // — so adding `code` silently changes how the DOM PARSER reads the node.
    // That is a clipboard behaviour with nothing to do with input rules, and
    // the two members want OPPOSITE answers: a `codeBlock` is genuinely
    // multi-line, so the derived "pre" is right and is left inherited; a
    // `latexComment` is ONE `%` source line, and under "pre" a newline
    // surviving out of pasted markup makes `% ${textContent}` emit a second
    // LIVE `.tex` line. It is "normal" only because it says so, and this pin
    // is what keeps that from being tidied away as redundant.
    const ed = mount("x");
    const schema = ed.state.schema;
    const resolved: Record<string, string> = {};
    for (const name of schemaTypeNames(ed)) {
      const type = schema.nodes[name];
      if (!type.isTextblock) continue;
      const node = type.createAndFill() ?? type.create();
      if (blockCarriesProse(node)) continue;
      resolved[name] = type.whitespace;
    }
    expect(resolved).toEqual({ codeBlock: "pre", latexComment: "normal" });
  });

  it("`RAW_LATEX_MARK_NAMES` is the carrier family PLUS the command mark", () => {
    // The derivation, stated: it is strictly WIDER than `CARRIER_MARK_NAMES`,
    // which `isOpaqueRun` must keep reading (a `latexCommand` scanner has to
    // look INSIDE a command run and must not treat it as opaque).
    for (const name of CARRIER_MARK_NAMES) {
      expect(RAW_LATEX_MARK_NAMES).toContain(name);
    }
    expect(RAW_LATEX_MARK_NAMES).toContain(LATEX_COMMAND_MARK);
    expect(CARRIER_MARK_NAMES).not.toContain(LATEX_COMMAND_MARK);
  });
});

// ── D. the census ────────────────────────────────────────────────────────────

describe("census — nobody re-derives the prose test", () => {
  const PRODUCTION = [
    ...trackedFiles("src", /\.(ts|tsx)$/),
    ...trackedFiles("library", /\.(ts|tsx)$/),
  ].filter((p) => !p.includes("__tests__"));

  /** Files that legitimately spell the three mark names in code. */
  const MARK_NAME_SPELLERS: Record<string, string> = {
    // The SSOT itself — the names live here, beside the family they belong to.
    "src/lib/latex-lexer.ts": "declares RAW_LATEX_MARK_NAMES + the three names",
    // NOTE `src/lib/tiptap/latex-command.ts` is deliberately NOT here: since
    // task 517 it registers all three marks through the constants and spells
    // no name of its own, so it needs no exemption. That is the shape every
    // other consumer should have.
    // The WORD COUNTER is the third half-answer, deliberately NOT migrated
    // (task 517 states it as a non-goal). Its buckets need the marks named
    // INDIVIDUALLY and in order — a comment tail goes to `comments` and must be
    // tested BEFORE the pair whose `\caption{…}` payloads go to `captions` —
    // so a single "is this raw LaTeX" predicate cannot express it. Its walk and
    // its `\caption{…}` extraction stay where they are until they migrate
    // deliberately.
    "src/lib/word-count-core.ts": "the third half-answer, a stated non-goal",
  };

  it("no production file hand-lists the raw-LaTeX marks", () => {
    const offenders: string[] = [];
    for (const abs of PRODUCTION) {
      const rel = abs.slice(REPO_ROOT.length + 1);
      if (MARK_NAME_SPELLERS[rel]) continue;
      // Comments stripped and string LITERALS KEPT — the drift being hunted
      // IS a literal, so `codeOnly` (which blanks literals) would make this
      // leg pass vacuously on every file including the offenders.
      const src = commentsStripped(readFileSync(abs, "utf8"));
      // Two or more of the family named on ONE line is an alternation, an
      // array or a Set — a second copy of the census. One name alone is a
      // legitimate single-mark question (a serializer arm, a mark toggle).
      for (const line of src.split("\n")) {
        const named = RAW_LATEX_MARK_NAMES.filter((n) => line.includes(`"${n}"`));
        if (named.length >= 2) offenders.push(`${rel}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the scanner can SEE a hand list — and swallowed nothing", () => {
    // A census whose stripper ate the lines it greps passes for the wrong
    // reason. Both halves: a synthetic offender must be flagged by the same
    // predicate the sweep uses, and no production file may have a string that
    // opened and never closed (`_source-scan`'s own asked-for self-check).
    const fixture = commentsStripped(
      'const RAW = ["latexCommand", "latexVerbatim"];\n// "latexCommand" "latexVerbatim" in prose\n',
    );
    const flagged = fixture
      .split("\n")
      .filter((l) => RAW_LATEX_MARK_NAMES.filter((n) => l.includes(`"${n}"`)).length >= 2);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toContain("const RAW");

    // Scoped to the files that actually NAME a mark: a swallowed line
    // elsewhere cannot hide an offender from this sweep, and the scanner has
    // known benign false positives (a `"` inside a regex character class) in
    // files this census has no question about.
    for (const abs of PRODUCTION) {
      const raw = readFileSync(abs, "utf8");
      if (!RAW_LATEX_MARK_NAMES.some((n) => raw.includes(`"${n}"`))) continue;
      const swallowed = swallowedLines(raw);
      expect(swallowed, `${abs.slice(REPO_ROOT.length + 1)}`).toEqual([]);
    }
  });

  it("every allowlisted speller still spells something", () => {
    // An exemption that has stopped excusing anything is a standing licence
    // for the next hand list under the exempted name.
    for (const rel of Object.keys(MARK_NAME_SPELLERS)) {
      const src = commentsStripped(readFileSync(resolve(REPO_ROOT, rel), "utf8"));
      const named = RAW_LATEX_MARK_NAMES.filter((n) => src.includes(`"${n}"`));
      expect(named.length, `${rel} no longer spells any mark name`).toBeGreaterThan(0);
    }
  });

  it("the Search panel owns no private index of its own", () => {
    // The door was never the part that could misbehave — a consumer that
    // rebuilds the walk beside it is, and it type-checks perfectly.
    const src = codeOnly(
      readFileSync(resolve(REPO_ROOT, "src/panels/Search/SearchPanel.tsx"), "utf8"),
    );
    expect(src).toContain("buildProseIndex");
    expect(src).not.toContain("buildMainTextIndex");
    expect(src).not.toContain("charOffsetToPm");
    // The main-text walk itself is gone: no second `descendants` walk that
    // collects text out of the document.
    expect(src).not.toContain("isTextblock");
  });
});
