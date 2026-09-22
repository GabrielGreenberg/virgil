// @vitest-environment jsdom
//
// Task 705 — a footnote card's title is a REAL, persisted field.
//
// Every footnote surface (docked panel, Omni, floats) wired its "+T" title row
// to `handleEditFootnoteTitle`, which was a documented no-op — and even had it
// set the atom's `title` attr, nothing persisted it: the serializer writes only
// the `\footnote{}` body and `FootnoteRef` had no `title`. The title's home is
// now the `footnotes.json` ref (like `aiRequest`); EditorPane writes BOTH the
// atom attr and the ref on a rename and hydrates the attr from the ref when the
// atom appears.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { FootnotesState } from "@/lib/types";

const DISK: Record<string, unknown> = {};
const writes: Array<{ file: string; data: unknown }> = [];

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async (_docId: string, file: string, dflt: unknown) =>
    file in DISK ? structuredClone(DISK[file]) : dflt,
  ),
  writeSidecar: vi.fn(async (_handle: unknown, file: string, data: unknown) => {
    DISK[file] = structuredClone(data);
    writes.push({ file, data });
  }),
}));
vi.mock("@/lib/ai-request-bridge", () => ({ bridgeFlagForCard: vi.fn() }));

import { useFootnotes } from "../useFootnotes";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import { pullSeed } from "@/lib/stack/pull-seed";
import { POPULATED_SNAPSHOT_DATA } from "@/lib/stack/__tests__/_pull-fixtures";
import { inspectSteps } from "@/lib/tiptap/doc-structure/step-inspector";

const DOC = "doc-fn-title";
const BODY = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }],
};
const liveBody = (id: string) => (id === "fn-live" ? BODY : null);

beforeEach(() => {
  __resetForTests();
  for (const k of Object.keys(DISK)) delete DISK[k];
  writes.length = 0;
});

async function flushLoad() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

const refOnDisk = (id: string) =>
  (DISK["footnotes.json"] as FootnotesState | undefined)?.footnotes.find((f) => f.id === id);

describe("useFootnotes.setFootnoteTitle (task 705)", () => {
  it("a rename on a ref-less (toolbar / parsed) footnote persists through the upsert door", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useFootnotes(DOC, undefined, undefined, liveBody));
    await flushLoad();

    let ok = false;
    act(() => { ok = result.current.setFootnoteTitle("fn-live", "On glosses"); });

    expect(ok).toBe(true);
    expect(refOnDisk("fn-live")).toMatchObject({ id: "fn-live", title: "On glosses" });
    expect(refOnDisk("fn-live")?.content).toEqual(BODY);
  });

  it("survives a remount (reload) — the ref is where the title lives", async () => {
    beginDocPipeline(DOC);
    const first = renderHook(() => useFootnotes(DOC, undefined, undefined, liveBody));
    await flushLoad();
    act(() => { first.result.current.setFootnoteTitle("fn-live", "Kept"); });
    first.unmount();

    const second = renderHook(() => useFootnotes(DOC, undefined, undefined, liveBody));
    await flushLoad();
    expect(second.result.current.footnoteRefs.find((f) => f.id === "fn-live")?.title).toBe("Kept");
  });

  it("clearing the title stores it as ABSENT — one spelling of untitled", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useFootnotes(DOC, undefined, undefined, liveBody));
    await flushLoad();
    act(() => { result.current.setFootnoteTitle("fn-live", "Temp"); });
    act(() => { result.current.setFootnoteTitle("fn-live", "   "); });
    expect(refOnDisk("fn-live")).toBeDefined();
    expect("title" in (refOnDisk("fn-live") ?? {})).toBe(false);
  });

  it("archive → unarchive keeps the title", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useFootnotes(DOC, undefined, undefined, liveBody));
    await flushLoad();
    act(() => { result.current.setFootnoteTitle("fn-live", "Parked title"); });
    act(() => { result.current.setArchived("fn-live", true); });
    act(() => { result.current.setArchived("fn-live", false); });
    expect(refOnDisk("fn-live")).toMatchObject({ title: "Parked title", unanchored: true });
  });

  it("a title-only rename marks the footnote non-pristine (it is real writing)", async () => {
    beginDocPipeline(DOC);
    const pristine = { markNew: vi.fn(), markDirty: vi.fn(), isPristine: vi.fn() };
    const { result } = renderHook(() =>
      useFootnotes(DOC, pristine as never, undefined, liveBody),
    );
    await flushLoad();
    act(() => { result.current.setFootnoteTitle("fn-live", "Only a title"); });
    expect(pristine.markDirty).toHaveBeenCalledWith("fn-live");
  });

  it("duplicate (cloneFootnote) carries the title", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useFootnotes(DOC, undefined, undefined, liveBody));
    await flushLoad();
    act(() => { result.current.setFootnoteTitle("fn-live", "Twin"); });
    let cloneId: string | null = null;
    act(() => { cloneId = result.current.cloneFootnote("fn-live"); });
    expect(cloneId).toBeTruthy();
    expect(refOnDisk(cloneId!)?.title).toBe("Twin");
  });
});

