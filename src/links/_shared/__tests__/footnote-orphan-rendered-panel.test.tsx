// @vitest-environment jsdom
//
// W2 CUTOVER — the RENDERED-panel pin (the adversarial-review BLOCKER).
//
// W2a built a durable orphan sidecar (`useOrphanedFootnotes`) and W2b made the
// bus reconciler (`useInlineAtomLifecycle`) its only writer — but the docked
// FootnotePanel rendered from the LEGACY EditorLayout shell store, so flag-ON
// the reconciler maintained a store NOTHING rendered while the legacy event web
// drove the UI. The cutover routes the panel's orphan source to the sidecar
// when the flag is ON.
//
// These pins assert the RENDERED panel (not just the store object), wiring a
// REAL editor + the single W1b consumer + `useInlineAtomLifecycle` + the REAL
// `useOrphanedFootnotes` sidecar, then rendering `FootnotePanel` from
// `sidecar.orphans + footnoteInfos` — exactly EditorPane's flag-ON shape:
//
//  (a) FN-A1-03 reaching the UI: delete f007 (orphan card renders) → undo →
//      the orphan record clears, EXACTLY ONE live footnote card renders, and
//      React emits NO duplicate-key warning (the merge can't produce two f007).
//  (b) FN-A2-01: the orphan survives a simulated reload (sidecar persistence) —
//      a fresh hook reads the persisted record back and the panel re-renders it.
//
// The card BODIES mount real TipTap editors; mock the two card components to
// light stubs so the test pins the panel's merge/keying + the sidecar data
// flow, not editor internals. The duplicate-key crash lives in CardListPanel's
// `<Fragment key={getId(item)}>` (id = footnoteId), so it surfaces regardless
// of the stubbed body.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, render, act, waitFor, cleanup } from "@testing-library/react";

// In-test on-disk fixture for the durable sidecar. `readSidecarIfExists` returns
// null when absent; writes are captured so the reload round-trip can replay them.
let DISK: unknown = null;
const writes: Array<{ docId: string; filename: string; data: unknown }> = [];

vi.mock("@/lib/storage", () => ({
  isDevStorage: false,
  readSidecar: vi.fn(async (_docId: string, _file: string, dflt: unknown) => dflt),
  readSidecarIfExists: vi.fn(async () => DISK),
  writeSidecar: vi.fn(async (h: { docId: string }, filename: string, data: unknown) => {
    writes.push({ docId: h.docId, filename, data });
  }),
}));

// Light card stubs — emit a recognizable testid carrying the footnoteId + a body
// text node, so each rendered card is countable and the body text is queryable.
vi.mock("@/panels/Footnotes/FootnoteCard", () => ({
  FootnoteCard: ({ footnote }: { footnote: { footnoteId: string } }) => (
    <div data-testid={`fn-anchored-${footnote.footnoteId}`} data-card-key={footnote.footnoteId} />
  ),
  OrphanedFootnoteCard: ({ orphan }: { orphan: { footnoteId: string } }) => (
    <div data-testid={`fn-orphan-${orphan.footnoteId}`} data-card-key={orphan.footnoteId} />
  ),
}));

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Citation } from "@/lib/tiptap/citation";
import { Footnote } from "@/lib/tiptap/footnote";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import { IdentityCascade } from "@/lib/identity/identity-cascade";
import { useIdentityBusConsumer } from "@/lib/identity/useIdentityBusConsumer";
import { setIdentityCascadeFlag } from "@/lib/identity/identity-flag";
import { setInlineAtomLifecycleFlag } from "@/lib/identity/inline-atom-lifecycle-flag";
import { useInlineAtomLifecycle } from "../useInlineAtomLifecycle";
import { useOrphanedFootnotes } from "@/hooks/useOrphanedFootnotes";
import { useStructuralRevisions } from "@/hooks/useStructuralRevisions";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import FootnotePanel from "@/panels/Footnotes/FootnotePanel";
import type { FootnoteInfo } from "@/components/Editor";

function footnoteNode(id: string, body: string) {
  return {
    type: "footnote",
    attrs: {
      footnoteId: id,
      number: 1,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] },
    },
  };
}
function para(text: string, atoms: Array<Record<string, unknown>> = []) {
  return { type: "paragraph", content: [{ type: "text", text }, ...atoms] };
}

function mountEditor(content: Record<string, unknown>): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [StarterKit, DocStructureObserver, Citation, Footnote],
    content,
  });
}

/** Walk the live editor footnotes into the panel's `footnoteInfos` shape
 *  (mirrors EditorHandle.getFootnotes). */
function liveFootnoteInfos(editor: Editor): FootnoteInfo[] {
  const out: FootnoteInfo[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "footnote" && node.attrs.footnoteId) {
      out.push({
        footnoteId: node.attrs.footnoteId,
        content: node.attrs.content,
        number: node.attrs.number || 0,
        pos,
        title: node.attrs.title || undefined,
        thanks: !!node.attrs.thanks,
      });
    }
    return true;
  });
  return out;
}

function footnotePos(editor: Editor): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((n, pos) => {
    if (found == null && n.type.name === "footnote") found = pos;
    return found == null;
  });
  return found;
}

// jsdom has no layout — PM scroll calls coordsAtPos → getClientRects. Stub them.
function stubClientRects() {
  const empty = (() => []) as unknown as () => DOMRectList;
  Element.prototype.getClientRects = empty;
  Range.prototype.getClientRects = empty;
  Element.prototype.getBoundingClientRect ??= (() => ({
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}),
  })) as unknown as () => DOMRect;
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

