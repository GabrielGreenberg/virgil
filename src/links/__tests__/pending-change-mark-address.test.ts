// @vitest-environment jsdom
//
// Task 1641 — a pending AI change is addressed by its OWN MARK, never by
// searching for its text.
//
// Before 1641 every verb after the splice re-found the change by text: the
// apply stamped its blue mark with a PLAIN-text search for a LaTeX string (so
// a replacement carrying `\emph{…}` or a `\vcid{…}` was never marked), and
// Dismiss dropped the mark first and restored the original at the FIRST
// occurrence of the replacement. The verbs also returned nothing, so a
// Dismiss that spliced nothing still archived the card as rejected.
//
// Real editor stack (the apply-suggestion.test.ts pattern) — the schema, the
// serializer's `\vlid` pair and the reparse are what is under test.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type Content } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { serializeParagraphInline } from "@/lib/latex-serializer";
import { findNodeByUuid } from "@/lib/tiptap/structural-edit";
import {
  applyPendingChange,
  keepPendingChange,
  revertPendingChange,
} from "@/links/apply-suggestion";
import { reapplyPendingMarks } from "@/links/_shared/reapply-pending-marks";
import {
  dismissSuggestion,
  previewOriginal,
  previewSuggested,
  keepSuggestion,
  type AppliedChangeDescriptor,
  type PendingChangeCardDeps,
} from "@/links/pending-change-actions";
import { getPreviewDir, resetPreviewDir } from "@/links/pending-preview-store";

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

const P = "a1b2";
const CARD = "card-1641";
const ANCHOR = "anc-1641";

function para(content: Content[]): Content {
  return {
    type: "doc",
    content: [{ type: "paragraph", attrs: { uuid: P }, content }],
  } as Content;
}

function mount(content: Content): { editor: Editor; cleanup: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content,
  });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

/** The serialization of the (only) paragraph, wherever its uuid now is. */
function inline(editor: Editor): string {
  const node = editor.state.doc.firstChild;
  return node ? serializeParagraphInline(node.toJSON()) : "";
}

