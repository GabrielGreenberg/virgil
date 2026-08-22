// @vitest-environment jsdom
//
// Task 398 — the slash popup ASKS before it OFFERS, and a refusal costs the
// user nothing.
//
// THE BUG THIS PINS (a visible affordance that eats input and then does nothing).
// `executeSelection` dispatched `tr.delete(slashPos, cursor)` as its OWN
// transaction and called `cmd.action` afterwards; the action's `applies()` bail
// — `runViewOnlyAction` for the pure-PM rows, the bridge's `runAction` for the
// rest — then refused a command that cannot run at this caret. So with the caret
// in a `latexComment` / `codeBlock` / `titleField`, typing `\forest` and pressing
// Enter DELETED seven characters, inserted nothing, and said nothing. The
// lightning grid's forest cell is correctly greyed at the same caret, so two
// surfaces routing to ONE `run()` disagreed about ONE gate — the "what the hover
// OFFERS is what the commit ACCEPTS" law (083 / 258 / 321), with the extra cost
// that this refusal was LOSSY rather than merely silent.
//
// And the popup never asked at all: `filterByPrefix` filtered
// `VIRGIL_COMMAND_NAMES` by typed prefix and nothing else — no `applies()`, no
// `canEdit`, no container. Of the four surfaces, grab asks per row, lightning
// asks per row (task 397), typed asks at its input rule, and slash asked nothing
// before it committed the user's keystrokes.
//
// WHAT IS PROVEN (driving the REAL `SlashPopupExtension` inside the REAL
// `buildEditorExtensions("main")` stack — the shipped `handleTextInput` /
// `handleKeyDown` props, not a re-model; only `@/lib/storage` is stubbed, per
// the extension-barrel gotcha):
//   1. REFUSAL IS FREE — in each of the three containers, typing a refused
//      command and pressing Enter leaves the document byte-identical (the typed
//      `\name` still there), inserts nothing, and adds no history entry.
//   2. THE OFFER CARRIES THE VERDICT — the popup state's `disabled` list equals
//      the registry's own `applies() === "disabled"` set, per name, per
//      container. No hand list: the expectation is DERIVED from
//      `VIRGIL_ACTION_REGISTRY` so a future gate change moves both sides.
//   3. NAVIGATION cannot land on a greyed row (initial selection + arrows).
//   4. CONTROL — in prose every command still runs, still removes the typed
//      `\name`, and the doc changes exactly as before.
//   5. A CLICK on a greyed row (the popup's other commit door) is inert too.
import { describe, it, expect, afterEach, vi } from "vitest";

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
    "mutateSidecar", "enqueueDocWrite",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  slashPopupKey,
  executeSlashSelectionAt,
} from "@/lib/tiptap/slash-popup";
import { VIRGIL_COMMAND_NAMES } from "@/lib/tiptap/commands";
import {
  buildSlashActionContext,
  firstEnabledIndex,
  slashCommandVerdict,
  stepEnabledIndex,
} from "@/lib/tiptap/slash-applicability";
import {
  SLASH_NAME_TO_ACTION_ID,
  VIRGIL_ACTION_REGISTRY,
} from "@/lib/actions/action-registry";
import { serializeToLatex } from "@/lib/latex-serializer";

// ---------------------------------------------------------------------------
// Real editor stack
// ---------------------------------------------------------------------------

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
  } as unknown as EditorExtensionsCtx;
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/**
 * The four containers this class turns on: ordinary prose (the control), an
 * `inline*` title, and the two MARKLESS `text*` verbatim blocks. The
 * `latexComment` carries a REAL commented line so a promotion would be visible
 * in the serialized bytes, not only in the node tree.
 */
function mount(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "para-A" },
          content: [{ type: "text", text: "alpha beta" }],
        },
        {
          type: "titleField",
          attrs: { field: "title", uuid: "title-A" },
          content: [{ type: "text", text: "My Paper" }],
        },
        {
          type: "codeBlock",
          attrs: { uuid: "code-A" },
          content: [{ type: "text", text: "alpha beta" }],
        },
        {
          type: "latexComment",
          attrs: { uuid: "cmt-A" },
          content: [{ type: "text", text: "% todo fix later" }],
        },
      ],
    },
  });
  return editor;
}

type Container = "paragraph" | "titleField" | "codeBlock" | "latexComment";
const CONTAINER_INDEX: Record<Container, number> = {
  paragraph: 0,
  titleField: 1,
  codeBlock: 2,
  latexComment: 3,
};

/** Caret at the END of the named top-level block. */
function caretIn(ed: Editor, container: Container): number {
  const idx = CONTAINER_INDEX[container];
  let pos = -1;
  let i = 0;
  ed.state.doc.forEach((node, p) => {
    if (i === idx) pos = p + node.nodeSize - 1;
    i += 1;
  });
  ed.view.dispatch(
    ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)),
  );
  return pos;
}

