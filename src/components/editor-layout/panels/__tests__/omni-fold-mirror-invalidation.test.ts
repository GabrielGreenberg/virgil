// @vitest-environment jsdom
//
// Task 126 — the omni fold-mirror invalidation gate.
//
// `omni-host`'s `hiddenTopLevel` memo reads `getHiddenTopLevelIndices`, which
// returns the section-folding plugin's cached `hiddenIdx`: a set of ABSOLUTE
// top-level child indices. The plugin rebuilds that set on ANY structural block
// diff — a plain (non-heading) paragraph inserted/deleted/reordered ELSEWHERE
// shifts every subsequent top-level index. The omni gate used to bump on a
// strict SUBSET (fold-meta + heading add/remove only), so a block edit while a
// section was folded left the mirror stale — mis-binning cards (ghost card
// beside a collapsed section, or a wrongly-dropped visible card) until the next
// fold toggle.
//
// `subscribeFoldMirrorInvalidation` is the fix: it MIRRORS the plugin's own
// `hiddenIdx`-rebuild trigger set (fold meta + headings + blocks
// added/removed/reordered). This test pins that contract:
//   • a block insert/delete while folded FIRES the gate AND `hiddenTopLevel`
//     shifts to the new absolute indices (the bug — pre-fix the gate stayed
//     silent);
//   • a fold toggle fires the gate;
//   • plain in-block typing fires NEITHER the gate nor a structural bus emit
//     (keystroke sanctity).
//
// Task 657 — the SECOND member of the same class. The mirror named five
// per-kind bus events by hand and `onHeadingsChanged` was not among them, so a
// uuid-CONSERVING heading level flip (the heading annotation chip's type menu:
// `setNodeMarkup`, whose diff carries `changedHeadings` and nothing else)
// rebuilt the plugin's `hiddenIdx` — the fold stack keys on `attrs.level` —
// while the mirror stayed silent: ghost cards beside folded prose, and dropped
// cards beside prose that had just been un-folded. The fix retires the list:
// the mirror asks the plugin's OWN predicate (`diffHasStructuralEntries`) over
// the bus's generic structural channel. So this file gains a BEHAVIOURAL leg
// per direction (demote-into-a-fold, promote-out-of-one) and a SOURCE CENSUS —
// the census is the leg with the teeth, because no behavioural leg can see a
// sixth hand-written event being added beside the fifth.
//
// Builds the REAL main editor stack (schema + section-folding plugin +
// DocStructureObserver) so the plugin's cached `hiddenIdx` and the bus events
// behave faithfully (the structural-edit.test.ts pattern).
import { describe, it, expect, vi } from "vitest";

// Figure / graphics / tex-block React NodeViews transitively import
// `@/lib/storage`; stub it (same pattern as structural-edit.test.ts).
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type Content } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { getBus } from "@/lib/tiptap/doc-structure";
import {
  getHiddenTopLevelIndices,
  sectionFoldingPluginKey,
} from "@/lib/section-folding";
import { headingAttrsForLevel } from "@/lib/tiptap/heading-level";
import { subscribeFoldMirrorInvalidation } from "../omni-fold-mirror-invalidation";
import { readFileSync } from "node:fs";
import path from "node:path";

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

