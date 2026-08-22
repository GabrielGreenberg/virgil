// @vitest-environment jsdom
//
// TASK 402 — DATA LOSS: the archive card body dropped nine attr names.
//
// THE SHAPE. `EXCERPT_STARTER_KIT_CONFIG` is the empty override, so an excerpt
// card body mounted StarterKit's PLAIN `heading` / `paragraph` / `bulletList` /
// `orderedList` / `listItem` / `blockquote` / `codeBlock` — while the MAIN
// editor turns those same StarterKit nodes OFF and registers its own carrying
// `uuid`, `parTitle`, `label`, `numbered`, `sectionNumber`, `shortTitle`,
// `listPreamble`, `listOptions` and `itemLabel`. Nineteen node x attr pairs.
// ProseMirror drops an attr the mounted schema does not declare in SILENCE:
// `computeAttrs` iterates the TYPE's attrs, and `checkAttrs` then validates the
// already-computed result, which by construction holds no undeclared key.
//
// THE STRIPPER IS THE CARD-BODY EDIT, NOT THE RESTORE — and that is why every
// leg here types a character. `restoreExcerptAtCaret` strips nothing;
// `RichTextField`'s `onUpdate` (250 ms debounce) and its `onBlur` flush both
// call `onChange(editor.getJSON())` on the attr-poor mounted schema, and the
// archive host writes that result straight over `snippet.content`. So:
//
//     archive (attrs intact)
//       -> the user edits ONE character in the card body
//       -> archive.json now holds an attr-less heading
//       -> restore faithfully hands back the lamed version.
//
// An UNEDITED excerpt restored whole, which is exactly why the loss read as
// flaky rather than broken — and why the no-edit leg at the bottom is a
// NON-REGRESSION pin rather than a defect leg: it passes either way.
//
// WHAT EACH LOSS COST. `label` / `numbered` / `shortTitle` are the heading's
// `\label{}`, its `*` and its `[short]`; `listOptions` / `listPreamble` are
// `\begin{itemize}[…]` and its tuning lines; `itemLabel` is `\item[…]`.
// `parTitle` has no `.tex` carrier at all — it lives in the sidecar and was
// simply gone. `uuid` is IDENTITY, not bytes: `BlockUuidBackfill` mints a FRESH
// one on restore, so every card anchored to the archived block ORPHANS.
//
// WHY NO EXISTING SUITE COULD SEE IT. `excerpt-schema.test.ts` is a
// reverse-direction contract over node/mark TYPES — `heading` is mountable, so
// it was silent, and its fixture comment waved the attr drop through
// explicitly. It gains the per-type ATTR leg with this task; this suite drives
// the path the loss actually travelled.
import { describe, it, expect, vi, afterEach } from "vitest";

// The extension barrel transitively imports `@/lib/storage` (figure / graphics /
// tex-block NodeViews). Same stub the sibling schema suites use.
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

import fs from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  TabIndent,
  starterKitConfigForScope,
  buildCardBodySchema,
} from "@/lib/tiptap-extensions";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { prepareCardBodyCapture } from "@/lib/tiptap/card-body-capture";
import { restoreExcerptAtCaret } from "@/lib/tiptap/restore-excerpt";
import { normalizeRichContent } from "@/lib/footnote-content";
import { parseLatex } from "@/lib/latex-parser";
import {
  serializeBodyOnly,
  extractSidecarData,
  assignUuids,
} from "@/lib/latex-serializer";
import { bodySchemaForCardKind } from "@/cards/predicates";
import type { VirgilSidecar } from "@/lib/types";
import { codeOnly } from "@/lib/__tests__/_source-scan";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

// ── The two surfaces, composed exactly as the components compose them ──────

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

const open: (() => void)[] = [];

function mount(extensions: unknown[], content: JSONContent): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editor = new Editor({ element, extensions: extensions as any, content });
  open.push(() => {
    editor.destroy();
    element.remove();
  });
  return editor;
}

function mainEditor(content: JSONContent): Editor {
  return mount(buildEditorExtensions(mainCtx()), content);
}

