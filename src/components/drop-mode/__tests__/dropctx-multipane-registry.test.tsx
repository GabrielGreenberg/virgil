// @vitest-environment jsdom
/**
 * Task 329 — the `DropCtx` registry contract with N panes mounted.
 *
 * `activeCtx` was a module-level single slot with last-writer-wins assignment
 * and an UNCONDITIONAL `setDropCtx(null)` on unmount, under the premise "called
 * once by EditorPane". Multi-doc keep-alive (default ON, capacity 3) falsified
 * it: N `EditorPane`s are mounted at once — one visible, the rest `display:none`
 * and never unmounted — and each mounts its own `DropModeProvider`. So:
 *
 *   A. MIS-ROUTE. Whichever pane mounted LAST owned the slot, and a warm switch
 *      is a visibility flip, not a remount, so ownership never moved back. Every
 *      doc-scoped read (`ctx.mainEditor` for `main-only` hit tests, the panel
 *      hook bags, `closePopout`, `requestAnchorFlush`) then addressed the WRONG
 *      document: no drop bar painted anywhere and the release did nothing.
 *   B. CLOBBER. A background pane being evicted / a tab closing / the Library
 *      reader unmounting on the way back to the doc tab wrote `null`, disarming
 *      drag-and-drop APP-WIDE until some pane mounted fresh.
 *
 * The fix is the shape `editor-actions-bridge.ts` already had: a keyed registry
 * with an identity-guarded dispose, a focused→visible→single resolution ladder
 * (`pickActiveByEditor`), and — the structural half — a session that CARRIES the
 * ctx it started in, so `ctx.mainEditor` means "the document this drag began in"
 * by construction, for the hit-test and for the commit alike.
 *
 * Every leg below fails on the pre-fix tree except the two marked as
 * non-regression pins (which the old last-writer slot satisfied by accident, and
 * which a naive "just re-register on visibility" fix would break).
 *
 * Visibility is the same DOM signal `pickProbeEditor` reads: a hidden keep-alive
 * slot is `display:none`, so its ProseMirror DOM has `offsetHeight === 0`. jsdom
 * reports 0 for everything, so each fake editor's `dom.offsetHeight` is defined
 * explicitly and flipped to simulate a warm switch.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { codeOnly } from "@/lib/__tests__/_source-scan";

// Same rationale as `drop-session-survives-rerender.test.tsx`: rendering the
// provider pulls the whole spec registry, whose module graph reaches
// `@/lib/storage` and its top-level `require("@/lib/storage-fsa")`. Nothing in
// storage is exercised here.
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
  __resetDropCtxRegistry,
  beginDropSession,
  cancelDropSession,
  getDropCtx,
  getDropSession,
} from "../controller";
import type { ParagraphAnchorApi, StackPullApi } from "../types";

afterEach(() => {
  cancelDropSession();
  cleanup();
  __resetDropCtxRegistry();
});

const noop = () => {};

/** A fake editor whose "am I on screen?" answer is settable, as a keep-alive
 *  slot's `display:none` makes it. */
function makeEditor(): { editor: Editor; setVisible: (v: boolean) => void } {
  const dom = document.createElement("div");
  let visible = false;
  Object.defineProperty(dom, "offsetHeight", { get: () => (visible ? 400 : 0) });
  const editor = {
    isDestroyed: false,
    isFocused: false,
    state: {},
    view: { dom, dispatch() {} },
  } as unknown as Editor;
  return { editor, setVisible: (v: boolean) => { visible = v; } };
}

const makeAnchorApi = (): ParagraphAnchorApi => ({
  exists: () => true,
  getAnchorTextObjectIds: () => [],
  addTextObjectLink: noop,
  removeTextObjectLink: noop,
});

/** `stack` doubles as the per-pane IDENTITY marker: it is a distinct sentinel
 *  per pane, so an assertion on `getDropCtx()?.stack` names WHICH pane won. */
