// @vitest-environment jsdom
//
// Task 512 — a `%` COMMENT BLOCK is a byte-literal container, so no type-time
// transform may restyle its bytes.
//
// THE BUG THIS PINS. `latexComment` declared `marks: ""` — which the prose
// index reads as "byte-literal container" (`blockCarriesProse`, rule 2: a node
// that admits no marks can never wear a carrier, so Virgil has no way to say
// which of its characters are raw LaTeX) — and did NOT declare `code`, which is
// the SAME FACT in the vocabulary TipTap's input-rule runner actually reads
// (`$from.parent.type.spec.code`). Two spellings of one fact, one of them
// missing, so every type-time rule fired inside a comment. MEASURED on the
// pre-512 tree:
//
//   - typing `a--b "q" c---d` into a comment produced `% todo a–b “q” c—d` —
//     curly quotes and en/em dashes written straight into the comment's own
//     source bytes, which the serializer emits raw (it round-trips, so the cost
//     was cosmetic-in-source rather than corruption — hence `low`);
//   - typing `` `code` `` DELETED both backticks. StarterKit's `code` MARK rule
//     matched, failed to apply a mark this node forbids, and kept its deletion
//     anyway. That one is LOSSY, it is in the same block and the same layer,
//     and it is why the fix is the framework's declaration rather than a
//     predicate inside `SmartQuotes`: a gate confined to our own rules closes
//     the reported symptom and leaves its worse sibling live.
//
// WHAT IS PROVEN (the REAL `buildEditorExtensions("main")` stack, typed one
// character at a time through the shipped `handleTextInput` prop — a single
// `insertContent` is a different transaction shape and fires no input rule at
// all, so it would pass on the pre-512 tree):
//   1. Typography and the `code` rule are declined inside a comment block, and
//      the `.tex` carries the literal characters.
//   2. CONTROLS — typography still fires in ordinary prose; a `codeBlock` is
//      unchanged; a `latexCommand` run still smartens (its deliberate net).
//   3. The comment-TAIL mark was ALREADY covered by `code: true` on the mark —
//      measured, not assumed, and pinned as a non-regression both INSIDE a tail
//      run (declines) and AFTER one (fires, because `inclusive: false` makes
//      what follows genuine prose, which the serializer puts on its own line).
//   4. TWO-CYCLE round-trip byte-identity for the shapes `code: true` could
//      have moved: interior blank lines around a comment, leading/trailing
//      whitespace, and an existing curly quote already in the source.
//   5. The whitespace flip is DECLINED, not inherited — `whitespace: "normal"`
//      is stated explicitly, so DOM parsing of a comment is byte-identical to
//      the pre-512 tree and a pasted newline cannot put a second line LIVE.
import { describe, it, expect, afterEach, vi } from "vitest";

// The extension barrel reaches `@/lib/storage`, whose backend `require` has no
// resolvable target under vitest — the standard stub for this stack.
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
import { TextSelection } from "@tiptap/pm/state";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { serializeToLatex, serializeBodyOnly, assignUuids } from "@/lib/latex-serializer";
import type { JSONContent } from "@tiptap/core";

const EN_DASH = "–";
const EM_DASH = "—";
const OPEN_Q = "“";
const CLOSE_Q = "”";

// ---------------------------------------------------------------------------
// Real editor stack
// ---------------------------------------------------------------------------

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

const live: Editor[] = [];
afterEach(() => {
  while (live.length) live.pop()?.destroy();
});

function mount(content: unknown): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: content as never,
  });
  live.push(ed);
  return ed;
}

/** Type one character the way the browser feeds it to ProseMirror — through the
 *  shipped `handleTextInput` prop, falling back to a plain insert when no rule
 *  fires. `insertContentAt` would bypass the input-rule runner entirely. */
function typeChar(ed: Editor, ch: string) {
  const { from, to } = ed.state.selection;
  const handled = ed.view.someProp("handleTextInput", (f) =>
    f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)),
  );
  if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
}

function typeText(ed: Editor, text: string) {
  for (const ch of text) typeChar(ed, ch);
}

/** Caret at the END of the first node of `typeName`. */
function caretAtEndOf(ed: Editor, typeName: string) {
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && n.type.name === typeName) pos = p + 1 + n.content.size;
    return pos < 0;
  });
  expect(pos).toBeGreaterThan(-1);
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
}

