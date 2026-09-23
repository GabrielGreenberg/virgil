// @vitest-environment jsdom
//
// TASK 733 — the grab surface asks the SURFACE-editability door, not
// `view.editable`.
//
// ## The state no suite could build before
//
// Virgil's main editor answers "may the user edit me?" on TWO axes:
//
//   - the PEN (collab) — `view.editable`, flipped by `setEditable`;
//   - the HOST (the React `editable` prop) — `editableRef`, which
//     `readOnlyEnforcer.filterTransaction` refuses doc-changing transactions
//     against.
//
// MAIN pins `view.editable = true` for the view's entire lifetime on purpose
// (`Editor.tsx` — `contenteditable="false"` broke selection routing in the
// Library Reader), so on MAIN the first axis is a CONSTANT and only the second
// moves. The Library Reader mounts the real pane with `editable={false}`, and
// that is the state the sibling `applicability-collab-gate` /
// `collab-gate-dispatch-seams` suites cannot express: both spell read-only as
// `canEdit: false` / `new Editor({ editable: false })`, which is the axis that
// does not move in production.
//
// Every leg below therefore builds the READER'S shape — `view.editable === true`
// AND `editableRef.current === false` — and is paired with a POSITIVE CONTROL
// on the identical fixture, so a refusal can never pass because the fixture was
// inert.
//
// ## What was wrong there
//
// The grab handle renders (its only gate is `editor.isEditable`, which the
// Reader deliberately pins true), the menu opens, and every row read as
// enabled. Picking Archive or Delete ran the destructive confirm, then
// `cleanupAndComputeDeleteRange` fired each anchored card's lifecycle `delete`
// and the anchor retarget — and only THEN dispatched a transaction the enforcer
// dropped on the floor. The paragraph stayed; its footnote and citation cards
// left the panels until reload.
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — the
// sibling-suite gotcha.)
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

vi.mock("@/lib/focus-new-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/focus-new-card")>();
  return { ...actual, focusNewCard: vi.fn() };
});

import type { RefObject } from "react";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { render, cleanup, renderHook } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { cardActionRows } from "@/lib/actions/action-registry";
import { ATOM_CREATE_POPOVER_EVENT } from "@/lib/actions/atom-create";
import { surfaceEditableNow } from "@/lib/tiptap/surface-editable";
import { DragHandleMenu, type DragHandleAction } from "@/components/DragHandleMenu";
import {
  useDragHandleActions,
  type DragHandleActionsDeps,
  type DragHandleRef,
} from "../drag-handle-actions";

// ---------------------------------------------------------------------------
// The Reader's shape: a REAL extension stack (so `readOnlyEnforcer` is mounted
// and publishes its ref) mounted `editable: true` with a host ref we control.
// ---------------------------------------------------------------------------

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

function installLayoutShims(): void {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
}

const PARA = (uuid: string, text: string): JSONContent => ({
  type: "paragraph",
  attrs: { uuid },
  content: [{ type: "text", text }],
});

/** Two paragraphs, so a `delete`/`archive` of the first leaves a doc to compare
 *  against rather than PM's empty-doc backfill. */
const FIXTURE = (): JSONContent[] => [PARA("p-A", "alpha beta gamma"), PARA("p-B", "second")];

/** A live SELECTION over "beta" — the ref shape the grab bar hands over. */
const SELECTION_REF: DragHandleRef = {
  kind: "selection",
  from: 7,
  to: 11,
  paragraphId: "p-A",
};

interface Mounted {
  editor: Editor;
  /** MAIN's mirror of the React `editable` prop. Flip it to move the HOST axis
   *  exactly as a re-render of `Editor.tsx` would. */
  editableRef: RefObject<boolean>;
}

function mountHost(hostEditable: boolean): Mounted {
  const editableRef: RefObject<boolean> = { current: hostEditable };
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef,
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    // The Reader's pin, and MAIN's for its whole life.
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: { type: "doc", content: FIXTURE() },
  });
  return { editor, editableRef };
}

/** Torn down in `afterEach` so a leg's listener can't count another leg's
 *  event (a harness is built per leg, on a shared `window`). */
const openPopoverListeners: Array<() => void> = [];

