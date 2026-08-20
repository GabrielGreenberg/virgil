// @vitest-environment jsdom
//
// TASK 308 — the never-delete-what-you-cannot-restore contract.
//
// The bug this pins: archiving a SECTION (grab bar on a section title) captured
// a faithful `heading`-bearing slice of the document, deleted the whole section,
// and then handed that capture to a card body whose schema had no `heading`
// node. TipTap does NOT throw on an unknown node type — `createNodeFromContent`
// swallows the `RangeError` and returns an EMPTY document (`enableContentCheck`
// is off by default) — so the card booted BLANK with nothing but a
// `console.warn`, and the first keystroke in that blank body persisted the empty
// doc back over the capture. From the user's view: total data loss.
//
// Three layers, matching the two halves of the fix:
//   1. VOCABULARY — the excerpt surface mounts every cluster member (heading,
//      blockquote, codeBlock, horizontalRule, the expex family, the nested
//      footnote marker, the highlight/textColor marks) and round-trips them.
//   2. THE REVERSE CONTRACT (the CI teeth) — every node/mark type the MAIN
//      editor can produce is mountable in the excerpt schema. The pre-existing
//      `borrowed-schema.test.ts` invariant runs one-directionally (borrowed ⊆
//      main), so it structurally CANNOT catch a main-only type reaching a card.
//      This is the direction that could. A new main-editor node kind fails here
//      until the excerpt surface admits it.
//   3. THE GUARD — `canMountInCardBody` refuses exactly what would blank, so
//      the destructive caller can abort instead of destroying.
import { describe, it, expect, vi } from "vitest";

// The extension barrel transitively imports `@/lib/storage` (figure / graphics /
// tex-block NodeViews). Same stub the sibling schema tests use — nothing here
// calls a storage function.
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

import { Editor, getSchema, type Content } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  TabIndent,
  starterKitConfigForScope,
  buildCardBodySchema,
  canMountInCardBody,
} from "@/lib/tiptap-extensions";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { bodySchemaForCardKind, excerptCardKinds } from "@/cards/predicates";

// ── The surfaces, composed exactly as the components compose them ──────────

/** RichTextField (the EXPANDED archive card body). */
function excerptEditableExtensions() {
  return [
    StarterKit.configure({ ...starterKitConfigForScope("excerpt") }),
    Placeholder.configure({ placeholder: "" }),
    TabIndent,
    ...buildCardBodySchema("excerpt", { includeLabelRef: true }),
  ];
}

/** BorrowedMainText (the COMPRESSED archive card body). */
function excerptReadOnlyExtensions() {
  return [
    StarterKit.configure({ ...starterKitConfigForScope("excerpt") }),
    ...buildCardBodySchema("excerpt", { includeLabelRefFootnote: true }),
  ];
}

/** RichTextField at the narrow authored-prose scope — the footnote/note body,
 *  unchanged by this task. Used to prove the widening did NOT leak. */
function cardEditableExtensions() {
  return [
    StarterKit.configure({ ...starterKitConfigForScope("card") }),
    Placeholder.configure({ placeholder: "" }),
    TabIndent,
    ...buildCardBodySchema("card", { includeLabelRef: true }),
  ];
}

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

function mount(extensions: ReturnType<typeof excerptEditableExtensions>, content: Content, editable: boolean) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({ element, editable, extensions, content });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

/** Every node type name AND `mark:<name>` present in a doc JSON (recursive). */
function typesIn(json: unknown): Set<string> {
  const seen = new Set<string>();
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { type?: string; content?: unknown[]; marks?: { type: string }[] };
    if (node.type) seen.add(node.type);
    (node.marks ?? []).forEach((m) => seen.add(`mark:${m.type}`));
    (node.content ?? []).forEach(walk);
  };
  walk(json);
  return seen;
}