/** The EXPANDED archive card body — `RichTextField` at `"excerpt"` scope,
 *  extension for extension. The scope comes from `bodySchemaForCardKind` rather
 *  than a literal, so a kind that stopped declaring `bodySchema: "excerpt"`
 *  moves this suite with it. */
function archiveCardBody(content: JSONContent): Editor {
  const scope = bodySchemaForCardKind("archive");
  return mount(
    [
      StarterKit.configure({ ...starterKitConfigForScope(scope) }),
      Placeholder.configure({ placeholder: "" }),
      TabIndent,
      ...buildCardBodySchema(scope, { includeLabelRef: true }),
    ],
    content,
  );
}

afterEach(() => {
  while (open.length) open.pop()!();
});

// ── The pipeline, in the order the loss travels ────────────────────────────

/** A `.tex` + its sidecar, through the REAL parser, as the loader produces it.
 *
 *  Every fixture below carries EXPLICIT `%!v:` anchors, which is load-bearing
 *  rather than tidy: `assignUuids` mints RANDOM ids, so a fixture without them
 *  gets a different identity on every parse and an identity assertion becomes
 *  unfalsifiable in both directions — it would fail on a correct restore and
 *  could never fail on a broken one. With the anchor in the source, the uuid is
 *  the document's own, exactly as a real paper's is. */
function documentFrom(tex: string, sidecar?: VirgilSidecar) {
  const doc = parseLatex(tex, sidecar);
  assignUuids(doc);
  return doc;
}

/** The ARCHIVE capture: the real dispatcher's `doc.slice(from, to)` through the
 *  ONE capture door. Returns exactly the object the snippet would store. */
function archiveWholeDoc(main: Editor): JSONContent {
  const doc = main.state.doc;
  const capture = prepareCardBodyCapture(
    doc.slice(0, doc.content.size),
    bodySchemaForCardKind("archive"),
  );
  if (!capture.ok) throw new Error(`capture refused: ${capture.reason}`);
  return capture.content;
}

/** ONE card-body edit cycle: mount the stored content in the real card body,
 *  type a character, and return what the host would write back —
 *  `normalizeRichContent(editor.getJSON())`, which is `handleEditContent`
 *  (ArchiveCard) -> `onEdit` -> `updateSnippet` verbatim. */
function editInCard(stored: JSONContent): JSONContent {
  const card = archiveCardBody(stored);
  card.commands.focus("end");
  card.commands.insertContent("!");
  const out = normalizeRichContent(card.getJSON());
  // The edit is the whole repro, so prove one happened. Without this a leg
  // that silently failed to type would assert on an UNEDITED excerpt — which
  // restores whole on the pre-fix tree too, i.e. it would pass vacuously in
  // exactly the way the pinned non-regression leg at the bottom does by design.
  expect(JSON.stringify(out), "the card body was not edited").not.toEqual(
    JSON.stringify(stored),
  );
  return out;
}

/** RESTORE into a fresh document at a caret in a plain top-level paragraph
 *  (the only place `restoreExcerptAtCaret` permits a split), then report the
 *  `.tex` bytes + sidecar the next save would write. */
function restoreAndSave(stored: JSONContent) {
  const host = mainEditor({
    type: "doc",
    content: [{ type: "paragraph" }],
  });
  const landed = restoreExcerptAtCaret(host, stored);
  expect(landed, "the restore did not land").toBe(true);
  const doc = host.getJSON();
  return { doc, tex: serializeBodyOnly(doc), sidecar: extractSidecarData(doc) };
}

/** The whole story: parse -> archive -> N card edits -> restore -> save. */
function archiveEditRestore(
  tex: string,
  opts: { cycles?: number; sidecar?: VirgilSidecar } = {},
) {
  const main = mainEditor(documentFrom(tex, opts.sidecar) as JSONContent);
  let stored = archiveWholeDoc(main);
  const captured = stored;
  for (let i = 0; i < (opts.cycles ?? 1); i++) stored = editInCard(stored);
  return { captured, stored, ...restoreAndSave(stored) };
}

