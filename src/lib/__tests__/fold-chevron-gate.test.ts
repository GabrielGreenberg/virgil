// @vitest-environment jsdom
/**
 * #29 nit-3 — fold-chevron doc-wide resync keystroke-sanctity.
 *
 * The doc-wide chevron resync (folding/unfolding a DIFFERENT section doesn't
 * trigger this heading's NodeView `update()`) is now owned by a SINGLE shared
 * plugin-view: `sectionFoldingPlugin().view()` (one pluginView per EditorView).
 * It replaced the N per-heading `editor.on("transaction")` subscribers — N
 * headings = N subscribers, ungated before #29a — that this file originally
 * targeted. The new design bails O(1) on a plain keystroke by reference-
 * comparing the `SectionFoldingState` (the apply reducer returns the SAME
 * object on a structurally-null tx, a NEW object on a real fold change), so it
 * only ever `querySelectorAll`s + repaints on an actual fold move.
 *
 * The legitimate, kept per-node path is the NodeView's own `update(node)` —
 * ProseMirror fires it only when THAT heading node changes (e.g. typing in its
 * title), so its `refreshFoldBtn()` is O(1) per affected node, not doc-size-
 * proportional.
 *
 * These tests assert the OBSERVABLE DOM effect (a chevron's `classList.toggle`,
 * its only fold-state DOM write) rather than the deleted subscriber's identity:
 * folding one heading then typing under a DIFFERENT heading must leave every
 * chevron's `classList.toggle` untouched (the shared view's reference bail),
 * while a real fold toggle DOES repaint, proving the resync still works.
 *
 * Layers tested:
 *   1. `transactionTouchesFold` predicate — false for a non-fold tx. (The
 *      predicate survives: `useEditorUIState.ts`'s fold persister still gates
 *      on it, even though the chevron resync no longer does.)
 *   2. The mounted chevron's `classList.toggle` via a spy on its button —
 *      driven now by the shared plugin-view (and the per-node `update()`),
 *      not a per-heading transaction subscriber.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Same storage stub as editor-extensions.test.ts — the extension barrel pulls
// @/lib/storage transitively (figure/graphics NodeViews) and storage.ts's
// `require("@/lib/storage-fsa")` can't be resolved by vitest. We never call any
// storage fn here, so a no-op stub is enough.
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
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import { UuidAttrDecorator } from "@/lib/tiptap/uuid-attr";
import {
  createParagraphWithTitle,
  createHeadingWithLabel,
} from "@/lib/editor-extensions";
import {
  sectionFoldingPluginKey,
  transactionTouchesFold,
} from "@/lib/section-folding";

/**
 * Two sections: heading A + its paragraph, then heading B + its paragraph.
 * Folding A and typing in B's paragraph exercises the shared plugin-view's
 * doc-wide resync path (A's node never changes) without touching A's
 * `update()`. `createHeadingWithLabel({ surface: "main" })` installs
 * `sectionFoldingPlugin()` (its `addProseMirrorPlugins`), so the editor's
 * `EditorView` runs the shared `view()` under test.
 */
function buildTwoSectionEditor() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        heading: false,
        paragraph: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        dropcursor: false,
      }),
      DocStructureObserver,
      // Stamps `data-uuid` on each heading wrapper, exactly as the real
      // editor does — the shared plugin-view's resync resolves a chevron's
      // section via `closest('[data-uuid]')`, so without this the resync
      // would see every chevron as unfolded.
      UuidAttrDecorator,
      createParagraphWithTitle(),
      createHeadingWithLabel({}, { surface: "main" }),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, uuid: "h-A" },
          content: [{ type: "text", text: "Alpha" }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "p-A" },
          content: [{ type: "text", text: "Body A" }],
        },
        {
          type: "heading",
          attrs: { level: 1, uuid: "h-B" },
          content: [{ type: "text", text: "Beta" }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "p-B" },
          content: [{ type: "text", text: "Body B" }],
        },
      ],
    },
  });
  return { editor, el };
}

/** Wrap a chevron button's classList.toggle with a spy (preserving behavior). */
function spyChevron(btn: HTMLButtonElement) {
  const spy = vi.fn();
  const real = btn.classList.toggle.bind(btn.classList);
  btn.classList.toggle = ((...args: Parameters<DOMTokenList["toggle"]>) => {
    spy(...args);
    return real(...args);
  }) as DOMTokenList["toggle"];
  return spy;
}

