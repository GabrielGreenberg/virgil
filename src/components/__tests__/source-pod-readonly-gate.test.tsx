// @vitest-environment jsdom
/**
 * TASK 728 — the source pod's read-only gate, for BOTH wearers.
 *
 * `view.editable` is pinned `true` always (Editor.tsx); read-only /
 * partner-claimed is enforced downstream by `readOnlyEnforcer`'s
 * `filterTransaction`, which drops every `docChanged` transaction that does
 * not carry `ignoreReadOnly`. Every write a source pod makes — its source
 * attr, `parTitle`, `collapsed`, its own delete — is a `setNodeMarkup`, so
 * every one of them is dropped. Ungated, the pod accepted a whole tikz
 * picture, showed it as if saved, and lost it at the next re-render; the
 * delete button ran its confirm dialog and then did nothing.
 *
 * Both suites below are planted in the FALSIFYING direction: each read-only
 * assertion has an editable twin proving the affordance is really there when
 * the doc is writable, so removing the gate flips the read-only leg red
 * rather than making both legs vacuous.
 *
 * The extension barrel transitively imports `@/lib/storage` (the known
 * barrel/storage gotcha) — stub it wholesale; nothing here calls a storage fn.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

/** Captured props of every CodeMirror surface mounted in a test. Only the
 *  React COMPONENT is stubbed — the module's `EditorView` / `EditorState`
 *  re-exports stay real, because both pods build a theme and an extension
 *  list from them at module scope. */
type CmProps = { editable?: boolean; onChange?: (v: string) => void };
const cmMounts: CmProps[] = [];
vi.mock("@uiw/react-codemirror", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  default: (props: CmProps) => {
    cmMounts.push(props);
    return <div data-testid="cm" data-cm-editable={String(props.editable)} />;
  },
}));
// Partial: the in-place pod's NodeViewWrapper needs a NodeView context it has
// no business having in a unit test, but the module is imported transitively
// by half the editor and must otherwise stay real.
vi.mock("@tiptap/react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  NodeViewWrapper: ({ children, ...rest }: { children?: React.ReactNode }) => (
    <div {...rest}>{children}</div>
  ),
}));

// jsdom has no ResizeObserver; some chrome paths measure with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Editor as TiptapEditor, JSONContent, NodeViewProps } from "@tiptap/react";
import SourcePodNodeView, { type SourcePodConfig } from "@/components/SourcePodNodeView";
import { SourcePodFloatBody } from "@/text-objects/floats/source-pod-body";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import type { EditorHandle } from "@/components/Editor";

beforeEach(() => {
  cmMounts.length = 0;
});
afterEach(cleanup);

const lastCm = () => cmMounts[cmMounts.length - 1];

// ── The docked pod (SourcePodNodeView) ─────────────────────────────────────

const CONFIG: SourcePodConfig = {
  hostClass: "tex-block",
  sourceAttr: "code",
  chipLabel: ".tex",
  kindLabel: "LaTeX block",
  emptyLabel: "(empty .tex)",
  confirmMessage: "Delete this block?",
};

/** A stand-in for the pod's host editor carrying the ONE declarative signal
 *  `useMainEditable` reads — the same attribute `Editor.tsx` mirrors its
 *  `editable` prop onto. */
function hostEditor(editable: boolean): NodeViewProps["editor"] {
  const dom = document.createElement("div");
  dom.className = "ProseMirror";
  dom.setAttribute("data-editable", String(editable));
  document.body.appendChild(dom);
  return { view: { dom } } as unknown as NodeViewProps["editor"];
}

function renderDocked(editable: boolean, attrs: Record<string, unknown> = {}) {
  const node = {
    attrs: { code: "\\emph{x}", collapsed: false, parTitle: null, ...attrs },
  };
  const updateAttributes = vi.fn();
  const deleteNode = vi.fn();
  const view = render(
    <SourcePodNodeView
      node={node as never}
      updateAttributes={updateAttributes}
      deleteNode={deleteNode}
      editor={hostEditor(editable)}
      config={CONFIG}
      cardContext={false}
    />,
  );
  return { view, updateAttributes, deleteNode };
}