/** The text of the first node of `typeName`. */
function textOf(ed: Editor, typeName: string): string {
  let out: string | null = null;
  ed.state.doc.descendants((n) => {
    if (out === null && n.type.name === typeName) out = n.textContent;
    return out === null;
  });
  return out ?? "";
}

function commentDoc(seed: string) {
  return {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "alpha" }] },
      { type: "latexComment", attrs: { uuid: "c1" }, content: [{ type: "text", text: seed }] },
    ],
  };
}

function bodyOf(tex: string): string {
  const m = tex.match(/\\begin\{document\}\n?([\s\S]*?)\n?\\end\{document\}/);
  return (m?.[1] ?? "").trim();
}

// ── 1. the defect ────────────────────────────────────────────────────────────

describe("a `%` comment block declines every type-time transform", () => {
  it("typography leaves the literal characters in the comment BYTES", () => {
    const ed = mount(commentDoc("todo "));
    caretAtEndOf(ed, "latexComment");
    typeText(ed, 'a--b "q" c---d');
    // Pre-512: `todo a–b “q” c—d`.
    expect(textOf(ed, "latexComment")).toBe('todo a--b "q" c---d');
    expect(bodyOf(serializeToLatex(ed.getJSON() as JSONContent))).toContain(
      'todo a--b "q" c---d',
    );
  });

  it("a backtick pair survives — the LOSSY sibling in the same block", () => {
    // StarterKit's `code` MARK rule. Pre-512 it matched, could not apply a mark
    // this node forbids, and DELETED both backticks anyway. This is the leg
    // that a predicate inside `SmartQuotes` could not have turned green.
    const ed = mount(commentDoc("t "));
    caretAtEndOf(ed, "latexComment");
    typeText(ed, "`code`");
    expect(textOf(ed, "latexComment")).toBe("t `code`");
  });

  it("the comment carries no mark either way — the gate changes bytes, not the model", () => {
    const ed = mount(commentDoc("t "));
    caretAtEndOf(ed, "latexComment");
    typeText(ed, "**bold** `x`");
    const json = ed.getJSON() as {
      content?: { type?: string; content?: { marks?: unknown[] }[] }[];
    };
    const cmt = (json.content ?? []).find((n) => n.type === "latexComment");
    for (const child of cmt?.content ?? []) expect(child.marks ?? []).toEqual([]);
  });
});

// ── 2. controls — the gate is not a blanket ──────────────────────────────────

describe("controls", () => {
  it("typography still fires in ordinary prose", () => {
    const ed = mount(commentDoc("todo "));
    caretAtEndOf(ed, "paragraph");
    typeText(ed, ' a--b "q" c---d');
    expect(textOf(ed, "paragraph")).toBe(
      `alpha a${EN_DASH}b ${OPEN_Q}q${CLOSE_Q} c${EM_DASH}d`,
    );
  });

  it("a codeBlock is unchanged (its own `code: true`, pre-512 behaviour)", () => {
    const ed = mount({
      type: "doc",
      content: [{ type: "codeBlock", attrs: { uuid: "k1" }, content: [{ type: "text", text: "ab" }] }],
    });
    caretAtEndOf(ed, "codeBlock");
    typeText(ed, '--"');
    expect(textOf(ed, "codeBlock")).toBe('ab--"');
  });

  it("a `latexCommand` run still smartens — its deliberate net is untouched", () => {
    // `latex-command.ts` says why in place: smartening a quote typed into a
    // stray inherited command span is what keeps it emitting valid `.tex`.
    const ed = mount({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "p1" },
          content: [{ type: "text", text: "ab", marks: [{ type: "latexCommand" }] }],
        },
      ],
    });
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 2)));
    typeText(ed, "--");
    expect(textOf(ed, "paragraph")).toBe(`a${EN_DASH}b`);
  });
});

// ── 3. the comment TAIL mark — measured, not assumed ─────────────────────────

