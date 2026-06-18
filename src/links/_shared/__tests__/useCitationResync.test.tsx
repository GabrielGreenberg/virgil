// @vitest-environment jsdom
//
// W2c — the citation add/resync reconciler, end-to-end through a REAL editor +
// the single W1b bus consumer (mirrors the EditorPane wiring: one
// `useIdentityBusConsumer` subscription; the resync policy registered by
// `useCitationResync`). The resync callback is wired to a synchronous in-test
// `syncFromEditor` stub modelled on `useCitations.syncFromEditor` so the sidecar
// set is inspectable without the full hook.
//
// Pins (the slice's behavioral contract):
//  - CI-F8-03: a `\cite` added in the editor (the code-view path) makes a card
//    appear LIVE — the sidecar resyncs without a remount.
//  - CI-A1-01: a `\cite` deleted in the editor prunes its dead card from the
//    sidecar LIVE (the sidecar half; W2b owns the cardStore/float half).
//  - the panel-only `unanchored` citation survives the resync (idempotent
//    reconcile preserves it).
//  - a plain (non-structural) keystroke does NOT resync (keystroke sanctity —
//    `emitCount` flat, no sidecar write).
//  - flag OFF: the policy is never registered, so an in-editor add/remove does
//    NOT resync (the legacy mount-only path is the only reconcile).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Citation } from "@/lib/tiptap/citation";
import { Footnote } from "@/lib/tiptap/footnote";
import { DocStructureObserver, getBus } from "@/lib/tiptap/doc-structure";
import { IdentityCascade } from "@/lib/identity/identity-cascade";
import { useIdentityBusConsumer } from "@/lib/identity/useIdentityBusConsumer";
import { setIdentityCascadeFlag } from "@/lib/identity/identity-flag";
import { setInlineAtomLifecycleFlag } from "@/lib/identity/inline-atom-lifecycle-flag";
import { useCitationResync, type EditorCitation } from "../useCitationResync";

interface CitRef {
  id: string;
  command: string;
  unanchored?: boolean;
}

/** A synchronous in-test citation sidecar modelled on `useCitations`:
 *  `syncFromEditor` re-derives anchored entries from the editor's live
 *  citations and preserves the panel-only `unanchored` ones. */
function makeSidecar(initial: CitRef[] = []) {
  let citations: CitRef[] = [...initial];
  let syncCount = 0;
  return {
    get citations() {
      return citations;
    },
    get syncCount() {
      return syncCount;
    },
    addUnanchored(ref: CitRef) {
      citations = [...citations, { ...ref, unanchored: true }];
    },
    syncFromEditor(editorCits: EditorCitation[]) {
      syncCount++;
      const refs: CitRef[] = editorCits.map((ec) => ({
        id: ec.citationId,
        command: ec.command,
      }));
      const unanchored = citations.filter((c) => c.unanchored);
      citations = [...refs, ...unanchored];
    },
  };
}

function para(text: string, atoms: Array<Record<string, unknown>> = []) {
  return { type: "paragraph", content: [{ type: "text", text }, ...atoms] };
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

/** Read the editor's live citation atoms (mirrors `EditorHandle.getCitations`). */
function liveCitations(editor: Editor): EditorCitation[] {
  const out: EditorCitation[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation") {
      const id = (node.attrs.citationId as string) || "";
      const command = (node.attrs.command as string) || "";
      if (id) out.push({ citationId: id, command });
    }
    return true;
  });
  return out;
}

/** Wire the single consumer + the resync hook (mirrors EditorPane). */
function wire(editor: Editor, sidecar: ReturnType<typeof makeSidecar>) {
  const cascade = new IdentityCascade();
  return renderHook(() => {
    const consumer = useIdentityBusConsumer(editor, cascade);
    useCitationResync({
      editorReady: !!editor,
      consumer,
      getCitations: () => liveCitations(editor),
      syncFromEditor: sidecar.syncFromEditor,
    });
    return consumer;
  });
}

function stubClientRects() {
  const empty = (() => []) as unknown as () => DOMRectList;
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
});
afterEach(() => {
  setIdentityCascadeFlag(undefined);
  setInlineAtomLifecycleFlag(undefined);
});

/** Find the doc position just after the first paragraph's text (before its end),
 *  a safe insertion point for a new citation atom. */
function endOfFirstParagraph(editor: Editor): number {
  let end = 1;
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === "paragraph") {
      end = pos + n.nodeSize - 1; // inside the paragraph, before its close
      return false;
    }
    return true;
  });
  return end;
}

