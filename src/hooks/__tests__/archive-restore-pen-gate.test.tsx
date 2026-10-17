// @vitest-environment jsdom
//
// TASK 1169 — the Archive Restore door crosses the pen gate.
//
// Restore's CARD route (task 712: reinstate into the card's own panel + drop
// the snippet from archive.json) is React state plus sidecar writes — the
// `readOnlyEnforcer` never sees it, so before this task a press under a pen
// hold still moved a card between two sidecars the partner may be writing.
// Its EXCERPT route was refused by the enforcer, but the not-landed toast then
// blamed the caret. `EditorPane.handleArchiveRestore` now asks
// `archiveRestoreRefusal` (live `surfaceEditableNow`) before either route.
//
// The door legs below compose the gate with the REAL `useArchive` and
// `useNotes` hooks exactly as the handler does (gate → `restoreSnippet` with the
// panel's `reinstate`), each paired with a POSITIVE CONTROL on the identical
// fixture; the census pins that the handler really asks the gate first.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, renderHook, waitFor } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: (...a: unknown[]) => mockRead(...a),
    readSidecarIfExists: (...a: unknown[]) => mockRead(...a),
    writeSidecar: (...a: unknown[]) => mockWrite(...a),
  }),
);

import { Editor } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { archiveRestoreRefusal } from "@/lib/archive-restore-gate";
import { useArchive } from "../useArchive";
import { useNotes } from "../useNotes";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

function mountEditor(opts: { editable: boolean; editableRef?: { current: boolean } }): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef: opts.editableRef ?? { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  return new Editor({
    element,
    editable: opts.editable,
    extensions: buildEditorExtensions(ctx),
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] },
  });
}

const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a margin thought" }] }] };
const originalNote = {
  kind: "note",
  id: "n-1",
  title: "Why",
  content: body,
  aiRequest: false,
  createdAt: "2025-12-12T00:00:00.000Z",
  links: [],
};
const originSnippet = {
  id: "n-1",
  title: "Why",
  content: body,
  createdAt: "2026-09-01T00:00:00.000Z",
  links: [],
  originalPanel: "notes",
  originalCard: originalNote,
  archivedAt: "2026-09-01T00:00:00.000Z",
};
const excerptSnippet = { id: "x-1", title: "", content: body, createdAt: "2026-09-01T00:00:00.000Z", links: [] };

/** Archive + Notes for one doc, each reading its own sidecar shape. */
async function mountDoc(docId: string) {
  beginDocPipeline(docId);
  mockRead.mockImplementation(async (_dir: unknown, name: string) =>
    String(name).includes("archive") ? { snippets: [originSnippet, excerptSnippet] } : { cards: [] },
  );
  const archive = renderHook(() => useArchive(docId));
  const notes = renderHook(() => useNotes(docId));
  await waitFor(() => expect(archive.result.current.snippets).toHaveLength(2));
  await waitFor(() => expect(notes.result.current.cards).toEqual([]));
  return { archive, notes };
}

/** The handler's shape: gate first, then the one restore verb. */
function pressRestore(
  editor: Editor,
  id: string,
  hooks: Awaited<ReturnType<typeof mountDoc>>,
  land: () => boolean,
): { notified: string | null; restored: boolean } {
  const refusal = archiveRestoreRefusal(editor);
  if (refusal) return { notified: refusal, restored: false };
  let restored = false;
  act(() => {
    restored = hooks.archive.result.current.restoreSnippet(id, land, (_panel, card) =>
      hooks.notes.result.current.reinstate(card),
    );
  });
  return { notified: null, restored };
}

