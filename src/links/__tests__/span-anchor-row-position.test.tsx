// @vitest-environment jsdom
//
// TASK 1334 — a span-anchored (Mode-B) card sits beside its WORDS, not at its
// paragraph's top. The card-anchor authority seats each row: a row drawn only
// by live marks inside its paragraph carries `anchorId` + `anchorPos` (the
// span's first character); anything whole-paragraph keeps the block. The omni
// card (`buildOmniAnchorRows` → `OmniItem.pos`/`anchorId`) and the margin
// marker (`buildMarginMarkerRows` → `anchorId`) both read that one answer.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  buildCardAnchorPass,
  buildMarginMarkerRows,
  rowAnchorPos,
} from "@/links/card-anchor-rows";
import { createLinkedAnchor, type CardWithLinks } from "@/links/links";
import type { Link } from "@/links/_shared/types";
import { buildOmniAnchorRows } from "@/panels/_shared/omni-anchor-rows";

const TEXT = "A long opening clause, and then this span, and more after it.";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

function mountDoc(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "Q" }, content: [{ type: "text", text: "Before." }] },
        { type: "paragraph", attrs: { uuid: "P" }, content: [{ type: "text", text: TEXT }] },
      ],
    },
  });
}

function blockPos(editor: Editor, uuid: string): number {
  let at = -1;
  editor.state.doc.forEach((n, off) => {
    if (n.attrs.uuid === uuid) at = off;
  });
  return at;
}

function markSpan(editor: Editor, words: string): { anchorId: string; from: number } {
  const from = blockPos(editor, "P") + 1 + TEXT.indexOf(words);
  const rec = createLinkedAnchor(editor, "note", { from, to: from + words.length });
  if (!rec) throw new Error("expected a linkedAnchor record");
  return { anchorId: rec.anchorId, from };
}

function modeB(anchorId: string): Link {
  return {
    id: `link-${anchorId}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: ["P"],
      textRange: { anchorId, textSnapshot: "x" },
    },
    target: { type: "card", ref: { kind: "note", id: "c1" } },
    createdAt: "",
  };
}

function modeA(uuid: string): Link {
  return {
    id: `link-${uuid}`,
    kind: "anchor",
    anchor: { type: "textObject", targetKind: "paragraph", textObjectIds: [uuid] },
    target: { type: "card", ref: { kind: "note", id: "c1" } },
    createdAt: "",
  };
}

const card = (id: string, links: Link[]) => ({ id, links }) as CardWithLinks;

describe("span-anchored rows sit at their span (task 1334)", () => {
  it("a Mode-B row resolves to the span's from; a Mode-A row to its block", () => {
    const editor = mountDoc();
    const { anchorId, from } = markSpan(editor, "this span");
    const pass = buildCardAnchorPass(editor);

    const span = pass.resolve(card("b", [modeB(anchorId)])).rows[0];
    expect(span.pid).toBe("P");
    expect(span.pos).toBe(blockPos(editor, "P"));
    expect(span.anchorId).toBe(anchorId);
    expect(rowAnchorPos(span)).toBe(from);

    const whole = pass.resolve(card("a", [modeA("P")])).rows[0];
    expect(whole.anchorId).toBeUndefined();
    expect(rowAnchorPos(whole)).toBe(blockPos(editor, "P"));
    editor.destroy();
  });

  it("both renderers read it: the omni row's pos/anchorId and the margin row's anchorId", () => {
    const editor = mountDoc();
    const { anchorId, from } = markSpan(editor, "this span");
    const pass = buildCardAnchorPass(editor);
    const c = card("b", [modeB(anchorId)]);

    const [omni] = buildOmniAnchorRows(c, "float:card:note:b", pass.resolve, null);
    expect(omni.pos).toBe(from);
    expect(omni.anchorUuid).toBe("P");
    expect(omni.anchorId).toBe(anchorId);

    const [marker] = buildMarginMarkerRows(c, pass.resolve);
    expect(marker.anchorId).toBe(anchorId);
    editor.destroy();
  });

  it("a card ALSO bound to the whole paragraph stays at the block top", () => {
    const editor = mountDoc();
    const { anchorId } = markSpan(editor, "this span");
    const row = buildCardAnchorPass(editor).resolve(card("ab", [modeA("P"), modeB(anchorId)])).rows[0];
    expect(row.pid).toBe("P");
    expect(row.anchorId).toBeUndefined();
    expect(rowAnchorPos(row)).toBe(blockPos(editor, "P"));
    editor.destroy();
  });

  it("two spans on one card's row seat at the EARLIER span", () => {
    const editor = mountDoc();
    const late = markSpan(editor, "more after");
    const early = markSpan(editor, "opening clause");
    const row = buildCardAnchorPass(editor).resolve(card("bb", [modeB(late.anchorId), modeB(early.anchorId)])).rows[0];
    expect(row.anchorId).toBe(early.anchorId);
    expect(rowAnchorPos(row)).toBe(early.from);
    editor.destroy();
  });

  it("a dead mark falls back to the block (stored-pid self-heal)", () => {
    const editor = mountDoc();
    const row = buildCardAnchorPass(editor).resolve(card("dead", [modeB("never-minted")])).rows[0];
    expect(row?.pid).toBe("P");
    expect(row.anchorId).toBeUndefined();
    expect(rowAnchorPos(row)).toBe(blockPos(editor, "P"));
    editor.destroy();
  });
});
