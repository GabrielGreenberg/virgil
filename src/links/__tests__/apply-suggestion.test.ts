// @vitest-environment jsdom
//
// Phase 0 — the headless AI-change applicator (src/links/apply-suggestion.ts).
//
// Builds the REAL main editor stack so the schema, uuid backfill, the LaTeX
// serializer, and `reanchorByText`'s uuid-scoped search all behave faithfully
// (the borrowed `structural-edit.test.ts` pattern). NO UI, NO host wiring.
//
// Pins the contract the later UI phases lean on:
//   1. apply (replace) preserves the paragraph's uuid,
//   2. the blue `pending-ai-change` mark lands on EXACTLY the inserted span,
//   3. a marker-straddling `originalText` → {ok:false, reason:"stale"}, untouched,
//   4. a non-verbatim `originalText` → {ok:false, reason:"stale"}, untouched,
//   5. the uuid survives a full serialize → re-parse round trip,
//   6. delete mode: apply marks but doesn't cut; keep cuts; revert un-marks,
//   7. keep (replace) leaves NO residual `\vlid` marker in the serialized .tex,
//   8. revert (replace) restores the byte-identical original inline LaTeX.

import { describe, it, expect, vi } from "vitest";

// Figure / graphics / tex-block React NodeViews transitively import
// `@/lib/storage`; stub it (the structural-edit + smoke-test pattern). Without
// this the test fails with "Cannot find module '@/lib/storage-fsa'".
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
import { serializeBodyOnly, serializeParagraphInline } from "@/lib/latex-serializer";
import { findNodeByUuid } from "@/lib/tiptap/structural-edit";
import {
  applyPendingChange,
  revertPendingChange,
  keepPendingChange,
} from "@/links/apply-suggestion";

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

// Virgil block uuids are 4 hex chars (generateShortId); the parser's
// `%!v:<uuid>` anchor regex only recognises that shape, so use real-shaped ids
// here — test 5 round-trips through the serializer + parser and needs the
// anchor to survive.
const PARA_UUID = "a1b2";
const CITE_PARA_UUID = "c3d4";
const CARD_ID = "card-abc";
const ANCHOR_ID = "anchor-xyz";

