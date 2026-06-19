import { describe, expect, it } from "vitest";
import { EditorState, Plugin } from "@tiptap/pm/state";
import {
  buildInitial,
  applyDiff,
  docStructureKey,
  EMPTY_DIFF,
  inspectSteps,
} from "@/lib/tiptap/doc-structure";
import {
  __getFocusRebuildCount,
  type FocusBand,
  focusViewPlugin,
  focusViewPluginKey,
  isPosInFocusBand,
  isUuidInFocusBand,
  resolveFocusBand,
  setFocusBandMeta,
} from "@/lib/focus-view";
import {
  doc,
  heading,
  paragraph,
  testSchema,
} from "@/lib/tiptap/doc-structure/__tests__/fixtures";

function band(partial: Partial<FocusBand>): FocusBand {
  return { active: true, locked: false, startUuid: null, endUuid: null, ...partial };
}

// CHIP A: only a LOCKED band confines (the focusViewPlugin hides out-of-band
// blocks only when `bandConfines` = active && locked). A mere focus SELECTION
// (active && !locked) hides nothing. The plugin-decoration tests below assert
// the hide, so they must use a locked band.
function lockedBand(partial: Partial<FocusBand>): FocusBand {
  return band({ locked: true, ...partial });
}

// A four-block doc: h0, p1, p2, p3 (indices 0..3).
function fourBlockDoc() {
  return doc(
    heading("h0", 1, "Title"),
    paragraph("p1", "alpha"),
    paragraph("p2", "beta"),
    paragraph("p3", "gamma"),
  );
}

describe("resolveFocusBand", () => {
  it("resolves named start + end anchors to inclusive indices", () => {
    const d = fourBlockDoc();
    expect(resolveFocusBand(d, band({ startUuid: "p1", endUuid: "p2" }))).toEqual({
      startIdx: 1,
      endIdx: 2,
    });
  });

  it("null anchors are doc-start / doc-end sentinels", () => {
    const d = fourBlockDoc();
    expect(resolveFocusBand(d, band({ startUuid: null, endUuid: null }))).toEqual({
      startIdx: 0,
      endIdx: 3,
    });
    expect(resolveFocusBand(d, band({ startUuid: "p2", endUuid: null }))).toEqual({
      startIdx: 2,
      endIdx: 3,
    });
  });

  it("returns null for an inactive band", () => {
    const d = fourBlockDoc();
    expect(resolveFocusBand(d, band({ active: false, startUuid: "p1", endUuid: "p2" }))).toBeNull();
  });

  it("returns null when a named anchor is gone (dead → degrade to show all)", () => {
    const d = fourBlockDoc();
    expect(resolveFocusBand(d, band({ startUuid: "ghost", endUuid: "p2" }))).toBeNull();
    expect(resolveFocusBand(d, band({ startUuid: "p1", endUuid: "ghost" }))).toBeNull();
  });

  it("swaps inverted anchors rather than producing an empty/negative range", () => {
    const d = fourBlockDoc();
    expect(resolveFocusBand(d, band({ startUuid: "p3", endUuid: "p1" }))).toEqual({
      startIdx: 1,
      endIdx: 3,
    });
  });
});