beforeEach(() => {
  stubClientRects();
  __resetForTests();
  DISK = null;
  writes.length = 0;
  setIdentityCascadeFlag(true);
  setInlineAtomLifecycleFlag(true);
});
afterEach(() => {
  cleanup();
  setIdentityCascadeFlag(undefined);
  setInlineAtomLifecycleFlag(undefined);
});

/** Mount the full flag-ON wiring (consumer + lifecycle reconciler + the REAL
 *  durable sidecar) and expose the sidecar API the panel renders from. */
function wireSidecar(editor: Editor, docId: string) {
  const cascade = new IdentityCascade();
  return renderHook(() => {
    const consumer = useIdentityBusConsumer(editor, cascade);
    const rev = useStructuralRevisions(editor);
    const orphans = useOrphanedFootnotes(docId);
    useInlineAtomLifecycle({
      editor,
      consumer,
      cascade,
      orphans,
      atomRevision: rev.footnotes + rev.citations,
    });
    return orphans;
  });
}

/** Render FootnotePanel from the sidecar orphans + live footnote infos, exactly
 *  EditorPane's flag-ON shape (sidecar setters as the orphan handlers). */
function renderPanel(
  orphans: ReturnType<typeof useOrphanedFootnotes>,
  footnoteInfos: FootnoteInfo[],
) {
  return render(
    <FootnotePanel
      footnotes={footnoteInfos}
      selectedId={null}
      onSelect={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      onScrollToMarker={() => {}}
      orphanedFootnotes={orphans.orphans}
      onDeleteOrphan={orphans.clearOrphan}
      onEditOrphan={orphans.editOrphanContent}
      onEditOrphanTitle={orphans.editOrphanTitle}
    />,
  );
}

describe("W2 cutover — FootnotePanel renders from the durable sidecar (flag ON)", () => {
  it("FN-A1-03 reaches the UI: delete→undo clears the orphan, one card, no duplicate key", async () => {
    const editor = mountEditor({
      type: "doc",
      content: [para("Body ", [footnoteNode("f007", "the footnote body")])],
    });
    beginDocPipeline("doc-rendered");
    const hook = wireSidecar(editor, "doc-rendered");
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));

    // Trap React's duplicate-key warning (the FN-A1-03 crash signature).
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Delete the footnote atom (a real, undoable range delete).
    const pos = footnotePos(editor);
    expect(pos).not.toBeNull();
    await act(async () => {
      editor.view.dispatch(editor.state.tr.delete(pos!, pos! + 1));
      await Promise.resolve();
    });

    // The footnote-with-content orphaned into the SIDECAR (the rendered store).
    await waitFor(() =>
      expect(hook.result.current.orphans.map((o) => o.footnoteId)).toContain("f007"),
    );

    // Panel renders the orphan card (and no anchored card — marker is gone).
    const afterDelete = renderPanel(hook.result.current, liveFootnoteInfos(editor));
    expect(afterDelete.queryByTestId("fn-orphan-f007")).toBeTruthy();
    expect(afterDelete.queryByTestId("fn-anchored-f007")).toBeNull();
    afterDelete.unmount();

    // Undo brings the footnote back → the reconciler clears the orphan record so
    // the atom is never anchored AND orphan (FN-A1-03).
    await act(async () => {
      editor.commands.undo();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(hook.result.current.orphans.map((o) => o.footnoteId)).not.toContain("f007"),
    );

    // Render the panel from the post-undo sidecar + live doc: EXACTLY ONE card
    // (the anchored f007), zero orphan cards, and NO duplicate-key warning.
    const afterUndo = renderPanel(hook.result.current, liveFootnoteInfos(editor));
    expect(afterUndo.queryAllByTestId("fn-anchored-f007")).toHaveLength(1);
    expect(afterUndo.queryByTestId("fn-orphan-f007")).toBeNull();
    expect(afterUndo.container.querySelectorAll("[data-card-key='f007']")).toHaveLength(1);

    const dupKeyWarning = errSpy.mock.calls.some((c) =>
      String(c[0] ?? "").includes("same key"),
    );
    expect(dupKeyWarning).toBe(false);

    errSpy.mockRestore();
    afterUndo.unmount();
    hook.unmount();
    editor.destroy();
  });

  it("FN-A2-01: the orphan survives a simulated reload (sidecar persistence) and the panel re-renders it", async () => {
    const editor = mountEditor({
      type: "doc",
      content: [para("Body ", [footnoteNode("f009", "durable body")])],
    });
    beginDocPipeline("doc-reload");
    const hook = wireSidecar(editor, "doc-reload");
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));

    // Delete → orphan upserted to the sidecar by the reconciler.
    const pos = footnotePos(editor);
    await act(async () => {
      editor.view.dispatch(editor.state.tr.delete(pos!, pos! + 1));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(hook.result.current.orphans.map((o) => o.footnoteId)).toContain("f009"),
    );

    // The debounced write lands the durable record.
    await waitFor(() => {
      const w = writes.find((w) => w.docId === "doc-reload");
      expect(w).toBeTruthy();
    });
    const lastWrite = writes.at(-1)!;
    expect(lastWrite.filename).toBe("orphaned-footnotes.json");
    hook.unmount();
    editor.destroy();

    // Simulate a reload: a fresh sidecar hook reads the persisted record back
    // (no editor, no reconciler — pure persistence), and the panel renders it.
    DISK = lastWrite.data;
    const reloaded = renderHook(() => useOrphanedFootnotes("doc-reload"));
    await waitFor(() => expect(reloaded.result.current.orphans).toHaveLength(1));
    expect(reloaded.result.current.orphans[0].footnoteId).toBe("f009");

    const panel = renderPanel(reloaded.result.current, []);
    expect(panel.queryByTestId("fn-orphan-f009")).toBeTruthy();
    panel.unmount();
    reloaded.unmount();
  });
});