describe("the stack-pull footnote door carries the title (task 705)", () => {
  it("addFootnoteFromSeed lands body AND title under a fresh identity", async () => {
    beginDocPipeline(DOC);
    const { result } = renderHook(() => useFootnotes(DOC));
    await flushLoad();
    const src = POPULATED_SNAPSHOT_DATA.footnote;
    let created: ReturnType<typeof result.current.addFootnoteFromSeed> | null = null;
    act(() => { created = result.current.addFootnoteFromSeed(pullSeed("footnote", src)); });
    expect(created!.title).toBe(src.title);
    expect(created!.content).toEqual(src.content);
    expect(created!.id).not.toBe(src.id);
    expect(created!.archived).toBeFalsy();
    expect(created!.aiRequest).toBeFalsy();
    expect(created!.unanchored).toBeFalsy();
    expect(refOnDisk(created!.id)?.title).toBe(src.title);
  });
});

describe("a title rename is a structural footnote change (task 705)", () => {
  // The card rows (`footnoteInfos`) re-derive on `rev.footnotes`; a rename that
  // bumped nothing would leave every surface reading the old title.
  const schema = new Schema({
    nodes: {
      doc: { content: "paragraph+" },
      paragraph: { content: "inline*", group: "block" },
      text: { group: "inline" },
      footnote: {
        inline: true,
        group: "inline",
        atom: true,
        attrs: {
          footnoteId: { default: "" },
          number: { default: 1 },
          thanks: { default: false },
          title: { default: "" },
          content: { default: null },
        },
      },
    },
  });

  it("changedFootnotes carries the renamed atom", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("Hi"),
        schema.node("footnote", { footnoteId: "fn1" }),
      ]),
    ]);
    const state = EditorState.create({ schema, doc });
    const pos = 3;
    expect(state.doc.nodeAt(pos)?.type.name).toBe("footnote");
    const tr = state.tr.setNodeMarkup(pos, undefined, {
      ...state.doc.nodeAt(pos)!.attrs,
      title: "Renamed",
    });
    const diff = inspectSteps(tr, state.doc, tr.doc);
    expect(diff.changedFootnotes.map((f) => [f.id, f.title])).toEqual([["fn1", "Renamed"]]);
  });
});

describe("census · no footnote surface drops a title (task 705)", () => {
  const SRC = join(process.cwd(), "src");
  const pane = readFileSync(join(SRC, "components/EditorPane.tsx"), "utf8");

  it("handleEditFootnoteTitle writes the atom attr AND the persisted ref", () => {
    const start = pane.indexOf("const handleEditFootnoteTitle = useCallback(");
    expect(start).toBeGreaterThan(0);
    const body = pane.slice(start, pane.indexOf("\n  );", start));
    // A no-op binds its args with a leading underscore — the old shape.
    expect(body).not.toMatch(/\(\s*_id\b|_title\b/);
    expect(body).toContain("updateFootnoteTitle(id, title)");
    expect(body).toContain("footnotesHook.setFootnoteTitle(id, title)");
  });

  it("the load edge hydrates atom titles from the refs", () => {
    expect(pane).toMatch(/updateFootnoteTitle\(fn\.footnoteId, title\)/);
  });

  it("every UnanchoredFootnoteCard mount wires the title rename", () => {
    for (const rel of [
      "panels/Footnotes/FootnotePanel.tsx",
      "panels/Footnotes/omni.tsx",
      "cards/floats/index.tsx",
    ]) {
      const src = readFileSync(join(SRC, rel), "utf8");
      const at = src.indexOf("<UnanchoredFootnoteCard");
      expect(at, rel).toBeGreaterThan(0);
      const mount = src.slice(at, src.indexOf("/>", at));
      expect(mount, `${rel}: unanchored footnote mounted without onEditTitle`).toMatch(/onEditTitle=/);
    }
  });
});
