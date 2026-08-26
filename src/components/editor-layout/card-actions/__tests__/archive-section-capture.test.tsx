// @vitest-environment jsdom
//
// TASK 308 — archiving a SECTION, end to end, plus the never-destroy guard.
//
// THE BUG (data loss, reported by Gabriel): grab bar on a section title →
// Archive removed the entire section from the document and the Archive panel
// showed nothing. The capture was faithful and the delete was intended; the
// hole was in between — the archive card body's schema had no `heading` node,
// and TipTap does not throw on an unknown node type (`createNodeFromContent`
// swallows the `RangeError` and returns an EMPTY document), so the card booted
// blank with only a `console.warn`. Deleted from the doc, unmountable in the
// card.
//
// These drive the REAL `useDragHandleActions` hook over the REAL main-editor
// extension stack, so the section-range resolution, the cascade, the capture and
// the delete all run for real. Two contracts:
//
//   1. THE FIX — archiving a section removes it from the doc AND hands
//      `createArchiveSnippet` a capture that contains the heading + every body
//      block + the sub-section, and that capture MOUNTS in the archive body's
//      schema. (The schema-level round-trip per cluster member lives in
//      `src/lib/tiptap/__tests__/excerpt-schema.test.ts`; this pins the
//      dispatcher end of it.)
//   2. THE INVARIANT — when the capture canNOT mount, the delete is NOT
//      dispatched, no snippet is minted, and the user is notified. This is what
//      retires the class: a future node kind the excerpt surface hasn't caught
//      up on refuses instead of destroying. It is simulated by forcing
//      `canMountInCardBody` to fail, because today (post-fix) nothing in the
//      main vocabulary actually does — which is precisely why the guard has to
//      be tested against a hypothetical rather than a live gap.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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

vi.mock("@/lib/focus-new-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/focus-new-card")>();
  return { ...actual, focusNewCard: vi.fn() };
});

// Partial mock so the guard can be forced to refuse. Every other export — most
// importantly the schema builders both card surfaces mount — stays REAL.
const mountCheckOverride: { value: null | { ok: false; reason: string } } = { value: null };
vi.mock("@/lib/tiptap/borrowed-schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tiptap/borrowed-schema")>();
  return {
    ...actual,
    canMountInCardBody: (json: unknown, scope: "card" | "excerpt") =>
      mountCheckOverride.value ?? actual.canMountInCardBody(json, scope),
  };
});

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { renderHook } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  useDragHandleActions,
  type DragHandleActionsDeps,
  type DragHandleRef,
} from "../drag-handle-actions";
import { canMountInCardBody } from "@/lib/tiptap/borrowed-schema";
import type { DragHandleAction } from "@/components/DragHandleMenu";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

function mountDoc(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
}

const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
function installLayoutShims(): void {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
}

beforeEach(() => {
  installLayoutShims();
  mountCheckOverride.value = null;
});

afterEach(() => {
  document.body.innerHTML = "";
  mountCheckOverride.value = null;
  vi.restoreAllMocks();
});

interface ArchiveCall {
  text: unknown;
  content: unknown;
  paragraphId: unknown;
}

