// @vitest-environment jsdom
//
// Task 122 — "how many words" means ONE thing, app-wide.
//
// THE CLASS BUG: `word-count-core` owned the canonical *categorization*
// walker (task 112) and every surface shared it — but the *filter* that turns
// per-category tallies into a headline number lived as a private reduce inside
// `WordCountPanel`. So the two consumers with no reduce of their own read the
// precomputed, UNFILTERED `WordCounts.total` instead:
//
//   * the Cutter goal strip (`currentWords`, and the `initialWords` baseline
//     `useCutter.setGoal` freezes from it), and
//   * the selection counter, which additionally kept its OWN flat-text walker
//     — a hand-copy of the categorization rules producing a single
//     uncategorized number, so the include-config had nothing to filter.
//
// With the default config (`comments: false`) a document the panel headlines as
// 10 words drove a cut goal measured against 15, and a selection's "words"
// counted comment text the headline excluded. Half an SSOT is what it looks
// like: the walker was shared, the question it answers was not.
//
// THE FIX: `includedTotals(counts, include)` is the ONE filter door and the
// precomputed unfiltered total is DELETED from the type, so a consumer cannot
// reach one by accident. The selection derives from the same walker via
// `doc.slice(from, to, true)`.
//
// The legs below split accordingly: the SELECTION legs drive a REAL editor
// (the walker swap is only observable against real ProseMirror slicing — the
// `includeParents` flag in particular is invisible to any hand-built fixture),
// and the CENSUS legs read source, because the SSOT was never the part that
// could misbehave — a call site that doesn't ask it is.
//
// (Storage stub guards the extension-barrel/@/lib/storage gotcha: the
// figure/graphics/tex NodeViews transitively import @/lib/storage.)
import { describe, it, expect, vi, afterEach } from "vitest";

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
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  ALL_CATEGORIES,
  type IncludeSet,
  computeCategoryCounts,
  includedTotals,
} from "@/lib/word-count-core";
import { DEFAULT_WORD_COUNT_CONFIG } from "@/hooks/useWordCountConfig";
import { getSelectionCounts } from "@/hooks/useSelectionCounts";
import { strip } from "@/lib/__tests__/_source-scan";

const ALL_ON = Object.fromEntries(
  ALL_CATEGORIES.map((c) => [c, true]),
) as IncludeSet;
const DEFAULT_INCLUDE = DEFAULT_WORD_COUNT_CONFIG.include;

// ---------------------------------------------------------------- real editor

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
  };
}

const editors: Editor[] = [];

/** doc: heading("Alpha beta gamma") · paragraph("one two three four") ·
 *  latexComment("todo fix this") · paragraph("five six") */
function mountEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Alpha beta gamma" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "one two three four" }],
        },
        { type: "latexComment", content: [{ type: "text", text: "todo fix this" }] },
        { type: "paragraph", content: [{ type: "text", text: "five six" }] },
      ],
    },
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

/** Select from the first occurrence of `a` to the end of the first occurrence
 *  of `b`, in DOCUMENT positions (walks the doc for the text nodes). */
function selectSpan(editor: Editor, a: string, b: string): void {
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    const ia = node.text.indexOf(a);
    if (from < 0 && ia >= 0) from = pos + ia;
    const ib = node.text.indexOf(b);
    if (ib >= 0) to = pos + ib + b.length;
    return true;
  });
  if (from < 0 || to < 0) throw new Error(`span "${a}".."${b}" not found`);
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, from, Math.max(from, to)),
    ),
  );
}

describe("selection counts derive from the canonical walker (task 122)", () => {
  it("buckets a selected latexComment into `comments` — so the DEFAULT config excludes it, exactly like the panel headline", () => {
    const editor = mountEditor();
    // paragraph "one two three four" through the comment "todo fix this"
    selectSpan(editor, "one two", "todo fix this");
    const sel = getSelectionCounts(editor);
    expect(sel).not.toBeNull();

    // The comment's three words are CATEGORIZED, not merged into a flat count
    // (the pre-fix walker had no categories at all).
    expect(sel!.words.comments).toBe(3);
    expect(sel!.words.mainText).toBe(4);

    // …and the default include-set drops them, which is the whole defect:
    // pre-fix this selection reported 7 words while the panel called the same
    // text 4.
    expect(includedTotals(sel, DEFAULT_INCLUDE).words).toBe(4);
    expect(includedTotals(sel, ALL_ON).words).toBe(7);
  });

  it("counts a selection wholly INSIDE one paragraph (the `includeParents` trap)", () => {
    const editor = mountEditor();
    selectSpan(editor, "two", "three");
    const sel = getSelectionCounts(editor);
    // Without `includeParents: true` the slice resolves to the shared depth and
    // comes back as BARE INLINE nodes — no paragraph for the block walker to
    // enter — and this reports 0 for the commonest selection there is.
    expect(includedTotals(sel, DEFAULT_INCLUDE).words).toBe(2);
  });

  it("routes heading text to `headings`, matching the whole-doc walker", () => {
    const editor = mountEditor();
    selectSpan(editor, "Alpha", "gamma");
    const sel = getSelectionCounts(editor);
    expect(sel!.words.headings).toBe(3);
    expect(sel!.words.mainText).toBe(0);
  });

  it("a collapsed caret is still null (the O(1) bail every keystroke takes)", () => {
    const editor = mountEditor();
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3, 3)),
    );
    expect(getSelectionCounts(editor)).toBeNull();
  });

  it("selecting the WHOLE doc agrees with the whole-doc walker, category for category", () => {
    const editor = mountEditor();
    const end = editor.state.doc.content.size;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 0, end)),
    );
    const sel = getSelectionCounts(editor)!;
    const whole = computeCategoryCounts(editor.state.doc.toJSON());
    for (const cat of ALL_CATEGORIES) {
      expect(sel.words[cat], `category "${cat}"`).toBe(whole.words[cat]);
      expect(sel.characters[cat], `chars "${cat}"`).toBe(whole.characters[cat]);
    }
  });
});