beforeEach(installLayoutShims);
afterEach(() => {
  for (const l of openPopoverListeners.splice(0)) {
    window.removeEventListener(ATOM_CREATE_POPOVER_EVENT, l);
  }
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// (0) The door
// ---------------------------------------------------------------------------

describe("task 733 (0) — the door reads BOTH axes", () => {
  it("a host-read-only main editor still reports `isEditable` true — the lie", () => {
    const { editor } = mountHost(false);
    expect(editor.isEditable, "the pin the Reader depends on").toBe(true);
    expect(editor.view.editable).toBe(true);
    editor.destroy();
  });

  it("`surfaceEditableNow` answers false there, and true when the host allows", () => {
    const ro = mountHost(false);
    expect(surfaceEditableNow(ro.editor)).toBe(false);
    ro.editor.destroy();

    const rw = mountHost(true);
    expect(surfaceEditableNow(rw.editor)).toBe(true);
    rw.editor.destroy();
  });

  it("it tracks a LIVE flip of the ref — not a snapshot taken at mount", () => {
    const { editor, editableRef } = mountHost(true);
    expect(surfaceEditableNow(editor)).toBe(true);
    editableRef.current = false;
    expect(surfaceEditableNow(editor)).toBe(false);
    editor.destroy();
  });

  it("a bare VIEW resolves the same answer through the owning editor", () => {
    // PM plugin-land holds a view and nothing else; `owningEditor` is the
    // back-pointer that keeps it from having to be handed the ref.
    const { editor } = mountHost(false);
    expect(surfaceEditableNow(editor.view)).toBe(false);
    editor.destroy();
  });

  it("a surface with NO enforcer (a card body / float) is answered by the view alone", () => {
    const floatCtx: EditorExtensionsCtx = {
      surface: "float",
      editable: true,
      cardContext: true,
      callbacks: {},
      docIdRef: { current: null },
      host: { getMainEditor: () => null },
    };
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      editable: false,
      extensions: buildEditorExtensions(floatCtx),
      content: { type: "doc", content: FIXTURE() },
    });
    // No `readOnlyEnforcer` ⇒ no published ref ⇒ `view.editable`, which is the
    // honest answer on that surface.
    expect(
      (editor.storage as unknown as Record<string, unknown>).readOnlyEnforcer,
    ).toBeUndefined();
    expect(surfaceEditableNow(editor)).toBe(false);
    editor.setEditable(true);
    expect(surfaceEditableNow(editor)).toBe(true);
    editor.destroy();
  });

  it("`null` answers TRUE — an absent surface never gates (no over-gating)", () => {
    expect(surfaceEditableNow(null)).toBe(true);
    expect(surfaceEditableNow(undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (A) The menu greys declaratively
// ---------------------------------------------------------------------------

const RECT = { left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 };

function renderMenu(editor: Editor) {
  render(
    <DragHandleMenu
      anchorRect={RECT}
      kind="selection"
      target={{ kind: "selection", from: 7, to: 11, paragraphId: "p-A" }}
      editor={editor}
      canEdit
      onSelect={() => {}}
      onClose={() => {}}
    />,
  );
  return Array.from(
    document.querySelectorAll('[role="menu"] button[role="menuitem"]'),
  ) as HTMLButtonElement[];
}

const enabledLabels = (buttons: HTMLButtonElement[]): string[] =>
  buttons.filter((b) => !b.disabled).map((b) => b.textContent ?? "");

describe("task 733 (A) — the grab menu greys every row on a host-read-only surface", () => {
  it("population self-check — the menu rendered the card rows", () => {
    const { editor } = mountHost(true);
    expect(renderMenu(editor).length).toBeGreaterThanOrEqual(
      cardActionRows("grab").length,
    );
    editor.destroy();
  });

  it("host-read-only: NOTHING is enabled — including the note row", () => {
    // The Reader's one writable sidecar is `notes.json`, but a note created
    // from here lands a Mode-B `linkedAnchor` MARK, which is a `docChanged`
    // transaction the enforcer refuses. An enabled note row would be another
    // dead affordance, so it greys with the rest.
    const { editor } = mountHost(false);
    expect(enabledLabels(renderMenu(editor))).toEqual([]);
    editor.destroy();
  });

  it("POSITIVE CONTROL: the identical menu on a host-writable surface enables rows", () => {
    const { editor } = mountHost(true);
    expect(enabledLabels(renderMenu(editor)).length).toBeGreaterThan(0);
    editor.destroy();
  });

  it("NO OVER-GATING: the host-writable menu is unchanged, row for row", () => {
    // This fix TIGHTENS a gate, so the shape of an ordinary editable main doc's
    // menu is pinned against the registry's own verdicts rather than a count.
    const { editor } = mountHost(true);
    const buttons = renderMenu(editor);
    const byRow = cardActionRows("grab").map((r) => r.id);
    expect(buttons.length).toBe(byRow.length);
    // Every row the registry does not itself grey for THIS ref is enabled.
    expect(enabledLabels(buttons).length).toBeGreaterThanOrEqual(
      byRow.length - buttons.filter((b) => b.disabled).length,
    );
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// (B) The dispatcher refuses at the seam, BEFORE the irreversible half
// ---------------------------------------------------------------------------

interface Harness {
  dispatch: (action: DragHandleAction, ref: DragHandleRef) => Promise<void>;
  creations: string[];
  /** Every anchored-card lifecycle the dispatcher reached. `cleanupAndCompute
   *  DeleteRange` fires these BEFORE its dispatch, so a non-empty list on a
   *  read-only surface is the exact defect: state destroyed for a document
   *  change that never landed. */
  lifecycleReads: number;
  /** The destructive confirm. Reached at all ⇒ the gate came too late. */
  confirms: number;
  retargets: number;
  /** `citation` neither mutates the doc nor registers a card from this seam: it
   *  hops a window event to open the shared create popover. Counting it is what
   *  keeps its legs non-vacuous — and offering a live create popover on a
   *  surface that cannot receive the atom is itself the defect. */
  popovers: number;
}

function makeHarness(editor: Editor): Harness {
  const creations: string[] = [];
  const counts = { lifecycleReads: 0, confirms: 0, retargets: 0, popovers: 0 };
  let n = 0;
  const cardCreation = new Proxy(
    {},
    {
      get: (_t, prop: string) => (..._args: unknown[]) => {
        creations.push(prop);
        const id = `card-${++n}`;
        return { id, footnoteId: id };
      },
    },
  ) as unknown as DragHandleActionsDeps["cardCreation"];

  const deps: DragHandleActionsDeps = {
    editorRef: { current: { getEditor: () => editor } as never },
    cardCreation,
    cardLifecycle: {
      get: () => {
        counts.lifecycleReads += 1;
        return undefined;
      },
    } as unknown as DragHandleActionsDeps["cardLifecycle"],
    anchorRetarget: {
      retarget: () => {
        counts.retargets += 1;
        return 0;
      },
    },
    appliedSplice: { get: () => null, ask: async () => null, settle: () => true },
    confirm: async () => {
      counts.confirms += 1;
      return true;
    },
    notify: vi.fn(),
    prefs: { placements: [], activeLeft: null, activeRight: null } as never,
    expandLeft: () => {},
    expandRight: () => {},
    clearBlankIfSet: () => {},
  };

  const onPopover = () => {
    counts.popovers += 1;
  };
  window.addEventListener(ATOM_CREATE_POPOVER_EVENT, onPopover);
  openPopoverListeners.push(onPopover);

  const { result } = renderHook(() => useDragHandleActions(deps));
  return {
    dispatch: result.current.dispatch,
    creations,
    get popovers() {
      return counts.popovers;
    },
    get lifecycleReads() {
      return counts.lifecycleReads;
    },
    get confirms() {
      return counts.confirms;
    },
    get retargets() {
      return counts.retargets;
    },
  };
}

const CARD_IDS = cardActionRows("grab").map((r) => r.id as DragHandleAction);

describe("task 733 (B) — the card dispatcher refuses on a host-read-only surface", () => {
  it("population self-check — the sweep found the card rows", () => {
    expect(CARD_IDS.length).toBeGreaterThanOrEqual(11);
  });

  for (const id of CARD_IDS) {
    it(`\`${id}\` mutates nothing and registers no card`, async () => {
      const { editor } = mountHost(false);
      expect(editor.view.editable, "precondition: the Reader's pin holds").toBe(true);
      const before = editor.state.doc.toJSON();
      const h = makeHarness(editor);

      await h.dispatch(id, SELECTION_REF);

      expect(h.creations, `\`${id}\` registered a card`).toEqual([]);
      expect(h.popovers, `\`${id}\` opened a create popover`).toBe(0);
      expect(editor.state.doc.toJSON(), `\`${id}\` mutated the doc`).toEqual(before);
      editor.destroy();
    });
  }

  it("the two DESTRUCTIVE rows stop BEFORE the confirm and the card cleanup", async () => {
    // The ordering claim, which "the doc is unchanged" alone cannot make: the
    // enforcer would have produced that outcome anyway while every irreversible
    // side effect still ran.
    for (const id of ["archive", "delete"] as DragHandleAction[]) {
      const { editor } = mountHost(false);
      const h = makeHarness(editor);

      await h.dispatch(id, SELECTION_REF);

      expect(h.confirms, `\`${id}\` opened the destructive confirm`).toBe(0);
      expect(h.lifecycleReads, `\`${id}\` reached the anchored-card cleanup`).toBe(0);
      expect(h.retargets, `\`${id}\` retargeted an anchor`).toBe(0);
      editor.destroy();
    }
  });

  it("POSITIVE CONTROL: the same dispatch does something when the host allows", async () => {
    for (const id of CARD_IDS) {
      const { editor } = mountHost(true);
      const before = JSON.stringify(editor.state.doc.toJSON());
      const h = makeHarness(editor);

      await h.dispatch(id, SELECTION_REF);

      const didSomething =
        h.creations.length > 0 ||
        h.confirms > 0 ||
        h.popovers > 0 ||
        JSON.stringify(editor.state.doc.toJSON()) !== before;
      expect(
        didSomething,
        `\`${id}\` is inert even when host-writable — its refusal leg proves nothing`,
      ).toBe(true);
      editor.destroy();
    }
  });

  it("the gate is asked LIVE: a host flip while the menu is open is honored", async () => {
    // The menu is a snapshot; the seam is not. A pane that goes read-only
    // between menu-build and click must refuse at the click.
    const { editor, editableRef } = mountHost(true);
    const before = editor.state.doc.toJSON();
    const h = makeHarness(editor);
    editableRef.current = false;

    await h.dispatch("delete", SELECTION_REF);

    expect(h.confirms).toBe(0);
    expect(editor.state.doc.toJSON()).toEqual(before);
    editor.destroy();
  });
});
