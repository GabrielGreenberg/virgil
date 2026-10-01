// @vitest-environment jsdom
//
// Task 2026-10-01-878 — block identity has ONE owner.
//
// "May this node carry a block uuid?" is `mayCarryBlockUuid` (anchorable ∧ not
// a deferred inner paragraph), read by the backfill, the DocStructureObserver's
// index, and node-identity's paste-as-new minting (the Stack pull's door).
// "Is this uuid live?" is the observer snapshot (`hasLiveBlock` /
// `hasLiveAnchor`), read in O(1) by the two orphan guards — which used to walk
// the whole document on every block-joining Backspace/Delete.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { hasLiveBlock, readDocStructure } from "@/lib/tiptap/doc-structure";
import type { BlockAbsorbedEvent } from "@/lib/tiptap/linked-anchor";
import {
  collectBlockUuids,
  inheritBlockUuid,
  withFreshBlockUuids,
} from "@/lib/tiptap/node-identity";
import { codeOnly } from "@/lib/__tests__/_source-scan";

const ROOT = join(__dirname, "../../../..");

let absorbed: BlockAbsorbedEvent[];
let orphaned: string[];

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    onBlockAbsorbedRef: { current: (e: BlockAbsorbedEvent) => absorbed.push(e) },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

const editors: Editor[] = [];
function mount(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
  editors.push(ed);
  return ed;
}

function press(ed: Editor, key: string): boolean {
  return (
    ed.view.someProp("handleKeyDown", (f) =>
      f(ed.view, new KeyboardEvent("keydown", { key })),
    ) ?? false
  );
}

function caretAtStartOf(ed: Editor, text: string) {
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isTextblock && n.textContent === text) pos = p + 1;
    return true;
  });
  if (pos < 0) throw new Error(`no textblock "${text}"`);
  ed.commands.setTextSelection(pos);
}

const P = (uuid: string | null, text?: string): JSONContent => ({
  type: "paragraph",
  attrs: { uuid },
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const ITEM = (uuid: string | null, ...kids: JSONContent[]): JSONContent => ({
  type: "listItem",
  attrs: { uuid },
  content: kids,
});
const LIST = (uuid: string | null, ...items: JSONContent[]): JSONContent => ({
  type: "bulletList",
  attrs: { uuid },
  content: items,
});

function onOrphan(e: Event) {
  orphaned.push((e as CustomEvent<{ uuid: string }>).detail.uuid);
}

beforeEach(() => {
  absorbed = [];
  orphaned = [];
  window.addEventListener("virgil-textobject-orphaned", onOrphan);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.removeEventListener("virgil-textobject-orphaned", onOrphan);
  for (const ed of editors.splice(0)) ed.destroy();
});

describe("878 — the orphan guards decide liveness from the snapshot, not a doc walk", () => {
  it("a join-Backspace on a 300-block doc walks nothing in the deferred liveness check", () => {
    const blocks: JSONContent[] = [];
    for (let i = 0; i < 300; i++) blocks.push(P(`b${i}`, `para ${i}`));
    const ed = mount(blocks);
    caretAtStartOf(ed, "para 150");
    expect(press(ed, "Backspace")).toBe(true);

    const spy = vi.spyOn(PMNode.prototype, "descendants");
    vi.runAllTimers();
    expect(spy).not.toHaveBeenCalled();

    // …and the verdict is still the right one: absorbed, not orphaned.
    expect(absorbed.map((e) => [e.absorbed.uuid, e.survivor.uuid])).toEqual([["b150", "b149"]]);
    expect(orphaned).not.toContain("b150");
  });

  it("a genuinely removed block is still announced as orphaned", () => {
    const ed = mount([P("A", "one"), P("B", "two"), P("C", "three")]);
    let from = -1;
    let to = -1;
    ed.state.doc.forEach((n, off) => {
      if (n.attrs.uuid === "B") {
        from = off;
        to = off + n.nodeSize;
      }
    });
    ed.view.dispatch(ed.state.tr.delete(from, to));
    vi.runAllTimers();
    expect(orphaned).toContain("B");
  });

  it("guard sources carry no liveness walk", () => {
    const src = codeOnly(readFileSync(join(ROOT, "src/lib/tiptap/linked-anchor.ts"), "utf8"));
    expect(src).not.toMatch(/liveUuids|liveAnchorIds/);
  });
});

describe("878 — one eligibility rule: a deferred inner paragraph carries no live identity", () => {
  it("the observer does not index a uuid stranded on a list item's body paragraph", () => {
    const ed = mount([LIST("L", ITEM("I", P("X", "body")))]);
    const blocks = readDocStructure(ed.state).blocks;
    expect(blocks.has("L")).toBe(true);
    expect(blocks.has("I")).toBe(true);
    expect(blocks.has("X")).toBe(false);
    expect(hasLiveBlock(ed.state, "X")).toBe(false);
    expect(hasLiveBlock(ed.state, "I")).toBe(true);
  });

  it("a Stack-pull mint stamps the list and its items but never an item's body paragraph", () => {
    const live = new Set(["L", "I1", "I2"]);
    const out = withFreshBlockUuids(
      LIST("L", ITEM("I1", P("X1", "a")), ITEM("I2", P(null, "b"))) as never,
      live,
    ) as JSONContent;
    const list = out.attrs!.uuid as string;
    const items = out.content!.map((i) => i.attrs!.uuid as string);
    const bodies = out.content!.map((i) => i.content![0].attrs!.uuid);
    expect(bodies).toEqual([null, null]);
    for (const id of [list, ...items]) {
      expect(typeof id).toBe("string");
      expect(["L", "I1", "I2"]).not.toContain(id);
    }
    expect(new Set([list, ...items]).size).toBe(3);
    // Every claimed id joined the collision set.
    for (const id of [list, ...items]) expect(live.has(id)).toBe(true);
  });

  it("a top-level paragraph is minted fresh against the destination's live ids", () => {
    const ed = mount([P("A", "x")]);
    const live = collectBlockUuids(ed.state.doc);
    const out = withFreshBlockUuids(P("A", "copy") as never, live) as JSONContent;
    expect(out.attrs!.uuid).toBeTruthy();
    expect(out.attrs!.uuid).not.toBe("A");
  });

  it("inheritBlockUuid stops at a node that already holds an id", () => {
    const ed = mount([P("Z", "x")]);
    const item = ed.schema.nodeFromJSON(ITEM("HELD", P(null, "body")));
    const [result] = inheritBlockUuid([item], "FREED", ed.schema);
    expect(result.attrs.uuid).toBe("HELD");
    expect(result.firstChild!.attrs.uuid).toBeNull();
    // …while a bare wrapper still inherits, outermost first.
    const bare = ed.schema.nodeFromJSON(ITEM(null, P(null, "body")));
    const [stamped] = inheritBlockUuid([bare], "FREED", ed.schema);
    expect(stamped.attrs.uuid).toBe("FREED");
    expect(stamped.firstChild!.attrs.uuid).toBeNull();
  });

  it("stack-pull reads node-identity's collectors — no private copy", () => {
    const src = codeOnly(
      readFileSync(join(ROOT, "src/components/drop-mode/specs/stack-pull.ts"), "utf8"),
    );
    expect(src).not.toMatch(/function\s+collectAtomIds|function\s+withFreshUuid/);
    expect(src).toMatch(/withFreshBlockUuids\(/);
  });
});
