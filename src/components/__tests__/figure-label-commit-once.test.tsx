// @vitest-environment jsdom
/**
 * TASK 555 — the figure lozenge's label edit ends exactly ONCE.
 *
 * `commit` opened with `if (!editing) return;` — the SAME permanently-true
 * captured guard task 529 retired from `SourcePodNodeView`. The input renders
 * only while `editing`, so every `commit` a mounted input can reach captured
 * `editing === true`: the guard its author wrote to stop a second commit could
 * never fire. A guard that is always true is a lie in the source, and this one
 * was covering a LIVE double-commit rather than merely reading oddly.
 *
 * The mechanism is 529's, and it needs the real dialog to be visible: the
 * commit is ASYNC (it awaits the host's rename confirm) and a dialog FOCUSES
 * its cued default (task 389). That focus steal blurs an input that is still
 * mounted, React delegates `onBlur` off the synchronous `focusout`, and the
 * blur's own `commit("blur")` runs from the same stale closure — a second
 * `renameLabelWithRefs`, a second dialog, over a document the first one has
 * already rewritten.
 *
 * So the confirm here BLURS the input before resolving, which is what the
 * production dialog does, and the legs count DOOR ENTRIES (`renameLabelWithRefs`
 * asks its confirm once per attempt) rather than reading the rendered chrome.
 *
 * No pre-555 suite could see this: `figure-lozenge-keyboard` drives the same
 * lozenge and asserts the button CONTRACT, and every other figure fixture
 * renames a label no `\ref` points at — so the confirm never fires and the
 * second attempt has nothing to announce itself with.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

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

import { Editor, type Content } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { findNodeByUuid } from "@/lib/tiptap/structural-edit";
import FigureAnnotation from "@/components/FigureAnnotation";

afterEach(cleanup);

const FIG = "uuid-fig";

/** A figure carrying `label`, and a `\ref` that names it — the ref is what
 *  makes `renameLabelWithRefs` ASK, and therefore what makes a second attempt
 *  observable at all. */
function content(label: string): Content {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "p-1" },
        content: [
          { type: "text", text: "See " },
          {
            type: "labelRef",
            attrs: { label, refCommand: "\\ref", targetKind: "figure", displayText: "1" },
          },
          { type: "text", text: "." },
        ],
      },
      {
        type: "figureBlock",
        attrs: { uuid: FIG, label, numbered: true, sources: [{ path: "a.png", options: "" }] },
        content: [{ type: "figureCaption", content: [{ type: "text", text: "A caption" }] }],
      },
    ],
  };
}

function mount(label = "fig:a") {
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: content(label),
  });
  return { editor, teardown: () => { editor.destroy(); el.remove(); } };
}

const figureOf = (editor: Editor) => findNodeByUuid(editor, FIG);

/** Renders the lozenge and opens its label input, focused as the real
 *  affordance leaves it. `.blur()` is inert on an unfocused element, so
 *  without the focus the whole mechanism under test cannot fire. */
function openLabelInput(
  editor: Editor,
  onConfirmRename: ((o: string, n: string, c: number) => Promise<boolean>) | null,
) {
  const utils = render(
    <FigureAnnotation
      editor={editor}
      label="fig:a"
      numbered
      canNumber
      getFigurePos={() => figureOf(editor)?.pos ?? null}
      onConfirmRename={onConfirmRename}
      onConfirmDelete={null}
    />,
  );
  fireEvent.click(utils.container.querySelector(".figure-label-text") as HTMLElement);
  const input = utils.container.querySelector("input") as HTMLInputElement;
  expect(input).toBeTruthy();
  input.focus();
  return { ...utils, input };
}

describe("figure label — the edit session ends exactly ONCE (task 555)", () => {
  it("Enter asks the rename confirm ONCE, even though the dialog steals focus", async () => {
    const { editor, teardown } = mount();
    try {
      const asked: string[] = [];
      let input!: HTMLInputElement;
      const confirm = vi.fn(async (oldL: string, newL: string) => {
        asked.push(`${oldL}->${newL}`);
        // What the real dialog does: focus its cued default, which blurs an
        // input that is still mounted. Pre-555 this ran the blur's own commit
        // from the stale closure and asked a SECOND time.
        input.blur();
        return true;
      });

      const opened = openLabelInput(editor, confirm);
      input = opened.input;

      fireEvent.change(input, { target: { value: "fig:renamed" } });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(asked).toEqual(["fig:a->fig:renamed"]);
      expect(figureOf(editor)?.node.attrs.label).toBe("fig:renamed");
    } finally {
      teardown();
    }
  });

  it("a conflicting candidate is REFUSED and the input stays open", async () => {
    const { editor, teardown } = mount();
    try {
      // A second declaration claims the key the user is typing.
      editor.commands.insertContentAt(0, {
        type: "heading",
        attrs: { level: 1, uuid: "h-1", label: "fig:taken" },
        content: [{ type: "text", text: "Head" }],
      });

      const confirm = vi.fn(async () => true);
      const { input, container } = openLabelInput(editor, confirm);

      fireEvent.change(input, { target: { value: "fig:taken" } });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
        await Promise.resolve();
      });

      // Nothing written, nothing asked, and the user is still editing.
      expect(confirm).not.toHaveBeenCalled();
      expect(figureOf(editor)?.node.attrs.label).toBe("fig:a");
      expect(container.querySelector("input")).toBeTruthy();
    } finally {
      teardown();
    }
  });

  it("Escape abandons the draft, writing nothing", async () => {
    const { editor, teardown } = mount();
    try {
      const confirm = vi.fn(async () => true);
      const { input, container } = openLabelInput(editor, confirm);

      fireEvent.change(input, { target: { value: "fig:renamed" } });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Escape" });
        await Promise.resolve();
      });

      expect(confirm).not.toHaveBeenCalled();
      expect(figureOf(editor)?.node.attrs.label).toBe("fig:a");
      expect(container.querySelector("input")).toBeNull();
    } finally {
      teardown();
    }
  });

  it("blurring away with a CONFLICTING draft abandons it rather than trapping focus", async () => {
    const { editor, teardown } = mount();
    try {
      editor.commands.insertContentAt(0, {
        type: "heading",
        attrs: { level: 1, uuid: "h-1", label: "fig:taken" },
        content: [{ type: "text", text: "Head" }],
      });

      const confirm = vi.fn(async () => true);
      const { input, container } = openLabelInput(editor, confirm);

      fireEvent.change(input, { target: { value: "fig:taken" } });
      await act(async () => {
        fireEvent.blur(input);
        await Promise.resolve();
      });

      expect(confirm).not.toHaveBeenCalled();
      expect(figureOf(editor)?.node.attrs.label).toBe("fig:a");
      expect(container.querySelector("input")).toBeNull();
    } finally {
      teardown();
    }
  });
});