/** All mounted fold-chevron buttons, in document order. */
function chevrons(el: HTMLElement): HTMLButtonElement[] {
  return [...el.querySelectorAll<HTMLButtonElement>(".heading-fold-chevron")];
}

/** The fold-chevron whose enclosing heading carries `data-uuid="<uuid>"`. */
function chevronForUuid(el: HTMLElement, uuid: string): HTMLButtonElement {
  const wrapper = el.querySelector<HTMLElement>(`[data-uuid="${uuid}"]`);
  const btn = wrapper?.querySelector<HTMLButtonElement>(".heading-fold-chevron");
  if (!btn) throw new Error(`no chevron for uuid ${uuid}`);
  return btn;
}

/** Position inside the LAST paragraph's text ("Body B"), an unrelated block. */
function posInLastParagraph(editor: Editor): number {
  // doc.content.size - 1 sits inside the trailing paragraph's text.
  return editor.state.doc.content.size - 1;
}

describe("#29a transactionTouchesFold predicate", () => {
  it("is false for a selection-only transaction (no doc change, no fold meta)", () => {
    const { editor } = buildTwoSectionEditor();
    const tr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 1),
    );
    expect(tr.docChanged).toBe(false);
    expect(transactionTouchesFold(tr)).toBe(false);
    editor.destroy();
  });

  it("is true for a fold-meta transaction", () => {
    const { editor } = buildTwoSectionEditor();
    const tr = editor.state.tr.setMeta(sectionFoldingPluginKey, {
      action: "toggle",
      uuid: "h-A",
    });
    expect(transactionTouchesFold(tr)).toBe(true);
    editor.destroy();
  });
});