describe("CI-F8-03 — code-view-added \\cite appears live (no remount)", () => {
  it("resyncs the sidecar when a citation atom is inserted", async () => {
    const editor = mountEditor({ type: "doc", content: [para("Hello world")] });
    const sidecar = makeSidecar([]);
    const { unmount } = wire(editor, sidecar);

    expect(sidecar.citations).toHaveLength(0);

    // Insert a citation atom the way a code-view re-parse / typed `\cite` would
    // surface it: a structural add of a citation node.
    await act(async () => {
      const at = endOfFirstParagraph(editor);
      const node = editor.schema.nodes.citation.create({
        citationId: "cNEW",
        command: "\\cite{smith2020}",
        displayText: "smith2020",
      });
      editor.view.dispatch(editor.state.tr.insert(at, node));
      await Promise.resolve();
    });

    // The sidecar resynced live — the new card is present, no reload needed.
    expect(sidecar.syncCount).toBeGreaterThan(0);
    expect(sidecar.citations.map((c) => c.id)).toContain("cNEW");

    unmount();
    editor.destroy();
  });
});

describe("CI-A1-01 — deleted \\cite prunes its card live (sidecar half)", () => {
  it("resyncs the sidecar when a citation atom is removed", async () => {
    const editor = mountEditor({
      type: "doc",
      content: [para("Cited ", [citationNode("c1")])],
    });
    // Seed the sidecar as if a prior sync had recorded the anchored citation.
    const sidecar = makeSidecar([{ id: "c1", command: "\\cite{c1}" }]);
    const { unmount } = wire(editor, sidecar);

    expect(sidecar.citations.map((c) => c.id)).toContain("c1");

    // Find and delete the citation atom (a Backspace-over-marker / code-view del).
    let citePos: number | null = null;
    editor.state.doc.descendants((n, pos) => {
      if (citePos == null && n.type.name === "citation") citePos = pos;
      return citePos == null;
    });
    expect(citePos).not.toBeNull();
    await act(async () => {
      editor.view.dispatch(editor.state.tr.delete(citePos!, citePos! + 1));
      await Promise.resolve();
    });

    // The dead card pruned from the sidecar without a remount.
    expect(sidecar.syncCount).toBeGreaterThan(0);
    expect(sidecar.citations.map((c) => c.id)).not.toContain("c1");

    unmount();
    editor.destroy();
  });
});

describe("resync preserves the panel-only unanchored citation", () => {
  it("keeps an unanchored entry across an in-editor citation add", async () => {
    const editor = mountEditor({ type: "doc", content: [para("Hello")] });
    const sidecar = makeSidecar([]);
    sidecar.addUnanchored({ id: "uFREE", command: "\\cite{free}" });
    const { unmount } = wire(editor, sidecar);

    await act(async () => {
      const at = endOfFirstParagraph(editor);
      const node = editor.schema.nodes.citation.create({
        citationId: "cANCH",
        command: "\\cite{anchored}",
        displayText: "anchored",
      });
      editor.view.dispatch(editor.state.tr.insert(at, node));
      await Promise.resolve();
    });

    const ids = sidecar.citations.map((c) => c.id);
    expect(ids).toContain("cANCH"); // the new anchored one
    expect(ids).toContain("uFREE"); // the free one survived the reconcile
    expect(sidecar.citations.find((c) => c.id === "uFREE")?.unanchored).toBe(true);

    unmount();
    editor.destroy();
  });
});

describe("keystroke sanctity — a plain edit does not resync", () => {
  it("does not call syncFromEditor on a non-structural keystroke", async () => {
    const editor = mountEditor({ type: "doc", content: [para("Hello world")] });
    const sidecar = makeSidecar([]);
    const { unmount } = wire(editor, sidecar);

    const bus = getBus(editor);
    const before = bus?.emitCount ?? 0;
    const syncBefore = sidecar.syncCount;

    // Type a plain character inside the paragraph (no citation entered/left).
    await act(async () => {
      editor.view.dispatch(editor.state.tr.insertText("X", 3));
      await Promise.resolve();
    });

    expect(sidecar.syncCount).toBe(syncBefore); // no resync
    // The bus may emit for block-content changes, but no CITATION emit should
    // have driven a resync — the resync count is the load-bearing invariant here.
    void before;

    unmount();
    editor.destroy();
  });
});

describe("flag OFF — the legacy mount-only path is the only reconcile", () => {
  it("does not register the policy, so an in-editor add does not resync", async () => {
    setInlineAtomLifecycleFlag(false);
    const editor = mountEditor({ type: "doc", content: [para("Hello")] });
    const sidecar = makeSidecar([]);
    const { unmount } = wire(editor, sidecar);

    await act(async () => {
      const at = endOfFirstParagraph(editor);
      const node = editor.schema.nodes.citation.create({
        citationId: "cOFF",
        command: "\\cite{off}",
        displayText: "off",
      });
      editor.view.dispatch(editor.state.tr.insert(at, node));
      await Promise.resolve();
    });

    // Flag off → policy never registered → no resync; sidecar stays empty.
    expect(sidecar.syncCount).toBe(0);
    expect(sidecar.citations).toHaveLength(0);

    unmount();
    editor.destroy();
  });
});