// A plain paragraph ("The quick brown fox jumps.") plus a paragraph carrying a
// citation atom (so its serialization contains `\vcid{…}\citet{…}` — the
// marker-straddle test target).
function makeContent(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: PARA_UUID },
        content: [{ type: "text", text: "The quick brown fox jumps." }],
      },
      {
        type: "paragraph",
        attrs: { uuid: CITE_PARA_UUID },
        content: [
          { type: "text", text: "See also " },
          {
            type: "citation",
            attrs: {
              citationId: "c1",
              command: "\\citet{foo}",
              displayText: "Foo 2020",
            },
          },
          { type: "text", text: " for details." },
        ],
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

// ── mark-reading helpers (borrowed from linked-anchor-kind-roundtrip.test.ts) ──

/** The `linkedAnchor` mark attrs at the given anchorId (or null). */
function markAttrsFor(
  editor: Editor,
  anchorId: string,
): Record<string, unknown> | null {
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

/** The live paragraph node carrying `uuid`. */
function paraNode(editor: Editor, uuid: string) {
  return findNodeByUuid(editor, uuid)?.node ?? null;
}

/** The inline-LaTeX serialization of the paragraph carrying `uuid`. */
function paraInline(editor: Editor, uuid: string): string {
  const n = paraNode(editor, uuid);
  return n ? serializeParagraphInline(n.toJSON()) : "";
}

// ── tests ──

describe("applyPendingChange — replace mode", () => {
  it("preserves the paragraph uuid (1)", () => {
    const { editor, cleanup } = mount();
    try {
      const res = applyPendingChange(editor, {
        anchorUuid: PARA_UUID,
        originalText: "quick brown fox",
        replacement: "lazy grey cat",
        mode: "replace",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
      });
      expect(res).toEqual({ ok: true, anchorId: ANCHOR_ID });
      // The block is still a paragraph with the SAME uuid.
      const after = findNodeByUuid(editor, PARA_UUID);
      expect(after).not.toBeNull();
      expect(after?.node.type.name).toBe("paragraph");
      expect(after?.node.attrs.uuid).toBe(PARA_UUID);
      expect(after?.node.textContent).toContain("lazy grey cat");
    } finally {
      cleanup();
    }
  });

  it("stamps the blue pending-ai-change mark on EXACTLY the inserted span (2)", () => {
    const { editor, cleanup } = mount();
    try {
      const res = applyPendingChange(editor, {
        anchorUuid: PARA_UUID,
        originalText: "quick brown fox",
        replacement: "lazy grey cat",
        mode: "replace",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
      });
      expect(res.ok).toBe(true);

      // The mark exists, with the pending kind + light-blue tint + card token.
      const attrs = markAttrsFor(editor, ANCHOR_ID);
      expect(attrs).not.toBeNull();
      expect(attrs?.kind).toBe("pending-ai-change");
      expect(attrs?.tintColor).toBe("#bfdbfe");
      // Folds onto the revision-suggestion spine kind in the linkCard token.
      expect(String(attrs?.linkCard)).toBe(`revision-suggestion:${CARD_ID}`);

      // The marked text is EXACTLY the replacement — no more, no less.
      expect(markedTextFor(editor, ANCHOR_ID)).toBe("lazy grey cat");
    } finally {
      cleanup();
    }
  });

  it("refuses a marker-straddling originalText → stale, doc untouched (3)", () => {
    const { editor, cleanup } = mount();
    try {
      // The cite paragraph serializes to `See also \vcid{c1}\citet{foo} for
      // details.` — the `\vcid{c1}` id marker sits INVISIBLY between "also " and
      // "\citet{foo}". A span that crosses the citation but omits the invisible
      // marker (what an AI working off the rendered text would draft — "also
      // \citet{foo}") is NOT a verbatim substring, so the stale guard refuses
      // it. This is the marker-straddle / clipped-marker refusal class.
      const before = paraInline(editor, CITE_PARA_UUID);
      expect(before).toContain("\\vcid{c1}\\citet{foo}");

      const res = applyPendingChange(editor, {
        anchorUuid: CITE_PARA_UUID,
        originalText: "also \\citet{foo} for", // missing the \vcid{c1} marker
        replacement: "also \\citet{bar} for",
        mode: "replace",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
      });
      expect(res).toEqual({ ok: false, reason: "stale" });
      // No mark, doc untouched.
      expect(markAttrsFor(editor, ANCHOR_ID)).toBeNull();
      expect(paraInline(editor, CITE_PARA_UUID)).toBe(before);
    } finally {
      cleanup();
    }
  });

  it("refuses an originalText clipped INTO a \\vcid id → stale (3b)", () => {
    const { editor, cleanup } = mount();
    try {
      // A span clipped mid-id ("\vcid{c1}\citet{fo" — cut inside the cite cmd,
      // or "\vcid{c" with a non-matching tail) that isn't a verbatim substring
      // is likewise refused. Here we clip into a NON-PRESENT id ("\vcid{c9}").
      const before = paraInline(editor, CITE_PARA_UUID);
      const res = applyPendingChange(editor, {
        anchorUuid: CITE_PARA_UUID,
        originalText: "also \\vcid{c9}\\citet{foo}", // wrong id — not verbatim
        replacement: "x",
        mode: "replace",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
      });
      expect(res).toEqual({ ok: false, reason: "stale" });
      expect(markAttrsFor(editor, ANCHOR_ID)).toBeNull();
      expect(paraInline(editor, CITE_PARA_UUID)).toBe(before);
    } finally {
      cleanup();
    }
  });

  it("refuses a non-verbatim originalText → stale, doc untouched (4)", () => {
    const { editor, cleanup } = mount();
    try {
      const before = paraInline(editor, PARA_UUID);
      const res = applyPendingChange(editor, {
        anchorUuid: PARA_UUID,
        originalText: "slow purple turtle", // not present
        replacement: "anything",
        mode: "replace",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
      });
      expect(res).toEqual({ ok: false, reason: "stale" });
      expect(markAttrsFor(editor, ANCHOR_ID)).toBeNull();
      expect(paraInline(editor, PARA_UUID)).toBe(before);
    } finally {
      cleanup();
    }
  });

  it("keeps the uuid findable after a full serialize → re-parse cycle (5)", async () => {
    const { editor, cleanup } = mount();
    try {
      applyPendingChange(editor, {
        anchorUuid: PARA_UUID,
        originalText: "quick brown fox",
        replacement: "lazy grey cat",
        mode: "replace",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
      });
      // Serialize the whole doc body and confirm the uuid anchor survives.
      const tex = serializeBodyOnly(editor.state.doc.toJSON());
      expect(tex).toContain(`%!v:${PARA_UUID}`);
      // And re-parse keeps the paragraph findable by the same uuid.
      const { parseLatex } = await import("@/lib/latex-parser");
      const reparsed = parseLatex(tex);
      type JNode = { attrs?: { uuid?: string }; content?: JNode[] };
      const findUuid = (n: JNode): boolean => {
        if (n.attrs?.uuid === PARA_UUID) return true;
        return n.content?.some(findUuid) ?? false;
      };
      expect(findUuid(reparsed as JNode)).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("applyPendingChange — delete mode", () => {
  it("apply marks the original span WITHOUT cutting; keep removes it; revert un-marks (6)", () => {
    // apply (delete): text intact, mark on the original span.
    {
      const { editor, cleanup } = mount();
      try {
        const beforeText = paraNode(editor, PARA_UUID)?.textContent;
        const res = applyPendingChange(editor, {
          anchorUuid: PARA_UUID,
          originalText: "quick brown fox ",
          replacement: "",
          mode: "delete",
          cardId: CARD_ID,
          anchorId: ANCHOR_ID,
        });
        expect(res).toEqual({ ok: true, anchorId: ANCHOR_ID });
        // The document TEXT is UNCHANGED — delete mode mutates no text on apply;
        // it only stamps the blue mark over the original span (the serialization
        // grows `\vlid…\vlidend` markers, but the rendered text is identical).
        expect(paraNode(editor, PARA_UUID)?.textContent).toBe(beforeText);
        expect(beforeText).toBe("The quick brown fox jumps.");
        const attrs = markAttrsFor(editor, ANCHOR_ID);
        expect(attrs?.kind).toBe("pending-ai-change");
        expect(attrs?.tintColor).toBe("#bfdbfe");
        expect(markedTextFor(editor, ANCHOR_ID)).toBe("quick brown fox ");
      } finally {
        cleanup();
      }
    }

    // keep (delete): removes exactly the original span, leaves a valid
    // paragraph that round-trips with its %!v:uuid.
    {
      const { editor, cleanup } = mount();
      try {
        applyPendingChange(editor, {
          anchorUuid: PARA_UUID,
          originalText: "quick brown fox ",
          replacement: "",
          mode: "delete",
          cardId: CARD_ID,
          anchorId: ANCHOR_ID,
        });
        keepPendingChange(editor, {
          anchorUuid: PARA_UUID,
          mode: "delete",
          anchorId: ANCHOR_ID,
          originalText: "quick brown fox ",
          replacement: "",
        });
        // The span is gone, the paragraph is valid, the mark is gone.
        expect(paraInline(editor, PARA_UUID)).toBe("The jumps.");
        expect(markAttrsFor(editor, ANCHOR_ID)).toBeNull();
        const tex = serializeBodyOnly(editor.state.doc.toJSON());
        expect(tex).toContain(`The jumps. %!v:${PARA_UUID}`);
      } finally {
        cleanup();
      }
    }

    // revert (delete): removes the mark, text intact.
    {
      const { editor, cleanup } = mount();
      try {
        const before = paraInline(editor, PARA_UUID);
        applyPendingChange(editor, {
          anchorUuid: PARA_UUID,
          originalText: "quick brown fox ",
          replacement: "",
          mode: "delete",
          cardId: CARD_ID,
          anchorId: ANCHOR_ID,
        });
        revertPendingChange(editor, {
          anchorUuid: PARA_UUID,
          originalText: "quick brown fox ",
          replacement: "",
          mode: "delete",
          anchorId: ANCHOR_ID,
        });
        expect(markAttrsFor(editor, ANCHOR_ID)).toBeNull();
        expect(paraInline(editor, PARA_UUID)).toBe(before);
      } finally {
        cleanup();
      }
    }
  });
});

describe("keepPendingChange — replace mode leaves no residual marker (7)", () => {
  it("after Keep, the serialized .tex carries no \\vlid for the anchor", () => {
    const { editor, cleanup } = mount();
    try {
      applyPendingChange(editor, {
        anchorUuid: PARA_UUID,
        originalText: "quick brown fox",
        replacement: "lazy grey cat",
        mode: "replace",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
      });
      // While pending, the mark is present in the doc.
      expect(markAttrsFor(editor, ANCHOR_ID)).not.toBeNull();

      keepPendingChange(editor, {
        anchorUuid: PARA_UUID,
        mode: "replace",
        anchorId: ANCHOR_ID,
        originalText: "quick brown fox",
        replacement: "lazy grey cat",
      });

      // The mark is gone from the doc …
      expect(markAttrsFor(editor, ANCHOR_ID)).toBeNull();
      // … and from the serialized .tex (no \vlid / \vlidend residue), while the
      // replacement text + the uuid anchor remain — a clean accept.
      const tex = serializeBodyOnly(editor.state.doc.toJSON());
      expect(tex).not.toContain("\\vlid");
      expect(tex).not.toContain(ANCHOR_ID);
      expect(tex).toContain("lazy grey cat");
      expect(tex).toContain(`%!v:${PARA_UUID}`);
    } finally {
      cleanup();
    }
  });
});

describe("revertPendingChange — replace mode restores byte-identical original (8)", () => {
  it("apply then revert returns the paragraph's inline LaTeX to the original", () => {
    const { editor, cleanup } = mount();
    try {
      const original = paraInline(editor, PARA_UUID);

      applyPendingChange(editor, {
        anchorUuid: PARA_UUID,
        originalText: "quick brown fox",
        replacement: "lazy grey cat",
        mode: "replace",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
      });
      // Sanity: the text actually changed.
      expect(paraInline(editor, PARA_UUID)).not.toBe(original);

      revertPendingChange(editor, {
        anchorUuid: PARA_UUID,
        originalText: "quick brown fox",
        replacement: "lazy grey cat",
        mode: "replace",
        anchorId: ANCHOR_ID,
      });

      // Byte-identical to the original inline serialization, mark gone.
      expect(paraInline(editor, PARA_UUID)).toBe(original);
      expect(markAttrsFor(editor, ANCHOR_ID)).toBeNull();
    } finally {
      cleanup();
    }
  });
});

// ── overlapping-anchor survival (the data-loss fix, 9) ──
//
// A revision is rarely the ONLY linked-range anchor in a paragraph: a highlight,
// note, or another cut frequently coexists in the same paragraph. When the
// paragraph is serialized for the splice, those other anchors emit their own
// `\vlid{id}…\vlidend{id}` markers; a bare inline reparse surfaces them as
// `_linkedAnchorBoundary` sentinels. The applicator must RESOLVE those sentinels
// back into real `linkedAnchor` marks (preserving their live tint / card / kind),
// not drop them — dropping is silent destruction of the other anchor.

// A pre-existing highlight anchor (Adobe-style yellow tint) sitting over "brown"
// in the fox paragraph, built directly into the doc JSON.
const HL_ANCHOR_ID = "hl-anchor";
const HL_CARD_ID = "hl-card";
const HL_TINT = "#fbbf24"; // defaultTintForLinkedAnchorKind("highlight")

function highlightMark() {
  return {
    type: "linkedAnchor",
    attrs: {
      anchorId: HL_ANCHOR_ID,
      kind: "highlight",
      linkId: HL_ANCHOR_ID,
      linkKind: "anchor",
      linkCard: `highlight:${HL_CARD_ID}`,
      tintColor: HL_TINT,
    },
  };
}

/** A paragraph "The quick brown fox jumps." with a highlight `linkedAnchor`
 *  mark already over the word "brown". The revision tests then target a
 *  DIFFERENT span ("jumps") so the highlight must survive the round-trip. */
function makeHighlightedContent(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: PARA_UUID },
        content: [
          { type: "text", text: "The quick " },
          { type: "text", text: "brown", marks: [highlightMark()] },
          { type: "text", text: " fox jumps." },
        ],
      },
    ],
  };
}

function mountHighlighted(): { editor: Editor; cleanup: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: makeHighlightedContent(),
  });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

describe("applyPendingChange — preserves a coexisting linked anchor (9)", () => {
  it("a replace on a DIFFERENT span keeps the pre-existing highlight's anchor + tint + card", () => {
    const { editor, cleanup } = mountHighlighted();
    try {
      // Sanity: the highlight is live over exactly "brown" before we touch anything.
      expect(markedTextFor(editor, HL_ANCHOR_ID)).toBe("brown");
      const beforeHl = markAttrsFor(editor, HL_ANCHOR_ID);
      expect(beforeHl?.tintColor).toBe(HL_TINT);

      // Replace a span that does NOT overlap the highlight.
      const res = applyPendingChange(editor, {
        anchorUuid: PARA_UUID,
        originalText: "jumps",
        replacement: "leaps",
        mode: "replace",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
      });
      expect(res).toEqual({ ok: true, anchorId: ANCHOR_ID });

      // The new blue pending mark landed on EXACTLY the replacement.
      expect(markedTextFor(editor, ANCHOR_ID)).toBe("leaps");
      const pending = markAttrsFor(editor, ANCHOR_ID);
      expect(pending?.kind).toBe("pending-ai-change");
      expect(pending?.tintColor).toBe("#bfdbfe");

      // … AND the pre-existing highlight SURVIVED — same range, same rich attrs.
      // (Before the fix the applicator dropped the `_linkedAnchorBoundary`
      //  sentinel, destroying this anchor: silent data loss.)
      expect(markedTextFor(editor, HL_ANCHOR_ID)).toBe("brown");
      const afterHl = markAttrsFor(editor, HL_ANCHOR_ID);
      expect(afterHl).not.toBeNull();
      expect(afterHl?.anchorId).toBe(HL_ANCHOR_ID);
      expect(afterHl?.kind).toBe("highlight");
      expect(afterHl?.tintColor).toBe(HL_TINT);
      expect(afterHl?.linkCard).toBe(`highlight:${HL_CARD_ID}`);

      // The block uuid is intact and the new text actually landed.
      const para = paraNode(editor, PARA_UUID);
      expect(para?.attrs.uuid).toBe(PARA_UUID);
      expect(para?.textContent).toBe("The quick brown fox leaps.");
    } finally {
      cleanup();
    }
  });

  it("serialize → full re-parse keeps BOTH the surviving highlight and the new pending anchor resolvable", async () => {
    const { editor, cleanup } = mountHighlighted();
    try {
      applyPendingChange(editor, {
        anchorUuid: PARA_UUID,
        originalText: "jumps",
        replacement: "leaps",
        mode: "replace",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
      });

      // Serialize the whole doc: both anchors must emit their paired markers.
      const tex = serializeBodyOnly(editor.state.doc.toJSON());
      expect(tex).toContain(`\\vlid{${HL_ANCHOR_ID}}`);
      expect(tex).toContain(`\\vlidend{${HL_ANCHOR_ID}}`);
      expect(tex).toContain(`\\vlid{${ANCHOR_ID}}`);
      expect(tex).toContain(`\\vlidend{${ANCHOR_ID}}`);
      // The highlight wraps "brown", the pending wraps "leaps".
      expect(tex).toContain(`\\vlid{${HL_ANCHOR_ID}}brown\\vlidend{${HL_ANCHOR_ID}}`);
      expect(tex).toContain(`\\vlid{${ANCHOR_ID}}leaps\\vlidend{${ANCHOR_ID}}`);

      // Full re-parse resolves BOTH ranges back to `linkedAnchor` marks.
      const { parseLatex } = await import("@/lib/latex-parser");
      const reparsed = parseLatex(tex);
      type JMark = { type: string; attrs?: { anchorId?: string } };
      type JNode = { type?: string; text?: string; marks?: JMark[]; content?: JNode[] };
      const textForAnchor = (root: JNode, anchorId: string): string => {
        let out = "";
        const walk = (n: JNode) => {
          if (
            n.type === "text" &&
            n.marks?.some((m) => m.type === "linkedAnchor" && m.attrs?.anchorId === anchorId)
          ) {
            out += n.text ?? "";
          }
          n.content?.forEach(walk);
        };
        walk(root);
        return out;
      };
      expect(textForAnchor(reparsed as JNode, HL_ANCHOR_ID)).toBe("brown");
      expect(textForAnchor(reparsed as JNode, ANCHOR_ID)).toBe("leaps");
    } finally {
      cleanup();
    }
  });
});