describe("the filter door", () => {
  const counts = computeCategoryCounts({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "one two three" }] },
      { type: "latexComment", content: [{ type: "text", text: "four five" }] },
    ],
  });

  it("words and characters come back from ONE include-set read", () => {
    const both = includedTotals(counts, DEFAULT_INCLUDE);
    expect(both.words).toBe(3);
    // "onetwothree" — the comment's chars are dropped by the SAME set that
    // dropped its words, so the two headline stats can never disagree on scope.
    expect(both.characters).toBe(11);
  });

  it("null counts resolve to zeros (no second branch at the call site)", () => {
    expect(includedTotals(null, DEFAULT_INCLUDE)).toEqual({ words: 0, characters: 0 });
  });

  it("an all-off include-set is an answer, not a fallback to everything", () => {
    const allOff = Object.fromEntries(
      ALL_CATEGORIES.map((c) => [c, false]),
    ) as IncludeSet;
    expect(includedTotals(counts, allOff)).toEqual({ words: 0, characters: 0 });
  });
});

// -------------------------------------------------------------------- census

const SRC = resolve(__dirname, "../..");
const LIBRARY = resolve(__dirname, "../../../library");
const CORE = resolve(SRC, "lib/word-count-core.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.(d\.ts|test\.tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

/** Production sources in BOTH silos, comments stripped and string literals
 *  KEPT — the drift this census hunts lives in code, and blanking literals is
 *  how task 205 made a leg unfalsifiable. */
const PROD: ReadonlyArray<readonly [string, string]> = [
  ...walk(SRC),
  ...walk(LIBRARY),
].map((f) => [f, strip(readFileSync(f, "utf8"), true)] as const);

const rel = (f: string) => relative(resolve(SRC, ".."), f);

describe("census: nothing re-derives a total (the leg that catches the ORIGINAL shape)", () => {
  it("can see the code it is grepping (canary)", () => {
    const core = PROD.find(([f]) => f === CORE);
    expect(core, "word-count-core.ts must be in the census").toBeTruthy();
    expect(core![1]).toContain("export function includedTotals");
    expect(PROD.length).toBeGreaterThan(300);
  });

  it("no consumer reduces over the include-set itself", () => {
    // The pre-fix `WordCountPanel` had exactly two of these, and having them
    // is what made the filter unshareable. A statement that both reduces and
    // names `include`/`visible(` is that shape.
    const hits = PROD.filter(([f, code]) => {
      if (f === CORE) return false;
      return /\.reduce\((?:[^;]|\n){0,400}?(?:include\[|visible\()/.test(code);
    }).map(([f]) => rel(f));
    expect(hits).toEqual([]);
  });

  it("the retired unfiltered fields are gone and stay gone", () => {
    // `WordCounts.total` / `.characters` / `.sentences` / `.readingTime` were
    // the precomputed answers a consumer could read INSTEAD of asking the
    // filter — plus, for the last two, dead fields with zero readers. Deleting
    // them is the guard; this pins the delete against a quiet reintroduction.
    // (A future reading-time / sentence feature is welcome — it arrives WITH a
    // reader and drops its name from this list, deliberately, which is the
    // whole point of the list.)
    for (const needle of [
      "computeWordCounts",
      "characterCategories",
      "countSentences",
      "readingTime",
    ]) {
      const hits = PROD.filter(([, code]) => code.includes(needle)).map(([f]) => rel(f));
      expect(hits, `"${needle}" should have no production site`).toEqual([]);
    }
  });

  it("every surface that renders a word TOTAL goes through the filter door", () => {
    // `currentWords` is the Cutter goal strip's sole input — the exact prop the
    // unfiltered total flowed into. A file that supplies it must import the
    // door. (The strip itself only RECEIVES the number, so the JSX-attribute
    // form is the needle, not the declaration.)
    const suppliers = PROD.filter(([, code]) => /currentWords=\{/.test(code));
    expect(suppliers.length, "the goal strip still has a call site").toBe(1);
    for (const [f, code] of suppliers) {
      expect(code, `${rel(f)} must derive currentWords from includedTotals`).toContain(
        "includedTotals",
      );
    }
  });
});
