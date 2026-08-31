// @vitest-environment jsdom
//
// Task 497 — AN ARCHIVED CARD DRAWS NO ANCHOR CHROME.
//
// Gabriel, from a real paper: "When a note is associated highlighting, and the
// note is archived, the highlighting should disappear. (the highlighting should
// be structurally linked to the presence of the note)".
//
// The chrome half of the archived exclusion did not exist. `EditorPane`'s
// `archivedIds` had five consumers — margin markers, the re-pin chip, the omni
// filter, the archive glyph and the jump re-check — and NONE of them was the
// in-document Mode-B span layer, though the set's own doc comment named
// "highlights" as a consumer. Task 476's class ("a named consumer that was
// never written"), one word over.
//
// **No pre-497 suite could see any of this**: `useLinkHighlight` had NO suite
// at all and `data-show-hl-` was asserted nowhere, so the whole sweep it owns
// was unpinned; and every reconciler fixture in the repo is UNARCHIVED, so a
// card whose chrome must not paint is unrepresentable in all of them.
//
// The legs drive the REAL hook against a REAL editor built from the REAL
// `buildEditorExtensions("main")` stack — the mark's `renderHTML` is what emits
// `data-link-id` / `data-link-card`, and it is exactly that emission the fix has
// to be keyed against.
//
// (Storage stub guards the extension-barrel/@/lib/storage gotcha.)
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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import { act, renderHook } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  useLinkHighlight,
  DATA_ANCHOR_ARCHIVED,
} from "@/links/_shared/useLinkHighlight";
import {
  archivedAnchorIds,
  archivedCardIds,
  cardIsArchived,
} from "@/links/_shared/archived-anchor-chrome";
import { useAnchorHighlightReconciler } from "@/links/_shared/useAnchorHighlightReconciler";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type { EntityCollectionSlots } from "@/cards/entity-collections";
import type { Link } from "@/links/_shared/types";

const PARA_UUID = "pa4971";
/** The card whose note is ARCHIVED. */
const ARCHIVED_ANCHOR = "aa11";
const ARCHIVED_CARD = "card-archived";
/** The card that is still ACTIVE — the control that keeps every leg honest. */
const ACTIVE_ANCHOR = "bb22";
const ACTIVE_CARD = "card-active";

const NO_KINDS: ReadonlySet<"note"> = new Set();
const NONE_ARCHIVED: ReadonlySet<string> = new Set<string>();

function mainCtx(anchored: Set<string>): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: anchored },
    host: null,
  };
}

