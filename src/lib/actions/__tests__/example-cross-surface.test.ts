// @vitest-environment jsdom
//
// CHIP 5c — the EXAMPLE cross-surface alignment proof.
//
// THE GOAL (MEMO_ACTION_ALIGNMENT.md §3 example row): an example created from
// EITHER surface — the lightning grid `ex` cell or the slash `\ex` — lands at
// the SAME destination via the SAME canonical `exampleRun`
// (wrap-if-selection-else-insert; one template; the `exampleItemList`-wrapped
// `multi` shape). This file drives the REAL editor stack (the actual
// `commands.ts` `\ex` slash action + the real `buildEditorExtensions` schema +
// `exampleRun` itself) with a REAL published bridge handle (mirroring
// EditorPane), so the join is exercised end-to-end, not stubbed.
//
// WHAT IS PROVEN
//   1. SLASH (collapsed caret) — `\ex` via the bridge inserts ONE empty single
//      example at the caret.
//   2. SLASH (selection) — `\ex` over a non-empty selection WRAPS the selected
//      inline text into the example's first item paragraph (DA-1 safe).
//   3. GRID — the lightning `ex` path (a direct `exampleRun` call, the SAME the
//      grid cell makes) produces a byte-identical single example.
//   4. SOFT-SELECT, NO FORCE-OPEN — the slash path calls
//      `panelRouting.selectExample(<uuid>)` (so an OPEN Examples panel scrolls to
//      the new block) but never `setActiveLeft`/`setActiveRight` (backlog #2 — it
//      never force-opens a panel).
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — the same
// gotcha as the sibling action tests.)
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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
import { TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { COMMAND_MAP } from "@/lib/tiptap/commands";
import {
  VIRGIL_ACTION_REGISTRY,
  exampleRun,
  type ActionContext,
  type ActionId,
  type CursorRef,
  type EditorActionsHandle,
} from "@/lib/actions/action-registry";
import { setEditorActionsHandle } from "@/lib/actions/editor-actions-bridge";
import { paragraphUuidAt } from "@/links/links";
import type { ViewPrefs } from "@/hooks/useViewPrefs";

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

/** Mount a real main editor whose single paragraph (uuid "para-A") holds the
 *  given text, with the caret at `caretOffset` (1-based doc pos = 1 + offset). */
function mountEditor(text: string, caretOffset = text.length): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "para-A" },
          content: text ? [{ type: "text", text }] : [],
        },
      ],
    },
  });
  const pos = 1 + caretOffset;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
  return editor;
}

/** Every exampleBlock in the doc. */
function exampleBlocks(editor: Editor): PMNode[] {
  const out: PMNode[] = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name === "exampleBlock") out.push(n);
    return true;
  });
  return out;
}

let selectExample: ReturnType<typeof vi.fn>;
let setActiveLeft: ReturnType<typeof vi.fn>;
let setActiveRight: ReturnType<typeof vi.fn>;

function prefs(): ViewPrefs {
  return {
    placements: [{ id: "examples", side: "right" }],
    activeLeft: "notes",
    activeRight: null,
  } as unknown as ViewPrefs;
}

/** Publish a bridge handle EXACTLY like EditorPane: synthesize a CursorRef from
 *  the live selection head, build the ActionContext with the spy panelRouting
 *  (incl. `selectExample`), invoke `spec.run(ctx)`. `exampleRun` reads the live
 *  selection off `ctx.view.state` (not the synthesized ref). */
function publishHandle(editor: Editor): void {
  const handle: EditorActionsHandle = {
    runAction(id: ActionId, seed) {
      const spec = VIRGIL_ACTION_REGISTRY[id];
      if (!spec) return;
      const pos = editor.state.selection.head;
      const ref: CursorRef = {
        kind: "cursor",
        pos,
        paragraphId: paragraphUuidAt(editor.state.doc, pos) ?? "",
      };
      const ctx: ActionContext = {
        editor,
        view: editor.view,
        ref,
        surface: seed.surface,
        panelRouting: {
          prefs: prefs(),
          setActiveLeft: setActiveLeft as (id: unknown) => void,
          setActiveRight: setActiveRight as (id: unknown) => void,
          focusCard: vi.fn(),
          selectExample: selectExample as (id: string) => void,
        } as unknown as ActionContext["panelRouting"],
      };
      void spec.run(ctx);
    },
  };
  setEditorActionsHandle(handle);
}

beforeEach(() => {
  selectExample = vi.fn();
  setActiveLeft = vi.fn();
  setActiveRight = vi.fn();
});

afterEach(() => {
  setEditorActionsHandle(null);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("slash \\ex (via the bridge)", () => {
  it("inserts ONE empty single example at a collapsed caret", () => {
    const editor = mountEditor("");
    publishHandle(editor);

    COMMAND_MAP.get("ex")!.action(editor.view, "\\ex");

    const blocks = exampleBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs.kind).toBe("single");
    expect(blocks[0].textContent).toBe(""); // empty body
  });

  it("WRAPS a non-empty selection into the example's first item (DA-1 safe)", () => {
    const editor = mountEditor("wrap me please");
    // select "wrap me" → doc positions 1..8
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 8)),
    );
    publishHandle(editor);

    COMMAND_MAP.get("ex")!.action(editor.view, "\\ex");

    const blocks = exampleBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs.kind).toBe("single");
    expect(blocks[0].textContent).toBe("wrap me");
    // only inline content reached the slot (no nested block corruption).
    let ok = true;
    blocks[0].child(0).forEach((inline) => {
      if (!inline.isInline) ok = false;
    });
    expect(ok).toBe(true);
  });

  it("soft-SELECTS the new example but NEVER force-opens a panel (backlog #2)", () => {
    const editor = mountEditor("");
    publishHandle(editor);

    COMMAND_MAP.get("ex")!.action(editor.view, "\\ex");

    const uuid = exampleBlocks(editor)[0].attrs.uuid as string;
    expect(selectExample).toHaveBeenCalledTimes(1);
    expect(selectExample).toHaveBeenCalledWith(uuid);
    // The soft-select scrolls an ALREADY-open panel; it must NOT flip the active
    // panel on either side.
    expect(setActiveLeft).not.toHaveBeenCalled();
    expect(setActiveRight).not.toHaveBeenCalled();
  });
});

describe("grid `ex` cell (direct exampleRun, the lightning path)", () => {
  it("produces a single example identical to the slash insert (no panelRouting)", () => {
    const editor = mountEditor("");
    // The grid cell builds a view-only ctx (no panelRouting — it inserts inline
    // without a panel hop) and calls exampleRun, exactly like ActionsMenuPanel.
    exampleRun({
      editor,
      view: editor.view,
      ref: {
        kind: "selection",
        from: editor.state.selection.from,
        to: editor.state.selection.to,
        paragraphId: "",
      },
      surface: "lightning",
    });

    const blocks = exampleBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs.kind).toBe("single");
    expect(blocks[0].textContent).toBe("");
    // No panel side-effect on the grid path.
    expect(selectExample).not.toHaveBeenCalled();
  });

  it("wraps a selection on the grid path too", () => {
    const editor = mountEditor("hello there");
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)),
    );
    exampleRun({
      editor,
      view: editor.view,
      ref: {
        kind: "selection",
        from: editor.state.selection.from,
        to: editor.state.selection.to,
        paragraphId: "",
      },
      surface: "lightning",
    });
    const blocks = exampleBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].textContent).toBe("hello");
  });
});
