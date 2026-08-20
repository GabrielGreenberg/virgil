// @vitest-environment jsdom
//
// TASK 393 — Archive refused any passage carrying a Mode-B text anchor.
//
// THE BUG (reported by Gabriel, screenshot + the refused passage): an ordinary
// prose + itemize section would not archive — "Can't archive this — the Archive
// panel can't hold part of it, so nothing was removed." The one unusual thing
// about the passage was that every paragraph carried a `linkedAnchor` span
// (`\vlid{b50e}…\vlidend{b50e}`), i.e. some card's Mode-B anchor covered the
// whole region.
//
// THE MECHANISM — two tables, one question. The dispatcher validated the RAW
// slice JSON; the write path stores the NORMALIZED one, and the card normalizer
// deliberately strips `DOC_ONLY_MARKS` (`linkedAnchor`) — which is exactly why
// the excerpt schema deliberately does not register that mark. So the 308 guard
// asked "can the destination hold the raw capture?" while the destination is
// only ever handed the stripped one: a FALSE refusal, protecting against a loss
// that cannot happen, and blocking the action entirely on precisely the
// worked-over prose a user most wants to archive (anchors accumulate there).
//
// WHY NO PRE-393 SUITE COULD SEE IT: every archive fixture in the repo is
// UNANCHORED, so the raw and the normalized payload are the same object and the
// divergence is unrepresentable. Every leg below marks the region first.
//
// These drive the REAL `useDragHandleActions` hook over the REAL main-editor
// extension stack — the section resolution, the cascade, the capture, the
// sidecar cleanup and the delete all run for real.
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

// Partial mock so the guard can be forced to refuse for the naming leg. Every
// other export — most importantly the schema builders the card surfaces mount —
// stays REAL, and the capture door's normalize runs for real.
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
import { normalizeRichContent } from "@/lib/footnote-content";
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

// ---------------------------------------------------------------------------
// Gabriel's passage: a section whose every paragraph — and every list item,
// nested list included — carries ONE card's Mode-B anchor.
// ---------------------------------------------------------------------------

const ANCHOR_ID = "b50e";
const CARD_KEY = "revision:rev-1";

/** The `linkedAnchor` mark as the editor really stamps it. */
function anchorMark(): JSONContent["marks"] {
  return [
    {
      type: "linkedAnchor",
      attrs: {
        anchorId: ANCHOR_ID,
        kind: "revision",
        linkId: ANCHOR_ID,
        linkKind: "anchor",
        linkCard: CARD_KEY,
      },
    },
  ];
}

/** Anchored text — the whole run inside one card's Mode-B span. */
function t(text: string): JSONContent {
  return { type: "text", text, marks: anchorMark() };
}

function item(text: string, nested?: JSONContent): JSONContent {
  return {
    type: "listItem",
    attrs: { uuid: `li-${text.replace(/\W+/g, "-")}` },
    content: [
      { type: "paragraph", attrs: { uuid: `lip-${text.replace(/\W+/g, "-")}` }, content: [t(text)] },
      ...(nested ? [nested] : []),
    ],
  };
}

/** heading + two anchored paragraphs + an anchored itemize with a NESTED list. */
function anchoredSectionDoc(): JSONContent[] {
  return [
    { type: "paragraph", attrs: { uuid: "p-before" }, content: [{ type: "text", text: "Before." }] },
    { type: "heading", attrs: { level: 2, uuid: "h-target" }, content: [t("Anchored Section")] },
    { type: "paragraph", attrs: { uuid: "p-a" }, content: [t("First anchored paragraph.")] },
    {
      type: "bulletList",
      attrs: { uuid: "ul-outer" },
      content: [
        item("Outer bullet one", {
          type: "bulletList",
          attrs: { uuid: "ul-inner" },
          content: [item("Inner bullet")],
        }),
        item("Outer bullet two"),
      ],
    },
    { type: "paragraph", attrs: { uuid: "p-b" }, content: [t("Second anchored paragraph.")] },
    { type: "heading", attrs: { level: 2, uuid: "h-next" }, content: [{ type: "text", text: "Next Section" }] },
  ];
}

const HEADING_REF: DragHandleRef = { kind: "heading", id: "h-target" } as DragHandleRef;

interface ArchiveCall {
  text: unknown;
  content: unknown;
  paragraphId: unknown;
}

/** Every `lifecycle.get(kind).delete(id)` the dispatcher fires, in order. */
type LifecycleCall = `${string}:${string}`;

function makeHarness(editor: Editor) {
  const notify = vi.fn();
  const archiveCalls: ArchiveCall[] = [];
  const lifecycleCalls: LifecycleCall[] = [];
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
    cardLifecycle: {
      get: (kind: string) => ({
        delete: (id: string) => lifecycleCalls.push(`${kind}:${id}`),
      }),
    } as unknown as DragHandleActionsDeps["cardLifecycle"],
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
    lifecycleCalls,
  };
}

/** Every mark type name in a JSONContent tree. */
function marksIn(json: unknown): Set<string> {
  const seen = new Set<string>();
  const walk = (nd: unknown) => {
    if (!nd || typeof nd !== "object") return;
    if (Array.isArray(nd)) return nd.forEach(walk);
    const node = nd as { marks?: { type?: string }[]; content?: unknown };
    for (const m of node.marks ?? []) if (m?.type) seen.add(m.type);
    walk(node.content);
  };
  walk(json);
  return seen;
}

