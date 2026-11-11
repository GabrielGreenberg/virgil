// @vitest-environment jsdom
//
// Task 1569 — a refused linked-range write shows its notice and does not
// overflow the stack.
//
// `reportRefusal` called `setEditable(false)`, whose default emits `update`,
// which re-entered `onUpdate` → the write-back → the same refusal, so the
// notice was never set. Mounts the real body with a primed range; only the
// planner's verdict is forced, because a real write-time refusal needs main to
// change under the float into content that will not fit.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

const planned = vi.hoisted(() => ({ calls: 0, refuse: false }));

vi.mock("@/lib/linked-range-writeback", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/linked-range-writeback")>();
  return {
    ...real,
    planLinkedRangeWriteBack: (...args: Parameters<typeof real.planLinkedRangeWriteBack>) => {
      planned.calls++;
      return planned.refuse
        ? { ok: false as const, reason: "forced", constructs: ["widget"] }
        : real.planLinkedRangeWriteBack(...args);
    },
  };
});

import { createRef, type ComponentProps, type RefObject } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions } from "@/lib/editor-extensions";
import type { EditorHandle } from "@/components/Editor";
import { LinkedRangeBody } from "@/text-objects/floats/linked-range-body";

const mains: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const e of mains.splice(0)) e.destroy();
  planned.calls = 0;
  planned.refuse = false;
});

function mountMain(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: buildEditorExtensions({
      surface: "main",
      editableRef: { current: true },
      editable: true,
      cardContext: false,
      callbacks: {},
      docIdRef: { current: null },
      anchoredUuidsRef: { current: new Set<string>() },
      host: null,
    }),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "linked words",
              marks: [{ type: "linkedAnchor", attrs: { anchorId: "a1", kind: "transient" } }],
            },
          ],
        },
      ],
    },
  });
  mains.push(editor);
  return editor;
}

async function mountBody(main: Editor): Promise<Editor> {
  const editorRef = createRef<EditorHandle | null>() as RefObject<EditorHandle | null>;
  editorRef.current = { getEditor: () => main } as unknown as EditorHandle;
  const props = {
    id: "a1",
    editorRef,
    setHeaderLabel: () => {},
  } as unknown as ComponentProps<typeof LinkedRangeBody>;
  const { container } = render(<LinkedRangeBody {...props} />);
  await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull());
  return (container.querySelector(".ProseMirror") as HTMLElement & { editor: Editor }).editor;
}

describe("a write-time linked-range refusal (task 1569)", () => {
  it("names the refusal, goes read-only and plans exactly once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const float = await mountBody(mountMain());
    expect(float.isEditable).toBe(true);

    planned.refuse = true;
    planned.calls = 0;
    let threw: unknown = null;
    act(() => {
      try {
        float.commands.insertContent("x");
      } catch (err) {
        threw = err;
      }
    });

    expect(threw).toBeNull();
    expect(planned.calls).toBe(1);
    await waitFor(() => expect(float.isEditable).toBe(false));
    expect(screen.getByText(/widget/)).toBeTruthy();
    expect(planned.calls).toBe(1);
    warn.mockRestore();
  });
});