/**
 * Type `\<name>` one character at a time through the SHIPPED `handleTextInput`
 * prop. A single `insertContent` of the whole string never opens the popup at
 * all — the plugin only arms on a lone `\`.
 */
function typeSlash(ed: Editor, name: string): void {
  const from = ed.state.selection.from;
  ed.view.someProp("handleTextInput", (f) =>
    f(ed.view, from, from, "\\", () => ed.state.tr),
  );
  ed.commands.insertContentAt(from, "\\");
  for (const ch of name) {
    const at = ed.state.selection.from;
    ed.view.someProp("handleTextInput", (f) =>
      f(ed.view, at, at, ch, () => ed.state.tr),
    );
    ed.commands.insertContentAt(at, ch);
  }
}

/** Press a key through ProseMirror's own dispatch. Returns whether it was handled. */
function press(ed: Editor, key: string): boolean {
  return (
    ed.view.someProp("handleKeyDown", (f) =>
      f(ed.view, new KeyboardEvent("keydown", { key })),
    ) ?? false
  );
}

function popup(ed: Editor) {
  const s = slashPopupKey.getState(ed.state);
  if (!s || !s.open) return null;
  return s;
}

/**
 * The verdict the REGISTRY gives at this caret, derived rather than hand-listed
 * so a future gate change moves the expectation and the code together.
 */
function registryDisabled(ed: Editor): string[] {
  return VIRGIL_COMMAND_NAMES.filter(
    (n) => slashCommandVerdict(ed.view, n) !== "ok",
  );
}

// ---------------------------------------------------------------------------
// 1. A refusal is FREE — the typed text survives
// ---------------------------------------------------------------------------

describe("a refused slash command consumes nothing", () => {
  // `\forest` is the reported case; `\ex` (bridge-routed) and `\quote` (a
  // wrapper, whose refusal task 397 widened) cover the other two dispatch
  // shapes, so the fix is proven at the DOOR rather than for one command.
  const REFUSED: Array<[Container, string]> = [
    ["latexComment", "forest"],
    ["latexComment", "tex"],
    ["latexComment", "ex"],
    ["codeBlock", "forest"],
    ["codeBlock", "footnote"],
    ["codeBlock", "quote"],
    ["titleField", "section"],
    ["titleField", "cite"],
    ["titleField", "enumerate"],
  ];

  it.each(REFUSED)(
    "%s + \\%s — Enter leaves the document byte-identical",
    (container, name) => {
      const ed = mount();
      caretIn(ed, container);
      const before = serializeToLatex(ed.state.doc.toJSON() as never);
      typeSlash(ed, name);
      const typed = serializeToLatex(ed.state.doc.toJSON() as never);

      // The popup is open and the row is offered GREYED, not silently live.
      const st = popup(ed);
      expect(st, "popup should be open").not.toBeNull();
      expect(st!.filtered).toContain(name);
      expect(st!.disabled).toContain(name);

      press(ed, "Enter");

      // Nothing inserted, and — the defect — nothing DELETED either.
      expect(serializeToLatex(ed.state.doc.toJSON() as never)).toBe(typed);
      expect(typed.length).toBeGreaterThan(before.length);
      // The popup closed, so the user isn't left staring at a dead list.
      expect(popup(ed)).toBeNull();
    },
  );

  it("a refusal adds no undoable history entry beyond the typing itself", () => {
    const ed = mount();
    caretIn(ed, "codeBlock");
    typeSlash(ed, "forest");
    const typed = serializeToLatex(ed.state.doc.toJSON() as never);
    press(ed, "Enter");
    // One undo of the typing burst; if the refusal had dispatched a delete it
    // would be the thing this undo removes, and the text would be back.
    expect(serializeToLatex(ed.state.doc.toJSON() as never)).toBe(typed);
  });

  it("Enter on an all-greyed popup consumes the key and changes nothing", () => {
    // Activating a disabled control does nothing — the idiom both menus use.
    // The popup CLOSES, so the user's next Enter is an ordinary one; what must
    // never happen is the document changing under a refusal.
    const ed = mount();
    caretIn(ed, "codeBlock");
    typeSlash(ed, "quot"); // \quote + \quotation, both refused in a codeBlock
    const st = popup(ed)!;
    expect(st.filtered.length).toBeGreaterThan(0);
    expect(st.disabled).toEqual(st.filtered);
    const typed = serializeToLatex(ed.state.doc.toJSON() as never);
    expect(press(ed, "Enter")).toBe(true);
    expect(serializeToLatex(ed.state.doc.toJSON() as never)).toBe(typed);
    expect(popup(ed)).toBeNull();
    // …and the NEXT Enter is the editor's own.
    expect(press(ed, "Enter")).toBe(true);
    expect(serializeToLatex(ed.state.doc.toJSON() as never)).not.toBe(typed);
  });

  it("the POPUP-LESS door refuses too (`\\name` + Enter with no popup open)", () => {
    // `latex-command.ts`'s `virgilCommands` plugin is the slash surface's second
    // commit door: it matches a trailing `\name` on Enter and fires when the
    // popup was never opened. Pre-398 it carried its own copy of the same
    // delete-then-ask ordering, so a fix to the popup alone would have left this
    // one eating characters in the very same containers.
    const ed = mount();
    caretIn(ed, "codeBlock");
    typeSlash(ed, "forest");
    press(ed, "Escape"); // dismiss the popup — now only the second door is live
    expect(popup(ed)).toBeNull();
    const typed = serializeToLatex(ed.state.doc.toJSON() as never);
    press(ed, "Enter");
    expect(serializeToLatex(ed.state.doc.toJSON() as never)).toContain(
      "\\forest",
    );
    expect(ed.state.doc.child(2).textContent).toContain("\\forest");
    expect(typed).toContain("\\forest");
  });

  it("the POPUP-LESS door still RUNS an applicable command (control)", () => {
    const ed = mount();
    caretIn(ed, "paragraph");
    typeSlash(ed, "section");
    press(ed, "Escape");
    expect(popup(ed)).toBeNull();
    expect(press(ed, "Enter")).toBe(true);
    const json = ed.state.doc.toJSON() as { content: Array<{ type: string }> };
    expect(json.content[0]!.type).toBe("heading");
    expect(ed.state.doc.child(0).textContent).toBe("alpha beta");
  });

  it("a CLICK on a greyed row is inert too (the other commit door)", () => {
    const ed = mount();
    caretIn(ed, "latexComment");
    typeSlash(ed, "forest");
    const typed = serializeToLatex(ed.state.doc.toJSON() as never);
    const st = popup(ed)!;
    const i = st.filtered.indexOf("forest");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(executeSlashSelectionAt(ed.view, i)).toBe(false);
    expect(serializeToLatex(ed.state.doc.toJSON() as never)).toBe(typed);
  });
});

