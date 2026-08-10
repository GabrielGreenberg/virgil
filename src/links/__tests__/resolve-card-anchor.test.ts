// @vitest-environment jsdom
//
// CHIP R0 — the pure anchor-recovery SSOT (`resolve-card-anchor.ts`).
//
// Exhaustive over every legacy link shape: uuid-only Mode-A, snapshot+uuid
// Mode-A (proving uuid-STRICTLY-before-snapshot), textRange+mark Mode-B,
// the RC1 poisoned hybrid (linkedRange link whose textObjectIds[0] is the
// new paragraph), `reconcileCardToResolved` idempotency, and the
// duplicated-text first-match-wins documentation.
//
// Real `new Editor` (the main stack, so paragraphs carry `uuid` attrs and
// `linkedAnchor` marks exactly as in prod) is used wherever a live doc /
// index is needed; hand-built fixtures cover the pure-ladder cases.
//
// The storage stub guards the extension-barrel/@/lib/storage gotcha (the
// figure/graphics/tex NodeViews transitively import @/lib/storage).
import { describe, it, expect, vi } from "vitest";

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

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  captureParagraphSnapshot,
  createLinkedAnchor,
  getTextAnchor,
  type CardWithLinks,
} from "@/links/links";
import type { Link } from "@/links/_shared/types";
import {
  buildResolveIndex,
  resolveCardAnchor,
  reconcileCardToResolved,
  normalizeParagraphText,
  type ResolveIndex,
} from "@/links/resolve-card-anchor";

// ---------------------------------------------------------------------------
// Real-editor harness (mirrors mode-a-reconcile.test.ts)
// ---------------------------------------------------------------------------

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

/** Mount the real main stack with the given paragraphs (uuid + text). */
function mountDoc(paras: Array<{ uuid: string; text: string }>): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: paras.map((p) => ({
        type: "paragraph",
        attrs: { uuid: p.uuid },
        content: [{ type: "text", text: p.text }],
      })),
    },
  });
}

// ---------------------------------------------------------------------------
// Hand-built fixtures for the pure-ladder cases
// ---------------------------------------------------------------------------

type AnyCard = CardWithLinks & { id: string; kind: string };

function modeALink(
  uuid: string,
  paragraphSnapshot?: string,
): Link {
  return {
    id: `link-${uuid}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: [uuid],
      ...(paragraphSnapshot !== undefined ? { paragraphSnapshot } : {}),
    },
    target: { type: "card", ref: { kind: "note", id: "c1" } },
    createdAt: "",
  };
}

function modeBLink(
  anchorId: string,
  textSnapshot: string,
  textObjectIds: string[] = [],
): Link {
  return {
    id: `link-${anchorId}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds,
      textRange: { anchorId, textSnapshot },
    },
    target: { type: "card", ref: { kind: "note", id: "c1" } },
    createdAt: "",
  };
}

function card(id: string, links: Link[]): AnyCard {
  return { id, kind: "note", links };
}

/** A pure (no-editor) index for hand-built ladder cases. */
function fakeIndex(args: {
  uuids?: string[];
  anchorIds?: Record<string, string>;
  /** normalized-text → uuid */
  snapshots?: Record<string, string>;
}): ResolveIndex {
  const uuidToParagraph = new Set(args.uuids ?? []);
  const anchorIdToParagraph = new Map(Object.entries(args.anchorIds ?? {}));
  const snap = new Map(Object.entries(args.snapshots ?? {}));
  return {
    uuidToParagraph,
    anchorIdToParagraph,
    snapshotToParagraph: (k) => (k ? snap.get(k) ?? null : null),
  };
}

// ===========================================================================
// normalizeParagraphText
// ===========================================================================

describe("normalizeParagraphText", () => {
  it("trims, collapses internal whitespace, strips zero-width", () => {
    expect(normalizeParagraphText("  the   first\tparagraph.\n")).toBe(
      "the first paragraph.",
    );
    // Zero-width chars (ZWSP/ZWJ/BOM) removed.
    expect(normalizeParagraphText("a​b‍ c﻿")).toBe("ab c");
    expect(normalizeParagraphText("")).toBe("");
    expect(normalizeParagraphText("   ")).toBe("");
  });
});

// ===========================================================================
// uuid-only Mode-A
// ===========================================================================