function markedText(editor: Editor, anchorId = ANCHOR): string {
  let out = "";
  editor.state.doc.descendants((node) => {
    if (
      node.isText &&
      node.marks.some(
        (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
      )
    )
      out += node.text ?? "";
    return true;
  });
  return out;
}

function markKind(editor: Editor): unknown {
  let kind: unknown = null;
  editor.state.doc.descendants((node) => {
    for (const m of node.marks)
      if (m.type.name === "linkedAnchor" && m.attrs.anchorId === ANCHOR)
        kind = m.attrs.kind;
    return true;
  });
  return kind;
}

function apply(
  editor: Editor,
  originalText: string,
  replacement: string,
  extra: { replacementAuthor?: "human" | "ai" } = {},
) {
  return applyPendingChange(editor, {
    anchorUuid: P,
    originalText,
    replacement,
    mode: replacement === "" ? "delete" : "replace",
    cardId: CARD,
    anchorId: ANCHOR,
    family: "revision-suggestion",
    ...extra,
  });
}

/** A deps bag over ONE applied card, with recording mutators. */
function depsFor(ac: AppliedChangeDescriptor) {
  const state = {
    status: "applied" as string,
    archived: false,
    applied: ac as AppliedChangeDescriptor | undefined,
  };
  const deps: PendingChangeCardDeps = {
    getAppliedChange: () => state.applied,
    setSuggestionStatus: (_id, s) => { state.status = s; },
    setArchived: (_id, a) => { state.archived = a; },
    setAppliedChange: (_id, v) => { state.applied = v; },
    family: "revision-suggestion",
  };
  return { state, deps };
}

describe("task 1641 — Dismiss restores AT the change, not at the first copy", () => {
  it("'dog'→'cat' after an earlier 'cat': Dismiss restores the SECOND occurrence", () => {
    const { editor, cleanup } = mount(
      para([{ type: "text", text: "the cat sat. The dog ran." }]),
    );
    try {
      expect(apply(editor, "dog", "cat").ok).toBe(true);
      expect(inline(editor)).toContain("the cat sat. The \\vlid{");
      const res = revertPendingChange(editor, {
        anchorUuid: P,
        originalText: "dog",
        replacement: "cat",
        mode: "replace",
        anchorId: ANCHOR,
      });
      expect(res).toEqual({ ok: true });
      expect(inline(editor)).toBe("the cat sat. The dog ran.");
    } finally {
      cleanup();
    }
  });

  it("Keep (delete mode) removes exactly the struck span", () => {
    const { editor, cleanup } = mount(
      para([{ type: "text", text: "one two one two." }]),
    );
    try {
      expect(apply(editor, "two one ", "").ok).toBe(true);
      expect(markedText(editor)).toBe("two one ");
      const res = keepPendingChange(editor, {
        anchorUuid: P,
        mode: "delete",
        anchorId: ANCHOR,
        originalText: "two one ",
        replacement: "",
      });
      expect(res).toEqual({ ok: true });
      expect(inline(editor)).toBe("one two.");
    } finally {
      cleanup();
    }
  });
});

describe("task 1641 — a LaTeX-bearing replacement gets its mark", () => {
  it("\\emph{…}: the mark covers the inserted text, and Dismiss restores", () => {
    const { editor, cleanup } = mount(
      para([{ type: "text", text: "The quick brown fox jumps." }]),
    );
    try {
      expect(apply(editor, "quick brown", "\\emph{lazy} grey").ok).toBe(true);
      expect(markKind(editor)).toBe("pending-ai-change");
      expect(markedText(editor)).toBe("lazy grey");
      expect(
        revertPendingChange(editor, {
          anchorUuid: P,
          originalText: "quick brown",
          replacement: "\\emph{lazy} grey",
          mode: "replace",
          anchorId: ANCHOR,
        }),
      ).toEqual({ ok: true });
      expect(inline(editor)).toBe("The quick brown fox jumps.");
    } finally {
      cleanup();
    }
  });

  it("a carried \\vcid{…}: the rewrite of a cited sentence is marked", () => {
    const { editor, cleanup } = mount(
      para([
        { type: "text", text: "See also " },
        {
          type: "citation",
          attrs: { citationId: "c1", command: "\\citet{foo}", displayText: "Foo 2020" },
        },
        { type: "text", text: " for details." },
      ] as Content[]),
    );
    try {
      const original = inline(editor);
      expect(original).toContain("\\vcid{c1}");
      const replacement = original
        .replace("See also", "Compare")
        .replace("for details", "here");
      expect(apply(editor, original, replacement).ok).toBe(true);
      expect(markKind(editor)).toBe("pending-ai-change");
      expect(markedText(editor)).toBe("Compare  here.");
      expect(
        keepPendingChange(editor, {
          anchorUuid: P,
          mode: "replace",
          anchorId: ANCHOR,
          originalText: original,
          replacement,
        }),
      ).toEqual({ ok: true });
      expect(inline(editor)).not.toContain("\\vlid");
      expect(inline(editor)).toContain("\\vcid{c1}");
    } finally {
      cleanup();
    }
  });

  it("reload re-stamp of a LOST mark finds a LaTeX-bearing span", () => {
    // The paragraph as it would load with the `\vlid` pair gone: the
    // replacement is in the text, unmarked.
    const { editor, cleanup } = mount(
      para([
        { type: "text", text: "The " },
        { type: "text", text: "lazy", marks: [{ type: "italic" }] },
        { type: "text", text: " grey fox jumps." },
      ] as Content[]),
    );
    try {
      const replacement = inline(editor).slice(4, inline(editor).indexOf(" fox"));
      expect(replacement).toMatch(/^\\(emph|textit)\{lazy\} grey$/);
      reapplyPendingMarks(editor, [
        {
          family: "revision-suggestion",
          cards: [
            {
              id: CARD,
              kind: "suggestion",
              status: "applied",
              appliedChange: {
                anchorId: ANCHOR,
                anchorUuid: P,
                originalText: "quick brown",
                replacement,
                mode: "replace",
              },
            },
          ],
        },
      ]);
      expect(markKind(editor)).toBe("pending-ai-change");
      expect(markedText(editor)).toBe("lazy grey");
    } finally {
      cleanup();
    }
  });
});

describe("task 1641 — status flips only on a real splice", () => {
  const ac: AppliedChangeDescriptor = {
    anchorId: ANCHOR,
    anchorUuid: P,
    originalText: "dog",
    replacement: "cat",
    mode: "replace",
    appliedAt: "2026-11-15T00:00:00Z",
  };

  it("Dismiss after the user edits INSIDE the blue range: card stays applied, text untouched", () => {
    const { editor, cleanup } = mount(
      para([{ type: "text", text: "The dog ran." }]),
    );
    try {
      expect(apply(editor, "dog", "cat").ok).toBe(true);
      // The user types inside the blue range: "cat" → "cart".
      const at = editor.state.doc.textContent.indexOf("cat") + 1;
      editor.view.dispatch(editor.state.tr.insertText("r", at + 2));
      expect(markedText(editor)).toBe("cart");
      const before = inline(editor);

      const { state, deps } = depsFor(ac);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      dismissSuggestion(editor as never, CARD, null, deps);
      warn.mockRestore();

      expect(state.status).toBe("applied");
      expect(state.archived).toBe(false);
      expect(state.applied).toBe(ac);
      expect(inline(editor)).toBe(before);
    } finally {
      cleanup();
    }
  });

  it("Keep after the user deleted the whole change: card stays applied", () => {
    const { editor, cleanup } = mount(
      para([{ type: "text", text: "The dog ran." }]),
    );
    try {
      expect(apply(editor, "dog", "cat").ok).toBe(true);
      const from = editor.state.doc.textContent.indexOf("cat") + 1;
      editor.view.dispatch(editor.state.tr.delete(from, from + 3));
      const { state, deps } = depsFor(ac);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      keepSuggestion(editor as never, CARD, null, deps);
      warn.mockRestore();
      expect(state.status).toBe("applied");
      expect(state.applied).toBe(ac);
    } finally {
      cleanup();
    }
  });

  it("a re-minted paragraph uuid: Dismiss still resolves through the mark", () => {
    const { editor, cleanup } = mount(
      para([{ type: "text", text: "The dog ran." }]),
    );
    try {
      expect(apply(editor, "dog", "cat").ok).toBe(true);
      // Re-mint: the stored `anchorUuid` now names nothing.
      editor.view.dispatch(
        editor.state.tr.setNodeAttribute(0, "uuid", "e5f6"),
      );
      expect(findNodeByUuid(editor, P)).toBeNull();
      const { state, deps } = depsFor(ac);
      dismissSuggestion(editor as never, CARD, null, deps);
      expect(state.status).toBe("rejected");
      expect(state.archived).toBe(true);
      expect(inline(editor)).toBe("The dog ran.");
    } finally {
      cleanup();
    }
  });
});

describe("task 1641 — the preview round trip holds the human-author rule", () => {
  it("a human replacement that drops a citation re-applies on Original→Suggested", () => {
    const { editor, cleanup } = mount(
      para([
        { type: "text", text: "See also " },
        {
          type: "citation",
          attrs: { citationId: "c1", command: "\\citet{foo}", displayText: "Foo 2020" },
        },
        { type: "text", text: " for details." },
      ] as Content[]),
    );
    try {
      const original = inline(editor);
      const res = apply(editor, original, "My own sentence.", {
        replacementAuthor: "human",
      });
      expect(res.ok).toBe(true);
      const { state, deps } = depsFor({
        anchorId: ANCHOR,
        anchorUuid: P,
        originalText: original,
        replacement: "My own sentence.",
        mode: "replace",
        appliedAt: "2026-11-15T00:00:00Z",
        replacementAuthor: "human",
      });
      resetPreviewDir("doc-1641", CARD);
      previewOriginal(editor as never, CARD, "doc-1641", deps);
      expect(getPreviewDir("doc-1641", CARD)).toBe("original");
      expect(inline(editor)).toBe(original);

      previewSuggested(editor as never, CARD, "doc-1641", deps);
      expect(getPreviewDir("doc-1641", CARD)).toBe("suggested");
      expect(markedText(editor)).toBe("My own sentence.");
      expect(state.status).toBe("applied");
      resetPreviewDir("doc-1641", CARD);
    } finally {
      cleanup();
    }
  });
});