// ---------------------------------------------------------------------------
// 2. The OFFER carries the registry's verdict
// ---------------------------------------------------------------------------

describe("the popup renders the registry's verdict", () => {
  it.each<Container>(["paragraph", "titleField", "codeBlock", "latexComment"])(
    "%s — `disabled` equals the rows whose applies() is not ok",
    (container) => {
      const ed = mount();
      caretIn(ed, container);
      const expected = registryDisabled(ed);
      typeSlash(ed, "");
      const st = popup(ed)!;
      expect(st.filtered).toEqual([...VIRGIL_COMMAND_NAMES]);
      expect(st.disabled).toEqual(expected);
    },
  );

  it("crosses BOTH regimes — some containers refuse, prose refuses nothing", () => {
    const ed = mount();
    caretIn(ed, "paragraph");
    typeSlash(ed, "");
    expect(popup(ed)!.disabled).toEqual([]);

    const ed2 = mount();
    caretIn(ed2, "codeBlock");
    typeSlash(ed2, "");
    expect(popup(ed2)!.disabled.length).toBeGreaterThan(3);
  });

  it("re-derives when the DOC changes under an unchanged query", () => {
    // A stale verdict is the two-tables defect wearing the fix's clothes, and
    // the branch that can hold one is the `tail === value.query` short-circuit:
    // the caret can move and the block can change TYPE without a single
    // character of the query changing.
    const ed = mount();
    caretIn(ed, "paragraph");
    typeSlash(ed, "fore");
    expect(popup(ed)!.disabled).toEqual([]);
    // Convert the paragraph the popup is anchored in into a markless verbatim
    // block, WITHOUT touching the typed query.
    const at = ed.state.selection.from;
    ed.view.dispatch(
      ed.state.tr.setBlockType(at, at, ed.state.schema.nodes.codeBlock!),
    );
    const st = popup(ed)!;
    expect(st.query).toBe("fore");
    expect(st.disabled).toContain("forest");
  });
});

// ---------------------------------------------------------------------------
// 3. Navigation never lands on a greyed row
// ---------------------------------------------------------------------------