describe("resolveCardAnchor — uuid-only Mode-A", () => {
  it("live uuid → source:'uuid', mode:'A', high", () => {
    const index = fakeIndex({ uuids: ["P1"] });
    const res = resolveCardAnchor(card("c1", [modeALink("P1")]), null, index);
    expect(res).toEqual({
      paragraphId: "P1",
      mode: "A",
      source: "uuid",
      confidence: "high",
      liveAnchorId: null,
    });
  });

  it("dead uuid + matching snapshot → source:'snapshot', low", () => {
    const index = fakeIndex({
      uuids: ["Pother"],
      // Key is the NORMALIZED form (trim/collapse/strip-zero-width — NOT
      // lowercased): the resolver looks up normalizeParagraphText(raw).
      snapshots: { "The body of the note.": "Plive" },
    });
    const res = resolveCardAnchor(
      card("c1", [modeALink("Pdead", "The body of the note.")]),
      null,
      index,
    );
    expect(res.source).toBe("snapshot");
    expect(res.mode).toBe("A");
    expect(res.confidence).toBe("low");
    expect(res.paragraphId).toBe("Plive");
  });

  it("dead uuid + no snapshot → orphan", () => {
    const index = fakeIndex({ uuids: ["Pother"] });
    const res = resolveCardAnchor(card("c1", [modeALink("Pdead")]), null, index);
    expect(res).toEqual({
      paragraphId: null,
      mode: null,
      source: "orphan",
      confidence: "low",
      liveAnchorId: null,
    });
  });
});

// ===========================================================================
// snapshot+uuid Mode-A — proves uuid STRICTLY before snapshot
// ===========================================================================

describe("resolveCardAnchor — uuid STRICTLY before snapshot", () => {
  it("live uuid wins even when the snapshot would match a DIFFERENT sibling", () => {
    // Card's stored uuid P_self is live. Its snapshot text also exists on a
    // sibling P_sibling. A snapshot-first ladder would rebind to P_sibling;
    // the contract demands the live uuid wins.
    const index = fakeIndex({
      uuids: ["P_self", "P_sibling"],
      snapshots: { "Shared duplicated body.": "P_sibling" },
    });
    const res = resolveCardAnchor(
      card("c1", [modeALink("P_self", "Shared duplicated body.")]),
      null,
      index,
    );
    expect(res.source).toBe("uuid");
    expect(res.paragraphId).toBe("P_self"); // NOT P_sibling
  });
});

// ===========================================================================
// textRange + mark Mode-B
// ===========================================================================

describe("resolveCardAnchor — Mode-B", () => {
  it("live anchorId → source:'mark', mode:'B', liveAnchorId set", () => {
    const index = fakeIndex({
      uuids: ["P1"],
      anchorIds: { "anc-1": "P1" },
    });
    const res = resolveCardAnchor(
      card("c1", [modeBLink("anc-1", "the linked span")]),
      null,
      index,
    );
    expect(res).toEqual({
      paragraphId: "P1",
      mode: "B",
      source: "mark",
      confidence: "high",
      liveAnchorId: "anc-1",
    });
  });

  it("mark gone + textSnapshot matches → source:'snapshot', liveAnchorId preserved", () => {
    const index = fakeIndex({
      uuids: ["P1"],
      // anchorId NOT in the index (mark gone)
      snapshots: { "the linked span": "P1" },
    });
    const res = resolveCardAnchor(
      card("c1", [modeBLink("anc-gone", "the linked span")]),
      null,
      index,
    );
    expect(res.source).toBe("snapshot");
    expect(res.mode).toBe("B");
    expect(res.paragraphId).toBe("P1");
    // anchorId preserved for a caller that wants to re-apply the mark.
    expect(res.liveAnchorId).toBe("anc-gone");
  });

  it("mark gone + snapshot no match → orphan", () => {
    const index = fakeIndex({ uuids: ["P1"] });
    const res = resolveCardAnchor(
      card("c1", [modeBLink("anc-gone", "vanished text")]),
      null,
      index,
    );
    expect(res.source).toBe("orphan");
    expect(res.paragraphId).toBeNull();
  });
});

// ===========================================================================
// RC1 poisoned hybrid — self-heals via the uuid rung
// ===========================================================================

