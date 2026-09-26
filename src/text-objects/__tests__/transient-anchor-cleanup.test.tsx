// @vitest-environment jsdom
/**
 * TASK 788 — closing a selection-grab popout strips its transient anchor.
 *
 * `useTransientAnchorCleanup` once matched `poppedOutCards` by the literal
 * prefix `"textobject:linkedRange:"`, which the AF grammar flip retired: every
 * live key is minted `float:textobject:linkedRange:<id>`, so the watcher never
 * fired and each closed grab leaked a `\vlid…\vlidend` pair into the .tex.
 * These legs drive the hook with REAL minted keys (`textObjectPopoutKey`),
 * never a hand-written literal, so a future grammar change cannot silently
 * blind it again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Editor } from "@tiptap/react";

const removeTransientAnchor = vi.fn();
vi.mock("@/links/links", () => ({
  removeTransientAnchor: (editor: unknown, id: string) =>
    removeTransientAnchor(editor, id),
}));

import { useTransientAnchorCleanup } from "../useTransientAnchorCleanup";
import { textObjectPopoutKey } from "../text-object-registry";

const editor = { isDestroyed: false } as unknown as Editor;

function mount(initial: readonly string[]) {
  return renderHook(
    ({ keys }: { keys: readonly string[] }) =>
      useTransientAnchorCleanup(editor, keys),
    { initialProps: { keys: initial } },
  );
}

beforeEach(() => removeTransientAnchor.mockClear());

describe("useTransientAnchorCleanup (task 788)", () => {
  it("removes the transient anchor when a minted linkedRange float closes", () => {
    const key = textObjectPopoutKey({ kind: "linkedRange", id: "r1" });
    const { rerender } = mount([key]);
    expect(removeTransientAnchor).not.toHaveBeenCalled();
    rerender({ keys: [] });
    expect(removeTransientAnchor).toHaveBeenCalledTimes(1);
    expect(removeTransientAnchor).toHaveBeenCalledWith(editor, "r1");
  });

  it("only the closed float's anchor is removed; siblings stay", () => {
    const a = textObjectPopoutKey({ kind: "linkedRange", id: "a" });
    const b = textObjectPopoutKey({ kind: "linkedRange", id: "b" });
    const para = textObjectPopoutKey({ kind: "paragraph", id: "p" });
    const { rerender } = mount([a, b, para]);
    rerender({ keys: [b] });
    expect(removeTransientAnchor.mock.calls.map((c) => c[1])).toEqual(["a"]);
  });

  it("ignores non-range floats and card floats", () => {
    const para = textObjectPopoutKey({ kind: "paragraph", id: "p" });
    const { rerender } = mount([para, "float:card:note:n1"]);
    rerender({ keys: [] });
    expect(removeTransientAnchor).not.toHaveBeenCalled();
  });

  it("a grammar re-spelling of the SAME open float is not a close", () => {
    const { rerender } = mount(["textobject:linkedRange:r1"]);
    rerender({ keys: [textObjectPopoutKey({ kind: "linkedRange", id: "r1" })] });
    expect(removeTransientAnchor).not.toHaveBeenCalled();
    rerender({ keys: [] });
    expect(removeTransientAnchor).toHaveBeenCalledWith(editor, "r1");
  });
});
