// @vitest-environment jsdom
/**
 * TASK 730 (the durable half) — a source-pod float never writes back a buffer
 * it seeded at mount.
 *
 * The float body holds its source in LOCAL state, seeded once from the node,
 * and writes the whole string back on every keystroke. On its own that is a
 * last-write-wins clobber: edit the docked pod, then type one character in the
 * float, and the float replaces the docked edit with its own pre-edit buffer
 * plus that character. Undo recovers it; nothing says anything was lost.
 *
 * What keeps that unreachable is TWO things, and this suite pins the second so
 * a future change cannot quietly rely on the first alone:
 *   1. `.is-popped` — the docked pod goes `pointer-events: none` while the
 *      float is open, so there is normally no second writer at all. That is
 *      what task 730 fixed for `forestBlock` (source-pod-popped-dim.test.tsx).
 *   2. The float RE-READS its node on any main transaction that touched its
 *      source and wasn't its own write (`useMainTransactionSync` →
 *      `syncFromMain`). So even where a second writer does get through — an
 *      agent write, an undo, a `.tex` re-parse, a future path that un-dims the
 *      docked pod — the float converges on the document instead of overwriting
 *      it from a stale buffer.
 *
 * Planted in the falsifying direction: the final assertion demands the EXACT
 * post-external-edit string, so a float that kept its mount-time buffer fails
 * with the clobbered value rather than passing vacuously.
 *
 * The extension barrel transitively imports `@/lib/storage` (the known
 * barrel/storage gotcha) — stub it wholesale; nothing here calls a storage fn.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

type CmProps = { value?: string; onChange?: (v: string) => void };
const cmMounts: CmProps[] = [];
vi.mock("@uiw/react-codemirror", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  default: (props: CmProps) => {
    cmMounts.push(props);
    return <div data-testid="cm" />;
  },
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { SourcePodFloatBody } from "@/text-objects/floats/source-pod-body";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import type { EditorHandle } from "@/components/Editor";

beforeEach(() => {
  cmMounts.length = 0;
});
afterEach(cleanup);

const UUID = "forestflt1";
const SEEDED = "\\begin{forest}[a]\\end{forest}";
const DOCKED_EDIT = "\\begin{forest}[a[b]]\\end{forest}";

const lastCm = () => cmMounts[cmMounts.length - 1];

function mainCtx(): EditorExtensionsCtx {
  return {
    cardContext: false,
    callbacks: {},
  } as unknown as EditorExtensionsCtx;
}

function buildMain(): TiptapEditor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ed = new Editor({
    element: el,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        { type: "forestBlock", attrs: { uuid: UUID, source: SEEDED } },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    },
  }) as unknown as TiptapEditor;
  ed.view.dom.setAttribute("data-editable", "true");
  return ed;
}

function sourceAttr(ed: TiptapEditor): string {
  let found = "";
  ed.state.doc.descendants((n) => {
    if (n.type.name === "forestBlock" && n.attrs.uuid === UUID) {
      found = (n.attrs.source as string) ?? "";
      return false;
    }
    return true;
  });
  return found;
}

/** A write into main from somewhere OTHER than this float — what the docked
 *  pod's CodeMirror does. Deliberately carries no `FLOAT_WRITE_META`. */
function externalEdit(ed: TiptapEditor, next: string) {
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (n.type.name === "forestBlock" && n.attrs.uuid === UUID) {
      pos = p;
      return false;
    }
    return true;
  });
  const node = ed.state.doc.nodeAt(pos)!;
  ed.view.dispatch(
    ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, source: next }),
  );
}

describe("source-pod float — an external edit is not clobbered", () => {
  it("re-reads its source on an external write, so the next float keystroke builds on it", () => {
    const ed = buildMain();
    render(
      <SourcePodFloatBody
        cardKey={`float:textobject:forestBlock:${UUID}`}
        id={UUID}
        editorRef={{ current: { getEditor: () => ed } as unknown as EditorHandle }}
        cardContext={false}
        setHeaderLabel={() => {}}
        config={{ kind: "forestBlock", sourceAttr: "source", chipLabel: "forest" }}
      />,
    );
    expect(lastCm().value).toBe(SEEDED);

    // Someone else edits the block in the main document.
    act(() => externalEdit(ed, DOCKED_EDIT));
    expect(lastCm().value).toBe(DOCKED_EDIT);

    // One keystroke in the float now extends the EXTERNAL text, not the
    // mount-time buffer. Against a float that never re-read, main would come
    // back as SEEDED + "%" and the external edit would be gone.
    act(() => lastCm().onChange?.(`${DOCKED_EDIT}%`));
    expect(sourceAttr(ed)).toBe(`${DOCKED_EDIT}%`);
  });
});