describe("resolveCardAnchor — RC1 poisoned hybrid", () => {
  // The exact RC1 shape (MEMO_CARD_DROP_MARGIN_FIX.md): a Mode-B fold left a
  // linkedRange link whose textObjectIds gained the new paragraph but whose
  // textRange still points at the OLD (now dead) anchor and carries NO
  // paragraphSnapshot. P_new is live. The card must self-heal via the uuid
  // rung (2b) — NOT revert to the stale textRange snapshot, and NOT orphan.
  function poisoned(textObjectIds: string[]): Link {
    return {
      id: "link-poison",
      kind: "anchor",
      anchor: {
        type: "textObject",
        targetKind: "linkedRange",
        textObjectIds,
        textRange: { anchorId: "anc-old-dead", textSnapshot: "old span text" },
        // no paragraphSnapshot
      },
      target: { type: "card", ref: { kind: "note", id: "c1" } },
      createdAt: "",
    };
  }

  it("textObjectIds:[P_new] (old id already removed) self-heals via uuid", () => {
    const index = fakeIndex({
      uuids: ["P_new"],
      // Even if the OLD span text matched a different paragraph, uuid wins:
      snapshots: { "old span text": "P_somewhere_else" },
      anchorIds: {}, // mark gone
    });
    const res = resolveCardAnchor(card("c1", [poisoned(["P_new"])]), null, index);
    expect(res.source).toBe("uuid");
    expect(res.mode).toBe("A");
    expect(res.paragraphId).toBe("P_new");
  });

  it("textObjectIds:[P_old_dead, P_new] self-heals on the FIRST live id", () => {
    const index = fakeIndex({
      uuids: ["P_new"], // P_old_dead is gone
      anchorIds: {},
    });
    const res = resolveCardAnchor(
      card("c1", [poisoned(["P_old_dead", "P_new"])]),
      null,
      index,
    );
    expect(res.source).toBe("uuid");
    expect(res.paragraphId).toBe("P_new");
  });

  it("a HEALTHY Mode-B (live mark + live containing paragraph) is NOT hijacked by 2b", () => {
    // Guard: the containing paragraph uuid is live AND the mark is live.
    // Rung 2 (mark) must win — the card stays Mode-B, never demoted to a
    // paragraph-uuid binding by the RC1 self-heal rung.
    const index = fakeIndex({
      uuids: ["P_container"],
      anchorIds: { "anc-live": "P_container" },
    });
    const healthy = modeBLink("anc-live", "the span", ["P_container"]);
    const res = resolveCardAnchor(card("c1", [healthy]), null, index);
    expect(res.source).toBe("mark");
    expect(res.mode).toBe("B");
    expect(res.liveAnchorId).toBe("anc-live");
  });
});

// ===========================================================================
// reconcileCardToResolved — idempotency + relocation
// ===========================================================================