// ── The capture fixtures ───────────────────────────────────────────────────
//
// These are shaped like real `sliceToDocJson` output: main-editor blocks carry
// their `uuid` / `parTitle` / `label` attrs, which the card schemas' plain
// StarterKit nodes do not declare. (Verified tolerated — ProseMirror ignores
// undeclared attrs on a known type; only an unknown TYPE or MARK blanks the
// doc. Pinned by the `card` cluster row below, which fails on `heading` alone.)

/** A whole section as the heading grab-bar Archive captures it: the heading,
 *  its body, a sub-heading, and the sub-section body. */
const SECTION_CAPTURE = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2, uuid: "h-1", label: "sec:intro" }, content: [{ type: "text", text: "Introduction" }] },
    { type: "paragraph", attrs: { uuid: "p-1", parTitle: null }, content: [{ type: "text", text: "Body prose." }] },
    { type: "heading", attrs: { level: 3, uuid: "h-2" }, content: [{ type: "text", text: "A sub-section" }] },
    { type: "paragraph", attrs: { uuid: "p-2" }, content: [{ type: "text", text: "Sub-section prose." }] },
  ],
} as const;

/** One fixture per confirmed cluster member (task 308 "The cluster" table). */
const CLUSTER: { label: string; doc: Record<string, unknown>; expect: string[] }[] = [
  {
    label: "heading (a whole section)",
    doc: SECTION_CAPTURE as unknown as Record<string, unknown>,
    expect: ["heading", "paragraph"],
  },
  {
    label: "blockquote",
    doc: {
      type: "doc",
      content: [{ type: "blockquote", attrs: { uuid: "b-1" }, content: [{ type: "paragraph", content: [{ type: "text", text: "quoted" }] }] }],
    },
    expect: ["blockquote"],
  },
  {
    label: "codeBlock (verbatim)",
    doc: {
      type: "doc",
      content: [{ type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "x = 1" }] }],
    },
    expect: ["codeBlock"],
  },
  {
    label: "horizontalRule (divider)",
    doc: { type: "doc", content: [{ type: "horizontalRule" }] },
    expect: ["horizontalRule"],
  },
  {
    label: "selection spanning a heading",
    doc: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "tail of the previous section" }] },
        { type: "heading", attrs: { level: 2, uuid: "h-3" }, content: [{ type: "text", text: "Next" }] },
        { type: "paragraph", content: [{ type: "text", text: "head of the next" }] },
      ],
    },
    expect: ["heading", "paragraph"],
  },
  {
    label: "exampleBlock (expex)",
    doc: {
      type: "doc",
      content: [
        {
          type: "exampleBlock",
          attrs: { uuid: "e-1" },
          content: [
            {
              type: "exampleItemList",
              content: [{ type: "exampleItem", attrs: { uuid: "ei-1" }, content: [{ type: "paragraph", content: [{ type: "text", text: "an example" }] }] }],
            },
          ],
        },
      ],
    },
    expect: ["exampleBlock", "exampleItemList", "exampleItem"],
  },
  {
    label: "paragraph carrying a \\footnote marker",
    doc: {
      type: "doc",
      content: [{ type: "paragraph", attrs: { uuid: "p-3" }, content: [{ type: "text", text: "claim" }, { type: "footnote", attrs: { footnoteId: "f-1" } }] }],
    },
    expect: ["footnote"],
  },
  {
    label: "highlighted prose",
    doc: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "tinted", marks: [{ type: "highlight", attrs: { color: "yellow" } }] }] }],
    },
    expect: ["mark:highlight"],
  },
  {
    label: "colored prose",
    doc: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "red", marks: [{ type: "textColor", attrs: { color: "#ff0000" } }] }] }],
    },
    expect: ["mark:textColor"],
  },
];

