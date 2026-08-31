// @vitest-environment jsdom
/**
 * Task 504 — **a live CONTENT drag claims Escape.**
 *
 * Task 471 stated the class and fixed it for the pane-resize engine: a live
 * pointer gesture is the INNERMOST transient thing on screen, so one press
 * ends exactly one thing. The drop-mode controller — the single chokepoint
 * every content drag routes through (block lift, text-object drag, inline-atom
 * grab, card-anchor drag, stack pull) — had the identical disease and a WIDER
 * reach, since a content drag is far more common than a divider drag.
 *
 * The two victims are the two real Escape owners, and both are stood in for
 * here at their REAL receiver + phase:
 *
 *   - `useMarginEdit`'s cancel — `window`, BUBBLE. Its `cancel()` drops
 *     `liveMargins`: every margin guide dragged this session and not yet
 *     Saved, plus margin-edit mode itself, closed under the user.
 *   - the dialog stack (`system-dialog.tsx`) — `document`, CAPTURE, and it
 *     deliberately ignores `defaultPrevented` ("a modal always has a way
 *     out"), so `preventDefault()` alone would not have stopped it. Only
 *     `stopPropagation` reaches it — which is why the claim is the pair.
 *
 * The fix is a PHASE CHANGE plus the claim, and the phase is not optional:
 * pre-504 this listener was `window` + BUBBLE — the LAST phase — where a claim
 * added in place stops essentially nothing (document capture has already run,
 * and margin-edit is a same-target same-phase listener registered first, which
 * `stopPropagation` cannot reach).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Same precedent as `refused-drop-keeps-float.test.ts`: the controller resolves
// its placement through the hit-test on mousemove, so mocking it lets the leg
// choose the geometry precisely.
let mockPlacement: Placement | null = null;
vi.mock("../hit-test", () => ({
  hitTest: () => mockPlacement,
  isUnmintedParagraphId: () => false,
  mintPlacementUuid: (_e: unknown, id: string) => id,
}));

import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  beginDropSession,
  cancelDropSession,
  getDropSession,
  setDropCtx,
} from "../controller";
import type { DropCtx, Placement } from "../types";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
  },
});

const para = (uuid: string, text: string) =>
  schema.nodes.paragraph.create({ uuid }, schema.text(text));

const CARD_KEY = "textobject:paragraph:SRC";

interface Harness {
  editor: Editor;
  doc: PMNode;
  dispatched: Transaction[];
}

function harness(): Harness {
  const doc = schema.nodes.doc.create(null, [
    para("SRC", "move me"),
    para("TAIL", "tail"),
  ]);
  const dispatched: Transaction[] = [];
  const editor = {
    state: EditorState.create({ schema, doc }),
    schema,
    view: {
      dispatch: (tr: Transaction) => dispatched.push(tr),
      focus: () => {},
    },
  } as unknown as Editor;
  setDropCtx({
    mainEditor: editor,
    closePopout: () => {},
    confirm: async () => true,
  } as unknown as DropCtx);
  return { editor, doc, dispatched };
}

function gap(editor: Editor, insertPos: number): Placement {
  return {
    kind: "between-blocks",
    editor,
    insertPos,
    rect: { x: 0, y: 0, width: 100, height: 2 },
  };
}

/** Start the gesture and let the controller resolve one placement. */
async function startDrag(h: Harness): Promise<void> {
  mockPlacement = gap(h.editor, h.doc.firstChild!.nodeSize);
  expect(
    beginDropSession({
      cardKey: CARD_KEY,
      origin: { x: 10, y: 10 },
      externalCommit: true,
    }),
  ).toBe(true);
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 200, clientY: 200, buttons: 1 }),
  );
  // Past the controller's ~16ms move throttle.
  await new Promise((r) => setTimeout(r, 30));
}

/**
 * A press dispatched from INSIDE the document, so the propagation path is the
 * real one: window capture → document capture → target → document bubble →
 * window bubble. Dispatching at `window` itself has a path of just `[window]`
 * — enough to reach the controller's own listener, and structurally unable to
 * reach a `document` listener at all. That is 471's recorded harness trap, and
 * the reason it matters here is that the fix is precisely a phase change.
 */
const keyFromDocument = (key: string) =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

/** The two real Escape owners, at their real receiver + phase. */
function withOwners(run: (owners: { margin: () => void; dialog: () => void }) => void) {
  const margin = vi.fn();
  const dialog = vi.fn();
  window.addEventListener("keydown", margin);
  document.addEventListener("keydown", dialog, true);
  try {
    run({ margin, dialog });
  } finally {
    window.removeEventListener("keydown", margin);
    document.removeEventListener("keydown", dialog, true);
  }
}

beforeEach(() => {
  mockPlacement = null;
});

afterEach(() => {
  cancelDropSession();
  setDropCtx(null);
  vi.restoreAllMocks();
});

describe("a live content drag CLAIMS Escape (task 504)", () => {
  it("cancels the drag and ONLY the drag", async () => {
    // The defect leg. Pre-504 both stand-ins fired from this one press: the
    // user's unsaved margins were discarded and a scrimless Preferences /
    // bug-report window closed, from a key they pressed to abandon a drag.
    const h = harness();
    await startDrag(h);
    expect(getDropSession()).not.toBeNull();

    withOwners(({ margin, dialog }) => {
      keyFromDocument("Escape");

      expect(getDropSession()).toBeNull(); // the drag DID cancel…
      expect(h.dispatched).toEqual([]); // …dispatching nothing…
      expect(margin).not.toHaveBeenCalled(); // …and nothing else ran.
      expect(dialog).not.toHaveBeenCalled();
    });
  });

  it("claims ONLY while a session is live: with none in flight both owners fire", () => {
    // The accepting control. Without it the leg above passes just as happily
    // on a controller that silenced Escape app-wide — far worse than the bug,
    // since margin-edit's own Cancel and every dialog's way out ride this key.
    harness();
    withOwners(({ margin, dialog }) => {
      keyFromDocument("Escape");
      expect(margin).toHaveBeenCalledTimes(1);
      expect(dialog).toHaveBeenCalledTimes(1);
    });
  });

  it("claims ONLY Escape: another key during a live drag reaches both owners", async () => {
    // The second accepting control. The claim is scoped to the key the gesture
    // answers, so typing during a drag is untouched — and `input-modality`'s
    // window-capture typing tracker, which AGENTS.md says must never be
    // silenced, still sees it.
    const h = harness();
    await startDrag(h);

    withOwners(({ margin, dialog }) => {
      keyFromDocument("a");
      expect(margin).toHaveBeenCalledTimes(1);
      expect(dialog).toHaveBeenCalledTimes(1);
      expect(getDropSession()).not.toBeNull(); // and the drag is untouched
    });
  });

  it("the capture-phase listener is REMOVED at capture phase, so it cannot outlive the gesture", async () => {
    // A capture listener is NOT removed by a bubble-phase removal, so a
    // mismatched teardown leaves a live Escape claim installed app-wide for
    // the rest of the session — every later Escape cancelling a session that
    // no longer exists AND stopping every other owner from seeing the press.
    // Asserted through behaviour rather than a spy: after the gesture ends,
    // both owners must get the press back.
    const h = harness();
    await startDrag(h);
    cancelDropSession();

    withOwners(({ margin, dialog }) => {
      keyFromDocument("Escape");
      expect(margin).toHaveBeenCalledTimes(1);
      expect(dialog).toHaveBeenCalledTimes(1);
    });
  });
});