function findByType(node: JSONContent, type: string): JSONContent | null {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const hit = findByType(child, type);
    if (hit) return hit;
  }
  return null;
}

/** Every uuid in a doc, in document order. */
function uuidsIn(node: JSONContent, out: string[] = []): string[] {
  const u = node.attrs?.uuid;
  if (typeof u === "string" && u) out.push(u);
  for (const child of node.content ?? []) uuidsIn(child, out);
  return out;
}

// ── 1. THE REPORTED CASE — a starred section with a short title + a label ──

describe("task 402 · a heading survives the card-body edit", () => {
  // `\section*[Short]{Title}` + `\label{}`: four of the five heading attrs at
  // once, three of them with `.tex` bytes riding on them.
  const TEX =
    `\\section*[Short RH]{The Long Title}\n` +
    `\\label{sec:intro} %!v:a001\n\nBody prose. %!v:a002`;

  it("keeps label, numbered:false, shortTitle and its uuid — on the BYTES and the attrs", () => {
    const before = documentFrom(TEX);
    const headingBefore = findByType(before as JSONContent, "heading")!;
    // The premise: the parser really did produce all four.
    expect(headingBefore.attrs).toMatchObject({
      label: "sec:intro",
      numbered: false,
      shortTitle: "Short RH",
    });
    expect(typeof headingBefore.attrs!.uuid).toBe("string");

    const out = archiveEditRestore(TEX);
    const heading = findByType(out.doc, "heading")!;
    expect(heading.attrs).toMatchObject({
      label: "sec:intro",
      numbered: false,
      shortTitle: "Short RH",
      uuid: headingBefore.attrs!.uuid,
    });
    // …and the bytes, which is what the user actually loses. The typed
    // character lands at the END of the card body (the last paragraph), so the
    // heading's own bytes must come back untouched.
    expect(out.tex).toContain("\\section*[Short RH]{The Long Title}");
    expect(out.tex).toContain("\\label{sec:intro}");
    expect(out.tex, "the edit did reach the body").toContain("Body prose.!");
  });

  it("survives a SECOND card-body edit unchanged (nothing accumulates)", () => {
    const out = archiveEditRestore(TEX, { cycles: 2 });
    const heading = findByType(out.doc, "heading")!;
    expect(heading.attrs).toMatchObject({
      label: "sec:intro",
      numbered: false,
      shortTitle: "Short RH",
    });
    expect(out.tex).toContain("\\section*[Short RH]{");
    expect(out.tex).toContain("\\label{sec:intro}");
  });
});

// ── 2. THE OTHER SIX ROWS OF THE TABLE ─────────────────────────────────────

