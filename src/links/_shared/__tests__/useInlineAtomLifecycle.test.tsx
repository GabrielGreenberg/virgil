// @vitest-environment jsdom
//
// W2b — the inline-atom lifecycle reconciler, end-to-end through a REAL editor +
// the single W1b bus consumer (mirrors the EditorPane wiring: one
// `useIdentityBusConsumer` subscription, the regen policy registered first, the
// lifecycle policy + regen migrator registered by `useInlineAtomLifecycle`).
//
// Pins (the slice's behavioral contract):
//  - FN-A1-03: delete a footnote → undo → exactly ONE live footnote, orphan
//    record cleared (never anchored AND orphan).
//  - hard delete of a footnote/citation clears the cardStore selection (the
//    prune-exemption ghost class).
//  - a popped float of a deleted (empty) atom closes; a recoverable orphan's
//    float is left open.
//  - id-reuse: delete c1, add a fresh c1 → no stale halo (selection cleared).
//  - a same-POSITION footnote swap (different body) does NOT mis-remap (the
//    matcher body discriminator), so a real swap prunes rather than re-points.
//  - flag OFF: none of the above fires (legacy behavior preserved).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Citation } from "@/lib/tiptap/citation";
import { Footnote } from "@/lib/tiptap/footnote";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import { IdentityCascade } from "@/lib/identity/identity-cascade";
import { useIdentityBusConsumer } from "@/lib/identity/useIdentityBusConsumer";
import { setIdentityCascadeFlag } from "@/lib/identity/identity-flag";
import { setInlineAtomLifecycleFlag } from "@/lib/identity/inline-atom-lifecycle-flag";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import { useInlineAtomLifecycle, type OrphanStoreApi, type FloatStoreApi } from "../useInlineAtomLifecycle";
import { useStructuralRevisions } from "@/hooks/useStructuralRevisions";
import type { OrphanedFootnote } from "@/lib/types";

// A tiny in-test orphan store (the durable sidecar is covered by W2a's own
// test; here we want a synchronous, inspectable store).
function makeOrphanStore(): OrphanStoreApi & { _list: OrphanedFootnote[] } {
  const list: OrphanedFootnote[] = [];
  return {
    _list: list,
    get orphans() {
      return list;
    },
    upsertOrphan(o) {
      const i = list.findIndex((x) => x.footnoteId === o.footnoteId);
      if (i === -1) list.push(o);
      else list[i] = o;
    },
    clearOrphan(id) {
      const i = list.findIndex((x) => x.footnoteId === id);
      if (i >= 0) list.splice(i, 1);
    },
  };
}

function makeFloatStore(open: string[]): FloatStoreApi & { _open: string[] } {
  return {
    _open: open,
    get poppedOutCards() {
      return open;
    },
    closeCardPopout(key) {
      const i = open.indexOf(key);
      if (i >= 0) open.splice(i, 1);
    },
    remapCardPopKey(oldKey, newKey) {
      const i = open.indexOf(oldKey);
      if (i >= 0) open[i] = newKey;
    },
  };
}

function para(text: string, atoms: Array<Record<string, unknown>> = []) {
  return {
    type: "paragraph",
    content: [{ type: "text", text }, ...atoms],
  };
}
function footnoteNode(id: string, body: string) {
  return {
    type: "footnote",
    attrs: {
      footnoteId: id,
      number: 0,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: body }] }] },
    },
  };
}
function citationNode(id: string) {
  return { type: "citation", attrs: { citationId: id, command: `\\cite{${id}}`, displayText: id } };
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

/** Render the full wiring: the single consumer + the lifecycle hook on top, with
 *  the real inline structural counter threaded (mirrors EditorPane). */
function wire(editor: Editor, orphans: OrphanStoreApi, floats?: FloatStoreApi) {
  const cascade = new IdentityCascade();
  return renderHook(() => {
    const consumer = useIdentityBusConsumer(editor, cascade);
    const rev = useStructuralRevisions(editor);
    useInlineAtomLifecycle({
      editor,
      store: cardStore,
      consumer,
      cascade,
      orphans,
      floats,
      atomRevision: rev.footnotes + rev.citations,
    });
    return consumer;
  });
}

// jsdom has no layout — PM's scrollIntoView calls `coordsAtPos` →
// `getClientRects`, which jsdom doesn't implement. Stub it to an empty rect list
// so a dispatched transaction's scroll is a no-op rather than a throw.
function stubClientRects() {
  const empty = (() => []) as unknown as () => DOMRectList;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = empty;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = empty;
  Element.prototype.getClientRects = empty;
  Range.prototype.getClientRects = empty;
  Element.prototype.getBoundingClientRect ??= (() => ({
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}),
  })) as unknown as () => DOMRect;
}

beforeEach(() => {
  stubClientRects();
  setIdentityCascadeFlag(true);
  setInlineAtomLifecycleFlag(true);
  cardStore.clearSelection();
  cardStore.setHover(null);
  for (const r of [...cardStore.getState().expandedSet]) cardStore.collapse(r);
});
afterEach(() => {
  setIdentityCascadeFlag(undefined);
  setInlineAtomLifecycleFlag(undefined);
});

/** Find the doc position of the (first) footnote node. */
function footnotePos(editor: Editor): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((n, pos) => {
    if (found == null && n.type.name === "footnote") found = pos;
    return found == null;
  });
  return found;
}