// Top-level children (index : node):
//   0 paragraph p-intro   1 heading  sec-a (L2)   2 paragraph p-a1
//   3 paragraph p-a2      4 heading  sec-b (L2)   5 paragraph p-b1
// Folding sec-a hides indices {2,3}.
function makeContent(): Content {
  return {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { uuid: "p-intro" }, content: [{ type: "text", text: "Intro" }] },
      { type: "heading", attrs: { level: 2, uuid: "sec-a" }, content: [{ type: "text", text: "Section A" }] },
      { type: "paragraph", attrs: { uuid: "p-a1" }, content: [{ type: "text", text: "A body one" }] },
      { type: "paragraph", attrs: { uuid: "p-a2" }, content: [{ type: "text", text: "A body two" }] },
      { type: "heading", attrs: { level: 2, uuid: "sec-b" }, content: [{ type: "text", text: "Section B" }] },
      { type: "paragraph", attrs: { uuid: "p-b1" }, content: [{ type: "text", text: "B body" }] },
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

/** Fold (toggle) a top-level heading by uuid — the fold-meta transaction. */
function foldSection(editor: Editor, uuid: string) {
  editor.view.dispatch(
    editor.state.tr.setMeta(sectionFoldingPluginKey, { action: "toggle", uuid }),
  );
}

/** A uuid-bearing paragraph — anchorable, so its insert/remove hits the block diff. */
function paragraph(editor: Editor, uuid: string, text: string) {
  return editor.schema.nodes.paragraph.create({ uuid }, editor.schema.text(text));
}

function hidden(editor: Editor): number[] {
  return [...getHiddenTopLevelIndices(editor.state)].sort((a, b) => a - b);
}

/** Locate a TOP-LEVEL heading by uuid: its child index, offset and node. */
function findHeading(editor: Editor, uuid: string) {
  let found: { index: number; pos: number; node: ReturnType<Editor["state"]["doc"]["child"]> } | null =
    null;
  editor.state.doc.forEach((node, offset, index) => {
    if (node.type.name === "heading" && node.attrs?.uuid === uuid) {
      found = { index, pos: offset, node };
    }
  });
  if (!found) throw new Error(`heading ${uuid} not found`);
  return found as { index: number; pos: number; node: ReturnType<Editor["state"]["doc"]["child"]> };
}

/**
 * Change a heading's LEVEL exactly the way the heading annotation chip's type
 * menu does (`editor-extensions.ts` → `applyLevelChange`): `setNodeMarkup` with
 * the attrs door's spread, which CONSERVES the uuid. That conservation is the
 * whole mechanism — a leg written with `setBlockType` re-mints the uuid,
 * fires `onHeadingsRemoved`, and passes pre-fix while proving nothing.
 */
function setHeadingLevelLikeChip(editor: Editor, uuid: string, level: number) {
  const { pos, node } = findHeading(editor, uuid);
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(
      pos,
      undefined,
      headingAttrsForLevel(node, editor.schema.nodes.heading, level),
    ),
  );
}

