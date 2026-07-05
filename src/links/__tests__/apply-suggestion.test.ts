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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  insertParagraphAfter,
} from "@/links/apply-suggestion";
import {
  reapplyPendingMarks,
  pendingMarkAnchorIds,
  type PendingMarkCardLike,
} from "@/links/_shared/reapply-pending-marks";
import { setPendingChangesFlag } from "@/lib/pending-changes-flag";
import { parseLatex } from "@/lib/latex-parser";

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
        family: "revision-suggestion",
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
        family: "revision-suggestion",
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
        family: "revision-suggestion",
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
        family: "revision-suggestion",
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
        family: "revision-suggestion",
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
        family: "revision-suggestion",
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
          family: "revision-suggestion",
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
          family: "revision-suggestion",
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
          family: "revision-suggestion",
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
        family: "revision-suggestion",
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
        family: "revision-suggestion",
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

  // SESSION 4 — the non-committing preview toggle drives these same inverse
  // splices back and forth. Toggling repeatedly must be LOSSLESS: after any
  // number of original⇄suggested flips, the "original" view byte-matches the
  // pre-apply serialization and the "suggested" view re-stamps the blue mark
  // with the SAME anchorId (so the card / pill can still resolve the range).
  it("preview toggle round-trips (original ⇄ suggested) are lossless (SESSION 4)", () => {
    const { editor, cleanup } = mount();
    try {
      const original = paraInline(editor, PARA_UUID);
      const apply = () =>
        applyPendingChange(editor, {
          anchorUuid: PARA_UUID,
          originalText: "quick brown fox",
          replacement: "lazy grey cat",
          mode: "replace",
          cardId: CARD_ID,
          anchorId: ANCHOR_ID,
          family: "revision-suggestion",
        });
      const revert = () =>
        revertPendingChange(editor, {
          anchorUuid: PARA_UUID,
          originalText: "quick brown fox",
          replacement: "lazy grey cat",
          mode: "replace",
          anchorId: ANCHOR_ID,
        });

      apply(); // auto-applied: suggested + mark
      const suggested = paraInline(editor, PARA_UUID);
      expect(suggested).not.toBe(original);
      expect(markAttrsFor(editor, ANCHOR_ID)).not.toBeNull();

      // Flip original ⇄ suggested three times; every landing byte-matches.
      for (let i = 0; i < 3; i++) {
        revert(); // → original view
        expect(paraInline(editor, PARA_UUID)).toBe(original);
        expect(markAttrsFor(editor, ANCHOR_ID)).toBeNull();

        apply(); // → suggested view
        expect(paraInline(editor, PARA_UUID)).toBe(suggested);
        // Re-stamped with the SAME anchorId, so the pill/card still resolve it.
        expect(markAttrsFor(editor, ANCHOR_ID)).not.toBeNull();
      }
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
        family: "revision-suggestion",
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
        family: "revision-suggestion",
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

// ── family-correct linkCard token (Phase 4, Part A) ────────────────────────
//
// Both suggestion families share the single `pending-ai-change` kind (which
// drives tint/behaviour only), so the `linkCard` token (card IDENTITY) cannot be
// derived from the kind — it must be threaded from the host/hook that owns the
// card. The bug: a CUTTER applied change stamped `revision-suggestion:<id>`,
// breaking the three-surface hover halo (the gutter marker + card use
// `cutter-suggestion:<id>`). The fix threads an explicit `family`, so:
//   - a cutter applied change's mark tokens `cutter-suggestion:<id>`,
//   - a revision applied change's mark tokens `revision-suggestion:<id>`.

describe("applyPendingChange — family-correct linkCard token (Part A)", () => {
  it("a CUTTER applied change tokens cutter-suggestion:<id>", () => {
    const { editor, cleanup } = mount();
    try {
      const res = applyPendingChange(editor, {
        anchorUuid: PARA_UUID,
        originalText: "quick brown fox",
        replacement: "lazy grey cat",
        mode: "replace",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
        family: "cutter-suggestion",
      });
      expect(res.ok).toBe(true);
      const attrs = markAttrsFor(editor, ANCHOR_ID);
      // The kind still folds onto the shared pending kind …
      expect(attrs?.kind).toBe("pending-ai-change");
      // … but the IDENTITY token now carries the CUTTER family.
      expect(String(attrs?.linkCard)).toBe(`cutter-suggestion:${CARD_ID}`);
    } finally {
      cleanup();
    }
  });

  it("a REVISION applied change tokens revision-suggestion:<id>", () => {
    const { editor, cleanup } = mount();
    try {
      const res = applyPendingChange(editor, {
        anchorUuid: PARA_UUID,
        originalText: "quick brown fox",
        replacement: "lazy grey cat",
        mode: "replace",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
        family: "revision-suggestion",
      });
      expect(res.ok).toBe(true);
      const attrs = markAttrsFor(editor, ANCHOR_ID);
      expect(String(attrs?.linkCard)).toBe(`revision-suggestion:${CARD_ID}`);
    } finally {
      cleanup();
    }
  });
});

// ── delete-mode strikethrough signal (Phase 4, Part B) ─────────────────────
//
// A pure cutter deletion (empty suggested_text → mode "delete") stamps the blue
// mark over the ORIGINAL text. Per the design it must render struck-through in
// blue (a preview of what Keep removes), distinct from a replacement's plain
// blue highlight. The mark carries a `pendingDelete` attr → `data-pending-delete`
// in the DOM that CSS targets. A replacement carries no such signal.

describe("applyPendingChange — delete-mode strikethrough signal (Part B)", () => {
  it("a delete-mode pending mark carries pendingDelete:true", () => {
    const { editor, cleanup } = mount();
    try {
      const res = applyPendingChange(editor, {
        anchorUuid: PARA_UUID,
        originalText: "quick brown fox ",
        replacement: "",
        mode: "delete",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
        family: "cutter-suggestion",
      });
      expect(res.ok).toBe(true);
      const attrs = markAttrsFor(editor, ANCHOR_ID);
      expect(attrs?.pendingDelete).toBe(true);
      // The struck text is still in the doc (delete-mode marks but does not cut).
      expect(markedTextFor(editor, ANCHOR_ID)).toBe("quick brown fox ");
    } finally {
      cleanup();
    }
  });

  it("a replace-mode pending mark carries NO pendingDelete signal", () => {
    const { editor, cleanup } = mount();
    try {
      const res = applyPendingChange(editor, {
        anchorUuid: PARA_UUID,
        originalText: "quick brown fox",
        replacement: "lazy grey cat",
        mode: "replace",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
        family: "revision-suggestion",
      });
      expect(res.ok).toBe(true);
      const attrs = markAttrsFor(editor, ANCHOR_ID);
      // null (not true) — a replacement renders as the plain blue highlight.
      expect(attrs?.pendingDelete).toBeNull();
    } finally {
      cleanup();
    }
  });
});

// ── reload re-stamp (the persistence fix, 10) ──────────────────────────────
//
// `linkedAnchor` marks are app-state: the serializer strips kind/tint/linkCard
// on `.tex` export, the parser resurrects each `\vlid` pair as a placeholder
// `kind:"note"` mark, and the load reconcile re-applies the authoritative attrs
// from the sidecar. For an APPLIED-but-not-yet-kept suggestion the blue
// `pending-ai-change` mark is described by the card's `appliedChange`
// descriptor, not a text-range link, so the Mode-B reconcile doesn't know about
// it. `reapplyPendingMarks` is the load-only pass that re-stamps it. Here we
// simulate a reload (serialize → re-parse → mount fresh editor, which DROPS the
// blue mark) and assert the re-stamp restores `#bfdbfe` over the right region.

/** Mount a fresh editor from arbitrary content (the "after reload" editor). */
function mountContent(content: Content): { editor: Editor; cleanup: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content,
  });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

/** Simulate a reload of `editor`'s doc: serialize body to `.tex`, re-parse to
 *  JSON, and mount a fresh editor on the result. The blue mark is gone (the
 *  serializer dropped its kind/tint; the parser resurrects a `note` placeholder),
 *  exactly as on a real reopen. */
function reload(editor: Editor): { editor: Editor; cleanup: () => void } {
  const tex = serializeBodyOnly(editor.state.doc.toJSON());
  const reparsed = parseLatex(tex) as Content;
  return mountContent(reparsed);
}

describe("reapplyPendingMarks — reload re-stamp (10)", () => {
  beforeEach(() => setPendingChangesFlag(true));
  afterEach(() => setPendingChangesFlag(undefined));

  it("re-stamps the blue mark on the replacement region after a reload (replace)", () => {
    const src = mount();
    let reloaded: { editor: Editor; cleanup: () => void } | null = null;
    try {
      const res = applyPendingChange(src.editor, {
        anchorUuid: PARA_UUID,
        originalText: "quick brown fox",
        replacement: "lazy grey cat",
        mode: "replace",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
        family: "revision-suggestion",
      });
      expect(res.ok).toBe(true);

      // Reload: the blue mark is NOT the pending mark anymore — the serializer
      // stripped kind/tint, so the round-tripped mark is a placeholder.
      reloaded = reload(src.editor);
      const afterReload = markAttrsFor(reloaded.editor, ANCHOR_ID);
      // The anchorId's range survived (the `\vlid` pair round-trips) …
      expect(afterReload).not.toBeNull();
      // … but it is NOT the blue pending mark (kind/tint were dropped on export).
      expect(afterReload?.kind).not.toBe("pending-ai-change");
      expect(afterReload?.tintColor).not.toBe("#bfdbfe");

      // The load re-stamp: the card carrying the appliedChange descriptor.
      const card: PendingMarkCardLike = {
        id: CARD_ID,
        kind: "suggestion",
        status: "applied",
        appliedChange: {
          anchorId: ANCHOR_ID,
          anchorUuid: PARA_UUID,
          originalText: "quick brown fox",
          replacement: "lazy grey cat",
          mode: "replace",
        },
      };
      const n = reapplyPendingMarks(reloaded.editor, [
        { family: "revision-suggestion", cards: [card] },
      ]);
      expect(n).toBe(1);

      // The blue pending mark is back, over EXACTLY the replacement region.
      const restamped = markAttrsFor(reloaded.editor, ANCHOR_ID);
      expect(restamped?.kind).toBe("pending-ai-change");
      expect(restamped?.tintColor).toBe("#bfdbfe");
      expect(String(restamped?.linkCard)).toBe(`revision-suggestion:${CARD_ID}`);
      expect(markedTextFor(reloaded.editor, ANCHOR_ID)).toBe("lazy grey cat");
    } finally {
      reloaded?.cleanup();
      src.cleanup();
    }
  });

  it("re-stamps the blue mark on the original region after a reload (delete, cutter family)", () => {
    const src = mount();
    let reloaded: { editor: Editor; cleanup: () => void } | null = null;
    try {
      // Apply as a CUTTER delete so the reload re-stamp must reconstruct BOTH the
      // cutter family token (Part A) and the pending-delete strikethrough signal
      // (Part B) from the card's `appliedChange`.
      const res = applyPendingChange(src.editor, {
        anchorUuid: PARA_UUID,
        originalText: "quick brown fox ",
        replacement: "",
        mode: "delete",
        cardId: CARD_ID,
        anchorId: ANCHOR_ID,
        family: "cutter-suggestion",
      });
      expect(res.ok).toBe(true);

      reloaded = reload(src.editor);
      // Delete mode left the text in the doc, so "quick brown fox " is present
      // and the blue mark must wrap it after re-stamp.
      const card: PendingMarkCardLike = {
        id: CARD_ID,
        kind: "suggestion",
        status: "applied",
        appliedChange: {
          anchorId: ANCHOR_ID,
          anchorUuid: PARA_UUID,
          originalText: "quick brown fox ",
          replacement: "",
          mode: "delete",
        },
      };
      const n = reapplyPendingMarks(reloaded.editor, [
        { family: "cutter-suggestion", cards: [card] },
      ]);
      expect(n).toBe(1);

      const restamped = markAttrsFor(reloaded.editor, ANCHOR_ID);
      expect(restamped?.kind).toBe("pending-ai-change");
      expect(restamped?.tintColor).toBe("#bfdbfe");
      // Part A: the re-stamped token carries the CUTTER family, not the
      // kind-folded revision-suggestion.
      expect(String(restamped?.linkCard)).toBe(`cutter-suggestion:${CARD_ID}`);
      // Part B: a delete re-stamp carries the strikethrough signal.
      expect(restamped?.pendingDelete).toBe(true);
      expect(markedTextFor(reloaded.editor, ANCHOR_ID)).toBe("quick brown fox ");
    } finally {
      reloaded?.cleanup();
      src.cleanup();
    }
  });

  it("is a graceful no-op when the stored text no longer matches (edited post-apply)", () => {
    const { editor, cleanup } = mount();
    try {
      // No apply ran; the card claims a replacement that isn't in the doc.
      const card: PendingMarkCardLike = {
        id: CARD_ID,
        kind: "suggestion",
        status: "applied",
        appliedChange: {
          anchorId: ANCHOR_ID,
          anchorUuid: PARA_UUID,
          originalText: "quick brown fox",
          replacement: "text that is not present anywhere",
          mode: "replace",
        },
      };
      // The record is built (text non-empty), but reanchorByText finds nothing.
      const n = reapplyPendingMarks(editor, [
        { family: "revision-suggestion", cards: [card] },
      ]);
      expect(n).toBe(1); // processed …
      expect(markAttrsFor(editor, ANCHOR_ID)).toBeNull(); // … but no mark stamped
    } finally {
      cleanup();
    }
  });

  it("flag-OFF stamps nothing and the alive-set is empty (parity)", () => {
    setPendingChangesFlag(false);
    const { editor, cleanup } = mount();
    try {
      const card: PendingMarkCardLike = {
        id: CARD_ID,
        kind: "suggestion",
        status: "applied",
        appliedChange: {
          anchorId: ANCHOR_ID,
          anchorUuid: PARA_UUID,
          originalText: "quick brown fox",
          replacement: "lazy grey cat",
          mode: "replace",
        },
      };
      expect(
        reapplyPendingMarks(editor, [
          { family: "revision-suggestion", cards: [card] },
        ]),
      ).toBe(0);
      expect(markAttrsFor(editor, ANCHOR_ID)).toBeNull();
      expect(pendingMarkAnchorIds([card]).size).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("pendingMarkAnchorIds collects only applied cards' appliedChange.anchorId", () => {
    const applied: PendingMarkCardLike = {
      id: "c1",
      kind: "suggestion",
      status: "applied",
      appliedChange: {
        anchorId: "anc-1",
        anchorUuid: PARA_UUID,
        originalText: "x",
        replacement: "y",
        mode: "replace",
      },
    };
    const pending: PendingMarkCardLike = { id: "c2", kind: "suggestion", status: "pending" };
    const comment: PendingMarkCardLike = { id: "c3", kind: "comment", status: "applied" };
    const ids = pendingMarkAnchorIds([applied, pending, comment]);
    expect([...ids]).toEqual(["anc-1"]);
  });
});

// ── insertParagraphAfter — the non-destructive "Insert below" primitive (11) ──
//
// Behind the retired 4-field AI fallback: instead of splicing the (possibly
// returned / re-anchored) original, drop the suggestion as a NEW sibling
// paragraph directly after the anchor. The contract the UI leans on:
//   - the anchored paragraph's serialized `.tex` line is BYTE-UNCHANGED,
//   - EXACTLY one new `%!v:` anchor line appears (the new paragraph, its uuid
//     minted by BlockUuidBackfill — not hand-minted),
//   - the new paragraph carries the inserted text,
//   - a bad uuid is a safe no-op (false, doc untouched).

/** Count the `%!v:` block anchors in a serialized body. */
function countAnchors(tex: string): number {
  return (tex.match(/%!v:/g) || []).length;
}

/** The serialized `.tex` line carrying block `uuid` (or null). */
function texLineFor(tex: string, uuid: string): string | null {
  return tex.split("\n").find((l) => l.includes(`%!v:${uuid}`)) ?? null;
}

describe("insertParagraphAfter — non-destructive insert below (11)", () => {
  it("inserts a new sibling paragraph, original line byte-unchanged, exactly one new %!v: line", () => {
    const { editor, cleanup } = mount();
    try {
      const beforeTex = serializeBodyOnly(editor.state.doc.toJSON());
      const beforeAnchors = countAnchors(beforeTex);
      const beforeFoxLine = texLineFor(beforeTex, PARA_UUID);
      const beforeFoxInline = paraInline(editor, PARA_UUID);
      expect(beforeFoxLine).not.toBeNull();

      const ok = insertParagraphAfter(
        editor,
        PARA_UUID,
        "A brand new sentence.",
      );
      expect(ok).toBe(true);

      const afterTex = serializeBodyOnly(editor.state.doc.toJSON());
      // The anchored paragraph's inline serialization is UNTOUCHED (pure insert).
      expect(paraInline(editor, PARA_UUID)).toBe(beforeFoxInline);
      // Its whole serialized line survives byte-for-byte.
      expect(texLineFor(afterTex, PARA_UUID)).toBe(beforeFoxLine);
      // EXACTLY one new anchor appeared (the new paragraph's minted uuid).
      expect(countAnchors(afterTex)).toBe(beforeAnchors + 1);
      // The inserted text is present, as a distinct paragraph after the anchor.
      expect(afterTex).toContain("A brand new sentence.");
      // The new paragraph carries a REAL, non-null uuid (BlockUuidBackfill minted
      // it — the id is neither of the two pre-existing block uuids).
      const newAnchor = (afterTex.match(/%!v:([0-9a-f]+)/g) || [])
        .map((m) => m.replace("%!v:", ""))
        .find((u) => u !== PARA_UUID && u !== CITE_PARA_UUID);
      expect(newAnchor).toBeTruthy();
      expect(findNodeByUuid(editor, newAnchor as string)?.node.textContent).toBe(
        "A brand new sentence.",
      );
    } finally {
      cleanup();
    }
  });

  it("is a safe no-op (false, doc untouched) when the anchor uuid does not resolve", () => {
    const { editor, cleanup } = mount();
    try {
      const beforeTex = serializeBodyOnly(editor.state.doc.toJSON());
      const ok = insertParagraphAfter(editor, "dead", "Should not appear.");
      expect(ok).toBe(false);
      expect(serializeBodyOnly(editor.state.doc.toJSON())).toBe(beforeTex);
    } finally {
      cleanup();
    }
  });
});