function makeLink(anchorId: string, cardId: string): Link {
  return {
    id: `lnk-${anchorId}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [PARA_UUID],
      textRange: { anchorId, textSnapshot: "word" },
    },
    target: { type: "card", ref: { kind: "note", id: cardId } },
    createdAt: "",
  };
}

/**
 * One paragraph carrying TWO `linkedAnchor` marks: an ARCHIVED card's over the
 * first word and an ACTIVE card's over the second. Two spans in one document is
 * the whole point — a leg that only asserted "the archived span is off" passes
 * on an implementation that turns EVERY span off.
 *
 * `linkCard` is stamped EMPTY (`"note:"`) deliberately: that is exactly what
 * `applyLinkedAnchors` re-stamps on reload — kind token present, card id absent
 * — so this fixture IS the post-reload shape, and a card-id-keyed fix cannot
 * pass here.
 */
function mountTwoAnchors(): { editor: Editor; element: HTMLElement } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx(new Set([PARA_UUID]))),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: PARA_UUID },
          content: [{ type: "text", text: "alpha bravo charlie" }],
        },
      ],
    },
  });
  const markType = editor.schema.marks.linkedAnchor;
  if (!markType) throw new Error("linkedAnchor mark missing from the main stack");
  const mk = (anchorId: string) =>
    markType.create({
      anchorId,
      linkId: anchorId,
      kind: "note",
      linkKind: "anchor",
      linkCard: "note:",
    });
  // "alpha" = [1, 6); "bravo" = [7, 12).
  editor.view.dispatch(editor.state.tr.addMark(1, 6, mk(ARCHIVED_ANCHOR)));
  editor.view.dispatch(editor.state.tr.addMark(7, 12, mk(ACTIVE_ANCHOR)));
  return { editor, element };
}

function spanFor(editor: Editor, anchorId: string): HTMLElement {
  const el = editor.view.dom.querySelector(
    `.linked-anchor[data-link-id="${anchorId}"]`,
  ) as HTMLElement | null;
  if (!el) throw new Error(`no .linked-anchor span for ${anchorId}`);
  return el;
}

async function waitForEditorInit(editor: Editor): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  if (!editor.isInitialized) throw new Error("editor never initialized");
}

// ── The authority ───────────────────────────────────────────────────────────

describe("archived-anchor-chrome — the ONE rule, two projections", () => {
  const notes = [
    { id: ARCHIVED_CARD, archived: true, links: [makeLink(ARCHIVED_ANCHOR, ARCHIVED_CARD)] },
    { id: ACTIVE_CARD, links: [makeLink(ACTIVE_ANCHOR, ACTIVE_CARD)] },
  ];

  it("cardIsArchived reads the card's OWN record and nothing else", () => {
    expect(cardIsArchived({ id: "x", archived: true })).toBe(true);
    expect(cardIsArchived({ id: "x", archived: false })).toBe(false);
    // Absent is NOT archived — an archivable kind that has never been archived
    // carries no field at all.
    expect(cardIsArchived({ id: "x" })).toBe(false);
  });

  it("archivedCardIds and archivedAnchorIds are two projections of ONE walk", () => {
    expect([...archivedCardIds([notes])]).toEqual([ARCHIVED_CARD]);
    expect([...archivedAnchorIds([notes])]).toEqual([ARCHIVED_ANCHOR]);
  });

  it("collects EVERY text range an archived card owns, not just the first", () => {
    const multi = [
      {
        id: ARCHIVED_CARD,
        archived: true,
        links: [makeLink("m1", ARCHIVED_CARD), makeLink("m2", ARCHIVED_CARD)],
      },
    ];
    expect([...archivedAnchorIds([multi])].sort()).toEqual(["m1", "m2"]);
  });

  it("a card with no text range contributes no anchor id (the inline-atom kinds)", () => {
    expect(archivedAnchorIds([[{ id: "fn1", archived: true }]]).size).toBe(0);
    // …but it is still an archived CARD.
    expect([...archivedCardIds([[{ id: "fn1", archived: true }]])]).toEqual(["fn1"]);
  });
});

// ── The sweep (M1–M4: the persistent washes and the tint band) ───────────────

describe("useLinkHighlight — the archived-chrome sweep", () => {
  it("stamps data-anchor-archived on the ARCHIVED span only, and clears it on unarchive", () => {
    const { editor, element } = mountTwoAnchors();

    const hook = renderHook(
      ({ archived }: { archived: ReadonlySet<string> }) =>
        useLinkHighlight({
          editor,
          activeLinkId: null,
          hoveredLinkId: null,
          visibleHighlightKinds: NO_KINDS,
          archivedAnchorIds: archived,
        }),
      { initialProps: { archived: new Set([ARCHIVED_ANCHOR]) as ReadonlySet<string> } },
    );

    expect(spanFor(editor, ARCHIVED_ANCHOR).getAttribute(DATA_ANCHOR_ARCHIVED)).toBe(
      "true",
    );
    // The CONTROL: the active card's span in the SAME paragraph is untouched.
    expect(spanFor(editor, ACTIVE_ANCHOR).getAttribute(DATA_ANCHOR_ARCHIVED)).toBeNull();

    // Unarchive → the stamp comes off. (Restoring a card restores its chrome.)
    hook.rerender({ archived: NONE_ARCHIVED });
    expect(
      spanFor(editor, ARCHIVED_ANCHOR).getAttribute(DATA_ANCHOR_ARCHIVED),
    ).toBeNull();

    hook.unmount();
    editor.destroy();
    element.remove();
  });

  it("works on the POST-RELOAD span shape, whose data-link-card carries NO card id", () => {
    const { editor, element } = mountTwoAnchors();
    // Premise: this fixture really is the restored shape. `applyLinkedAnchors`
    // re-stamps with an empty `linkCard`, so a fix keyed on the card id out of
    // `data-link-card` would work in-session and die here.
    expect(spanFor(editor, ARCHIVED_ANCHOR).getAttribute("data-link-card")).toBe(
      "note:",
    );

    const hook = renderHook(() =>
      useLinkHighlight({
        editor,
        activeLinkId: null,
        hoveredLinkId: null,
        visibleHighlightKinds: NO_KINDS,
        archivedAnchorIds: new Set([ARCHIVED_ANCHOR]),
      }),
    );
    expect(spanFor(editor, ARCHIVED_ANCHOR).getAttribute(DATA_ANCHOR_ARCHIVED)).toBe(
      "true",
    );

    hook.unmount();
    editor.destroy();
    element.remove();
  });

  it("does NOT touch the linkedAnchor MARK — hiding is an attribute, never an unsetMark", () => {
    const { editor, element } = mountTwoAnchors();
    const before = JSON.stringify(editor.getJSON());

    const hook = renderHook(() =>
      useLinkHighlight({
        editor,
        activeLinkId: null,
        hoveredLinkId: null,
        visibleHighlightKinds: NO_KINDS,
        archivedAnchorIds: new Set([ARCHIVED_ANCHOR]),
      }),
    );

    // The mark is the durable anchor a RESTORE needs; the document must be
    // byte-identical ("Transient state is never document content").
    expect(JSON.stringify(editor.getJSON())).toBe(before);

    hook.unmount();
    editor.destroy();
    element.remove();
  });

  it("re-stamps after a whole-doc redraw (setContent) with the archived set unchanged", async () => {
    const { editor, element } = mountTwoAnchors();
    const hook = renderHook(() =>
      useLinkHighlight({
        editor,
        activeLinkId: null,
        hoveredLinkId: null,
        visibleHighlightKinds: NO_KINDS,
        archivedAnchorIds: new Set([ARCHIVED_ANCHOR]),
      }),
    );
    await waitForEditorInit(editor);
    expect(spanFor(editor, ARCHIVED_ANCHOR).getAttribute(DATA_ANCHOR_ARCHIVED)).toBe(
      "true",
    );

    // A code-pane re-parse that ADDED a block. Measured on this tree: a
    // structure-PRESERVING `setContent` leaves the span element in place (PM's
    // viewdesc sync matches and reuses the `MarkViewDesc`), so the raw stamp
    // survives it unaided and a leg written on that shape would be VACUOUS. A
    // structure-CHANGING one builds FRESH span DOM and the stamp goes with the
    // old elements — and that is precisely the case the DocStructureBus reports
    // (`addedBlocks`), so the re-sweep is what puts the stamp back.
    const before = spanFor(editor, ARCHIVED_ANCHOR);
    const json = editor.getJSON();
    (json.content as Array<unknown>).unshift({
      type: "paragraph",
      attrs: { uuid: "newpar" },
      content: [{ type: "text", text: "a new block from the code pane" }],
    });
    act(() => {
      editor.commands.setContent(json, { emitUpdate: true });
    });

    // Premise: the span really was recreated (or this leg proves nothing).
    expect(spanFor(editor, ARCHIVED_ANCHOR)).not.toBe(before);
    expect(spanFor(editor, ARCHIVED_ANCHOR).getAttribute(DATA_ANCHOR_ARCHIVED)).toBe(
      "true",
    );
    expect(spanFor(editor, ACTIVE_ANCHOR).getAttribute(DATA_ANCHOR_ARCHIVED)).toBeNull();

    hook.unmount();
    editor.destroy();
    element.remove();
  });

  it("KEYSTROKE SANCTITY — typing plain characters leaves the bus emitCount flat", async () => {
    const { editor, element } = mountTwoAnchors();
    const hook = renderHook(() =>
      useLinkHighlight({
        editor,
        activeLinkId: null,
        hoveredLinkId: null,
        visibleHighlightKinds: NO_KINDS,
        archivedAnchorIds: new Set([ARCHIVED_ANCHOR]),
      }),
    );
    await waitForEditorInit(editor);

    const { getBus } = await import("@/lib/tiptap/doc-structure");
    const bus = getBus(editor);
    if (!bus) throw new Error("no DocStructureBus on the main stack");
    const before = bus.emitCount;
    act(() => {
      for (const ch of "typingtypingtyping") {
        editor.commands.insertContentAt(editor.state.doc.content.size - 1, ch);
      }
    });
    // A plain in-block keystroke is structurally null, so the sweep's only
    // non-prop trigger never fires — the whole hook costs nothing while typing.
    expect(bus.emitCount).toBe(before);
    // …and the stamp is still standing (PM reuses the MarkViewDesc).
    expect(spanFor(editor, ARCHIVED_ANCHOR).getAttribute(DATA_ANCHOR_ARCHIVED)).toBe(
      "true",
    );

    hook.unmount();
    editor.destroy();
    element.remove();
  });
});

// ── M5: hover / selection from the Archives view ────────────────────────────

describe("useAnchorHighlightReconciler — an archived card paints no IN-DOCUMENT chrome", () => {
  afterEach(() => {
    act(() => {
      cardStore.setHover(null);
      cardStore.clearSelection();
    });
  });

  function collectionsFor(archived: boolean): EntityCollectionSlots {
    return {
      notes: [
        { id: ARCHIVED_CARD, ...(archived ? { archived: true } : {}), links: [makeLink(ARCHIVED_ANCHOR, ARCHIVED_CARD)] },
        { id: ACTIVE_CARD, links: [makeLink(ACTIVE_ANCHOR, ACTIVE_CARD)] },
      ],
      highlights: [],
      cutterCards: [],
      comments: [],
      todoItems: [],
      archiveSnippets: [],
      reportCards: [],
      examples: [],
    };
  }

  it("hovering an ARCHIVED card from the Archives view paints NO wash (M5)", async () => {
    const { editor, element } = mountTwoAnchors();
    const recon = renderHook(() =>
      useAnchorHighlightReconciler({
        editor,
        collections: collectionsFor(true),
        store: cardStore,
        panelSides: {},
        archivedCardIds: new Set([ARCHIVED_CARD]),
      }),
    );
    await waitForEditorInit(editor);
    act(() => {
      cardStore.setHover({ kind: "note", id: ARCHIVED_CARD });
    });
    expect(spanFor(editor, ARCHIVED_ANCHOR).getAttribute("data-card-hovered")).toBeNull();

    recon.unmount();
    editor.destroy();
    element.remove();
  });

  it("CONTROL — hovering an ACTIVE card still paints, in the same document", async () => {
    const { editor, element } = mountTwoAnchors();
    const recon = renderHook(() =>
      useAnchorHighlightReconciler({
        editor,
        collections: collectionsFor(true),
        store: cardStore,
        panelSides: {},
        archivedCardIds: new Set([ARCHIVED_CARD]),
      }),
    );
    await waitForEditorInit(editor);
    act(() => {
      cardStore.setHover({ kind: "note", id: ACTIVE_CARD });
    });
    expect(spanFor(editor, ACTIVE_ANCHOR).getAttribute("data-card-hovered")).toBe("true");

    recon.unmount();
    editor.destroy();
    element.remove();
  });

  it("selection is gated too, and un-archiving restores the paint", async () => {
    const { editor, element } = mountTwoAnchors();
    const recon = renderHook(
      ({ archived }: { archived: ReadonlySet<string> }) =>
        useAnchorHighlightReconciler({
          editor,
          collections: collectionsFor(archived.size > 0),
          store: cardStore,
          panelSides: {},
          archivedCardIds: archived,
        }),
      { initialProps: { archived: new Set([ARCHIVED_CARD]) as ReadonlySet<string> } },
    );
    await waitForEditorInit(editor);
    act(() => {
      cardStore.select({ kind: "note", id: ARCHIVED_CARD });
    });
    expect(spanFor(editor, ARCHIVED_ANCHOR).getAttribute("data-card-selected")).toBeNull();

    act(() => {
      recon.rerender({ archived: NONE_ARCHIVED });
    });
    expect(spanFor(editor, ARCHIVED_ANCHOR).getAttribute("data-card-selected")).toBe(
      "true",
    );

    recon.unmount();
    editor.destroy();
    element.remove();
  });
});

// ── The leg with teeth: the CENSUS ──────────────────────────────────────────
//
// The authority was never the part that could misbehave — a surface that draws
// anchor chrome without asking it is, and that type-checks perfectly. Task 476's
// finding one surface over, so the same instrument.

describe("census — every archived answer comes from the ONE authority", () => {
  const ROOT = join(__dirname, "..", "..", "..", "..");
  const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

  it("EditorPane derives BOTH projections from the authority and hand-rolls neither", () => {
    const src = read("src/components/EditorPane.tsx");
    expect(src).toContain('from "@/links/_shared/archived-anchor-chrome"');
    expect(src).toContain("archivedCardIds(archivableCollections)");
    expect(src).toContain("archivedAnchorIds(archivableCollections)");
    // The retired hand-rolled loop — `for (const c of arr) if (c.archived) …`
    // — must not come back anywhere in the pane.
    expect(src).not.toMatch(/if\s*\(c\.archived\)/);
  });

  it("the DOM-keyed sweep reaches EditorLayout from PaneState, never a second derivation", () => {
    const layout = read("src/components/EditorLayout.tsx");
    expect(layout).toContain("archivedAnchorIds: paneState?.archivedAnchorIds");
    // EditorLayout holds no `archived` fact of its own: it must not build one.
    expect(layout).not.toContain("archivedCardIds(");
    expect(layout).not.toContain("archivedAnchorIds(");
  });

  it("the in-document reconciler is handed the SAME set the margin markers read", () => {
    const src = read("src/components/EditorPane.tsx");
    expect(src).toMatch(/archivedCardIds:\s*archivedIds/);
    // …and the margin surfaces still read it too, so the three cannot drift.
    expect(src).toContain("!archivedIds.has(m.entityId)");
    expect(src).toContain("m.unanchored && !archivedIds.has(m.entityId)");
  });

  it("the CSS rule exists, is !important, and sits AFTER every other .linked-anchor background", () => {
    const css = read("src/app/globals.css");
    const at = css.indexOf('.linked-anchor[data-anchor-archived="true"]');
    expect(at).toBeGreaterThan(-1);
    // `!important` is required, not stylistic — the tint band carries one.
    const rule = css.slice(at, css.indexOf("}", at));
    expect(rule).toContain("background: none !important");
    expect(rule).toContain("--link-anchor-color: transparent");
    // Position is load-bearing: two `!important` declarations at equal
    // specificity are resolved by SOURCE ORDER, so a rule placed above the
    // tint band would lose to it and M2 would still paint.
    expect(at).toBeGreaterThan(css.indexOf(".linked-anchor[data-tint-color]"));
    expect(at).toBeGreaterThan(css.indexOf('[data-show-hl-note="true"]'));
    expect(at).toBeGreaterThan(css.indexOf('.linked-anchor[data-card-hovered="true"]'));
  });

  it("the attribute name has ONE speller in TS (the CSS is the only other side)", () => {
    // JSX/CSS cannot import the constant, so the contract is a two-sided pin:
    // the hook exports the name, and nothing else in src/ writes it by hand.
    const hook = read("src/links/_shared/useLinkHighlight.ts");
    expect(hook).toContain('export const DATA_ANCHOR_ARCHIVED = "data-anchor-archived"');
    const css = read("src/app/globals.css");
    expect(css).toContain("data-anchor-archived");
  });
});