describe("task 402 · every forked node keeps its attrs through a card-body edit", () => {
  it("a bullet list keeps listOptions", () => {
    const TEX =
      `\\begin{itemize}[label=(\\roman*)]\n` +
      `  \\item alpha %!v:b001\n\\end{itemize} %!v:b002`;
    const out = archiveEditRestore(TEX);
    expect(findByType(out.doc, "bulletList")!.attrs!.listOptions).toBe(
      "[label=(\\roman*)]",
    );
    expect(out.tex).toContain("\\begin{itemize}[label=(\\roman*)]");
  });

  it("an ordered list keeps its listPreamble", () => {
    const TEX =
      `\\begin{enumerate}\n  \\setlength{\\itemsep}{0pt}\n` +
      `  \\item one %!v:b003\n\\end{enumerate} %!v:b004`;
    const out = archiveEditRestore(TEX);
    expect(findByType(out.doc, "orderedList")!.attrs!.listPreamble).toContain(
      "\\setlength",
    );
    expect(out.tex).toContain("\\setlength{\\itemsep}{0pt}");
  });

  it("a list item keeps its itemLabel", () => {
    const TEX =
      `\\begin{itemize}\n  \\item[(b)] beta %!v:b005\n\\end{itemize} %!v:b006`;
    const out = archiveEditRestore(TEX);
    expect(findByType(out.doc, "listItem")!.attrs!.itemLabel).toBe("(b)");
    expect(out.tex).toContain("\\item[(b)]");
  });

  it("a blockquote keeps its uuid", () => {
    const TEX = `\\begin{quote}\nQuoted prose.\\end{quote} %!v:c001`;
    const before = documentFrom(TEX) as JSONContent;
    const uuid = findByType(before, "blockquote")!.attrs!.uuid as string;
    expect(typeof uuid).toBe("string");
    const out = archiveEditRestore(TEX);
    expect(findByType(out.doc, "blockquote")!.attrs!.uuid).toBe(uuid);
  });

  it("a code block keeps its uuid", () => {
    const TEX = `\\begin{verbatim}\nx = 1\n\\end{verbatim} %!v:c002`;
    const before = documentFrom(TEX) as JSONContent;
    const uuid = findByType(before, "codeBlock")!.attrs!.uuid as string;
    expect(typeof uuid).toBe("string");
    const out = archiveEditRestore(TEX);
    expect(findByType(out.doc, "codeBlock")!.attrs!.uuid).toBe(uuid);
  });

  it("a paragraph keeps its parTitle — which lives ONLY in the sidecar", () => {
    // `parTitle` has no `.tex` carrier: `\partitle{}` is parsed for legacy
    // migration and nothing serializes it. So the loss here is invisible in the
    // bytes and total in the sidecar — the assertion has to be the sidecar the
    // next save would write.
    const TEX = `Titled prose. %!v:d001`;
    const sidecar: VirgilSidecar = {
      paragraphs: { d001: { title: "A NAMED PARAGRAPH" } },
    };
    // The premise: the REAL loader merge really did put the title on the node.
    expect(
      findByType(documentFrom(TEX, sidecar) as JSONContent, "paragraph")!.attrs!
        .parTitle,
    ).toBe("A NAMED PARAGRAPH");
    const out = archiveEditRestore(TEX, { sidecar });
    expect(findByType(out.doc, "paragraph")!.attrs!.parTitle).toBe(
      "A NAMED PARAGRAPH",
    );
    expect(JSON.stringify(out.sidecar)).toContain("A NAMED PARAGRAPH");
  });
});

// ── 3. IDENTITY — the loss with no bytes at all ────────────────────────────

describe("task 402 · anchor identity survives the card-body edit", () => {
  it("every archived block comes back with the uuid it went in with", () => {
    // The `uuid` half is not a byte question and no `.tex` assertion can see
    // it: a re-minted uuid serializes to a perfectly well-formed document. What
    // it costs is every card, marginalia marker and sidecar entry keyed on the
    // archived block — they orphan instead of re-anchoring, which is precisely
    // what an archive card exists NOT to do.
    const TEX = [
      `\\section{One}`,
      `\\label{sec:one} %!v:e001`,
      ``,
      `Alpha prose. %!v:e002`,
      ``,
      `\\begin{quote}`,
      `Quoted.\\end{quote} %!v:e003`,
    ].join("\n");
    const before = documentFrom(TEX) as JSONContent;
    const expected = uuidsIn(before);
    expect(expected.length).toBeGreaterThan(2);

    const out = archiveEditRestore(TEX, { cycles: 2 });
    // The restore lands into a host that already holds one (minted) paragraph,
    // so compare the SET rather than the sequence.
    for (const uuid of expected) {
      expect(uuidsIn(out.doc), `lost the identity of ${uuid}`).toContain(uuid);
    }
  });
});

// ── 4. NON-REGRESSION PINS (these pass either way, and say so) ─────────────