describe("reconcileCardToResolved", () => {
  it("source:'snapshot' rewrites textObjectIds[0] + restamps snapshot, then is idempotent", () => {
    const index = fakeIndex({
      uuids: ["Plive"],
      snapshots: { "The body text.": "Plive" },
    });
    const c0 = card("c1", [modeALink("Pdead", "The body text.")]);
    const res0 = resolveCardAnchor(c0, null, index);
    expect(res0.source).toBe("snapshot");

    const { card: c1, changed: ch1 } = reconcileCardToResolved(c0, res0);
    expect(ch1).toBe(true);
    const l1 = c1.links![0];
    if (l1.anchor.type !== "textObject") throw new Error("textObject");
    expect(l1.anchor.textObjectIds).toEqual(["Plive"]);
    expect(l1.anchor.paragraphSnapshot).toBe("The body text."); // normalized

    // 2nd call: now the uuid resolves → uuid rung → backfill canonical
    // snapshot which is already canonical → changed:false.
    const res1 = resolveCardAnchor(c1, null, index);
    expect(res1.source).toBe("uuid");
    const { changed: ch2 } = reconcileCardToResolved(c1, res1);
    expect(ch2).toBe(false);
  });

  it("source:'snapshot' Mode-B is CONVERTED to a clean Mode-A paragraph link", () => {
    const index = fakeIndex({
      uuids: ["Plive"],
      snapshots: { "the linked span": "Plive" },
      anchorIds: {}, // mark gone
    });
    const c0 = card("c1", [modeBLink("anc-gone", "the linked span")]);
    const res0 = resolveCardAnchor(c0, null, index);
    expect(res0.source).toBe("snapshot");
    expect(res0.mode).toBe("B");

    const { card: c1, changed } = reconcileCardToResolved(c0, res0);
    expect(changed).toBe(true);
    const l1 = c1.links![0];
    if (l1.anchor.type !== "textObject") throw new Error("textObject");
    // Converted: clean Mode-A, mark binding dropped.
    expect(l1.anchor.targetKind).toBe("paragraph");
    expect(l1.anchor.textObjectIds).toEqual(["Plive"]);
    expect(l1.anchor.textRange).toBeUndefined();
    expect(l1.anchor.paragraphSnapshot).toBe("the linked span");

    // Idempotent: 2nd resolve hits the uuid rung now → no further change.
    const res1 = resolveCardAnchor(c1, null, index);
    expect(res1.source).toBe("uuid");
    expect(reconcileCardToResolved(c1, res1).changed).toBe(false);
  });

  it("source:'uuid' canonicalizes a non-canonical snapshot once, then no-ops", () => {
    const index = fakeIndex({ uuids: ["P1"] });
    // Stored snapshot has sloppy whitespace; uuid is live.
    const c0 = card("c1", [modeALink("P1", "  the   body  ")]);
    const res0 = resolveCardAnchor(c0, null, index);
    expect(res0.source).toBe("uuid");
    const { card: c1, changed } = reconcileCardToResolved(c0, res0);
    expect(changed).toBe(true);
    const l1 = c1.links![0];
    if (l1.anchor.type !== "textObject") throw new Error("textObject");
    expect(l1.anchor.paragraphSnapshot).toBe("the body");
    // 2nd pass: already canonical → no-op.
    const res1 = resolveCardAnchor(c1, null, index);
    expect(reconcileCardToResolved(c1, res1).changed).toBe(false);
  });

  it("source:'uuid' with no snapshot is a no-op (RC-A backfills real text)", () => {
    const index = fakeIndex({ uuids: ["P1"] });
    const c0 = card("c1", [modeALink("P1")]); // no snapshot
    const res0 = resolveCardAnchor(c0, null, index);
    expect(res0.source).toBe("uuid");
    expect(reconcileCardToResolved(c0, res0).changed).toBe(false);
  });

  it("source:'mark' and 'orphan' are no-ops", () => {
    const idxMark = fakeIndex({ uuids: ["P1"], anchorIds: { "anc-1": "P1" } });
    const cMark = card("c1", [modeBLink("anc-1", "span")]);
    expect(
      reconcileCardToResolved(cMark, resolveCardAnchor(cMark, null, idxMark))
        .changed,
    ).toBe(false);

    const idxOrphan = fakeIndex({ uuids: ["Pother"] });
    const cOrphan = card("c1", [modeALink("Pdead")]);
    expect(
      reconcileCardToResolved(cOrphan, resolveCardAnchor(cOrphan, null, idxOrphan))
        .changed,
    ).toBe(false);
  });
});

// ===========================================================================
// Duplicated-text doc — first-match-wins, documented
// ===========================================================================

describe("buildResolveIndex — duplicated text (first-match-wins)", () => {
  it("dead-uuid card resolves to the FIRST same-text paragraph via snapshot", () => {
    const editor = mountDoc([
      { uuid: "first0", text: "Ambiguous shared text." },
      { uuid: "secnd0", text: "Ambiguous shared text." },
    ]);
    const index = buildResolveIndex(editor);
    // The snapshot map keeps the FIRST uuid for a duplicated normalized key.
    expect(index.snapshotToParagraph("Ambiguous shared text.")).toBe("first0");

    const res = resolveCardAnchor(
      card("c1", [modeALink("deadid", "Ambiguous shared text.")]),
      editor,
      index,
    );
    expect(res.source).toBe("snapshot");
    expect(res.paragraphId).toBe("first0"); // documented first-match-wins
    editor.destroy();
  });
});

// ===========================================================================
// Real-editor end-to-end: index + ladder + reconcile against the live stack
// ===========================================================================

