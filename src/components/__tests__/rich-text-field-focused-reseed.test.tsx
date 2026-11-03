// @vitest-environment jsdom
//
// Task 2026-11-03-1446 — a RichTextField edits a value that lives elsewhere (a
// sidecar card body), so it follows task 532's draft rule: adopt the source
// WHILE the draft is not dirty. Pre-fix its external-value sync simply
// RETURNED while the editor was focused and nothing re-ran it on blur, so an
// agent's edit-card write that landed mid-focus was never shown — and the next
// keystroke wrote the stale body back over it. And a sync that landed while an
// UNFOCUSED edit (a drop) sat in the 250 ms coalescer replaced it, the
// coalescer then reading the SEED back as the user's edit.
//
// Drives the REAL RichTextField. Focus/blur are driven through the editor's
// own focus/blur events (TipTap's `onFocus`/`onBlur` options).
import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

const captured: { editor: import("@tiptap/core").Editor | null } = { editor: null };
vi.mock("@tiptap/react", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...mod,
    useEditor: (...args: Parameters<typeof mod.useEditor>) => {
      const ed = mod.useEditor(...args);
      if (ed) captured.editor = ed;
      return ed;
    },
  };
});

import { act, cleanup, render } from "@testing-library/react";
import type { JSONContent } from "@tiptap/react";
import RichTextField from "@/components/RichTextField";

afterEach(() => {
  cleanup();
  captured.editor = null;
  vi.useRealTimers();
});

const body = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function mount(initial: JSONContent) {
  const onChange = vi.fn();
  const view = render(
    <RichTextField value={initial} instanceKey="focused-reseed" onChange={onChange} />,
  );
  const editor = captured.editor;
  if (!editor) throw new Error("RichTextField minted no editor");
  const rerender = (next: JSONContent) =>
    view.rerender(
      <RichTextField value={next} instanceKey="focused-reseed" onChange={onChange} />,
    );
  return { editor, onChange, rerender };
}

function focus(editor: import("@tiptap/core").Editor) {
  act(() => {
    editor.emit("focus", { editor, event: new FocusEvent("focus"), transaction: editor.state.tr });
  });
}
function blur(editor: import("@tiptap/core").Editor) {
  act(() => {
    editor.emit("blur", { editor, event: new FocusEvent("blur"), transaction: editor.state.tr });
  });
}
function typeAtEnd(editor: import("@tiptap/core").Editor, text: string) {
  act(() => {
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(editor.state.tr.insertText(text, end));
  });
}
const lastOnChangeText = (onChange: ReturnType<typeof vi.fn>) => {
  const doc = onChange.mock.calls.at(-1)?.[0] as JSONContent | undefined;
  return doc?.content?.[0]?.content?.[0]?.text;
};

describe("RichTextField reconciles an external value held back by focus (task 1446)", () => {
  it("a value that lands while focused is shown on blur, and no stale onChange is written", () => {
    const { editor, onChange, rerender } = mount(body("old"));
    focus(editor);
    rerender(body("agent wrote this"));
    // Held while focused — the caret is not fought.
    expect(editor.getText()).toBe("old");
    blur(editor);
    expect(editor.getText()).toBe("agent wrote this");
    expect(onChange).not.toHaveBeenCalled();
    // And the next keystroke builds on the NEW body, not the stale one.
    vi.useFakeTimers();
    typeAtEnd(editor, "!");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(lastOnChangeText(onChange)).toBe("agent wrote this!");
  });

  it("a focused, typed edit is never overwritten by the seed it outlived — theirs wins", () => {
    const { editor, onChange, rerender } = mount(body("old"));
    focus(editor);
    typeAtEnd(editor, " typed");
    rerender(body("agent wrote this"));
    blur(editor);
    expect(lastOnChangeText(onChange)).toBe("old typed");
    expect(editor.getText()).toBe("old typed");
  });

  it("an unfocused edit pending in the coalescer survives a concurrent re-seed", () => {
    vi.useFakeTimers();
    const { editor, onChange, rerender } = mount(body("old"));
    // A drop dispatches without focusing.
    typeAtEnd(editor, " dropped");
    rerender(body("old"));
    rerender(body("re-seeded"));
    expect(editor.getText()).toBe("old dropped");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(lastOnChangeText(onChange)).toBe("old dropped");
  });
});
