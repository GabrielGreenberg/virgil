// @vitest-environment jsdom
//
// Task 1557 — Cut is "archive to the clipboard". Drives ProseMirror's REAL
// cut/paste DOM handlers on the real main extension stack (a synthesized
// clipboard event with a DataTransfer stub), and reads the guards' verdicts off
// the window events the card stores listen to.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import {
  ANCHORS_ARCHIVED_EVENT,
  ANCHORS_REVIVED_EVENT,
  ANCHOR_ORPHANED_EVENT,
  TEXTOBJECT_ORPHANED_EVENT,
} from "@/lib/tiptap/orphan-events";
import { isClipboardHoldingId } from "@/lib/tiptap/clipboard-carry";

const DOC = "doc-cut";

function mount(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: DOC },
    anchoredUuidsRef: { current: new Set(["p2"]) },
    host: null,
  };
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "first." }] },
        {
          type: "paragraph",
          attrs: { uuid: "p2" },
          content: [
            { type: "text", text: "moved " },
            {
              type: "text",
              text: "words",
              marks: [{ type: "linkedAnchor", attrs: { anchorId: "a1", kind: "note" } }],
            },
            { type: "text", text: " here." },
          ],
        },
        { type: "paragraph", attrs: { uuid: "p3" }, content: [{ type: "text", text: "last." }] },
      ],
    },
  });
}

function clipboardEvent(type: "cut" | "copy" | "paste", store: Map<string, string>): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: {
      clearData: () => store.clear(),
      setData: (k: string, v: string) => store.set(k, v),
      getData: (k: string) => store.get(k) ?? "",
      types: [],
      files: [],
      items: [],
    },
  });
  return ev;
}

function posOf(editor: Editor, uuid: string): number {
  let at = -1;
  editor.state.doc.descendants((n, p) => {
    if (at >= 0) return false;
    if (n.attrs?.uuid === uuid) at = p;
    return at < 0;
  });
  return at;
}

function uuids(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.forEach((n) => out.push(String(n.attrs.uuid)));
  return out;
}

function anchorIds(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((n) => {
    for (const m of n.marks) if (m.type.name === "linkedAnchor") out.push(m.attrs.anchorId);
  });
  return out;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function record() {
  const seen: Record<string, unknown[]> = { archived: [], revived: [], orphan: [], textOrphan: [] };
  const order: string[] = [];
  const on = (name: string, key: string) => {
    const h = (e: Event) => {
      seen[key].push((e as CustomEvent).detail);
      order.push(key);
    };
    window.addEventListener(name, h);
    return () => window.removeEventListener(name, h);
  };
  const offs = [
    on(ANCHORS_ARCHIVED_EVENT, "archived"),
    on(ANCHORS_REVIVED_EVENT, "revived"),
    on(ANCHOR_ORPHANED_EVENT, "orphan"),
    on(TEXTOBJECT_ORPHANED_EVENT, "textOrphan"),
  ];
  return { seen, order, off: () => offs.forEach((f) => f()) };
}

let editor: Editor | null = null;
let rec: ReturnType<typeof record> | null = null;
afterEach(() => {
  rec?.off();
  editor?.destroy();
  editor = null;
});

function cutWholeP2(ed: Editor, clip: Map<string, string>) {
  ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, posOf(ed, "p2"))));
  ed.view.dom.dispatchEvent(clipboardEvent("cut", clip));
}

function caretAtEnd(ed: Editor) {
  ed.view.dispatch(
    ed.state.tr.setSelection(TextSelection.create(ed.state.doc, ed.state.doc.content.size - 1)),
  );
}

describe("cut carries a passage's cards to its paste (task 1557)", () => {
  it("cut parks the cards in a clipboard holding — no placeholder, dormant before any orphan", async () => {
    editor = mount();
    rec = record();
    const clip = new Map<string, string>();
    cutWholeP2(editor, clip);
    await flush();
    expect(uuids(editor)).toEqual(["p1", "p3"]); // no resurrected empty p2
    // The departure goes dormant FIRST; an orphan event for the same id may
    // follow (as for a Redo of an Archive) and the stores skip a dormant link.
    expect(rec.order[0]).toBe("archived");
    const archived = rec.seen.archived as { snippetId: string; uuids: string[]; anchorIds: string[] }[];
    // One event per guard (mark guard → anchorIds, block guard → uuids), both
    // naming the same clipboard holding.
    const holdings = new Set(archived.map((a) => a.snippetId));
    expect(holdings.size).toBe(1);
    expect(isClipboardHoldingId([...holdings][0])).toBe(true);
    expect(archived.flatMap((a) => a.uuids)).toEqual(["p2"]);
    expect(archived.flatMap((a) => a.anchorIds)).toEqual(["a1"]);
  });

  it("paste of that cut lands the same uuid + mark, and a second paste is a copy", async () => {
    editor = mount();
    rec = record();
    const clip = new Map<string, string>();
    cutWholeP2(editor, clip);
    await flush();
    caretAtEnd(editor);
    editor.view.dom.dispatchEvent(clipboardEvent("paste", clip));
    await flush();
    expect(uuids(editor)).toContain("p2");
    expect(anchorIds(editor)).toEqual(["a1"]);
    const revived = rec.seen.revived as { uuids: string[]; anchorIds: string[] }[];
    expect(revived.flatMap((r) => r.uuids)).toContain("p2");
    expect(revived.flatMap((r) => r.anchorIds)).toContain("a1");

    // Second paste: a copy — no duplicate identity.
    caretAtEnd(editor);
    editor.view.dom.dispatchEvent(clipboardEvent("paste", clip));
    await flush();
    expect(uuids(editor).filter((u) => u === "p2").length).toBe(1);
    expect(anchorIds(editor)).toEqual(["a1"]);
  });

  it("copy + paste is unchanged: nothing is held, the copy gets fresh identity", async () => {
    editor = mount();
    rec = record();
    const clip = new Map<string, string>();
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, posOf(editor, "p2"))),
    );
    editor.view.dom.dispatchEvent(clipboardEvent("copy", clip));
    caretAtEnd(editor);
    editor.view.dom.dispatchEvent(clipboardEvent("paste", clip));
    await flush();
    expect(uuids(editor).filter((u) => u === "p2").length).toBe(1);
    expect(anchorIds(editor)).toEqual(["a1"]);
    expect(rec.seen.archived).toEqual([]);
  });

  it("an ordinary delete still resurrects the anchored block (the guard is unchanged)", async () => {
    editor = mount();
    rec = record();
    const p = posOf(editor, "p2");
    editor.view.dispatch(editor.state.tr.delete(p, p + editor.state.doc.nodeAt(p)!.nodeSize));
    await flush();
    expect(uuids(editor)).toContain("p2");
    expect(rec.seen.archived).toEqual([]);
  });
});
