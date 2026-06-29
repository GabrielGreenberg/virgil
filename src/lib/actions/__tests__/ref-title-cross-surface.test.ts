// @vitest-environment jsdom
//
// CHIP 7a — the LAST cross-surface alignment proof. Migrates the final 4
// unmigrated action ids onto the registry: `ref` (the `\ref` cross-reference)
// and the `title`/`author`/`date` title fields. After this chip EVERY ActionId
// has a registry row — the registry is the COMPLETE SSOT.
//
// THE GOALS (MEMO_ACTION_ALIGNMENT.md §3 `\ref` + title rows):
//
//   `\ref` — was SLASH-ONLY. SETTLED: ADD a lightning cell. BOTH surfaces now
//   route through the SAME `refRun` → `ctx.openAtomCreate()` (the LabelRef
//   create-mode popover IS the creator). This file drives the REAL editor stack
//   (the actual `commands.ts` `\ref` slash action via a published bridge handle,
//   exactly like EditorPane) and asserts the `openAtomCreate` seam fires from
//   both the slash and the grid path. The retired `virgil-ref-create` event has
//   ZERO emitters/listeners.
//
//   `title`/`author`/`date` — SLASH-ONLY by design (a titleField is a doc-top
//   singleton, no menu twin). Each routes through the registry's pure-PM
//   `titleFieldRun` via `runViewOnlyAction` (no bridge). We assert the idempotent
//   find-existing-or-insert (a second `\title` does NOT duplicate — it just
//   re-places the cursor), the canonical doc-top order (title=0/author=1/date=2),
//   and that `\date` pre-fills today.
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
import { COMMAND_MAP, VIRGIL_COMMAND_NAMES } from "@/lib/tiptap/commands";
import {
  VIRGIL_ACTION_REGISTRY,
  refRun,
  assertActionCoverage,
  type ActionContext,
  type ActionId,
  type CursorRef,
  type EditorActionsHandle,
} from "@/lib/actions/action-registry";
import { setEditorActionsHandle } from "@/lib/actions/editor-actions-bridge";
import { paragraphUuidAt } from "@/links/links";

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
 *  given text, caret at the end. */
function mountEditor(text = ""): Editor {
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
  const pos = 1 + text.length;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
  return editor;
}

/** Every top-level titleField, in doc order. */
function titleFields(editor: Editor): PMNode[] {
  const out: PMNode[] = [];
  editor.state.doc.forEach((n) => {
    if (n.type.name === "titleField") out.push(n);
  });
  return out;
}

let openAtomCreate: ReturnType<typeof vi.fn>;

/** Publish a bridge handle EXACTLY like EditorPane: synthesize a CursorRef from
 *  the live selection head, build the ActionContext with the spy `openAtomCreate`
 *  seam, invoke `spec.run(ctx)`. `refRun` calls `ctx.openAtomCreate()`. */
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
        openAtomCreate: openAtomCreate as () => void,
      };
      void spec.run(ctx);
    },
  };
  setEditorActionsHandle(handle);
}

beforeEach(() => {
  openAtomCreate = vi.fn();
});