/** Every node type name in a JSONContent tree. */
function typesIn(json: unknown): Set<string> {
  const seen = new Set<string>();
  const walk = (nd: unknown) => {
    if (!nd || typeof nd !== "object") return;
    if (Array.isArray(nd)) return nd.forEach(walk);
    const node = nd as { type?: string; content?: unknown };
    if (node.type) seen.add(node.type);
    walk(node.content);
  };
  walk(json);
  return seen;
}

describe("task 393 — an anchored passage archives", () => {
  it("archives Gabriel's passage: the section leaves the doc and the snippet holds it", async () => {
    const editor = mountDoc(anchoredSectionDoc());
    const h = makeHarness(editor);

    await h.dispatch("archive", HEADING_REF);

    // THE DEFECT LEG. Pre-393 the guard refused here: nothing was captured,
    // nothing was deleted, and the user got a noun-less toast.
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.archiveCalls).toHaveLength(1);

    const docText = editor.state.doc.textContent;
    expect(docText).not.toContain("Anchored Section");
    expect(docText).not.toContain("First anchored paragraph.");
    expect(docText).not.toContain("Inner bullet");
    expect(docText).not.toContain("Second anchored paragraph.");
    // …and only that section.
    expect(docText).toContain("Before.");
    expect(docText).toContain("Next Section");

    const captured = h.archiveCalls[0].content;
    const capturedText = JSON.stringify(captured);
    expect(capturedText).toContain("Anchored Section");
    expect(capturedText).toContain("First anchored paragraph.");
    expect(capturedText).toContain("Outer bullet one");
    expect(capturedText).toContain("Inner bullet");
    expect(capturedText).toContain("Second anchored paragraph.");
    // Structure survives — the heading is a heading, the nested list is nested.
    expect(typesIn(captured).has("heading")).toBe(true);
    expect(typesIn(captured).has("bulletList")).toBe(true);
  });

  it("stores the payload it VALIDATED — no `linkedAnchor` reaches the snippet", async () => {
    const editor = mountDoc(anchoredSectionDoc());
    const h = makeHarness(editor);
    await h.dispatch("archive", HEADING_REF);

    const captured = h.archiveCalls[0].content;
    // The doc-only mark is gone from what the dispatcher handed over — so the
    // write's own `normalizeRichContent` is a NO-OP on it, which is the whole
    // of "one payload, one door": guard and write judge the same object.
    expect(marksIn(captured).has("linkedAnchor")).toBe(false);
    expect(normalizeRichContent(captured)).toEqual(captured);
    // And that object mounts — asked of the same value that will be stored,
    // not of a raw slice the write would never see.
    expect(canMountInCardBody(captured, "excerpt").ok).toBe(true);
    // The pre-393 payload — the raw slice, marks and all — does NOT mount.
    // This is the two-tables gap, pinned from the failing side so a future
    // "just validate the capture" refactor fails here rather than in the field.
    const raw = JSON.parse(JSON.stringify(captured)) as JSONContent;
    (raw.content as JSONContent[])[0].content![0].marks = anchorMark();
    expect(canMountInCardBody(raw, "excerpt").ok).toBe(false);

    // Survives the sidecar's JSON save → reload unchanged.
    const reloaded = JSON.parse(JSON.stringify(captured));
    expect(reloaded).toEqual(captured);
    expect(canMountInCardBody(reloaded, "excerpt").ok).toBe(true);
  });

  it("orphans the anchored card exactly as a plain Delete of the same range would", async () => {
    // A DECISION, not an accident: archiving text that carries another card's
    // Mode-B anchor puts that card on the normal orphan path (its kind's
    // `lifecycle.delete`, which for an anchored card is the orphan-strip /
    // re-pin route) — the same path Delete takes over the same range. Asserted
    // as an EQUALITY between the two actions so neither can drift alone.
    const archived = mountDoc(anchoredSectionDoc());
    const a = makeHarness(archived);
    await a.dispatch("archive", HEADING_REF);

    const deleted = mountDoc(anchoredSectionDoc());
    const d = makeHarness(deleted);
    await d.dispatch("delete", HEADING_REF);

    expect(a.lifecycleCalls).toContain(`revision:rev-1`);
    expect(a.lifecycleCalls).toEqual(d.lifecycleCalls);
    // Both remove the same text; only Archive keeps a copy.
    expect(archived.state.doc.textContent).toBe(deleted.state.doc.textContent);
  });

  it("a REAL refusal still refuses — and now NAMES what it could not hold", async () => {
    // The invariant is untouched: when the destination genuinely cannot hold
    // the payload, nothing is deleted and nothing is minted. What changed is
    // the message — "part of it" gave the user no noun to act on.
    mountCheckOverride.value = { ok: false, reason: "Unknown node type: futureBlock" };
    const editor = mountDoc(anchoredSectionDoc());
    const before = editor.state.doc.textContent;
    const h = makeHarness(editor);

    await h.dispatch("archive", HEADING_REF);

    expect(editor.state.doc.textContent).toBe(before);
    expect(h.archiveCalls).toHaveLength(0);
    expect(h.notify).toHaveBeenCalledTimes(1);
    const msg = (h.notify.mock.calls[0][0] as { message: string }).message;
    expect(msg).toContain("futureBlock");
    expect(msg).toContain("nothing was removed");
  });
});
