// @vitest-environment jsdom
//
// Task 1587 — every block-insert verb mints its uuid against the WHOLE document
// (the ONE mint door, `mintDocUuid` / `collectDocUuids`, task 552), never
// against blocks of its own type only.
//
// Block uuids share ONE namespace (`BlockUuidBackfill` dedups across every
// anchorable type). A per-type collision set let a fresh figure take a
// paragraph's id; the backfill then re-minted the figure, `smartInsertBlock`'s
// locate missed it (`pos: -1`) and the Insert → Figure popover silently never
// opened.
//
// The mint is forced to collide: `generateShortId` is scripted so its FIRST
// candidate is the paragraph's uuid — a per-type mint (which does not see the
// paragraph) returns it; a whole-doc mint skips it. Measured by restoring the
// pre-1587 per-type scans: every leg below goes red.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

const PARA = "c011";
let counter = 0;
vi.mock("@/lib/uuid", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/uuid")>();
  return {
    ...real,
    // Scripted: the paragraph's id first, then a deterministic fresh sequence.
    generateShortId: (existing?: Set<string>) => {
      if (!existing?.has(PARA)) return PARA;
      let id: string;
      do {
        id = (0xa000 + counter++).toString(16);
      } while (existing.has(id));
      return id;
    },
  };
});

import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { smartInsertBlock } from "@/lib/tiptap/smart-insert";
import {
  figureRun,
  graphicsRun,
  texRun,
  forestRun,
  type ActionContext,
} from "@/lib/actions/action-registry";

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

function mountEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: PARA },
          content: [{ type: "text", text: "hello world" }],
        },
      ],
    },
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)),
  );
  return editor;
}

function nodesOfType(editor: Editor, typeName: string): PMNode[] {
  const out: PMNode[] = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name === typeName) out.push(n);
    return true;
  });
  return out;
}

function paragraphUuids(editor: Editor): string[] {
  return nodesOfType(editor, "paragraph").map((n) => n.attrs.uuid as string);
}

function viewCtx(editor: Editor, extra: Partial<ActionContext> = {}): ActionContext {
  return {
    editor,
    view: editor.view,
    ref: {
      kind: "selection",
      from: editor.state.selection.from,
      to: editor.state.selection.to,
      paragraphId: "",
    },
    surface: "lightning",
    canEdit: true,
    ...extra,
  } as ActionContext;
}

const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

let rafStub: ReturnType<typeof vi.spyOn> | undefined;
beforeEach(() => {
  counter = 0;
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
  rafStub = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
});

afterEach(() => {
  rafStub?.mockRestore();
  document.body.innerHTML = "";
});

describe("block inserts mint through the ONE doc-wide door (task 1587)", () => {
  it.each([
    ["figureBlock", figureRun],
    ["graphicsBlock", graphicsRun],
  ] as const)("%s: a forced collision never takes the paragraph's id, and the popover opens", (typeName, run) => {
    const editor = mountEditor();
    const openFigurePopover = vi.fn();
    run(viewCtx(editor, { openFigurePopover } as Partial<ActionContext>));

    const [block] = nodesOfType(editor, typeName);
    expect(block).toBeDefined();
    expect(block.attrs.uuid).not.toBe(PARA);
    expect(paragraphUuids(editor)).toContain(PARA);
    // The popover opened, addressing the block by its LIVE uuid.
    expect(openFigurePopover).toHaveBeenCalledTimes(1);
    const seed = openFigurePopover.mock.calls[0][0] as { uuid: string; pos: number };
    expect(seed.uuid).toBe(block.attrs.uuid);
    expect(editor.state.doc.nodeAt(seed.pos)?.attrs.uuid).toBe(block.attrs.uuid);
  });

  it.each([
    ["texBlock", texRun],
    ["forestBlock", forestRun],
  ] as const)("%s: a forced collision never takes the paragraph's id", (typeName, run) => {
    const editor = mountEditor();
    // Read the uuid the verb DISPATCHES — the backfill would re-mint a colliding
    // one afterwards, masking the per-type mint in the settled doc.
    const dispatched: string[] = [];
    const real = editor.view;
    const view = new Proxy(real, {
      get(target, prop) {
        if (prop === "dispatch") {
          return (tr: Parameters<typeof real.dispatch>[0]) => {
            tr.doc.descendants((n) => {
              if (n.type.name === typeName) dispatched.push(n.attrs.uuid as string);
              return true;
            });
            real.dispatch(tr);
          };
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    run(viewCtx(editor, { view } as Partial<ActionContext>));
    expect(dispatched.length).toBeGreaterThan(0);
    expect(dispatched[0]).not.toBe(PARA);
    const [block] = nodesOfType(editor, typeName);
    expect(block.attrs.uuid).toBe(dispatched[0]);
    expect(paragraphUuids(editor)).toContain(PARA);
  });

  it("smartInsertBlock: an internal mint draws against the whole doc", () => {
    const editor = mountEditor();
    const type = editor.state.schema.nodes.graphicsBlock;
    const { uuid, pos } = smartInsertBlock({ editor, type, attrs: {} });
    expect(uuid).not.toBe(PARA);
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(editor.state.doc.nodeAt(pos)?.attrs.uuid).toBe(uuid);
  });

  it("smartInsertBlock belt: a caller-supplied colliding uuid re-minted by the backfill still locates, and the RETURNED uuid is the live one", () => {
    const editor = mountEditor();
    const type = editor.state.schema.nodes.graphicsBlock;
    const { uuid, pos } = smartInsertBlock({ editor, type, attrs: { uuid: PARA } });
    expect(pos).toBeGreaterThanOrEqual(0);
    const live = editor.state.doc.nodeAt(pos);
    expect(live?.type.name).toBe("graphicsBlock");
    expect(uuid).toBe(live?.attrs.uuid);
    // No two blocks share an id after the backfill settles.
    const all: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.attrs?.uuid) all.push(n.attrs.uuid as string);
    });
    expect(new Set(all).size).toBe(all.length);
  });
});