describe("buildResolveIndex / resolveCardAnchor — real editor", () => {
  it("collects live uuids, mark→paragraph, and normalized snapshot map", () => {
    const editor = mountDoc([
      { uuid: "head0", text: "A heading-ish line." },
      { uuid: "body0", text: "The   body of   the note." },
    ]);
    const index = buildResolveIndex(editor);
    expect(index.uuidToParagraph.has("head0")).toBe(true);
    expect(index.uuidToParagraph.has("body0")).toBe(true);
    // textContent normalized in the snapshot map.
    expect(index.snapshotToParagraph("The body of the note.")).toBe("body0");
    editor.destroy();
  });

  it("Mode-A live uuid resolves high; dead uuid + snapshot rebinds + reconciles", () => {
    const editor = mountDoc([
      { uuid: "head0", text: "A heading-ish line." },
      { uuid: "fresh0", text: "The body of the note." },
    ]);
    const index = buildResolveIndex(editor);

    // Live uuid → uuid rung.
    const live = resolveCardAnchor(card("c1", [modeALink("head0")]), editor, index);
    expect(live.source).toBe("uuid");
    expect(live.paragraphId).toBe("head0");

    // Dead uuid (the paragraph was re-minted "fresh0") + snapshot → snapshot rung.
    const c0 = card("c2", [modeALink("stale0", "The body of the note.")]);
    const res = resolveCardAnchor(c0, editor, index);
    expect(res.source).toBe("snapshot");
    expect(res.paragraphId).toBe("fresh0");

    const { card: c1, changed } = reconcileCardToResolved(c0, res);
    expect(changed).toBe(true);
    const l1 = c1.links![0];
    if (l1.anchor.type !== "textObject") throw new Error("textObject");
    expect(l1.anchor.textObjectIds).toEqual(["fresh0"]);
    editor.destroy();
  });

  it("Mode-B live mark resolves via anchorIdToParagraph", () => {
    // Apply a real linkedAnchor mark over a selection so the index walk
    // picks it up exactly as in prod. createLinkedAnchor mints its own
    // anchorId — read it back and feed it to the card's textRange.
    const editor = mountDoc([{ uuid: "para0", text: "Anchor this span please." }]);
    const text = "Anchor this span please.";
    const from = 1 + text.indexOf("this span"); // +1: doc start offset
    const to = from + "this span".length;
    const rec = createLinkedAnchor(editor, "note", { from, to });
    if (!rec) throw new Error("expected a linkedAnchor record");

    const index = buildResolveIndex(editor);
    expect(index.anchorIdToParagraph.get(rec.anchorId)).toBe("para0");

    const res = resolveCardAnchor(
      card("c1", [modeBLink(rec.anchorId, "this span")]),
      editor,
      index,
    );
    expect(res.source).toBe("mark");
    expect(res.mode).toBe("B");
    expect(res.paragraphId).toBe("para0");
    expect(res.liveAnchorId).toBe(rec.anchorId);
    editor.destroy();
  });
});

// ===========================================================================
// RC-A AUGMENTATION 1 — editor-aware snapshot backfill (opts.liveText)
// ===========================================================================

describe("reconcileCardToResolved — AUGMENTATION 1: liveText backfill", () => {
  it("source:'uuid' MISSING snapshot is backfilled from opts.liveText (normalized)", () => {
    const index = fakeIndex({ uuids: ["P1"] });
    const c0 = card("c1", [modeALink("P1")]); // no snapshot
    const res = resolveCardAnchor(c0, null, index);
    expect(res.source).toBe("uuid");

    // Pure call (no opts) → no backfill (R0 behavior preserved).
    expect(reconcileCardToResolved(c0, res).changed).toBe(false);

    // Editor-aware call → backfill from live text, stored NORMALIZED.
    const { card: c1, changed } = reconcileCardToResolved(c0, res, {
      liveText: "  The   live  body. ",
    });
    expect(changed).toBe(true);
    const l1 = c1.links![0];
    if (l1.anchor.type !== "textObject") throw new Error("textObject");
    expect(l1.anchor.paragraphSnapshot).toBe("The live body.");

    // Idempotent: 2nd pass with the same (already-normalized) live text → no-op.
    const res1 = resolveCardAnchor(c1, null, index);
    expect(
      reconcileCardToResolved(c1, res1, { liveText: "The live body." }).changed,
    ).toBe(false);
  });

  it("source:'uuid' present-but-stale snapshot is refreshed to opts.liveText", () => {
    const index = fakeIndex({ uuids: ["P1"] });
    const c0 = card("c1", [modeALink("P1", "old body")]);
    const res = resolveCardAnchor(c0, null, index);
    const { card: c1, changed } = reconcileCardToResolved(c0, res, {
      liveText: "new body",
    });
    expect(changed).toBe(true);
    const l1 = c1.links![0];
    if (l1.anchor.type !== "textObject") throw new Error("textObject");
    expect(l1.anchor.paragraphSnapshot).toBe("new body");
  });
});