describe("isPosInFocusBand / isUuidInFocusBand", () => {
  it("tests a pos against the resolved band", () => {
    const d = fourBlockDoc();
    const b = band({ startUuid: "p1", endUuid: "p2" });
    // h0 spans [0, .], p1 starts at h0.nodeSize. Resolve via the block's pos.
    const p1Pos = d.child(0).nodeSize; // start of p1
    const h0Pos = 0;
    expect(isPosInFocusBand(d, b, p1Pos + 1)).toBe(true); // inside p1
    expect(isPosInFocusBand(d, b, h0Pos)).toBe(false); // h0 is out of band
  });

  it("no active band → not in band", () => {
    const d = fourBlockDoc();
    expect(isPosInFocusBand(d, band({ active: false }), 1)).toBe(false);
  });

  it("tests a uuid against the resolved band", () => {
    const d = fourBlockDoc();
    const b = band({ startUuid: "p1", endUuid: "p2" });
    expect(isUuidInFocusBand(d, b, "p1")).toBe(true);
    expect(isUuidInFocusBand(d, b, "p2")).toBe(true);
    expect(isUuidInFocusBand(d, b, "h0")).toBe(false);
    expect(isUuidInFocusBand(d, b, "p3")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Plugin: rebuild-vs-map keystroke sanctity.
// ---------------------------------------------------------------------------

/**
 * A minimal observer plugin mirroring the real one's STATE spec (init +
 * apply) using the same exported pieces, so `readPendingDiff` returns real
 * diffs. We don't need the bus/view side or position remapping here — the
 * focus plugin reads only `pendingDiff` and resolves the band off the live doc.
 */
function minimalObserverPlugin() {
  return new Plugin({
    key: docStructureKey,
    state: {
      init: (_c: unknown, state: EditorState) => ({
        structure: buildInitial(state.doc),
        pendingDiff: null,
      }),
      apply(tr: import("@tiptap/pm/state").Transaction, prev: { structure: ReturnType<typeof buildInitial>; pendingDiff: unknown }) {
        if (!tr.docChanged) {
          return prev.pendingDiff !== null
            ? { structure: prev.structure, pendingDiff: null }
            : prev;
        }
        const diff = inspectSteps(tr, tr.before, tr.doc, prev.structure);
        if (diff === EMPTY_DIFF) {
          return { structure: prev.structure, pendingDiff: null };
        }
        return { structure: applyDiff(prev.structure, diff), pendingDiff: diff };
      },
    },
  });
}

function stateWithFocus() {
  return EditorState.create({
    schema: testSchema,
    doc: fourBlockDoc(),
    plugins: [minimalObserverPlugin(), focusViewPlugin()],
  });
}

function decoCount(state: EditorState): number {
  const decoSet = focusViewPluginKey.getState(state)?.decoSet;
  return decoSet ? decoSet.find().length : 0;
}

describe("focusViewPlugin — decoration set", () => {
  it("locking a band hides exactly the out-of-band top-level blocks", () => {
    let state = stateWithFocus();
    expect(decoCount(state)).toBe(0); // no band yet
    state = state.apply(setFocusBandMeta(state.tr, lockedBand({ startUuid: "p1", endUuid: "p2" })));
    // Out of band: h0 (0) and p3 (3) → 2 hidden.
    expect(decoCount(state)).toBe(2);
  });

  it("CHIP A: an unlocked (active-only) band hides NOTHING", () => {
    let state = stateWithFocus();
    // A mere focus SELECTION is a preference — it confines nothing in the
    // editor, so no out-of-band block is hidden.
    state = state.apply(setFocusBandMeta(state.tr, band({ startUuid: "p1", endUuid: "p2" })));
    expect(decoCount(state)).toBe(0);
    // Locking the same band now confines: h0 + p3 hidden.
    state = state.apply(setFocusBandMeta(state.tr, lockedBand({ startUuid: "p1", endUuid: "p2" })));
    expect(decoCount(state)).toBe(2);
    // Unlocking again (still active) clears the hide.
    state = state.apply(setFocusBandMeta(state.tr, band({ startUuid: "p1", endUuid: "p2" })));
    expect(decoCount(state)).toBe(0);
  });

  it("plain typing inside the band MAPS the set forward (no rebuild)", () => {
    let state = stateWithFocus();
    state = state.apply(setFocusBandMeta(state.tr, lockedBand({ startUuid: "p1", endUuid: "p2" })));
    const before = __getFocusRebuildCount();
    // Insert a char inside p1 (after its opening token).
    const p1Pos = state.doc.child(0).nodeSize + 1;
    state = state.apply(state.tr.insertText("x", p1Pos, p1Pos));
    expect(__getFocusRebuildCount()).toBe(before); // mapped, NOT rebuilt
    expect(decoCount(state)).toBe(2); // still hiding h0 + p3
  });

  it("inserting a new top-level block REBUILDS the set", () => {
    let state = stateWithFocus();
    state = state.apply(setFocusBandMeta(state.tr, lockedBand({ startUuid: "p1", endUuid: "p2" })));
    const before = __getFocusRebuildCount();
    // Append a new paragraph at doc end (a real block add).
    const newPara = paragraph("p4", "delta");
    state = state.apply(state.tr.insert(state.doc.content.size, newPara));
    expect(__getFocusRebuildCount()).toBe(before + 1); // rebuilt
    // Out of band now: h0, p3, p4 → 3 hidden.
    expect(decoCount(state)).toBe(3);
  });

  it("multi-step tail edit (no childCount change) does not crash and stays map-safe", () => {
    // Regression: a multi-step transaction whose later step references a
    // grown-tail position must be resolved against tr.docs[i], not the original
    // doc — else oldDoc.resolve(tailPos) throws "Position out of range" and
    // breaks dispatch. Triggers in the wild via input rules / IME / smart
    // punctuation that emit two ReplaceSteps near the tail with no block change.
    let state = stateWithFocus();
    state = state.apply(setFocusBandMeta(state.tr, lockedBand({ startUuid: "p1", endUuid: "p2" })));
    const rb0 = __getFocusRebuildCount();
    const tr = state.tr;
    const p1Inside = state.doc.child(0).nodeSize + 1; // inside h0/p1 area, in p1
    tr.insertText("aa", p1Inside); // step 0 — grows the doc
    tr.insertText("bb", tr.doc.content.size - 2); // step 1 — tail, in post-step-0 coords
    expect(() => {
      state = state.apply(tr);
    }).not.toThrow();
    // No childCount change, both in-block edits → mapped, not rebuilt.
    expect(decoCount(state)).toBe(2); // h0 + p3 still hidden
    expect(__getFocusRebuildCount()).toBe(rb0);
  });

  it("deactivating clears the decorations", () => {
    let state = stateWithFocus();
    state = state.apply(setFocusBandMeta(state.tr, lockedBand({ startUuid: "p1", endUuid: "p2" })));
    expect(decoCount(state)).toBe(2);
    state = state.apply(setFocusBandMeta(state.tr, band({ active: false })));
    expect(decoCount(state)).toBe(0);
  });
});
