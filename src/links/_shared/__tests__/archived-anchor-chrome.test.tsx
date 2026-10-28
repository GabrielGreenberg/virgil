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

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

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
  archivedAnchorCss,
  DATA_ARCHIVED_ANCHOR_STYLE,
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

/** Every selector the live archived `<style>` sheets carry. */
function archivedSelectors(): string[] {
  const out: string[] = [];
  for (const el of document.querySelectorAll(`style[${DATA_ARCHIVED_ANCHOR_STYLE}]`)) {
    const sheet = (el as HTMLStyleElement).sheet;
    if (!sheet) continue;
    for (const rule of Array.from(sheet.cssRules)) {
      if ("selectorText" in rule) out.push((rule as CSSStyleRule).selectorText);
    }
  }
  return out;
}

/**
 * Is EVERY `.linked-anchor` span of `anchorId`'s passage matched by the
 * archived rule? Task 1331: "archived" is a per-pane stylesheet rule that
 * SELECTS the spans by id — so the question is asked of the real CSS engine
 * (`Element.matches`) for every span the editor rendered. A mark split renders
 * the passage as SEVERAL spans: "all" only when every one is matched, "none"
 * when none is, "partial" otherwise (the bug the old stamp had).
 */
function archivedCoverage(editor: Editor, anchorId: string): "all" | "none" | "partial" {
  const spans = editor.view.dom.querySelectorAll(
    `.linked-anchor[data-link-id="${anchorId}"]`,
  );
  if (spans.length === 0) throw new Error(`no .linked-anchor span for ${anchorId}`);
  const selectors = archivedSelectors();
  let covered = 0;
  for (const span of spans) {
    if (selectors.some((sel) => span.matches(sel))) covered++;
  }
  if (covered === spans.length) return "all";
  if (covered === 0) return "none";
  return "partial";
}