describe("task 308 — excerpt body vocabulary", () => {
  // ── 1. Round-trip, per cluster member, on BOTH archive body surfaces ─────
  for (const surface of [
    { name: "expanded (RichTextField)", exts: excerptEditableExtensions, editable: true },
    { name: "compressed (BorrowedMainText)", exts: excerptReadOnlyExtensions, editable: false },
  ]) {
    for (const member of CLUSTER) {
      it(`${surface.name}: ${member.label} survives mount + round-trip`, () => {
        // TipTap's blanking is SILENT except for this warn — assert on it too,
        // so a future regression that swallows content can't pass by the round-
        // trip check alone landing on a coincidentally-similar shape.
        const warns: unknown[] = [];
        const origWarn = console.warn;
        console.warn = (...a: unknown[]) => { warns.push(a[0]); };
        const { editor, cleanup } = (() => {
          try {
            return mount(surface.exts(), member.doc as Content, surface.editable);
          } finally {
            console.warn = origWarn;
          }
        })();
        try {
          expect(warns, `TipTap rejected the capture: ${JSON.stringify(warns)}`).toEqual([]);
          const types = typesIn(editor.getJSON());
          for (const t of member.expect) {
            expect(types.has(t), `round-trip dropped ${t} (got: ${[...types].join(", ")})`).toBe(true);
          }
          // The blanking failure mode produces EXACTLY `{doc:[{paragraph}]}` —
          // a shape a naive "did it throw?" check waves straight through.
          // Assert against that shape directly rather than a size threshold: a
          // legitimate leaf-only capture (a bare `horizontalRule`) is SMALLER
          // than the blank fallback, so any size floor is both wrong and
          // backwards here.
          expect(editor.getJSON()).not.toEqual({
            type: "doc",
            content: [{ type: "paragraph" }],
          });
        } finally {
          cleanup();
        }
      });
    }
  }

  // Save→reload of the sidecar is a pure JSON round-trip; pin that the captured
  // shape survives it, since `archive.json` stores this verbatim.
  it("a section capture survives a JSON save→reload round-trip and still mounts", () => {
    const reloaded = JSON.parse(JSON.stringify(SECTION_CAPTURE));
    expect(canMountInCardBody(reloaded, "excerpt").ok).toBe(true);
    const { editor, cleanup } = mount(excerptEditableExtensions(), reloaded, true);
    try {
      expect(editor.getText()).toContain("Introduction");
      expect(editor.getText()).toContain("A sub-section");
      expect(editor.getText()).toContain("Sub-section prose.");
    } finally {
      cleanup();
    }
  });

  // ── The narrow scope is UNCHANGED — the widening must not leak ───────────
  it("the 'card' scope still refuses a heading (the footnote/note surface is untouched)", () => {
    const check = canMountInCardBody(SECTION_CAPTURE, "card");
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toMatch(/heading/);
  });

  it("the 'card' scope schema still omits every widened block type", () => {
    const schema = getSchema(cardEditableExtensions());
    for (const n of ["heading", "blockquote", "codeBlock", "horizontalRule", "exampleBlock"]) {
      expect(schema.nodes[n], `"card" scope unexpectedly gained ${n}`).toBeUndefined();
    }
    expect(schema.marks.highlight).toBeUndefined();
    expect(schema.marks.textColor).toBeUndefined();
  });
});

// ── 2. THE REVERSE CONTRACT (the teeth) ────────────────────────────────────