describe("navigation skips greyed rows", () => {
  // The two index helpers are asserted DIRECTLY, and that is not laziness: with
  // today's vocabulary no container produces a row list whose FIRST entry is
  // greyed while a later one is live (`\title`/`\author`/`\date` take the bare
  // `blockApplies`, which is "ok" at any caret, and they lead the list), so an
  // integration leg for the initial selection is vacuous by construction — it
  // passes with the helper deleted. Stated rather than shipped as a leg that
  // looks like it proves something.
  it("firstEnabledIndex skips a greyed leading row", () => {
    expect(firstEnabledIndex(["a", "b", "c"], ["a", "b"])).toBe(2);
    expect(firstEnabledIndex(["a", "b"], [])).toBe(0);
    // Every row greyed ⇒ 0, so the popup always HAS a selection and Enter is a
    // refusal rather than a no-such-row.
    expect(firstEnabledIndex(["a", "b"], ["a", "b"])).toBe(0);
  });

  it("stepEnabledIndex walks past greyed rows and never loops", () => {
    expect(stepEnabledIndex(["a", "b", "c"], ["b"], 0, 1)).toBe(2);
    expect(stepEnabledIndex(["a", "b", "c"], ["b"], 2, -1)).toBe(0);
    expect(stepEnabledIndex(["a", "b", "c"], ["a", "b", "c"], 1, 1)).toBe(1);
    expect(stepEnabledIndex([], [], 0, 1)).toBe(0);
  });

  it("the INITIAL selection is never a greyed row (non-regression pin)", () => {
    const ed = mount();
    caretIn(ed, "titleField");
    typeSlash(ed, "");
    const st = popup(ed)!;
    expect(st.disabled).not.toContain(st.filtered[st.selectedIndex]);
  });

  it("ArrowDown / ArrowUp only ever land on live rows", () => {
    const ed = mount();
    caretIn(ed, "titleField");
    typeSlash(ed, "");
    for (let i = 0; i < 8; i += 1) {
      press(ed, "ArrowDown");
      const st = popup(ed)!;
      expect(st.disabled).not.toContain(st.filtered[st.selectedIndex]);
    }
    for (let i = 0; i < 8; i += 1) {
      press(ed, "ArrowUp");
      const st = popup(ed)!;
      expect(st.disabled).not.toContain(st.filtered[st.selectedIndex]);
    }
  });

  it("arrows are inert (never loop) when every row is greyed", () => {
    const ed = mount();
    caretIn(ed, "codeBlock");
    typeSlash(ed, "quot");
    const before = popup(ed)!.selectedIndex;
    expect(press(ed, "ArrowDown")).toBe(true);
    expect(popup(ed)!.selectedIndex).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 4. CONTROL — prose is byte-identical to the pre-fix behaviour
// ---------------------------------------------------------------------------

describe("control: in prose every command still runs", () => {
  it("\\section converts the block AND removes the typed name", () => {
    const ed = mount();
    caretIn(ed, "paragraph");
    typeSlash(ed, "section");
    expect(popup(ed)!.disabled).not.toContain("section");
    expect(press(ed, "Enter")).toBe(true);
    const json = ed.state.doc.toJSON() as { content: Array<{ type: string }> };
    expect(json.content[0]!.type).toBe("heading");
    expect(ed.state.doc.child(0).textContent).toBe("alpha beta");
  });

  it("\\tex inserts a texBlock at a prose caret", () => {
    const ed = mount();
    caretIn(ed, "paragraph");
    const beforeCount = ed.state.doc.childCount;
    typeSlash(ed, "tex");
    expect(press(ed, "Enter")).toBe(true);
    expect(ed.state.doc.childCount).toBeGreaterThan(beforeCount);
    expect(ed.state.doc.textBetween(0, ed.state.doc.content.size, " ")).not.toContain(
      "\\tex",
    );
  });

  it("every command the registry allows in prose is offered LIVE", () => {
    const ed = mount();
    caretIn(ed, "paragraph");
    typeSlash(ed, "");
    const st = popup(ed)!;
    for (const name of VIRGIL_COMMAND_NAMES) {
      const id = SLASH_NAME_TO_ACTION_ID[name]!;
      const ok =
        VIRGIL_ACTION_REGISTRY[id]!.applies(buildSlashActionContext(ed.view)) ===
        "ok";
      expect(st.disabled.includes(name), `\\${name}`).toBe(!ok);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. The collab read-only gate reaches the OFFER, not just the run
// ---------------------------------------------------------------------------

describe("a read-only pane greys the whole popup", () => {
  it("every row is disabled when the view is not editable", () => {
    const ed = mount();
    caretIn(ed, "paragraph");
    typeSlash(ed, "");
    expect(popup(ed)!.disabled).toEqual([]);
    ed.setEditable(false, false);
    // The verdict door reads `view.editable` (CHIP 7b's uniform gate), so a pen
    // handoff greys every row rather than eating characters on a doc this pane
    // cannot write.
    expect(registryDisabled(ed)).toEqual([...VIRGIL_COMMAND_NAMES]);
  });
});