describe("subscribeFoldMirrorInvalidation — the fold-mirror gate", () => {
  it("bumps AND shifts hiddenTopLevel when a block is INSERTED earlier while folded (task 126, insert direction)", () => {
    const { editor, cleanup } = mount();
    try {
      foldSection(editor, "sec-a");
      expect(hidden(editor)).toEqual([2, 3]);

      const bump = vi.fn();
      const unsub = subscribeFoldMirrorInvalidation(editor, bump);
      try {
        // Insert a plain top-level paragraph at the very top — NOT a fold-meta
        // tx and NOT a heading change, so the pre-fix headings-only gate stayed
        // silent. Every subsequent top-level index shifts by +1.
        editor.view.dispatch(editor.state.tr.insert(0, paragraph(editor, "p-new", "New top")));

        // THE BUG: pre-fix `bump` was never called here (headings-only gate).
        expect(bump).toHaveBeenCalled();
        // And the freshly-read set reflects the shifted indices — proving the
        // consumer's memo would have been stale had it not re-read.
        expect(hidden(editor)).toEqual([3, 4]);
      } finally {
        unsub();
      }
    } finally {
      cleanup();
    }
  });

  it("bumps AND shifts hiddenTopLevel when a block is DELETED earlier while folded (delete direction, previously unmasked)", () => {
    const { editor, cleanup } = mount();
    try {
      foldSection(editor, "sec-a");
      expect(hidden(editor)).toEqual([2, 3]);

      const bump = vi.fn();
      const unsub = subscribeFoldMirrorInvalidation(editor, bump);
      try {
        // Delete the leading paragraph (index 0). Everything shifts by -1.
        const introSize = editor.state.doc.child(0).nodeSize;
        editor.view.dispatch(editor.state.tr.delete(0, introSize));

        expect(bump).toHaveBeenCalled();
        expect(hidden(editor)).toEqual([1, 2]);
      } finally {
        unsub();
      }
    } finally {
      cleanup();
    }
  });

  it("bumps AND extends hiddenTopLevel when a following heading is DEMOTED into the fold (task 657, uuid-conserving level flip)", () => {
    const { editor, cleanup } = mount();
    try {
      foldSection(editor, "sec-a");
      expect(hidden(editor)).toEqual([2, 3]);

      const bus = getBus(editor);
      const bump = vi.fn();
      const unsub = subscribeFoldMirrorInvalidation(editor, bump);
      try {
        const uuidBefore = findHeading(editor, "sec-b").node.attrs.uuid;
        // The chip's own spelling — L2 → L3. sec-b now sits UNDER folded sec-a,
        // so the plugin's fold stack swallows it and its body: {2,3} → {2,3,4,5}.
        setHeadingLevelLikeChip(editor, "sec-b", 3);

        // Non-vacuity: the uuid was CONSERVED, so this really is the
        // `changedHeadings`-only diff — not a re-mint that any of the five
        // legacy events would have caught.
        const after = findHeading(editor, "sec-b");
        expect(after.node.attrs.uuid).toBe(uuidBefore);
        expect(after.node.attrs.level).toBe(3);

        // THE BUG: pre-fix `bump` was never called here (no `onHeadingsChanged`
        // in the hand-written list), so the consumer's memo kept serving {2,3}
        // and the cards anchored at indices 4/5 stayed in the gutter beside
        // prose that had just gone off screen.
        expect(bump).toHaveBeenCalled();
        expect(hidden(editor)).toEqual([2, 3, 4, 5]);
        expect(bus!.emitCount).toBeGreaterThan(0);
      } finally {
        unsub();
      }
    } finally {
      cleanup();
    }
  });

  it("bumps AND shrinks hiddenTopLevel when a swallowed heading is PROMOTED out of the fold (task 657, the mirror direction)", () => {
    const { editor, cleanup } = mount();
    try {
      // Put sec-b at L3 FIRST (before subscribing), then fold sec-a — so the
      // starting state is "sec-b and its body are hidden".
      setHeadingLevelLikeChip(editor, "sec-b", 3);
      foldSection(editor, "sec-a");
      expect(hidden(editor)).toEqual([2, 3, 4, 5]);

      const bump = vi.fn();
      const unsub = subscribeFoldMirrorInvalidation(editor, bump);
      try {
        const uuidBefore = findHeading(editor, "sec-b").node.attrs.uuid;
        // Promote back to L2: sec-b closes sec-a's fold, so it and its body
        // come back on screen — {2,3,4,5} → {2,3}. Pre-fix the omni mirror kept
        // DROPPING those cards from the cascade although their prose was visible.
        setHeadingLevelLikeChip(editor, "sec-b", 2);

        expect(findHeading(editor, "sec-b").node.attrs.uuid).toBe(uuidBefore);
        expect(bump).toHaveBeenCalled();
        expect(hidden(editor)).toEqual([2, 3]);
      } finally {
        unsub();
      }
    } finally {
      cleanup();
    }
  });

  it("bumps on a fold-toggle transaction (the fold-meta path)", () => {
    const { editor, cleanup } = mount();
    try {
      const bump = vi.fn();
      const unsub = subscribeFoldMirrorInvalidation(editor, bump);
      try {
        foldSection(editor, "sec-a");
        expect(bump).toHaveBeenCalled();
        expect(hidden(editor)).toEqual([2, 3]);
      } finally {
        unsub();
      }
    } finally {
      cleanup();
    }
  });

  it("stays SILENT on plain in-block typing — keystroke sanctity (no gate bump, no structural emit)", () => {
    const { editor, cleanup } = mount();
    try {
      foldSection(editor, "sec-a");
      const bus = getBus(editor);
      expect(bus).not.toBeNull();

      const bump = vi.fn();
      const unsub = subscribeFoldMirrorInvalidation(editor, bump);
      try {
        // A stable text position inside a non-folded paragraph (p-b1).
        let typePos: number | null = null;
        editor.state.doc.descendants((node, pos) => {
          if (node.isText && node.text === "B body") {
            typePos = pos + 1;
            return false;
          }
          return true;
        });
        expect(typePos).not.toBeNull();

        // Warm-up keystroke, then measure steady state (structural-edit pattern).
        editor.view.dispatch(editor.state.tr.insertText("a", typePos!));
        const emitBefore = bus!.emitCount;
        bump.mockClear();
        for (let i = 0; i < 8; i++) {
          editor.view.dispatch(editor.state.tr.insertText("a", typePos! + 1 + i));
        }
        // Plain typing fired ZERO structural emits and ZERO gate bumps.
        expect(bus!.emitCount).toBe(emitBefore);
        expect(bump).not.toHaveBeenCalled();
        // The fold set is unchanged by the typing.
        expect(hidden(editor)).toEqual([2, 3]);
      } finally {
        unsub();
      }
    } finally {
      cleanup();
    }
  });

  it("detaches every listener on unsubscribe", () => {
    const { editor, cleanup } = mount();
    try {
      const bump = vi.fn();
      const unsub = subscribeFoldMirrorInvalidation(editor, bump);
      unsub();
      // Post-unsub: neither a fold toggle nor a block insert reaches the gate.
      foldSection(editor, "sec-a");
      editor.view.dispatch(editor.state.tr.insert(0, paragraph(editor, "p-new2", "Another")));
      expect(bump).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// The leg with the teeth (task 657). Both members of this class were "the list
// beside the predicate lost a member": task 126 added three events to it, 657
// found a fourth missing. No behavioural leg can see a sixth being added, so
// the census holds the SHAPE — the mirror asks the plugin's predicate, and
// names no per-kind bus event at all.
// ---------------------------------------------------------------------------
describe("fold-mirror invalidation is DERIVED, not re-listed (task 657 census)", () => {
  const ROOT = path.resolve(__dirname, "../../../..");
  const MODULE_PATH = path.join(
    ROOT,
    "components/editor-layout/panels/omni-fold-mirror-invalidation.ts",
  );

  /** Source with comments stripped — the header legitimately NAMES the retired
   *  events while explaining why they are gone; only executable code counts. */
  function code(): string {
    return readFileSync(MODULE_PATH, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  it("subscribes to NO per-kind bus event — the only bus subscription is the generic structural channel", () => {
    const methods = [...code().matchAll(/\.on([A-Z]\w*)\s*\(/g)].map((m) => `on${m[1]}`);
    // If this fails, someone re-opened the hand-maintained list. The trigger
    // set is `diffHasStructuralEntries`; extend THAT, not a list beside it.
    expect([...new Set(methods)]).toEqual(["onAnyChange"]);
  });

  it("gates that channel on the section-folding plugin's own rebuild predicate", () => {
    expect(code()).toContain("diffHasStructuralEntries");
  });

  it("still owns the fold-meta transaction subscriber (no bus event covers it)", () => {
    expect(code()).toContain("sectionFoldingPluginKey");
    expect(code()).toMatch(/editor\.on\(\s*["']transaction["']/);
  });

  it("the plugin it mirrors still rebuilds on that same predicate", () => {
    const plugin = readFileSync(path.join(ROOT, "lib/section-folding.ts"), "utf8");
    // If section-folding stops calling `diffHasStructuralEntries`, the mirror's
    // derivation is no longer a derivation — it is a new hand-written guess.
    expect(plugin).toContain("diffHasStructuralEntries(diff)");
  });
});
