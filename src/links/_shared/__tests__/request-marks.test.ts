// @vitest-environment jsdom
//
// Open-AI-request text highlight (task 2026-07-03-021) — the request-open twin
// of the applied `pending-ai-change` mark (src/links/_shared/request-marks.ts).
//
// Builds the REAL main editor stack (the apply-suggestion.test.ts pattern) so
// the schema, uuid backfill, the LaTeX serializer, and `reanchorByText`'s
// uuid-scoped search all behave faithfully. Pins the three contracts the feature
// leans on:
//   (a) toggling `aiRequest` ON stamps a blue `pending-ai-request` mark over the
//       card's WHOLE anchored paragraph; toggling OFF (or deleting the card)
//       strips it,
//   (b) `reconcileRequestMarks` re-stamps from the `aiRequest===true` card after
//       a serialize → reparse round-trip strips the mark (reload persistence),
//   (c) `requestHighlightLink` synthesizes a Mode-B link at the request mark's
//       anchorId for a Mode-A request card (so the reconciler lights it on
//       hover/select), and returns null for a Mode-B or non-request card.

import { describe, it, expect, vi } from "vitest";

// Figure / graphics / tex-block React NodeViews transitively import
// `@/lib/storage`; stub it (the structural-edit + apply-suggestion pattern).
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

import { Editor, type Content } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { parseLatex } from "@/lib/latex-parser";
import type { Link } from "@/links/links";
import {
  reconcileRequestMarks,
  requestHighlightLink,
  requestAnchorId,
  isModeARequestCard,
  type RequestMarkCardLike,
} from "@/links/_shared/request-marks";

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

const PARA_UUID = "a1b2";
const OTHER_UUID = "c3d4";
const CARD_ID = "note-abc";
const PARA_TEXT = "The quick brown fox jumps.";

function makeContent(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: PARA_UUID },
        content: [{ type: "text", text: PARA_TEXT }],
      },
      {
        type: "paragraph",
        attrs: { uuid: OTHER_UUID },
        content: [{ type: "text", text: "A second, unrelated paragraph." }],
      },
    ],
  };
}

function mount(): { editor: Editor; cleanup: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: makeContent(),
  });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

/** A Mode-A anchor link (paragraph target, NO textRange). */
function modeALink(uuid: string): Link {
  return {
    id: `link-${uuid}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: [uuid],
      margin: { side: "right" },
    },
    target: { type: "card", ref: { kind: "note", id: CARD_ID } },
    createdAt: "",
  };
}

/** A Mode-B anchor link (linkedRange target, has textRange). */
function modeBLink(uuid: string): Link {
  return {
    id: `link-b-${uuid}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [uuid],
      margin: { side: "right" },
      textRange: { anchorId: "range-1", textSnapshot: "quick brown" },
    },
    target: { type: "card", ref: { kind: "note", id: CARD_ID } },
    createdAt: "",
  };
}

function note(over: Partial<RequestMarkCardLike>): RequestMarkCardLike {
  return { id: CARD_ID, kind: "note", aiRequest: true, links: [modeALink(PARA_UUID)], ...over };
}

/** The `linkedAnchor` mark attrs at the given anchorId (or null). */
function markAttrsFor(editor: Editor, anchorId: string): Record<string, unknown> | null {
  let attrs: Record<string, unknown> | null = null;
  editor.state.doc.descendants((node) => {
    if (attrs) return false;
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId) {
        attrs = m.attrs as Record<string, unknown>;
        return false;
      }
    }
    return true;
  });
  return attrs;
}