function makeHarness(editor: Editor) {
  const notify = vi.fn();
  const archiveCalls: ArchiveCall[] = [];
  let n = 0;
  const nextId = () => `card-${++n}`;

  const cardCreation = {
    createNote: () => ({ id: nextId() }),
    createTodo: () => ({ id: nextId() }),
    createHighlight: () => ({ id: nextId() }),
    createRevisionRequest: () => ({ id: nextId() }),
    createFootnote: () => ({ footnoteId: nextId() }),
    createCitation: () => ({ id: nextId() }),
    createCutterComment: () => ({ id: nextId() }),
    createReportRequest: () => ({ id: nextId() }),
    createArchiveSnippet: (opts: { text?: unknown; content?: unknown; paragraphId?: unknown }) => {
      archiveCalls.push({ text: opts.text, content: opts.content, paragraphId: opts.paragraphId });
      return { id: nextId() };
    },
  } as unknown as DragHandleActionsDeps["cardCreation"];

  const deps: DragHandleActionsDeps = {
    editorRef: { current: { getEditor: () => editor } as never },
    cardCreation,
    cardLifecycle: { get: () => undefined } as unknown as DragHandleActionsDeps["cardLifecycle"],
    // task 491: the capture-retarget door. Inert here — no card
    // collections are wired, so the sweep finds nothing to move.
    anchorRetarget: { retarget: () => 0 },
    confirm: async () => true,
    notify,
    prefs: { placements: [], activeLeft: null, activeRight: null } as never,
    expandLeft: () => {},
    expandRight: () => {},
    clearBlankIfSet: () => {},
  };

  const { result } = renderHook(() => useDragHandleActions(deps));
  return {
    dispatch: result.current.dispatch as (a: DragHandleAction, r: DragHandleRef) => Promise<void>,
    notify,
    archiveCalls,
  };
}

/** A section: heading + body paragraph + sub-heading + sub-body, followed by a
 *  sibling section the archive must NOT touch. */
function sectionDoc(): JSONContent[] {
  return [
    { type: "paragraph", attrs: { uuid: "p-before" }, content: [{ type: "text", text: "Before the section." }] },
    { type: "heading", attrs: { level: 2, uuid: "h-target" }, content: [{ type: "text", text: "Target Section" }] },
    { type: "paragraph", attrs: { uuid: "p-body" }, content: [{ type: "text", text: "Section body prose." }] },
    { type: "heading", attrs: { level: 3, uuid: "h-sub" }, content: [{ type: "text", text: "Sub-section" }] },
    { type: "paragraph", attrs: { uuid: "p-sub" }, content: [{ type: "text", text: "Sub-section prose." }] },
    { type: "heading", attrs: { level: 2, uuid: "h-next" }, content: [{ type: "text", text: "Next Section" }] },
    { type: "paragraph", attrs: { uuid: "p-next" }, content: [{ type: "text", text: "Untouched." }] },
  ];
}

const HEADING_REF: DragHandleRef = { kind: "heading", id: "h-target" } as DragHandleRef;

/** Every top-level block's uuid, in document order. */
function blockUuids(editor: Editor): (string | null)[] {
  const out: (string | null)[] = [];
  editor.state.doc.forEach((node) => {
    out.push((node.attrs?.uuid as string | null) ?? null);
  });
  return out;
}

/** Every node type name in a JSONContent tree. */
function typesIn(json: unknown): Set<string> {
  const seen = new Set<string>();
  const walk = (nd: unknown) => {
    if (!nd || typeof nd !== "object") return;
    const node = nd as { type?: string; content?: unknown[] };
    if (node.type) seen.add(node.type);
    (node.content ?? []).forEach(walk);
  };
  walk(json);
  return seen;
}