describe("#29 nit-3 fold-chevron: shared plugin-view does ZERO work on unrelated typing", () => {
  let editor: Editor;
  let el: HTMLElement;

  beforeEach(() => {
    ({ editor, el } = buildTwoSectionEditor());
  });

  it("mounts a chevron per heading", () => {
    expect(chevrons(el)).toHaveLength(2);
    editor.destroy();
  });

  it("typing in an unrelated paragraph never refreshes any heading's chevron", () => {
    const spies = chevrons(el).map(spyChevron);
    for (let i = 0; i < 12; i++) {
      editor.view.dispatch(
        editor.state.tr.insertText("x", posInLastParagraph(editor)),
      );
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("after folding A, typing in B's paragraph leaves A's chevron untouched", () => {
    // Fold the first heading.
    editor.view.dispatch(
      editor.state.tr.setMeta(sectionFoldingPluginKey, {
        action: "toggle",
        uuid: "h-A",
      }),
    );
    // Spy AFTER the fold so we measure only subsequent typing.
    const spies = chevrons(el).map(spyChevron);
    for (let i = 0; i < 10; i++) {
      editor.view.dispatch(
        editor.state.tr.insertText("y", posInLastParagraph(editor)),
      );
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("a fold toggle DOES refresh the toggled heading's chevron", () => {
    const spies = chevrons(el).map(spyChevron);
    editor.view.dispatch(
      editor.state.tr.setMeta(sectionFoldingPluginKey, {
        action: "toggle",
        uuid: "h-A",
      }),
    );
    // At least one chevron repainted with the folded state.
    const anyFolded = spies.some((s) =>
      s.mock.calls.some((c) => c[0] === "is-folded" && c[1] === true),
    );
    expect(anyFolded).toBe(true);
    editor.destroy();
  });

  it("a fold toggle paints the toggled heading's OWN chevron via the shared view", () => {
    const aBtn = chevronForUuid(el, "h-A");
    expect(aBtn.classList.contains("is-folded")).toBe(false);
    editor.view.dispatch(
      editor.state.tr.setMeta(sectionFoldingPluginKey, {
        action: "toggle",
        uuid: "h-A",
      }),
    );
    // The shared plugin-view resolved h-A via closest('[data-uuid]') and
    // flipped its chevron — proving the resync keys off live DOM uuid, not
    // the deleted per-node subscriber.
    expect(aBtn.classList.contains("is-folded")).toBe(true);
    editor.destroy();
  });

  it("deleting an UNRELATED heading never repaints a folded survivor's chevron", () => {
    // Fold A, then prune heading B (a meta-less docChanged tx). For A's chevron
    // to stay put, TWO bails must both fire:
    //   (1) the apply reducer returns the SAME SectionFoldingState (A's folded
    //       boolean is invariant under B's removal) → the shared view's O(1)
    //       reference bail fires, so the shared view never resyncs; AND
    //   (2) deleting B DOES fire A's OWN NodeView update() — a node deletion
    //       re-walks the doc's child list, so PM calls update() on the surviving
    //       siblings — which runs refreshFoldBtn() while A's chevron is already
    //       painted folded; its live-class idempotency (folded === the live
    //       `is-folded` class) bails, so no redundant toggle.
    // So this test DOES discriminate the live-class-vs-mirror deviation: under
    // the old `lastFoldedFlag` mirror the fold paint (shared view) left the
    // mirror stale (false), so refreshFoldBtn would redundantly toggle here →
    // RED (verified). The next test exercises the SAME idempotency but fires A's
    // update() by editing A's OWN text instead of a sibling prune. (Folding A
    // itself does NOT fire A's update() — it decorates A's sibling, not A's node
    // — so the fold is painted solely by the shared view.)
    editor.view.dispatch(
      editor.state.tr.setMeta(sectionFoldingPluginKey, {
        action: "toggle",
        uuid: "h-A",
      }),
    );
    const aSpy = spyChevron(chevronForUuid(el, "h-A"));

    // Find heading B's ("Beta") top-level range and delete just that node.
    let bFrom = -1;
    let bTo = -1;
    let offset = 0;
    editor.state.doc.forEach((node) => {
      if (node.type.name === "heading" && node.attrs.uuid === "h-B") {
        bFrom = offset;
        bTo = offset + node.nodeSize;
      }
      offset += node.nodeSize;
    });
    expect(bFrom).toBeGreaterThanOrEqual(0);
    const delTr = editor.state.tr.delete(bFrom, bTo);
    expect(delTr.getMeta(sectionFoldingPluginKey)).toBeUndefined(); // meta-less
    expect(delTr.docChanged).toBe(true);
    editor.view.dispatch(delTr);

    expect(aSpy).not.toHaveBeenCalled();
    // A is still folded after the prune (its boolean never changed).
    expect(chevronForUuid(el, "h-A").classList.contains("is-folded")).toBe(true);
    editor.destroy();
  });

  it("folding then editing a heading's OWN text does not redundantly repaint its chevron (live-class idempotency)", () => {
    // The deviation this test discriminates (#29 nit-3): refreshFoldBtn keys its
    // idempotency off the LIVE `is-folded` class — the SSOT the shared view
    // writes — NOT a private `lastFoldedFlag` mirror. Folding A paints A's
    // chevron via the shared view WITHOUT firing A's NodeView update(), so a
    // private mirror would be left stale (false) after the fold. Editing A's OWN
    // heading text DOES fire A's update() → refreshFoldBtn(): reading the live
    // class (already is-folded) it does nothing, whereas a stale mirror
    // (false !== folded true) would fire a redundant toggle. Verified RED
    // against the lastFoldedFlag design; GREEN against the shipped live-class one.
    editor.view.dispatch(
      editor.state.tr.setMeta(sectionFoldingPluginKey, {
        action: "toggle",
        uuid: "h-A",
      }),
    );
    const aBtn = chevronForUuid(el, "h-A");
    expect(aBtn.classList.contains("is-folded")).toBe(true);
    const aSpy = spyChevron(aBtn);

    // Edit heading A's own text ("Alpha") → fires A's NodeView update().
    editor.view.dispatch(editor.state.tr.insertText("!", 3));
    // The edit landed inside heading A (proves A's node changed → update() ran).
    expect(editor.state.doc.firstChild?.textContent).toContain("!");
    // The NodeView reused the SAME chevron button (update(), not recreate) —
    // otherwise aSpy would trivially pass against a detached node.
    expect(chevronForUuid(el, "h-A")).toBe(aBtn);
    // Live-class idempotency: no redundant toggle, chevron still folded.
    expect(aSpy).not.toHaveBeenCalled();
    expect(aBtn.classList.contains("is-folded")).toBe(true);
    editor.destroy();
  });

  it("a setFolded load-restore tx paints the restored heading via the shared view", () => {
    // Guards the timing case where NodeViews mounted UNFOLDED before a
    // restore-from-prefs setFolded meta arrives: the shared plugin-view must
    // pick up the new state and paint h-A's chevron.
    const aBtn = chevronForUuid(el, "h-A");
    expect(aBtn.classList.contains("is-folded")).toBe(false);
    editor.view.dispatch(
      editor.state.tr.setMeta(sectionFoldingPluginKey, {
        action: "setFolded",
        uuids: ["h-A"],
      }),
    );
    expect(aBtn.classList.contains("is-folded")).toBe(true);
    editor.destroy();
  });
});