// ===========================================================================
// RC-A AUGMENTATION 2 — HYBRID CLEANUP (opts.isAnchorIdLive)
// ===========================================================================

describe("reconcileCardToResolved — AUGMENTATION 2: hybrid cleanup", () => {
  /** The double-link hybrid a re-anchored Mode-B todo/revision/cutter/report
   *  leaves behind: a dead-mark linkedRange link + a clean Mode-A link on the
   *  new paragraph. */
  function deadLinkedRange(anchorId: string, textObjectIds: string[]): Link {
    return {
      id: `link-${anchorId}`,
      kind: "anchor",
      anchor: {
        type: "textObject",
        targetKind: "linkedRange",
        textObjectIds,
        textRange: { anchorId, textSnapshot: "old span text" },
      },
      target: { type: "card", ref: { kind: "todo", id: "c1" } },
      createdAt: "",
    };
  }

  it("double-link hybrid → single clean Mode-A link, getTextAnchor null", () => {
    // [{linkedRange, dead anchorId}, {paragraph,[live P_new]}].
    const index = fakeIndex({ uuids: ["P_new"], anchorIds: {} });
    const c0 = card("c1", [
      deadLinkedRange("anc-dead", []),
      modeALink("P_new", "the new body"),
    ]);
    const res = resolveCardAnchor(c0, null, index);
    expect(res.source).toBe("uuid");
    expect(res.paragraphId).toBe("P_new");

    const { card: c1, changed } = reconcileCardToResolved(c0, res, {
      isAnchorIdLive: (id) => index.anchorIdToParagraph.has(id),
    });
    expect(changed).toBe(true);
    // Exactly one link, clean Mode-A on P_new, no textRange.
    expect(c1.links).toHaveLength(1);
    const l1 = c1.links![0];
    if (l1.anchor.type !== "textObject") throw new Error("textObject");
    expect(l1.anchor.targetKind).toBe("paragraph");
    expect(l1.anchor.textObjectIds).toEqual(["P_new"]);
    expect(l1.anchor.textRange).toBeUndefined();
    expect(getTextAnchor(c1)).toBeNull();

    // Idempotent: 2nd pass → no further change.
    const res1 = resolveCardAnchor(c1, null, index);
    expect(
      reconcileCardToResolved(c1, res1, {
        isAnchorIdLive: (id) => index.anchorIdToParagraph.has(id),
      }).changed,
    ).toBe(false);
  });

  it("rung-2b poisoned single link (dead mark, live uuid in textObjectIds) → clean Mode-A", () => {
    // [{linkedRange, dead anchorId, textObjectIds:[P_new]}] — no separate clean link.
    const index = fakeIndex({ uuids: ["P_new"], anchorIds: {} });
    const c0 = card("c1", [deadLinkedRange("anc-dead", ["P_new"])]);
    const res = resolveCardAnchor(c0, null, index);
    expect(res.source).toBe("uuid"); // rung 2b
    expect(res.paragraphId).toBe("P_new");

    const { card: c1, changed } = reconcileCardToResolved(c0, res, {
      isAnchorIdLive: (id) => index.anchorIdToParagraph.has(id),
    });
    expect(changed).toBe(true);
    expect(c1.links).toHaveLength(1);
    const l1 = c1.links![0];
    if (l1.anchor.type !== "textObject") throw new Error("textObject");
    expect(l1.anchor.targetKind).toBe("paragraph");
    expect(l1.anchor.textObjectIds).toEqual(["P_new"]);
    expect(getTextAnchor(c1)).toBeNull();
  });

  it("a HEALTHY Mode-B (live mark) is NOT cleaned up", () => {
    // Live mark → resolves via rung 2 (source 'mark'), so reconcile is a
    // no-op anyway; but assert cleanup never strips a live-mark link.
    const index = fakeIndex({
      uuids: ["P1"],
      anchorIds: { "anc-live": "P1" },
    });
    const c0 = card("c1", [modeBLink("anc-live", "the span", ["P1"])]);
    const res = resolveCardAnchor(c0, null, index);
    expect(res.source).toBe("mark");
    const { changed } = reconcileCardToResolved(c0, res, {
      isAnchorIdLive: (id) => index.anchorIdToParagraph.has(id),
    });
    expect(changed).toBe(false);
    expect(getTextAnchor(c0)).not.toBeNull();
  });
});

