// @vitest-environment jsdom
/**
 * The shared "which editor is active?" ladder.
 *
 * It had no suite of its own while it had one consumer (the dev probes); it now
 * routes real user gestures for THREE — the geometry service's stats probe, the
 * editor-actions bridge (which document a typed `\ex`/`\cite` lands in), and the
 * drop-mode `DropCtx` registry (which document a drag targets, task 329) — with
 * its only coverage incidental, through fixtures in those consumers' suites.
 * That is the wrong direction of dependency for a routing SSOT: a rewrite of the
 * ladder (a `filter(...).pop()`, a reduce) would flip the tie-break silently and
 * be caught, if at all, by whichever consumer happened to have a two-pane case.
 *
 * The rungs, and why each is where it is:
 *   1. FOCUSED   — the pane being typed into;
 *   2. VISIBLE   — `offsetHeight > 0`, which is exactly what a keep-alive slot's
 *                  `display:none` falsifies. Load-bearing rather than a nicety:
 *                  when the dev runs a probe from the console NOTHING is
 *                  focused, and a focus-only resolver returns null exactly then;
 *   3. SOLE LIVE — one live editor is unambiguous;
 *   4. else null — genuinely ambiguous; don't guess.
 *
 * jsdom reports `offsetHeight === 0` for every element, so visibility is defined
 * explicitly per fixture.
 */

import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/react";
import { pickActiveByEditor, pickProbeEditor } from "../active-editor-probe";

interface Fake {
  editor: Editor;
  setVisible: (v: boolean) => void;
  setFocused: (v: boolean) => void;
  destroy: () => void;
}

function makeEditor(): Fake {
  const dom = document.createElement("div");
  let visible = false;
  Object.defineProperty(dom, "offsetHeight", { get: () => (visible ? 400 : 0) });
  const editor = {
    isDestroyed: false,
    isFocused: false,
    view: { dom },
  } as unknown as Editor;
  const m = editor as unknown as { isDestroyed: boolean; isFocused: boolean };
  return {
    editor,
    setVisible: (v) => { visible = v; },
    setFocused: (v) => { m.isFocused = v; },
    destroy: () => { m.isDestroyed = true; },
  };
}

describe("pickProbeEditor — the four rungs", () => {
  it("returns null for an empty set", () => {
    expect(pickProbeEditor([])).toBeNull();
  });

  it("a sole LIVE editor wins even when hidden and unfocused", () => {
    const a = makeEditor(); // not visible, not focused
    expect(pickProbeEditor([a.editor])).toBe(a.editor);
  });

  it("FOCUSED beats VISIBLE", () => {
    const focused = makeEditor();
    const visible = makeEditor();
    focused.setFocused(true);
    visible.setVisible(true);
    // Order deliberately puts the visible one first: the rung must win on the
    // signal, not on position.
    expect(pickProbeEditor([visible.editor, focused.editor])).toBe(focused.editor);
  });

  it("VISIBLE wins when nothing is focused (the console-probe case)", () => {
    const hidden = makeEditor();
    const shown = makeEditor();
    shown.setVisible(true);
    expect(pickProbeEditor([hidden.editor, shown.editor])).toBe(shown.editor);
  });

  it("two live editors with no focus and none painted are AMBIGUOUS → null", () => {
    const a = makeEditor();
    const b = makeEditor();
    // Fail closed. A guess here is a mis-route: the wrong document takes the
    // typed action / the drop.
    expect(pickProbeEditor([a.editor, b.editor])).toBeNull();
  });

  it("a DESTROYED editor never participates — and its peer becomes the sole live one", () => {
    const dead = makeEditor();
    const live = makeEditor();
    dead.destroy();
    dead.setVisible(true); // even painted, it must not win
    expect(pickProbeEditor([dead.editor, live.editor])).toBe(live.editor);
  });

  it("ties break on ITERATION ORDER, first wins", () => {
    // Pinned because a rewrite to `filter(...).pop()` or a reduce inverts this
    // in silence, and every registry that feeds it iterates a Map in insertion
    // order — so "first" means "the pane that registered earliest".
    const first = makeEditor();
    const second = makeEditor();
    first.setVisible(true);
    second.setVisible(true);
    expect(pickProbeEditor([first.editor, second.editor])).toBe(first.editor);
  });
});

describe("pickActiveByEditor — the general form the registries use", () => {
  it("returns the ENTRY, not the editor", () => {
    const a = makeEditor();
    const b = makeEditor();
    const entries = [
      { id: "a", ed: a.editor },
      { id: "b", ed: b.editor },
    ];
    b.setVisible(true);
    expect(pickActiveByEditor(entries, (e) => e.ed)?.id).toBe("b");
  });

  it("an entry whose accessor answers NULL does not participate", () => {
    // The case that makes the whole generalization worth having: a pane that has
    // registered but whose editor does not exist yet must not be able to win, or
    // to make its live peer look ambiguous. Its peer is then the SOLE live one.
    const live = makeEditor();
    const entries = [
      { id: "booting", ed: null as Editor | null },
      { id: "live", ed: live.editor },
    ];
    expect(pickActiveByEditor(entries, (e) => e.ed)?.id).toBe("live");
  });

  it("every accessor answering null resolves to null, not to an arbitrary entry", () => {
    const entries = [{ id: "a", ed: null }, { id: "b", ed: null }];
    expect(pickActiveByEditor(entries, (e) => e.ed as Editor | null)).toBeNull();
  });

  it("accepts an undefined accessor answer (an optional field) without throwing", () => {
    const live = makeEditor();
    const entries: Array<{ ed?: Editor }> = [{}, { ed: live.editor }];
    expect(pickActiveByEditor(entries, (e) => e.ed)?.ed).toBe(live.editor);
  });

  it("tolerates an editor with no view (a torn-down pane mid-teardown)", () => {
    // `view?.dom` is optional-chained on purpose: an editor can be non-destroyed
    // with its view already gone. It must fall through the visible rung rather
    // than throw — a throw here would take down whatever gesture asked.
    const viewless = { isDestroyed: false, isFocused: false } as unknown as Editor;
    const shown = makeEditor();
    shown.setVisible(true);
    expect(pickProbeEditor([viewless, shown.editor])).toBe(shown.editor);
    expect(pickProbeEditor([viewless])).toBe(viewless); // sole live
  });
});
