// @vitest-environment jsdom
//
// Task 1073 — deleting a footnote MARKER orphans it with EVERY carried attr.
//
// The flag-OFF orphan detector (footnote.ts) counted the title toward
// orphan-worthiness, then shipped `{ footnoteId, content }` alone: a title-only
// footnote orphaned as an empty card, and a `\thanks{…}` / `\footnote[3]{…}`
// lost its markup, so re-placing it wrote a plain counted `\footnote{…}`. The
// capture now rides task 947's SSOT (`pickFootnoteCarriedAttrs`), and both
// orphan writers build their record through ONE builder (`orphanRecordFor`).
//
// Real editor (DocStructureObserver + Footnote) + the REAL per-pane bridge.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { renderHook, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { OrphanedFootnote } from "@/lib/types";
import { Footnote } from "@/lib/tiptap/footnote";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import { serializeToLatex } from "@/lib/latex-serializer";
import {
  footnoteMarkupNodeAttrs,
  orphanRecordFor,
  pickFootnoteCarriedAttrs,
} from "@/lib/footnote-source-attrs";
import { useFootnoteOrphanBridges } from "../footnote-sync";

const DOC = "docA";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

function mountBridge() {
  let current: OrphanedFootnote[] = [];
  const setOrphanedFootnotes = vi.fn(
    (updater: OrphanedFootnote[] | ((p: OrphanedFootnote[]) => OrphanedFootnote[])) => {
      current = typeof updater === "function" ? updater(current) : updater;
    },
  );
  renderHook(() =>
    useFootnoteOrphanBridges({ docId: DOC, store: { setOrphanedFootnotes } }),
  );
  return { getOrphans: () => current };
}

const body = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function mountEditor(attrs: Record<string, unknown>): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: [
      DocStructureObserver,
      StarterKit,
      Footnote.configure({ docIdRef: { current: DOC } }),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Body " },
            { type: "footnote", attrs: { number: 1, ...attrs } },
            { type: "text", text: " end." },
          ],
        },
      ],
    },
  });
}

function deleteFootnoteAtom(editor: Editor) {
  let pos: number | null = null;
  editor.state.doc.descendants((node, p) => {
    if (pos != null) return false;
    if (node.type.name === "footnote") { pos = p; return false; }
    return true;
  });
  if (pos != null) editor.view.dispatch(editor.state.tr.delete(pos, pos + 1));
}

/** Orphan the editor's one footnote through the real detector + bridge. */
function orphan(attrs: Record<string, unknown>) {
  const { getOrphans } = mountBridge();
  const editor = mountEditor(attrs);
  act(() => {
    deleteFootnoteAtom(editor);
    vi.runAllTimers();
  });
  return { editor, orphans: getOrphans() };
}

/** Re-place an orphan the way the panel-drop rebuild does (Editor.tsx): the
 *  carried pick → node attrs → serialized `.tex`. */
function rePlaceTex(editor: Editor, o: OrphanedFootnote): string {
  const carried = pickFootnoteCarriedAttrs(o);
  const node = editor.schema.nodes.footnote.create({
    footnoteId: o.footnoteId,
    content: carried.content,
    title: carried.title ?? "",
    ...footnoteMarkupNodeAttrs(carried),
    number: 0,
  });
  const doc = editor.schema.nodes.doc.create(null, [
    editor.schema.nodes.paragraph.create(null, [editor.schema.text("x"), node]),
  ]);
  return serializeToLatex(doc.toJSON());
}

describe("footnote orphan capture carries every carried attr (task 1073)", () => {
  it("a `\\thanks{…}` orphans as a \\thanks and re-places as \\thanks", () => {
    const { editor, orphans } = orphan({
      footnoteId: "fn-thanks",
      thanks: true,
      content: body("Funded by X"),
    });
    try {
      expect(orphans).toHaveLength(1);
      expect(orphans[0].thanks).toBe(true);
      const tex = rePlaceTex(editor, orphans[0]);
      expect(tex).toContain("\\thanks{");
      expect(tex).not.toContain("\\footnote{");
    } finally {
      editor.destroy();
    }
  });

  it("a `\\footnote[3]{…}` keeps its mark through orphan → re-place", () => {
    const { editor, orphans } = orphan({
      footnoteId: "fn-mark",
      numberOverride: "3",
      content: body("Marked note"),
    });
    try {
      expect(orphans[0].numberOverride).toBe("3");
      expect(rePlaceTex(editor, orphans[0])).toContain("\\footnote[3]{");
    } finally {
      editor.destroy();
    }
  });

  it("a TITLE-ONLY footnote orphans with its title (not as an empty card)", () => {
    const { editor, orphans } = orphan({
      footnoteId: "fn-title",
      title: "On sources",
      content: null,
    });
    try {
      expect(orphans).toHaveLength(1);
      expect(orphans[0].title).toBe("On sources");
    } finally {
      editor.destroy();
    }
  });

  it("the flag-OFF record equals the ONE builder's record over the live atom (flag-ON parity)", () => {
    const attrs = {
      footnoteId: "fn-all",
      thanks: true,
      title: "Ack",
      content: body("Thanks to Y"),
    };
    const { editor, orphans } = orphan(attrs);
    try {
      const { orphanedAt, ...legacy } = orphans[0];
      const { orphanedAt: _t, ...shared } = orphanRecordFor(
        "fn-all",
        pickFootnoteCarriedAttrs(attrs),
        orphanedAt,
      );
      void _t;
      expect(legacy).toEqual(shared);
    } finally {
      editor.destroy();
    }
  });
});