/** Let the coalesced microtask repaint (bus-emit-driven rebuilds) land. */
async function flushRepaint(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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

// ── The paint (M1–M4: the persistent washes and the tint band) ───────────────

describe("useLinkHighlight — the archived-chrome sweep", () => {
  it("stamps data-anchor-archived on the ARCHIVED span only, and clears it on unarchive", () => {
    const { editor, element } = mountTwoAnchors();

    const hook = renderHook(
      ({ archived }: { archived: ReadonlySet<string> }) =>
        useLinkHighlight({
          editor,
          visibleHighlightKinds: NO_KINDS,
          archivedAnchorIds: archived,
        }),
      { initialProps: { archived: new Set([ARCHIVED_ANCHOR]) as ReadonlySet<string> } },
    );

    expect(archivedCoverage(editor, ARCHIVED_ANCHOR)).toBe("all");
    // The CONTROL: the active card's span in the SAME paragraph is untouched.
    expect(archivedCoverage(editor, ACTIVE_ANCHOR)).toBe("none");

    // Unarchive → the stamp comes off. (Restoring a card restores its chrome.)
    hook.rerender({ archived: NONE_ARCHIVED });
    expect(archivedCoverage(editor, ARCHIVED_ANCHOR)).toBe("none");

    hook.unmount();
    editor.destroy();
    element.remove();
  });

  it("one sheet per pane, one selector per archived id, and no DOM writes on PM-owned spans (task 1331, was 937)", () => {
    // Task 937 bounded the old imperative sweep at one root query; task 1331
    // retired the sweep. The hook neither queries nor stamps the editor's
    // spans: it writes ONE <style> whose rule selects the archived ids, scoped
    // to its own editor root.
    const { editor, element } = mountTwoAnchors();
    const spy = vi.spyOn(editor.view.dom, "querySelectorAll");
    const many = new Set([ARCHIVED_ANCHOR]);
    for (let i = 0; i < 50; i++) many.add(`ghost-${i}`);
    const hook = renderHook(() =>
      useLinkHighlight({
        editor,
        visibleHighlightKinds: NO_KINDS,
        archivedAnchorIds: many,
      }),
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(document.querySelectorAll(`style[${DATA_ARCHIVED_ANCHOR_STYLE}]`)).toHaveLength(1);
    expect(archivedSelectors()).toHaveLength(1); // one rule, a selector LIST
    expect(archivedCoverage(editor, ARCHIVED_ANCHOR)).toBe("all");
    // Nothing is stamped on the span itself — PM owns it.
    const span = spanFor(editor, ARCHIVED_ANCHOR);
    expect([...span.attributes].map((a) => a.name).filter((n) => n.includes("archived"))).toEqual([]);

    // Unmount takes the sheet with it.
    hook.unmount();
    expect(document.querySelectorAll(`style[${DATA_ARCHIVED_ANCHOR_STYLE}]`)).toHaveLength(0);
    editor.destroy();
    element.remove();
  });

  it("a pane's rule never reaches another pane's spans (multi-doc keep-alive)", () => {
    const a = mountTwoAnchors();
    const b = mountTwoAnchors();
    const hook = renderHook(() =>
      useLinkHighlight({
        editor: a.editor,
        visibleHighlightKinds: NO_KINDS,
        archivedAnchorIds: new Set([ARCHIVED_ANCHOR]),
      }),
    );
    expect(archivedCoverage(a.editor, ARCHIVED_ANCHOR)).toBe("all");
    // Same anchor id in the OTHER pane's document — not archived there.
    expect(archivedCoverage(b.editor, ARCHIVED_ANCHOR)).toBe("none");
    hook.unmount();
    for (const m of [a, b]) {
      m.editor.destroy();
      m.element.remove();
    }
  });

  it("an anchor id cannot break out of the selector it sits in", () => {
    const css = archivedAnchorCss("a1", new Set(['x"] , body { color: red } [y="']));
    expect(css).not.toBeNull();
    // The whole string must parse as ONE rule over `.linked-anchor` spans.
    const style = document.createElement("style");
    style.textContent = css!;
    document.head.appendChild(style);
    const rules = Array.from(style.sheet!.cssRules) as CSSStyleRule[];
    expect(rules).toHaveLength(1);
    expect(rules[0].selectorText).toContain(".linked-anchor");
    // It matches a span carrying exactly that hostile id under the scope…
    const root = document.createElement("div");
    root.setAttribute("data-archived-anchor-scope", "a1");
    const span = document.createElement("span");
    span.className = "linked-anchor";
    span.setAttribute("data-link-id", 'x"] , body { color: red } [y="');
    root.appendChild(span);
    expect(span.matches(rules[0].selectorText)).toBe(true);
    // …and nothing outside it: the id did not open a selector of its own.
    expect(document.body.matches(rules[0].selectorText)).toBe(false);
    style.remove();
    expect(archivedAnchorCss("a1", new Set())).toBeNull();
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
        visibleHighlightKinds: NO_KINDS,
        archivedAnchorIds: new Set([ARCHIVED_ANCHOR]),
      }),
    );
    expect(archivedCoverage(editor, ARCHIVED_ANCHOR)).toBe("all");

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
        visibleHighlightKinds: NO_KINDS,
        archivedAnchorIds: new Set([ARCHIVED_ANCHOR]),
      }),
    );
    await waitForEditorInit(editor);
    expect(archivedCoverage(editor, ARCHIVED_ANCHOR)).toBe("all");

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
    await flushRepaint();

    // Premise: the span really was recreated (or this leg proves nothing).
    expect(spanFor(editor, ARCHIVED_ANCHOR)).not.toBe(before);
    expect(archivedCoverage(editor, ARCHIVED_ANCHOR)).toBe("all");
    expect(archivedCoverage(editor, ACTIVE_ANCHOR)).toBe("none");

    hook.unmount();
    editor.destroy();
    element.remove();
  });

  it("KEYSTROKE SANCTITY — typing plain characters leaves the bus emitCount flat", async () => {
    const { editor, element } = mountTwoAnchors();
    const hook = renderHook(() =>
      useLinkHighlight({
        editor,
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
    // A plain in-block keystroke is structurally null, and the archived set
    // is unchanged, so the hook does nothing at all while typing.
    // non-prop trigger never fires — the sheet is not touched.
    expect(bus.emitCount).toBe(before);
    // …and the passage is still covered.
    expect(archivedCoverage(editor, ARCHIVED_ANCHOR)).toBe("all");

    hook.unmount();
    editor.destroy();
    element.remove();
  });
});

// ── Task 1331: a MARK SPLIT re-mints the span DOM with no structural emit ────

describe("useLinkHighlight — the archived paint survives a mark split (task 1331)", () => {
  for (const [label, markName] of [
    ["bolding", "bold"],
    ["italicizing", "italic"],
  ] as const) {
    it(`${label} a sub-range of an ARCHIVED passage leaves the whole passage un-washed`, async () => {
      const { editor, element } = mountTwoAnchors();
      const hook = renderHook(
        ({ archived }: { archived: ReadonlySet<string> }) =>
          useLinkHighlight({
            editor,
            visibleHighlightKinds: NO_KINDS,
            archivedAnchorIds: archived,
          }),
        { initialProps: { archived: new Set([ARCHIVED_ANCHOR]) as ReadonlySet<string> } },
      );
      await waitForEditorInit(editor);
      expect(archivedCoverage(editor, ARCHIVED_ANCHOR)).toBe("all");

      const { getBus } = await import("@/lib/tiptap/doc-structure");
      const bus = getBus(editor);
      if (!bus) throw new Error("no DocStructureBus on the main stack");
      const before = bus.emitCount;

      // "alpha" = [1, 6): mark "lp" = [2, 4). `LinkedAnchor` ranks after
      // StarterKit, so the new mark nests OUTSIDE it and PM renders the passage
      // as three `.linked-anchor` spans — fresh DOM for the split fragments.
      const type = editor.schema.marks[markName];
      if (!type) throw new Error(`${markName} mark missing`);
      act(() => {
        editor.view.dispatch(editor.state.tr.addMark(2, 4, type.create()));
      });
      // Premise: the split really happened, and it woke no structural watcher —
      // the exact shape the old `onAnyChange` sweep could not see.
      expect(
        editor.view.dom.querySelectorAll(`.linked-anchor[data-link-id="${ARCHIVED_ANCHOR}"]`)
          .length,
      ).toBeGreaterThan(1);
      expect(bus.emitCount).toBe(before);

      expect(archivedCoverage(editor, ARCHIVED_ANCHOR)).toBe("all");
      expect(archivedCoverage(editor, ACTIVE_ANCHOR)).toBe("none");

      // Unarchive → the wash comes back on EVERY fragment.
      hook.rerender({ archived: NONE_ARCHIVED });
      expect(archivedCoverage(editor, ARCHIVED_ANCHOR)).toBe("none");

      hook.unmount();
      editor.destroy();
      element.remove();
    });
  }

  it("an archived anchor that RE-ENTERS the document (undo of its deletion) is repainted", async () => {
    const { editor, element } = mountTwoAnchors();
    const hook = renderHook(() =>
      useLinkHighlight({
        editor,
        visibleHighlightKinds: NO_KINDS,
        archivedAnchorIds: new Set([ARCHIVED_ANCHOR]),
      }),
    );
    await waitForEditorInit(editor);
    // Delete the whole passage…
    act(() => {
      editor.view.dispatch(editor.state.tr.delete(1, 6));
    });
    await flushRepaint();
    // …and undo it: the re-minted span is matched by the rule like any other.
    act(() => {
      editor.commands.undo();
    });
    await flushRepaint();
    expect(archivedCoverage(editor, ARCHIVED_ANCHOR)).toBe("all");

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

  it("the DOM-keyed sweep runs IN the pane that owns the set, never a second derivation", () => {
    // Task 1316: the sweep (`useLinkHighlight`) moved from EditorLayout into
    // EditorPane, so the set no longer bubbles through PaneState at all — and a
    // shell-less host (the Library Reader) gets the sweep too.
    const pane = read("src/components/EditorPane.tsx");
    expect(pane).toMatch(/useLinkHighlight\(\{[\s\S]*?archivedAnchorIds:\s*archivedAnchorIdSet/);
    expect(pane).not.toMatch(/^\s*archivedAnchorIds:\s*ReadonlySet<string>;/m);
    const layout = read("src/components/EditorLayout.tsx");
    expect(layout).not.toContain("paneState?.archivedAnchorIds");
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

  it("the archived rule is !important and OUT-SPECIFIES every !important .linked-anchor background", () => {
    // Task 1331: the rule is GENERATED per pane (`archivedAnchorCss`) — it
    // selects spans by anchor id — so the pin moves from globals.css to it.
    const rule = archivedAnchorCss("a1", new Set(["x"]))!;
    // `!important` is required, not stylistic — the tint band carries one.
    expect(rule).toContain("background: none !important");
    expect(rule).toContain("--link-anchor-color: transparent !important");
    expect(rule).toContain("box-shadow: none !important");
    // A `<style>` appended at runtime cannot promise SOURCE ORDER against the
    // bundler's stylesheet, so the win must come from specificity: count
    // (class + attribute) selectors — none of these rules use ids.
    const weight = (sel: string) => (sel.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length;
    const ours = weight(rule.slice(0, rule.indexOf("{")));
    const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rivals: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/background[^;]*!important/.test(m[2])) continue;
      for (const sel of m[1].split(",")) {
        if (sel.includes(".linked-anchor")) rivals.push(sel.trim());
      }
    }
    // Premise: the tint band is one of them (or this leg proves nothing).
    expect(rivals).toContain(".linked-anchor[data-tint-color]");
    for (const sel of rivals) expect(weight(sel)).toBeLessThan(ours);
  });

  it("globals.css carries no stamped archived selector any more", () => {
    // The stamp is what a mark split shed; it must not come back as a rule
    // that something would then have to stamp.
    const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toContain("data-anchor-archived");
    const hook = read("src/links/_shared/useLinkHighlight.ts");
    expect(hook).not.toMatch(/setAttribute\(\s*DATA_ANCHOR_ARCHIVED/);
  });
});