describe("task 308 — main-document vocabulary ⊆ excerpt vocabulary", () => {
  // Not every main node is a legal doc CHILD (glossCell only nests inside a
  // gloss row, figureCaption inside a figure), but a capture can carry any of
  // them at depth, so the requirement is schema PRESENCE, not doc-level
  // legality. Presence is exactly what `Schema.nodeFromJSON` demands.
  const mainSchema = getSchema(buildEditorExtensions(mainCtx()));
  const excerptSchema = getSchema(excerptReadOnlyExtensions());

  it("every MAIN editor node type is registered in the excerpt schema", () => {
    const missing = Object.keys(mainSchema.nodes).filter((n) => !excerptSchema.nodes[n]);
    expect(
      missing,
      "A main-editor node type the archive body cannot hold. Archiving content " +
        "containing it would blank the card (TipTap swallows the schema " +
        "mismatch into an EMPTY doc). Register it in `buildExcerptOnlySchema` " +
        "(borrowed-schema.ts) — or, if it genuinely must not appear in an " +
        "excerpt, confirm `canMountInCardBody` refuses it so the Archive action " +
        "aborts the delete instead of destroying the content.",
    ).toEqual([]);
  });

  it("every MAIN editor mark type is registered in the excerpt schema (or stripped by the normalizer)", () => {
    // `linkedAnchor` is the doc-level note/highlight/cut/revision anchor mark —
    // meaningless in a card body and unconditionally stripped by
    // `normalizeRichContent` (`DOC_ONLY_MARKS`), which every card body funnels
    // content through. It is the ONE sanctioned omission.
    //
    // Task 393: this exemption is only sound because the CAPTURE asks about the
    // stripped payload too. It did not — the archive dispatcher validated the
    // RAW slice — so every anchored passage was refused for a loss that could
    // not happen. `prepareCardBodyCapture` (card-body-capture.ts) is now the one
    // door: normalize, then validate THAT, then store THAT. If this omission
    // ever grows a second member, that door is what keeps it honest.
    const STRIPPED_BY_NORMALIZER = new Set(["linkedAnchor"]);
    const missing = Object.keys(mainSchema.marks).filter(
      (m) => !excerptSchema.marks[m] && !STRIPPED_BY_NORMALIZER.has(m),
    );
    expect(
      missing,
      "A main-editor mark type the archive body cannot hold — same blanking " +
        "class as a missing node type (an unknown MARK throws the same swallowed " +
        "RangeError). Register it in `buildExcerptOnlySchema`, or add it to " +
        "`DOC_ONLY_MARKS` in footnote-content.ts if it is doc-only.",
    ).toEqual([]);
  });
});

// ── 3. THE GUARD ───────────────────────────────────────────────────────────

describe("task 308 — canMountInCardBody (the never-destroy guard)", () => {
  it("accepts what the excerpt surface can mount", () => {
    for (const member of CLUSTER) {
      const check = canMountInCardBody(member.doc, "excerpt");
      expect(check.ok, `${member.label}: ${check.ok === false ? check.reason : ""}`).toBe(true);
    }
  });

  it("refuses an unknown node type and names it", () => {
    const check = canMountInCardBody(
      { type: "doc", content: [{ type: "someFutureBlock", attrs: {} }] },
      "excerpt",
    );
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toMatch(/someFutureBlock/);
  });

  it("refuses an unknown MARK — the same blanking class", () => {
    const check = canMountInCardBody(
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "someFutureMark" }] }] }] },
      "excerpt",
    );
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toMatch(/someFutureMark/);
  });

  it("refuses a bad type nested DEEP, not just at the top level", () => {
    // ProseMirror's `Fragment.fromJSON` recurses and TipTap's single try/catch
    // wraps the whole tree, so a type five levels down blanks the doc exactly as
    // a top-level one does. The guard must be equally deep or it would wave
    // through the very captures that destroy content.
    const check = canMountInCardBody(
      {
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [
              { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "nopeNode" }] }] }] },
            ],
          },
        ],
      },
      "excerpt",
    );
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toMatch(/nopeNode/);
  });

  it("treats null/undefined content as mountable (nothing to lose)", () => {
    expect(canMountInCardBody(null, "excerpt").ok).toBe(true);
    expect(canMountInCardBody(undefined, "excerpt").ok).toBe(true);
  });
});

// ── The registry SSOT ──────────────────────────────────────────────────────

describe("task 308 — bodySchema registry facet", () => {
  it("archive is the excerpt-scoped kind (the destructive-capture destination)", () => {
    expect(bodySchemaForCardKind("archive")).toBe("excerpt");
    expect(excerptCardKinds()).toContain("archive");
  });

  it("authored-prose kinds keep the narrow card scope", () => {
    // `footnote` and `example` are `bodyClass: "borrowed"` (serif typography)
    // but hold authored / kind-specific content, not an arbitrary document
    // slice — the two facets are deliberately orthogonal.
    for (const k of ["note", "footnote", "todo", "report", "example"] as const) {
      expect(bodySchemaForCardKind(k)).toBe("card");
    }
  });
});