/** The exact text spanned by the linkedAnchor mark with the given anchorId. */
function markedTextFor(editor: Editor, anchorId: string): string {
  let out = "";
  editor.state.doc.descendants((node) => {
    if (
      node.isText &&
      node.marks.some(
        (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
      )
    ) {
      out += node.text ?? "";
    }
    return true;
  });
  return out;
}

describe("reconcileRequestMarks — persistence (A)", () => {
  it("stamps a blue pending-ai-request mark over the WHOLE anchored paragraph", () => {
    const { editor, cleanup } = mount();
    try {
      reconcileRequestMarks(editor, [note({})]);
      const id = requestAnchorId(CARD_ID);
      const attrs = markAttrsFor(editor, id);
      expect(attrs).not.toBeNull();
      expect(attrs?.kind).toBe("pending-ai-request");
      expect(attrs?.tintColor).toBe("#bfdbfe");
      // Whole paragraph washed (no sub-range).
      expect(markedTextFor(editor, id)).toBe(PARA_TEXT);
    } finally {
      cleanup();
    }
  });

  it("strips the mark when aiRequest toggles OFF", () => {
    const { editor, cleanup } = mount();
    try {
      reconcileRequestMarks(editor, [note({})]);
      expect(markAttrsFor(editor, requestAnchorId(CARD_ID))).not.toBeNull();
      // Flag off → the card is still present but no longer wants a mark.
      reconcileRequestMarks(editor, [note({ aiRequest: false })]);
      expect(markAttrsFor(editor, requestAnchorId(CARD_ID))).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("strips the mark when the card is deleted (gone from the set)", () => {
    const { editor, cleanup } = mount();
    try {
      reconcileRequestMarks(editor, [note({})]);
      expect(markAttrsFor(editor, requestAnchorId(CARD_ID))).not.toBeNull();
      reconcileRequestMarks(editor, []); // card removed
      expect(markAttrsFor(editor, requestAnchorId(CARD_ID))).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("is idempotent — a second identical reconcile leaves exactly one mark", () => {
    const { editor, cleanup } = mount();
    try {
      reconcileRequestMarks(editor, [note({})]);
      reconcileRequestMarks(editor, [note({})]);
      const id = requestAnchorId(CARD_ID);
      expect(markAttrsFor(editor, id)).not.toBeNull();
      expect(markedTextFor(editor, id)).toBe(PARA_TEXT);
    } finally {
      cleanup();
    }
  });

  it("moves the mark when the card is re-anchored to another paragraph", () => {
    const { editor, cleanup } = mount();
    try {
      reconcileRequestMarks(editor, [note({})]);
      expect(markedTextFor(editor, requestAnchorId(CARD_ID))).toBe(PARA_TEXT);
      // Re-anchor to the second paragraph.
      reconcileRequestMarks(editor, [note({ links: [modeALink(OTHER_UUID)] })]);
      expect(markedTextFor(editor, requestAnchorId(CARD_ID))).toBe(
        "A second, unrelated paragraph.",
      );
    } finally {
      cleanup();
    }
  });

  it("re-stamps from the aiRequest card after a serialize → reparse round-trip (reload)", () => {
    const { editor, cleanup } = mount();
    try {
      reconcileRequestMarks(editor, [note({})]);
      expect(markAttrsFor(editor, requestAnchorId(CARD_ID))).not.toBeNull();

      // Serialize the doc body and re-parse. Like every Virgil linkedAnchor, the
      // request mark round-trips its anchorId as a bare `\vlid` marker but LOSES
      // its rich attrs (the `#bfdbfe` tint + the `pending-ai-request` kind revert
      // to the parser's placeholder) — so the blue wash is gone (the reload gap).
      const tex = serializeBodyOnly(editor.state.doc.toJSON());
      expect(tex).toContain(`%!v:${PARA_UUID}`);
      const reparsed = parseLatex(tex);
      editor.commands.setContent(reparsed as Content);
      const afterReload = markAttrsFor(editor, requestAnchorId(CARD_ID));
      expect(afterReload?.kind).not.toBe("pending-ai-request");
      expect(afterReload?.tintColor).not.toBe("#bfdbfe");

      // The load-time reconcile (driven by the same aiRequest card) re-tints it —
      // restoring the blue `pending-ai-request` wash over the whole paragraph.
      reconcileRequestMarks(editor, [note({})]);
      const attrs = markAttrsFor(editor, requestAnchorId(CARD_ID));
      expect(attrs).not.toBeNull();
      expect(attrs?.kind).toBe("pending-ai-request");
      expect(attrs?.tintColor).toBe("#bfdbfe");
      expect(markedTextFor(editor, requestAnchorId(CARD_ID))).toBe(PARA_TEXT);
    } finally {
      cleanup();
    }
  });
});

describe("requestHighlightLink — marker association (B)", () => {
  const ref = { kind: "note" as const, id: CARD_ID };

  it("synthesizes a Mode-B link at the request mark's anchorId for a Mode-A request card", () => {
    const link = requestHighlightLink(ref, note({}));
    expect(link).not.toBeNull();
    expect(link?.anchor.type).toBe("textObject");
    if (link?.anchor.type === "textObject") {
      expect(link.anchor.targetKind).toBe("linkedRange");
      expect(link.anchor.textRange?.anchorId).toBe(requestAnchorId(CARD_ID));
    }
    expect(link?.target.ref.id).toBe(CARD_ID);
  });

  it("returns null for a card without the aiRequest flag", () => {
    expect(requestHighlightLink(ref, note({ aiRequest: false }))).toBeNull();
  });

  it("returns null for a Mode-B card (its own span mark already lights)", () => {
    expect(
      requestHighlightLink(ref, note({ links: [modeBLink(PARA_UUID)] })),
    ).toBeNull();
  });
});

describe("isModeARequestCard — classification", () => {
  it("true only for an aiRequest, Mode-A, anchored card", () => {
    expect(isModeARequestCard(note({}))).toBe(true);
    expect(isModeARequestCard(note({ aiRequest: false }))).toBe(false);
    expect(isModeARequestCard(note({ links: [modeBLink(PARA_UUID)] }))).toBe(false);
    expect(isModeARequestCard(note({ links: [] }))).toBe(false);
  });
});