describe("task 308 — archiving a section captures it whole", () => {
  it("removes the section from the doc AND captures heading + body + sub-section", async () => {
    const editor = mountDoc(sectionDoc());
    const h = makeHarness(editor);

    await h.dispatch("archive", HEADING_REF);

    // The section is gone from the document — heading, body, sub-heading, sub-body.
    const docText = editor.state.doc.textContent;
    expect(docText).not.toContain("Target Section");
    expect(docText).not.toContain("Section body prose.");
    expect(docText).not.toContain("Sub-section");
    expect(docText).not.toContain("Sub-section prose.");
    // …and only that section: the neighbours survive.
    expect(docText).toContain("Before the section.");
    expect(docText).toContain("Next Section");
    expect(docText).toContain("Untouched.");

    // The capture holds the COMPLETE section.
    expect(h.archiveCalls).toHaveLength(1);
    const captured = h.archiveCalls[0].content;
    const capturedText = JSON.stringify(captured);
    expect(capturedText).toContain("Target Section");
    expect(capturedText).toContain("Section body prose.");
    expect(capturedText).toContain("Sub-section");
    expect(capturedText).toContain("Sub-section prose.");
    // The heading is present AS A HEADING NODE, not flattened to a paragraph —
    // that node is the whole reason the card used to blank.
    expect(typesIn(captured).has("heading")).toBe(true);

    // And — the decisive assertion — that capture can actually MOUNT in the
    // archive card body. Before the fix this was false, which is what turned an
    // intended delete into data loss.
    expect(canMountInCardBody(captured, "excerpt").ok).toBe(true);
    // The regression, pinned from the other side: this SAME capture is still
    // unmountable at the narrow `"card"` scope — which is exactly what the
    // archive body used to mount, and exactly why the section vanished. If
    // someone re-narrows `archive`'s `bodySchema` facet, this is the assertion
    // that says what breaks.
    expect(canMountInCardBody(captured, "card").ok).toBe(false);

    // It survives the sidecar's JSON save→reload unchanged.
    const reloaded = JSON.parse(JSON.stringify(captured));
    expect(canMountInCardBody(reloaded, "excerpt").ok).toBe(true);
    expect(reloaded).toEqual(captured);
  });

  it("Cmd-Z immediately after an archive puts the section back", () => {
    // The removal is a single `tr` dispatched to the editor, so undo is a real
    // recovery path for an already-archived section. Worth pinning rather than
    // assuming: if the delete were ever split across transactions, one Cmd-Z
    // would restore only part of the section and quietly look like it worked.
    const editor = mountDoc(sectionDoc());
    const h = makeHarness(editor);
    const beforeText = editor.state.doc.textContent;
    const beforeUuids = blockUuids(editor);

    return h.dispatch("archive", HEADING_REF).then(() => {
      expect(editor.state.doc.textContent).not.toContain("Target Section");
      editor.commands.undo();
      // Text and block identity both come back — every uuid, in order, so this
      // catches a partial restore that happens to read the same.
      //
      // Compared on text + uuids rather than the whole `toJSON()`: the doc-wide
      // section numberer re-derives `sectionNumber` after the undo, so a raw
      // node-for-node compare fails on a DERIVED attribute while the user's
      // content is in fact fully restored. Asserting the derived value would
      // pin the numberer's timing, not the recovery.
      expect(editor.state.doc.textContent).toBe(beforeText);
      expect(blockUuids(editor)).toEqual(beforeUuids);
    });
  });
});

describe("task 308 — the never-destroy invariant", () => {
  it("refuses the delete when the capture cannot mount, and notifies", async () => {
    const editor = mountDoc(sectionDoc());
    const before = editor.state.doc.toJSON();
    const h = makeHarness(editor);

    // Simulate a future document node the excerpt surface cannot hold.
    mountCheckOverride.value = { ok: false, reason: "Unknown node type: someFutureBlock" };

    await h.dispatch("archive", HEADING_REF);

    // THE DOCUMENT IS UNTOUCHED — not the section, not a sidecar, nothing.
    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(editor.state.doc.textContent).toContain("Target Section");
    expect(editor.state.doc.textContent).toContain("Sub-section prose.");
    // No snippet was minted — a half-done archive would be its own bug.
    expect(h.archiveCalls).toHaveLength(0);
    // The user is told, rather than silently getting nothing.
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(String(h.notify.mock.calls[0][0].message)).toMatch(/nothing was removed/i);
  });

  it("does not refuse a capture that CAN mount (no over-blocking)", async () => {
    const editor = mountDoc(sectionDoc());
    const h = makeHarness(editor);

    await h.dispatch("archive", HEADING_REF);

    expect(h.archiveCalls).toHaveLength(1);
    expect(h.notify).not.toHaveBeenCalled();
    expect(editor.state.doc.textContent).not.toContain("Target Section");
  });
});