// ===========================================================================
// CHIP-D — capture-side normalize ties the snapshot rung after a round-trip
// ===========================================================================

describe("CHIP-D — normalize round-trip (capture ↔ index parity)", () => {
  it("a snapshot captured from a whitespace-variant paragraph ties on reload", () => {
    // Capture the snapshot from a doc whose paragraph has SLOPPY whitespace
    // (a pre-round-trip variant). captureParagraphSnapshot normalizes it.
    const editorPre = mountDoc([
      { uuid: "preid0", text: "The   body\tof   the note." },
    ]);
    const captured = captureParagraphSnapshot(editorPre, "preid0");
    // Capture side is normalized (CHIP-D).
    expect(captured).toBe("The body of the note.");
    editorPre.destroy();

    // Reload: the paragraph round-trips to a CLEAN-whitespace form and is
    // re-minted a fresh uuid (the dead-uuid reload race). The stored
    // snapshot must still tie via the snapshot rung.
    const editorPost = mountDoc([
      { uuid: "head000", text: "An unrelated heading." },
      { uuid: "fresh00", text: "The body of the note." },
    ]);
    const index = buildResolveIndex(editorPost);

    const c0 = card("c1", [modeALink("preid0", captured!)]); // uuid now dead
    const res = resolveCardAnchor(c0, editorPost, index);
    expect(res.source).toBe("snapshot");
    expect(res.paragraphId).toBe("fresh00");
    editorPost.destroy();
  });
});

// ===========================================================================
// Open-verification #2 — index built in ONE doc walk, not per card
// ===========================================================================

describe("buildResolveIndex — single index, no per-card walk (open-verification #2)", () => {
  it("builds the index in a fixed number of walks INDEPENDENT of card count", () => {
    // Build the index once for a small doc and once for a larger doc; the
    // index build's walk count must NOT grow with card/paragraph count —
    // it's O(doc), card-count-independent. (Internally `collectLiveUuids`
    // + one combined mark+snapshot walk = a fixed 2 walks, regardless of
    // how many cards will later resolve against it.)
    const small = mountDoc([{ uuid: "p1", text: "Alpha." }]);
    const spySmall = vi.spyOn(small.state.doc, "descendants");
    buildResolveIndex(small);
    const smallWalks = spySmall.mock.calls.length;
    spySmall.mockRestore();
    small.destroy();

    const big = mountDoc([
      { uuid: "q1", text: "Alpha." },
      { uuid: "q2", text: "Beta." },
      { uuid: "q3", text: "Gamma." },
      { uuid: "q4", text: "Delta." },
    ]);
    const spyBig = vi.spyOn(big.state.doc, "descendants");
    const index = buildResolveIndex(big);
    const bigWalks = spyBig.mock.calls.length;
    // Same fixed walk count — the index build does not scale with paragraphs.
    expect(bigWalks).toBe(smallWalks);

    // Resolving N cards against the prebuilt index does NO further walk —
    // O(1) per card, the load-bearing "never O(doc·cards)" invariant.
    const before = spyBig.mock.calls.length;
    resolveCardAnchor(card("c1", [modeALink("q1")]), big, index);
    resolveCardAnchor(card("c2", [modeALink("q2")]), big, index);
    resolveCardAnchor(card("c3", [modeALink("q3")]), big, index);
    resolveCardAnchor(card("c4", [modeALink("q4")]), big, index);
    expect(spyBig.mock.calls.length).toBe(before); // unchanged — no per-card walk

    spyBig.mockRestore();
    big.destroy();
  });
});