describe("archiveRestoreRefusal — the cause is named", () => {
  it("an editable surface (and no surface) passes", () => {
    const editor = mountEditor({ editable: true });
    expect(archiveRestoreRefusal(editor)).toBeNull();
    expect(archiveRestoreRefusal(null)).toBeNull();
    editor.destroy();
  });

  it("the pen (view.editable false) names the co-author, read live", () => {
    const editor = mountEditor({ editable: true });
    editor.setEditable(false); // the partner takes the pen AFTER the card rendered
    const msg = archiveRestoreRefusal(editor);
    expect(msg).toMatch(/^Your co-author has the pen/);
    expect(msg).toMatch(/Nothing was removed from the Archive\./);
    expect(msg).not.toMatch(/ordinary paragraph/);
    editor.destroy();
  });

  it("the host axis (editableRef false) names read-only, not the pen", () => {
    const editableRef = { current: true };
    const editor = mountEditor({ editable: true, editableRef });
    editableRef.current = false;
    expect(archiveRestoreRefusal(editor)).toMatch(/^This paper is open read-only/);
    editor.destroy();
  });
});

describe("task 1169 — Restore under a pen hold writes nothing", () => {
  it("a card-origin Restore leaves the panel and archive.json unchanged", async () => {
    const hooks = await mountDoc("doc-pen-card");
    const editor = mountEditor({ editable: false });
    mockWrite.mockClear();
    const { notified, restored } = pressRestore(editor, "n-1", hooks, () => true);
    expect(restored).toBe(false);
    expect(notified).toMatch(/^Your co-author has the pen/);
    expect(hooks.notes.result.current.cards, "no card registered").toEqual([]);
    expect(hooks.archive.result.current.snippets.map((s) => s.id)).toEqual(["n-1", "x-1"]);
    expect(mockWrite, "no sidecar written").not.toHaveBeenCalled();
    editor.destroy();
  });

  it("an excerpt Restore notifies with the pen phrase, never the caret instruction", async () => {
    const hooks = await mountDoc("doc-pen-excerpt");
    const editor = mountEditor({ editable: false });
    const land = vi.fn(() => true);
    const { notified } = pressRestore(editor, "x-1", hooks, land);
    expect(land).not.toHaveBeenCalled();
    expect(notified).toMatch(/^Your co-author has the pen/);
    expect(hooks.archive.result.current.snippets.find((s) => s.id === "x-1")?.archived).toBeFalsy();
    editor.destroy();
  });

  it("POSITIVE CONTROL: with the pen released both routes land", async () => {
    const hooks = await mountDoc("doc-pen-free");
    const editor = mountEditor({ editable: true });
    const card = pressRestore(editor, "n-1", hooks, () => true);
    expect(card).toEqual({ notified: null, restored: true });
    expect(hooks.notes.result.current.cards.map((c) => c.id)).toEqual(["n-1"]);
    expect(hooks.archive.result.current.snippets.map((s) => s.id)).toEqual(["x-1"]);
    const land = vi.fn(() => true);
    const excerpt = pressRestore(editor, "x-1", hooks, land);
    expect(excerpt).toEqual({ notified: null, restored: true });
    expect(land).toHaveBeenCalledWith(body);
    editor.destroy();
  });
});

describe("CENSUS — EditorPane's Restore door asks the gate before either route", () => {
  it("handleArchiveRestore calls archiveRestoreRefusal before snippetOrigin / restoreSnippet", () => {
    const src = readFileSync(join(process.cwd(), "src/components/EditorPane.tsx"), "utf8");
    const start = src.indexOf("const handleArchiveRestore = useCallback(");
    expect(start, "handler found").toBeGreaterThan(-1);
    const end = src.indexOf("const handleArchiveDelete", start);
    const handler = src.slice(start, end);
    const gate = handler.indexOf("archiveRestoreRefusal(innerRef.current?.getEditor())");
    expect(gate, "the handler asks the gate on its own editor").toBeGreaterThan(-1);
    expect(gate).toBeLessThan(handler.indexOf("archiveHook.snippetOrigin("));
    expect(gate).toBeLessThan(handler.indexOf("archiveHook.restoreSnippet("));
  });
});