describe("the comment TAIL mark was already covered", () => {
  function taggedProse() {
    const parsed = parseLatex("Some prose % a tail here\n");
    return mount({ type: "doc", content: parsed.content });
  }

  it("declines INSIDE a tail run (the mark's own `code: true`)", () => {
    const ed = taggedProse();
    const mid = 1 + "Some prose ".length + 5;
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, mid)));
    typeText(ed, '--"');
    expect(ed.state.doc.textContent).toBe('Some prose % a t--"ail here');
  });

  it("FIRES after a tail run — what follows it is genuine prose", () => {
    // `inclusive: false`, so typed text does not inherit the carrier; the
    // serializer's line obligation then puts it on its own line, where
    // smartened glyphs are correct and round-trip to `` `` `` / `''`.
    const ed = taggedProse();
    const end = ed.state.doc.content.size - 1;
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, end)));
    typeText(ed, ' x--y "q"');
    expect(ed.state.doc.textContent).toBe(
      `Some prose % a tail here x${EN_DASH}y ${OPEN_Q}q${CLOSE_Q}`,
    );
    const tex = serializeBodyOnly(ed.getJSON() as JSONContent);
    expect(tex).toContain("Some prose % a tail here\n");
    expect(tex).toContain("x--y ``q''");
  });
});

// ── 4. round trips — what `code: true` could have moved ──────────────────────

describe("two-cycle round trips over the shapes `code` could have moved", () => {
  const SOURCES: Record<string, string> = {
    "a plain comment between paragraphs": "Alpha.\n\n% todo fix later\n\nBeta.\n",
    "interior BLANK LINES around the comment": "Alpha.\n\n\n% todo\n\n\nBeta.\n",
    "leading and trailing whitespace in the comment": "Alpha.\n\n%   spaced out   \n\nBeta.\n",
    "an existing CURLY QUOTE already in the comment bytes":
      `Alpha.\n\n% he said ${OPEN_Q}hi${CLOSE_Q} and ${EN_DASH} left\n\nBeta.\n`,
    "a comment holding LaTeX and a backtick pair": "Alpha.\n\n% see \\emph{x} and `y`\n\nBeta.\n",
  };

  for (const [label, src] of Object.entries(SOURCES)) {
    it(`is a FIXED POINT for ${label}`, () => {
      const d1 = { type: "doc", content: parseLatex(src).content } as JSONContent;
      assignUuids(d1);
      const out1 = serializeBodyOnly(d1);
      const d2 = {
        type: "doc",
        content: parseLatex(`\\begin{document}\n${out1}\n\\end{document}\n`).content,
      } as JSONContent;
      assignUuids(d2);
      const out2 = serializeBodyOnly(d2);
      expect(out2).toBe(out1);
      // …and the comment's own bytes survive both cycles verbatim.
      const comment = out1.split("\n").find((l) => l.startsWith("%"));
      expect(comment).toBeTruthy();
      expect(out2).toContain(comment as string);
    });
  }
});

// ── 5. the whitespace flip is DECLINED, not inherited ────────────────────────

describe("`whitespace: \"normal\"` keeps DOM parsing byte-identical", () => {
  it("the spec states it explicitly rather than inheriting `pre` from `code`", () => {
    // ProseMirror derives it: `spec.whitespace || (spec.code ? "pre" : "normal")`.
    // Stating it is the whole of the declination, so it is pinned rather than
    // left to be rediscovered.
    const ed = mount(commentDoc("t"));
    const type = ed.state.schema.nodes.latexComment;
    expect(type.spec.code).toBe(true);
    expect(type.spec.whitespace).toBe("normal");
    expect(type.whitespace).toBe("normal");
  });

  it("a NEWLINE in pasted comment markup cannot put a second line LIVE", () => {
    // Under `pre` the newline survives into the text node, and the serializer's
    // `% ${textContent}` then emits `% one\ntwo` — line two is live `.tex`.
    const ed = mount(commentDoc("t"));
    const host = document.createElement("div");
    host.innerHTML =
      '<div data-type="latex-comment"><span class="latex-comment-prefix">% </span>' +
      '<span class="latex-comment-editable">one\ntwo</span></div>';
    const parsed = PMDOMParser.fromSchema(ed.state.schema).parse(host);
    const first = parsed.firstChild;
    expect(first?.type.name).toBe("latexComment");
    expect(first?.textContent).not.toContain("\n");
    expect(serializeBodyOnly({ type: "doc", content: parsed.toJSON().content } as JSONContent))
      .not.toMatch(/^two/m);
  });
});