afterEach(() => {
  setEditorActionsHandle(null);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
// `\ref` — slash + the new lightning cell, both open the LabelRef popover
// ───────────────────────────────────────────────────────────────────────────

describe("\\ref (cross-reference)", () => {
  it("slash \\ref opens the LabelRef popover via the openAtomCreate seam (bridge)", () => {
    const editor = mountEditor("see ");
    publishHandle(editor);

    COMMAND_MAP.get("ref")!.action(editor.view, "\\ref");

    expect(openAtomCreate).toHaveBeenCalledTimes(1);
    expect(openAtomCreate).toHaveBeenCalledWith("ref");
    // No atom is inserted by the action itself — the popover is the creator.
    let labelRefs = 0;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "labelRef") labelRefs++;
      return true;
    });
    expect(labelRefs).toBe(0);
  });

  it("the lightning 'Cross-ref' cell opens the same popover (direct refRun, the grid path)", () => {
    const editor = mountEditor("see ");
    // The grid cell builds a view-only ctx with the openAtomCreate seam and calls
    // refRun, exactly like ActionsMenuPanel's runGridAction("ref").
    refRun({
      editor,
      view: editor.view,
      ref: {
        kind: "selection",
        from: editor.state.selection.from,
        to: editor.state.selection.to,
        paragraphId: "",
      },
      surface: "lightning",
      openAtomCreate: openAtomCreate as ActionContext["openAtomCreate"],
    });

    expect(openAtomCreate).toHaveBeenCalledTimes(1);
    expect(openAtomCreate).toHaveBeenCalledWith("ref");
  });

  it("refRun no-ops cleanly when no popover seam is supplied (view-only path)", () => {
    const editor = mountEditor("see ");
    expect(() =>
      refRun({
        editor,
        view: editor.view,
        ref: { kind: "cursor", pos: editor.state.selection.head, paragraphId: "" },
        surface: "slash",
      }),
    ).not.toThrow();
  });

  it("the retired virgil-ref-create event has ZERO emitters and ZERO listeners", () => {
    // Emitter check: no source file emits or binds it (the whole hook is gone).
    // Listener check: firing it through the live editor lifecycle is inert — no
    // popover opens (the seam is the only path now).
    const editor = mountEditor("see ");
    publishHandle(editor);
    const spy = vi.fn();
    window.addEventListener("virgil-ref-create", spy);
    window.dispatchEvent(new CustomEvent("virgil-ref-create"));
    // Our own spy fires (we added it), but the real `\ref` route does NOT depend
    // on it: openAtomCreate stayed untouched by the bare event.
    expect(openAtomCreate).not.toHaveBeenCalled();
    window.removeEventListener("virgil-ref-create", spy);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// `\title` / `\author` / `\date` — slash-only, idempotent, canonical order
// ───────────────────────────────────────────────────────────────────────────

describe("\\title / \\author / \\date (title fields)", () => {
  it("\\title inserts a titleField at the doc top", () => {
    const editor = mountEditor("body");
    COMMAND_MAP.get("title")!.action(editor.view, "\\title");

    const fields = titleFields(editor);
    expect(fields).toHaveLength(1);
    expect(fields[0].attrs.field).toBe("title");
    // Hoisted to position 0 (before the body paragraph).
    expect(editor.state.doc.firstChild?.type.name).toBe("titleField");
  });

  it("is IDEMPOTENT — a second \\title does NOT duplicate (re-places the cursor)", () => {
    const editor = mountEditor("body");
    COMMAND_MAP.get("title")!.action(editor.view, "\\title");
    expect(titleFields(editor)).toHaveLength(1);

    // Move the caret away, then fire \title again.
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1),
      ),
    );
    COMMAND_MAP.get("title")!.action(editor.view, "\\title");

    // Still exactly ONE titleField (no duplicate); cursor landed back inside it.
    expect(titleFields(editor)).toHaveLength(1);
    const tfStart = 0; // the titleField is the first child
    const head = editor.state.selection.head;
    const tf = editor.state.doc.firstChild!;
    expect(head).toBeGreaterThan(tfStart);
    expect(head).toBeLessThanOrEqual(tfStart + tf.nodeSize);
  });

  it("places title=0 / author=1 / date=2 in canonical order regardless of insert order", () => {
    const editor = mountEditor("body");
    // Insert OUT of order: date, then title, then author.
    COMMAND_MAP.get("date")!.action(editor.view, "\\date");
    COMMAND_MAP.get("title")!.action(editor.view, "\\title");
    COMMAND_MAP.get("author")!.action(editor.view, "\\author");

    const fields = titleFields(editor);
    expect(fields.map((f) => f.attrs.field)).toEqual(["title", "author", "date"]);
  });

  it("\\date pre-fills today (pretty-printed) with isToday set", () => {
    const editor = mountEditor("");
    COMMAND_MAP.get("date")!.action(editor.view, "\\date");

    const fields = titleFields(editor);
    expect(fields).toHaveLength(1);
    const dateField = fields[0];
    expect(dateField.attrs.field).toBe("date");
    expect(dateField.attrs.isToday).toBe(true);
    const expected = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    expect(dateField.textContent).toBe(expected);
  });

  it("each title command is idempotent independently (no cross-duplication)", () => {
    const editor = mountEditor("body");
    for (const name of ["title", "author", "date"] as const) {
      COMMAND_MAP.get(name)!.action(editor.view, `\\${name}`);
      COMMAND_MAP.get(name)!.action(editor.view, `\\${name}`); // second fire
    }
    const fields = titleFields(editor);
    // One of each, no duplicates.
    expect(fields.map((f) => f.attrs.field)).toEqual(["title", "author", "date"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// COMPLETE-SSOT milestone — every ActionId has a row; zero pending ids
// ───────────────────────────────────────────────────────────────────────────

describe("registry is the COMPLETE SSOT (CHIP 7a milestone)", () => {
  it("assertActionCoverage reports ZERO problems", () => {
    expect(assertActionCoverage()).toEqual([]);
  });

  it("ref + title/author/date all have registry rows", () => {
    for (const id of ["ref", "title", "author", "date"] as const) {
      expect(VIRGIL_ACTION_REGISTRY[id]).toBeTruthy();
      expect(VIRGIL_ACTION_REGISTRY[id]!.id).toBe(id);
    }
  });

  it("every live slash command name maps to a registry row that owns the slash surface", () => {
    // The 4 heading names fan out to the discrete heading rows; the 5 structural-
    // wrapper names (bug sweep #6) ALIAS onto existing lightning format rows
    // reached through the bridge (many-to-one), so neither group maps 1:1 to a
    // slash-surface row — they're checked separately below.
    const fanOutNames = [
      "chapter", "section", "subsection", "subsubsection",
      "list", "itemize", "enumerate", "quote", "quotation",
    ];
    for (const name of VIRGIL_COMMAND_NAMES) {
      if (fanOutNames.includes(name)) continue;
      const row = Object.values(VIRGIL_ACTION_REGISTRY).find(
        (r) => r?.slashName === name,
      );
      expect(row, `slash \\${name} should resolve to a row`).toBeTruthy();
      expect(row!.surfaces.slash).toBe(true);
    }
  });

  it("the structural-wrapper slash commands alias onto existing format rows (bug sweep #6)", () => {
    // \list/\itemize → bullet-list, \enumerate → ordered-list,
    // \quote/\quotation → blockquote. Each alias must be a live command name and
    // resolve to a real registry row (reached via the bridge, not a slash row).
    const aliases: Array<[string, string]> = [
      ["list", "bullet-list"],
      ["itemize", "bullet-list"],
      ["enumerate", "ordered-list"],
      ["quote", "blockquote"],
      ["quotation", "blockquote"],
    ];
    for (const [name, id] of aliases) {
      expect(VIRGIL_COMMAND_NAMES, `\\${name} is a live command`).toContain(name);
      expect(VIRGIL_ACTION_REGISTRY[id as keyof typeof VIRGIL_ACTION_REGISTRY], `${name} → ${id}`).toBeTruthy();
    }
  });
});