describe("task 402 · non-regression", () => {
  it("an UNEDITED excerpt still restores whole", () => {
    // Today's behaviour and the fix must not change it. Deliberately recorded
    // as a PIN rather than a defect leg: the pre-402 tree passes it too, which
    // is exactly the vacuous shape a leg for this bug must avoid.
    const TEX =
      `\\section*[Short RH]{The Long Title}\n\\label{sec:intro} %!v:f001`;
    const out = archiveEditRestore(TEX, { cycles: 0 });
    expect(out.tex).toContain("\\section*[Short RH]{The Long Title}");
    expect(out.tex).toContain("\\label{sec:intro}");
  });

  it("the card body does NOT stamp data-uuid into its own DOM", () => {
    // The excerpt takes the attrs DATA-only (`dataOnlyAttrs`). `data-uuid` is a
    // resolution key — `resolveDomForUuid`, the grab-handle hover scan and the
    // marginalia registry all query it — and a card body has none of that
    // chrome, so a second copy of the document's identity attributes has no
    // reader and every opportunity to become one.
    const stored = archiveWholeDoc(
      mainEditor(
        documentFrom(`\\begin{quote}\nQuoted.\\end{quote} %!v:f002`) as JSONContent,
      ),
    );
    const card = archiveCardBody(stored);
    expect(card.view.dom.querySelector("[data-uuid]")).toBeNull();
    expect(card.view.dom.querySelector("[data-text-object-kind]")).toBeNull();
    // …while the attr is genuinely THERE in the model.
    expect(findByType(card.getJSON(), "blockquote")!.attrs!.uuid).toBeTruthy();
  });

  it("the narrow 'card' scope is untouched — a note body mints no doc attrs", () => {
    const scope = bodySchemaForCardKind("footnote");
    expect(scope).toBe("card");
    const note = mount(
      [
        StarterKit.configure({ ...starterKitConfigForScope(scope) }),
        Placeholder.configure({ placeholder: "" }),
        TabIndent,
        ...buildCardBodySchema(scope, { includeLabelRef: true }),
      ],
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "note" }] }] },
    );
    const para = findByType(note.getJSON(), "paragraph")!;
    expect(Object.keys(para.attrs ?? {})).toEqual([]);
  });
});

// ── 5. THE CENSUS — the surface must READ the shared composition ───────────

describe("task 402 · the card surfaces read the shared scope composition", () => {
  // The legs above compose the extension list themselves, exactly as the
  // component does — which is worth nothing if the component stops composing it
  // that way. The table was never the part that could misbehave; a surface that
  // does not read it is (this task's whole subject, one level up).
  const read = (rel: string) =>
    codeOnly(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));

  it.each([
    "src/components/RichTextField.tsx",
    "src/components/BorrowedMainText.tsx",
  ])("%s resolves its StarterKit config and body schema by SCOPE", (rel) => {
    const src = read(rel);
    expect(src, "must not hard-code a StarterKit config").toContain(
      "starterKitConfigForScope(",
    );
    expect(src, "must not hard-code a body sub-schema").toContain(
      "buildCardBodySchema(",
    );
  });

  it("nothing outside the SSOT re-declares one of the nine attr names", () => {
    // A second spelling of `itemLabel: { default: null, … }` in a surface is
    // the fork this task retires, and it would type-check perfectly.
    const NAMES = [
      "parTitle",
      "label",
      "numbered",
      "sectionNumber",
      "shortTitle",
      "listPreamble",
      "listOptions",
      "itemLabel",
    ];
    const files = [
      "src/lib/editor-extensions.ts",
      "src/lib/tiptap/borrowed-schema.ts",
      "src/components/RichTextField.tsx",
      "src/components/BorrowedMainText.tsx",
    ];
    const offenders: string[] = [];
    for (const rel of files) {
      const src = read(rel);
      for (const name of NAMES) {
        // The DECLARATION form only — `{ default: … }` on the same line.
        const re = new RegExp(`\\b${name}\\s*:\\s*\\{[^}]*\\bdefault\\b`);
        if (re.test(src)) offenders.push(`${rel}:${name}`);
      }
    }
    expect(
      offenders,
      "An attr spec declared outside `MAIN_STARTERKIT_NODE_ATTRS`. Move it " +
        "into the table (src/lib/node-attr-sets.ts) — a spec spelled twice is " +
        "a spec that can drift, and the drift this cluster is about cost the " +
        "user their \\label{}s.",
    ).toEqual([]);
  });
});