describe("source pod — docked read-only gate", () => {
  it("mounts CodeMirror non-editable and drops a write attempt", () => {
    const { updateAttributes } = renderDocked(false);
    expect(lastCm().editable).toBe(false);
    act(() => lastCm().onChange?.("\\begin{tikzpicture}\\end{tikzpicture}"));
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it("mounts CodeMirror editable and lets a write through on a writable doc", () => {
    const { updateAttributes } = renderDocked(true);
    expect(lastCm().editable).toBe(true);
    act(() => lastCm().onChange?.("\\begin{tikzpicture}\\end{tikzpicture}"));
    expect(updateAttributes).toHaveBeenCalledWith({
      code: "\\begin{tikzpicture}\\end{tikzpicture}",
    });
  });

  it("renders no delete, no fold chevron and no +T read-only", () => {
    const { view } = renderDocked(false);
    expect(view.container.querySelector(".source-pod-delete")).toBeNull();
    expect(view.container.querySelector(".source-pod-fold-chevron")).toBeNull();
    expect(view.container.querySelector(".par-title-add")).toBeNull();
  });

  it("renders all three on a writable doc", () => {
    const { view } = renderDocked(true);
    expect(view.container.querySelector(".source-pod-delete")).not.toBeNull();
    expect(view.container.querySelector(".source-pod-fold-chevron")).not.toBeNull();
    expect(view.container.querySelector(".par-title-add")).not.toBeNull();
  });

  it("shows an existing title as plain text, with no × and no way into edit mode", () => {
    const { view, updateAttributes } = renderDocked(false, { parTitle: "Tree A" });
    const text = view.container.querySelector(".par-title-text");
    expect(text?.textContent).toBe("Tree A");
    expect(view.container.querySelector(".par-title-delete")).toBeNull();
    fireEvent.click(text!);
    expect(view.container.querySelector(".par-title-input")).toBeNull();
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it("a collapsed pod offers no expand affordance read-only", () => {
    const { view, updateAttributes } = renderDocked(false, { collapsed: true });
    const preview = view.container.querySelector(".source-pod-preview");
    expect(preview).not.toBeNull();
    expect(preview!.getAttribute("data-hint")).toBeNull();
    fireEvent.click(preview!);
    expect(updateAttributes).not.toHaveBeenCalled();
  });

  it("a collapsed pod on a writable doc still expands on click", () => {
    const { view, updateAttributes } = renderDocked(true, { collapsed: true });
    fireEvent.click(view.container.querySelector(".source-pod-preview")!);
    expect(updateAttributes).toHaveBeenCalledWith({ collapsed: false });
  });
});

// ── The float twin (SourcePodFloatBody) ────────────────────────────────────

const TEX_UUID = "texflt01";

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

function texDoc(): JSONContent {
  return {
    type: "doc",
    content: [
      { type: "texBlock", attrs: { uuid: TEX_UUID, code: "\\emph{x}" } },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ],
  };
}

/** Build a main editor mirroring the live read-only signal: the PM view stays
 *  editable, `data-editable` is the declarative flag the float reads. */
function buildMainWith(editable: boolean): TiptapEditor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ed = new Editor({
    element: el,
    extensions: buildEditorExtensions(mainCtx()),
    content: texDoc(),
  }) as unknown as TiptapEditor;
  ed.view.dom.setAttribute("data-editable", String(editable));
  return ed;
}

function handleFor(editor: TiptapEditor): EditorHandle {
  return { getEditor: () => editor } as unknown as EditorHandle;
}

function codeAttr(ed: TiptapEditor): string {
  let found = "";
  ed.state.doc.descendants((n) => {
    if (n.type.name === "texBlock" && n.attrs.uuid === TEX_UUID) {
      found = (n.attrs.code as string) ?? "";
      return false;
    }
    return true;
  });
  return found;
}

function renderFloat(editable: boolean) {
  const ed = buildMainWith(editable);
  const view = render(
    <SourcePodFloatBody
      cardKey="textobject:texBlock:texflt01"
      id={TEX_UUID}
      editorRef={{ current: handleFor(ed) }}
      cardContext={false}
      setHeaderLabel={() => {}}
      config={{ kind: "texBlock", sourceAttr: "code", chipLabel: ".tex" }}
    />,
  );
  return { ed, view };
}

describe("source pod — float read-only gate", () => {
  it("mounts CodeMirror non-editable and writes nothing back to main", () => {
    const { ed } = renderFloat(false);
    expect(lastCm().editable).toBe(false);
    act(() => lastCm().onChange?.("\\begin{forest}[a]\\end{forest}"));
    expect(codeAttr(ed)).toBe("\\emph{x}");
  });

  it("mounts CodeMirror editable and writes back on a writable doc", () => {
    const { ed } = renderFloat(true);
    expect(lastCm().editable).toBe(true);
    act(() => lastCm().onChange?.("\\begin{forest}[a]\\end{forest}"));
    expect(codeAttr(ed)).toBe("\\begin{forest}[a]\\end{forest}");
  });

  it("offers no way into the title field read-only", () => {
    const { view } = renderFloat(false);
    fireEvent.click(view.container.querySelector(".par-title-annotation")!);
    expect(view.container.querySelector(".par-title-input")).toBeNull();
  });

  it("opens the title field on a writable doc", () => {
    const { view } = renderFloat(true);
    fireEvent.click(view.container.querySelector(".par-title-annotation")!);
    expect(view.container.querySelector(".par-title-input")).not.toBeNull();
  });
});