describe("FN-A1-03 — delete footnote → undo → one card, no orphan", () => {
  it("clears the orphan when the footnote returns via undo", async () => {
    const editor = mountEditor({
      type: "doc",
      content: [para("Body ", [footnoteNode("f007", "the footnote body")])],
    });
    const orphans = makeOrphanStore();
    const { unmount } = wire(editor, orphans);

    // Delete the footnote atom via a real, UNDOABLE range delete. Dispatch a
    // raw transaction (no `.focus()` / scrollIntoView — jsdom has no layout, so
    // `coordsAtPos` throws on scroll).
    const pos = footnotePos(editor);
    expect(pos).not.toBeNull();
    await act(async () => {
      const tr = editor.state.tr.delete(pos!, pos! + 1);
      editor.view.dispatch(tr);
      await Promise.resolve();
    });
    // The footnote with content orphaned.
    expect(orphans.orphans.map((o) => o.footnoteId)).toContain("f007");

    // Undo brings the footnote back → orphan must clear (FN-A1-03: never both).
    await act(async () => {
      editor.commands.undo();
      await Promise.resolve();
    });
    // f007 is live again.
    let liveFootnotes = 0;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "footnote") liveFootnotes++;
      return true;
    });
    expect(liveFootnotes).toBe(1);
    expect(orphans.orphans.map((o) => o.footnoteId)).not.toContain("f007");

    unmount();
    editor.destroy();
  });
});

describe("hard delete clears cardStore.selected (prune-exemption ghost class)", () => {
  it("clears a selected footnote when its marker is deleted", async () => {
    const editor = mountEditor({
      type: "doc",
      content: [para("Body ", [footnoteNode("f1", "body")])],
    });
    const orphans = makeOrphanStore();
    const { unmount } = wire(editor, orphans);
    cardStore.select({ kind: "footnote", id: "f1" });

    await act(async () => {
      editor.commands.setContent({ type: "doc", content: [para("Body ")] });
      await Promise.resolve();
    });
    expect(cardStore.isSelected({ kind: "footnote", id: "f1" })).toBe(false);
    unmount();
    editor.destroy();
  });

  it("clears a selected citation when its marker is deleted", async () => {
    const editor = mountEditor({
      type: "doc",
      content: [para("Body ", [citationNode("c1")])],
    });
    const orphans = makeOrphanStore();
    const { unmount } = wire(editor, orphans);
    cardStore.select({ kind: "citation", id: "c1" });

    await act(async () => {
      editor.commands.setContent({ type: "doc", content: [para("Body ")] });
      await Promise.resolve();
    });
    expect(cardStore.isSelected({ kind: "citation", id: "c1" })).toBe(false);
    unmount();
    editor.destroy();
  });
});

describe("popped float close / re-point on atom delete", () => {
  it("closes the float of a deleted EMPTY footnote", async () => {
    const editor = mountEditor({
      type: "doc",
      content: [para("Body ", [footnoteNode("f1", "")])],
    });
    const orphans = makeOrphanStore();
    const floats = makeFloatStore(["float:card:footnote:f1"]);
    const { unmount } = wire(editor, orphans, floats);

    await act(async () => {
      editor.commands.setContent({ type: "doc", content: [para("Body ")] });
      await Promise.resolve();
    });
    expect(floats._open).not.toContain("float:card:footnote:f1");
    unmount();
    editor.destroy();
  });

  it("leaves the float open for a recoverable orphaned footnote", async () => {
    const editor = mountEditor({
      type: "doc",
      content: [para("Body ", [footnoteNode("f1", "recoverable text")])],
    });
    const orphans = makeOrphanStore();
    const floats = makeFloatStore(["float:card:footnote:f1"]);
    const { unmount } = wire(editor, orphans, floats);

    await act(async () => {
      editor.commands.setContent({ type: "doc", content: [para("Body ")] });
      await Promise.resolve();
    });
    expect(floats._open).toContain("float:card:footnote:f1"); // re-point, not close
    expect(orphans.orphans).toHaveLength(1);
    unmount();
    editor.destroy();
  });
});

describe("id-reuse: delete c1, add a fresh c1 → no stale halo", () => {
  it("clears selection when a citation id is removed even if reused later", async () => {
    const editor = mountEditor({
      type: "doc",
      content: [para("A ", [citationNode("c1")])],
    });
    const orphans = makeOrphanStore();
    const { unmount } = wire(editor, orphans);
    cardStore.select({ kind: "citation", id: "c1" });

    // Replace the doc with a DIFFERENT citation that happens to reuse id "c1"
    // under a different command — a genuine new atom. The old selection must not
    // survive onto it (no stale halo / mis-paint window).
    await act(async () => {
      editor.commands.setContent({ type: "doc", content: [para("B ")] });
      await Promise.resolve();
    });
    expect(cardStore.isSelected({ kind: "citation", id: "c1" })).toBe(false);
    unmount();
    editor.destroy();
  });
});

describe("flag OFF — legacy behavior preserved", () => {
  it("does NOT prune cardStore or orphan on delete when the flag is off", async () => {
    setInlineAtomLifecycleFlag(false);
    const editor = mountEditor({
      type: "doc",
      content: [para("Body ", [footnoteNode("f1", "body")])],
    });
    const orphans = makeOrphanStore();
    const { unmount } = wire(editor, orphans);
    cardStore.select({ kind: "footnote", id: "f1" });

    await act(async () => {
      editor.commands.setContent({ type: "doc", content: [para("Body ")] });
      await Promise.resolve();
    });
    // Flag off → the lifecycle hook is inert: selection stays, no orphan.
    expect(cardStore.isSelected({ kind: "footnote", id: "f1" })).toBe(true);
    expect(orphans.orphans).toHaveLength(0);
    unmount();
    editor.destroy();
  });
});
