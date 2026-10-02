// @vitest-environment jsdom
//
// Task 891 — the inline-MARK toggles are reachable from the backslash popup
// (`\sc` / `\textsc` for small caps, `\bf` / `\textbf`, …), their names DERIVED
// from the wrapper-mark table's `slash` column.
//
// Drives the REAL `commands.ts` vocabulary + commit door and a REAL published
// bridge handle (mirroring EditorPane, as `list-quote-slash.test.ts` does)
// against the REAL schema.
//
// WHAT IS PROVEN
//   1. the popup vocabulary offers every table-derived name, and NOT the marks
//      the table leaves slash-less (underline, textcolor);
//   2. committing `\sc` at a COLLAPSED caret deletes the typed text and leaves a
//      STORED mark — the next typed characters are small caps, saved `\textsc{…}`;
//   3. with a selection the same action marks the selection;
//   4. the Enter door does not fire on `\textbf{` (a brace ends the name);
//   5. vocabulary ↔ registry: every slash name of a table `slash` row maps to
//      the format row that toggles that mark.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  commitSlashCommand,
  VIRGIL_COMMAND_NAMES,
} from "@/lib/tiptap/commands";
import {
  SLASH_NAME_TO_ACTION_ID,
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
  type ActionRef,
  type EditorActionsHandle,
} from "@/lib/actions/action-registry";
import { __setEditorActionsHandleForTest } from "@/lib/actions/editor-actions-bridge";
import { markSlashNames, SLASH_MARK_TYPES } from "@/lib/mark-composition";
import { serializeToLatex } from "@/lib/latex-serializer";
import { paragraphUuidAt } from "@/links/links";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

function mountEditor(text: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
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
}

/** Publish a bridge handle like EditorPane: ctx from the LIVE editor (which has
 *  `.chain()`), the live selection as the ref, then `applies()` → `run()`. */
function publishHandle(editor: Editor): void {
  const handle: EditorActionsHandle = {
    runAction(id: ActionId, seed) {
      const spec = VIRGIL_ACTION_REGISTRY[id];
      if (!spec) return;
      const { from, to } = editor.state.selection;
      const paragraphId = paragraphUuidAt(editor.state.doc, from) ?? "";
      const ref: ActionRef =
        from === to
          ? { kind: "cursor", pos: from, paragraphId }
          : { kind: "selection", from, to, paragraphId };
      const ctx: ActionContext = {
        editor,
        view: editor.view,
        ref,
        surface: seed.surface,
        canEdit: editor.isEditable,
        payload: seed.payload,
      };
      if (spec.applies(ctx) === "disabled") return;
      void spec.run(ctx);
    },
  };
  __setEditorActionsHandleForTest(handle);
}

function typeText(editor: Editor, text: string): void {
  const { view } = editor;
  view.dispatch(view.state.tr.insertText(text));
}

function save(editor: Editor): string {
  return serializeToLatex(editor.getJSON() as JSONContent);
}

afterEach(() => {
  __setEditorActionsHandleForTest(null);
  document.body.innerHTML = "";
});

describe("mark slash commands — the vocabulary (derived from the mark table)", () => {
  it("offers `\\sc` and `\\textsc`, and every short alias", () => {
    for (const name of ["sc", "textsc", "bf", "textbf", "it", "em", "emph", "textit", "sout", "tt", "texttt"]) {
      expect(VIRGIL_COMMAND_NAMES, `\\${name}`).toContain(name);
    }
    // the popup's prefix filter is `startsWith` over the same list
    expect(VIRGIL_COMMAND_NAMES.filter((n) => n.startsWith("sc"))).toEqual(["sc"]);
  });

  it("leaves the slash-less marks out (underline has no format action; textcolor needs an argument)", () => {
    expect(VIRGIL_COMMAND_NAMES).not.toContain("underline");
    expect(VIRGIL_COMMAND_NAMES).not.toContain("textcolor");
  });

  it("every slash name of a table `slash` row maps to the format row that toggles that mark", () => {
    const MARK_TO_ACTION: Record<string, ActionId> = {
      bold: "bold",
      italic: "italic",
      strike: "strike",
      smallCaps: "small-caps",
      code: "code",
    };
    expect([...SLASH_MARK_TYPES].sort()).toEqual(Object.keys(MARK_TO_ACTION).sort());
    for (const mark of SLASH_MARK_TYPES) {
      const id = MARK_TO_ACTION[mark]!;
      const names = markSlashNames(mark);
      expect(names.length, mark).toBeGreaterThan(0);
      for (const name of names) {
        expect(SLASH_NAME_TO_ACTION_ID[name], `\\${name}`).toBe(id);
      }
      const row = VIRGIL_ACTION_REGISTRY[id]!;
      expect([row.slashName, ...(row.slashAliases ?? [])]).toEqual([...names]);
    }
  });
});

describe("mark slash commands — commit (via the bridge)", () => {
  it("`\\sc` at a collapsed caret: the typed `\\sc` goes, and the next typed text is small caps", () => {
    const editor = mountEditor("See \\sc");
    publishHandle(editor);
    const end = editor.state.doc.child(0).nodeSize - 1; // end of the paragraph
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)),
    );
    const ran = commitSlashCommand(editor.view, "sc", end - 3, end);
    expect(ran).toBe(true);
    expect(editor.state.doc.textContent).toBe("See ");
    // the stored mark survived the delete transaction
    expect(editor.state.storedMarks?.map((m) => m.type.name)).toContain("smallCaps");
    typeText(editor, "Smith");
    expect(save(editor)).toContain("See \\textsc{Smith}");
    editor.destroy();
  });

  it("`\\textsc` with a selection marks the selection", () => {
    const editor = mountEditor("Alpha beta");
    publishHandle(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    // commit over an empty range (nothing typed to delete) keeps the selection
    const ran = commitSlashCommand(editor.view, "textsc", 1, 1);
    expect(ran).toBe(true);
    expect(save(editor)).toContain("\\textsc{Alpha} beta");
    editor.destroy();
  });

  it("`\\bf` toggles bold, saved as `\\textbf`", () => {
    const editor = mountEditor("\\bf");
    publishHandle(editor);
    const end = editor.state.doc.child(0).nodeSize - 1;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)),
    );
    expect(commitSlashCommand(editor.view, "bf", end - 3, end)).toBe(true);
    typeText(editor, "loud");
    expect(save(editor)).toContain("\\textbf{loud}");
    editor.destroy();
  });

  it("the Enter door does not fire on `\\textbf{` — a brace ends the name", () => {
    const editor = mountEditor("raw \\textbf{");
    publishHandle(editor);
    const end = editor.state.doc.child(0).nodeSize - 1;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)),
    );
    const plugin = editor.state.plugins.find((p) =>
      (p as unknown as { key: string }).key.startsWith("virgilCommands$"),
    );
    expect(plugin).toBeTruthy();
    const handled = plugin!.props.handleKeyDown!.call(
      plugin!,
      editor.view,
      new KeyboardEvent("keydown", { key: "Enter" }),
    );
    expect(handled).toBe(false);
    expect(editor.state.doc.textContent).toBe("raw \\textbf{");
    editor.destroy();
  });
});
