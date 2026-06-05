// @vitest-environment jsdom
/**
 * R5 regression lock — a live drop session must survive React re-renders.
 *
 * The `atoms-draggable` work (03f642e) made `setDropCtx(null)` cancel a live
 * session, so the global `user-select:none` / crosshair cursor / the
 * `data-drop-mode-active` body attr don't stick when the editor unmounts
 * mid-gesture (InlineAtomGrab has no controller mouseup of its own to fall
 * back on). But `DropModeProvider` USED to re-register the ctx on every change
 * of 10 effect deps — and `stack` (`dropStackApi`, a 7-hook `useMemo` in
 * EditorPane) churns identity on ordinary re-renders (reliably when the cursor
 * enters the margin → a marginalia hover re-renders the pane). Each
 * re-register ran the effect cleanup `setDropCtx(null)` → which now cancelled
 * the live gesture, for EVERY draggable kind. The user confirmed the session
 * died mid-drag (had to re-grab), not just the indicator hiding.
 *
 * The fix registers the ctx ONCE (on mount), reading the live values through a
 * ref, so a mere re-render never calls `setDropCtx(null)` — only a true
 * unmount does. This test renders the REAL `DropModeProvider` so it exercises
 * the effect wiring, not just the controller contract (the contract — null
 * cancels, non-null doesn't — already held; the bug was the provider CALLING
 * setDropCtx(null) on re-render). It locks BOTH halves:
 *   1. a re-render with churned deps does NOT cancel a live session, and the
 *      controller still reads LIVE ctx values through the ref; and
 *   2. a true unmount DOES end the session and clear the body hook (the
 *      atoms-draggable protection must keep working).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { Editor } from "@tiptap/react";

// Rendering the provider imports the controller → registry → every panel
// drop-spec, whose module graph reaches `@/lib/storage`, whose top-level
// `require("@/lib/storage-fsa")` vitest's resolver can't alias. Nothing in
// storage is exercised by this drop-session-lifecycle test, so a wholesale
// no-op mock is enough to let the graph load (the precedent the figure-visual
// test set).
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

import { DropModeProvider, type DropModeProviderProps } from "../DropModeProvider";
import {
  beginDropSession,
  cancelDropSession,
  getDropCtx,
  getDropSession,
} from "../controller";
import type { ParagraphAnchorApi, StackPullApi } from "../types";

afterEach(() => {
  cancelDropSession(); // never let a module-level session leak between tests
  cleanup();
});

const fakeEditor = { state: {}, view: { dispatch() {} } } as unknown as Editor;
const noop = () => {};

const makeAnchorApi = (): ParagraphAnchorApi => ({
  exists: () => true,
  getAnchorTextObjectIds: () => [],
  addTextObjectLink: noop,
  removeTextObjectLink: noop,
});

// `stack` is the dep that churns in the wild (`dropStackApi`). Its methods are
// only read at drop time, so a fresh sentinel object per render faithfully
// simulates the identity churn the regression turned fatal.
const makeStack = (): StackPullApi => ({}) as unknown as StackPullApi;

function props(stack: StackPullApi): DropModeProviderProps {
  return {
    mainEditor: fakeEditor,
    closePopout: noop,
    notes: makeAnchorApi(),
    highlights: makeAnchorApi(),
    todos: makeAnchorApi(),
    archive: makeAnchorApi(),
    cutterCards: makeAnchorApi(),
    revisions: makeAnchorApi(),
    reports: makeAnchorApi(),
    stack,
  };
}

// `todoDropSpec` is registered, so `beginDropSession` finds a spec; begin never
// calls a spec method, so any registered kind works.
const CARD_KEY = "todo:r5-lock";

function startSession(origin = { x: 100, y: 100 }) {
  let started = false;
  act(() => {
    // inPlace + externalCommit = the InlineAtomGrab path (no controller mouseup
    // of its own) — exactly the case atoms-draggable hardened with the cancel.
    started = beginDropSession({
      cardKey: CARD_KEY,
      origin,
      inPlace: true,
      externalCommit: true,
    });
  });
  return started;
}

describe("R5 — drop session survives provider re-renders", () => {
  it("a re-render with churned deps does NOT cancel a live session (ctx stays live)", () => {
    const stackA = makeStack();
    const { rerender } = render(<DropModeProvider {...props(stackA)} />);

    expect(startSession()).toBe(true);
    expect(getDropSession()).not.toBeNull();
    expect(document.body.getAttribute("data-drop-mode-active")).toBe("true");

    // Force the exact churn the regression died on: a new `stack` identity (and
    // fresh anchor APIs). Before the fix this re-ran the effect cleanup
    // `setDropCtx(null)` → cancelled the session.
    const stackB = makeStack();
    act(() => {
      rerender(<DropModeProvider {...props(stackB)} />);
    });

    // THE LOCK: the session survived the re-render.
    expect(getDropSession()).not.toBeNull();
    expect(getDropSession()?.cardKey).toBe(CARD_KEY);
    expect(document.body.getAttribute("data-drop-mode-active")).toBe("true");

    // And the controller reads LIVE ctx through the ref: the new `stack` is
    // visible at use time, so a real drop lands against current props — not the
    // values captured at mount.
    expect(getDropCtx()?.stack).toBe(stackB);
  });

  it("a TRUE unmount cancels the session and clears the body hook (atoms-draggable protection)", () => {
    const { unmount } = render(<DropModeProvider {...props(makeStack())} />);

    expect(startSession({ x: 0, y: 0 })).toBe(true);
    expect(getDropSession()).not.toBeNull();
    expect(document.body.getAttribute("data-drop-mode-active")).toBe("true");

    act(() => {
      unmount();
    });

    // Unmount must still end the session AND clear the global CSS hook, or
    // user-select:none / the crosshair cursor would stick with nothing left to
    // clear them (the bug atoms-draggable fixed).
    expect(getDropSession()).toBeNull();
    expect(document.body.hasAttribute("data-drop-mode-active")).toBe(false);
    expect(getDropCtx()).toBeNull();
  });
});