function props(mainEditor: Editor, stack: StackPullApi): DropModeProviderProps {
  return {
    mainEditor,
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

const CARD_KEY = "todo:multipane-329";

function startSession(editor?: Editor | null) {
  let started = false;
  act(() => {
    started = beginDropSession({
      cardKey: CARD_KEY,
      origin: { x: 10, y: 10 },
      inPlace: true,
      externalCommit: true,
      editor,
    });
  });
  return started;
}

/**
 * Two panes, mounted in the order the app mounts them on a warm switch: A first
 * (the doc already open), B second (the doc just opened). A is the VISIBLE one —
 * the state after switching back to A — which is exactly the arrangement the
 * pre-fix last-writer slot got wrong.
 */
function mountTwoPanes() {
  const a = makeEditor();
  const b = makeEditor();
  const stackA = {} as unknown as StackPullApi;
  const stackB = {} as unknown as StackPullApi;
  a.setVisible(true);
  b.setVisible(false);
  const paneA = render(<DropModeProvider {...props(a.editor, stackA)} />);
  const paneB = render(<DropModeProvider {...props(b.editor, stackB)} />);
  return { a, b, stackA, stackB, paneA, paneB };
}

describe("DropCtx registry — N panes mounted (multi-doc keep-alive)", () => {
  it("resolves the VISIBLE pane's ctx, not the last one that mounted", () => {
    const { stackA } = mountTwoPanes();
    // Pre-fix: B mounted last and owned the global slot, so every drag in A
    // hit-tested against B's document and found nothing.
    expect(getDropCtx()?.stack).toBe(stackA);
  });

  it("prefers the FOCUSED pane over both the visible one and the last to mount", () => {
    const { a, b, stackA } = mountTwoPanes();
    // Put every other signal against A so the leg can only pass on the ladder's
    // FIRST rung: B mounted last (what the pre-fix slot answered) and B is the
    // one reporting a painted DOM.
    act(() => {
      a.setVisible(false);
      b.setVisible(true);
    });
    (a.editor as unknown as { isFocused: boolean }).isFocused = true;
    expect(getDropCtx()?.stack).toBe(stackA);
  });

  it("unmounting the HIDDEN pane leaves the visible pane's registration intact", () => {
    const { stackA, paneB } = mountTwoPanes();
    act(() => {
      paneB.unmount();
    });
    // Pre-fix: the departing pane's cleanup wrote `null` unconditionally, so
    // `beginDropSession` returned false for every producer app-wide.
    expect(getDropCtx()?.stack).toBe(stackA);
  });

  it("a warm switch (visibility flip, no remount) moves ownership", () => {
    const { a, b, stackB } = mountTwoPanes();
    act(() => {
      a.setVisible(false);
      b.setVisible(true);
    });
    // NON-REGRESSION PIN: the old slot happened to answer B here, for the wrong
    // reason (B wrote last). The point is that ownership follows what the user
    // is LOOKING at, with no re-registration and no remount.
    expect(getDropCtx()?.stack).toBe(stackB);
  });

  it("unmounting the HIDDEN pane does not cancel a session running in the visible one", () => {
    const { paneB } = mountTwoPanes();
    expect(startSession()).toBe(true);

    act(() => {
      paneB.unmount();
    });

    // Pre-fix: B's cleanup called `setDropCtx(null)`, which cancelled ANY live
    // session — so evicting a background tab killed the drag in your hands.
    expect(getDropSession()).not.toBeNull();
    expect(document.body.getAttribute("data-drop-mode-active")).toBe("true");
  });

  it("unmounting the pane that OWNS a live session still cancels it", () => {
    const { paneA } = mountTwoPanes();
    expect(startSession()).toBe(true);

    act(() => {
      paneA.unmount();
    });

    // NON-REGRESSION PIN (the atoms-draggable protection, controller.ts): an
    // `externalCommit` gesture has no controller mouseup of its own, so without
    // this the crosshair cursor + the global `user-select:none` keyed on
    // `data-drop-mode-active` would stick with nothing left to clear them.
    expect(getDropSession()).toBeNull();
    expect(document.body.hasAttribute("data-drop-mode-active")).toBe(false);
  });

  it("the session CARRIES its ctx: a mid-drag visibility flip cannot re-route it", () => {
    const { a, b, stackA } = mountTwoPanes();
    expect(startSession()).toBe(true);

    act(() => {
      a.setVisible(false);
      b.setVisible(true);
    });

    // The structural half of the fix. A drag that began in A commits against A —
    // reading "the active ctx" at commit time would apply the drop to whichever
    // document happened to be frontmost by then.
    expect(getDropSession()?.ctx.stack).toBe(stackA);
    expect(getDropCtx()?.stack).not.toBe(stackA); // the ladder really did move
  });

  it("an EXACT editor hint binds the session to that pane, whatever is visible", () => {
    const { b, stackB, stackA } = mountTwoPanes();
    // The in-text atom grab and the lifted-overlay grab both fire from inside a
    // specific editor, so they name it. Correct even with two panes visible at
    // once, where the ladder can only guess.
    expect(startSession(b.editor)).toBe(true);
    expect(getDropSession()?.ctx.stack).toBe(stackB);
    expect(getDropCtx()?.stack).toBe(stackA); // A is still the visible one
  });

  it("with no pane registered at all, a gesture is refused", () => {
    expect(getDropCtx()).toBeNull();
    expect(startSession()).toBe(false);
  });
});

// ── Census ───────────────────────────────────────────────────────────
//
// The leg with teeth. The registry was never the part that could misbehave — a
// SECOND publisher that goes through the single legacy slot is, and it would
// reinstate the clobber exactly as before with every behavioural leg above
// still green: `setDropCtx(null)` deletes the shared default entry, so a
// provider that registered through it disarms whichever pane happens to hold
// that entry. Production publishes per provider (`registerDropCtx`), full stop;
// the legacy door survives only for test harnesses that hold no provider token.
// The mirror of `editor-actions-bridge.ts`'s `setEditorActionsHandle`.

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const PRODUCTION_SOURCES = ["src", "library"]
  .flatMap((silo) => walk(path.join(REPO_ROOT, silo)))
  .filter((f) => !/__tests__|\.test\.tsx?$/.test(f))
  // The controller DECLARES the legacy door; naming it there is not using it.
  .filter((f) => !f.endsWith(path.join("drop-mode", "controller.ts")));

describe("census — nothing in production publishes through the legacy slot", () => {
  it("finds real files to look at (the census can see)", () => {
    expect(PRODUCTION_SOURCES.length).toBeGreaterThan(500);
    expect(
      PRODUCTION_SOURCES.some((f) => f.endsWith(path.join("drop-mode", "DropModeProvider.tsx"))),
    ).toBe(true);
  });

  it("no production file calls setDropCtx", () => {
    // Comments stripped and literals dropped: the needle is a CALL, and both a
    // prose mention (this file's own header names it) and a string would be a
    // false positive.
    const offenders = PRODUCTION_SOURCES.filter((f) =>
      /\bsetDropCtx\s*\(/.test(codeOnly(fs.readFileSync(f, "utf8"))),
    ).map((f) => path.relative(REPO_ROOT, f));
    // A hit is MIGRATE-it (`registerDropCtx`), never an allowlist entry: there
    // is no true statement of the form "this publisher may clobber its peers".
    expect(offenders).toEqual([]);
  });

  it("the swallow self-check: the stripper does not blank a real call", () => {
    // A census that silently strips its own needle passes vacuously forever.
    // Synthetic fixture, not a live line — a canary must not stand on the thing
    // the census exists to drain.
    const fixture = `// setDropCtx(x) in a comment\nconst s = "setDropCtx(y)";\nsetDropCtx(z);\n`;
    const scanned = codeOnly(fixture);
    expect(/\bsetDropCtx\s*\(/.test(scanned)).toBe(true);
    expect(scanned.split("\n").filter((l) => /setDropCtx/.test(l))).toHaveLength(1);
  });
});
