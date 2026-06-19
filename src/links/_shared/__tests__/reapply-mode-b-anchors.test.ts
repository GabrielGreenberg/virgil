// @vitest-environment jsdom
//
// RC-B pins — the Mode-B `linkedAnchor` re-apply that retired the
// `EditorLayout.applyLinkedAnchors` effect, moved into the EditorPane load
// reconcile pass. Drives `reapplyModeBAnchors` against a REAL `new Editor`
// (so paragraphs carry `uuid` attrs and marks behave exactly as in prod) with
// a faithful `applyLinkedAnchors` handle that mirrors `Editor.tsx`'s impl, and
// the REAL panel hooks + `useReconcileModeAAnchors` for the RC-A interaction.
//
// Teeth (each has a temp-revert → RED proof in the chip report):
//   - make-or-break #iii: a Mode-B HIGHLIGHT the user did NOT re-anchor still
//     gets its mark re-applied on load.
//   - overlap last-wins: a highlight inside a broader revision selection wins
//     (highlights applied LAST) and `LinkedAnchorGuard` fires no spurious
//     orphan-strip.
//   - re-anchored hybrid does NOT revert: after RC-B + RC-A the card has NO
//     stray mark at the OLD paragraph and is a clean Mode-A on P_new.
//   - healthy un-re-anchored Mode-B note/todo/revision/cutter keeps its mark
//     across reload (no regression).
//   - keystroke sanctity: the pass is load-only — typing adds no mark work and
//     leaves the bus `emitCount` flat.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

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
  mod.readSidecar = (...a: unknown[]) => mockRead(...a);
  mod.readSidecarIfExists = (...a: unknown[]) => mockRead(...a);
  mod.writeSidecar = (...a: unknown[]) => mockWrite(...a);
  return mod;
});

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { useNotes } from "@/hooks/useNotes";
import { useTodos } from "@/hooks/useTodos";
import { useCutter } from "@/hooks/useCutter";
import { useRevisions } from "@/hooks/useRevisions";
import { getTextAnchor } from "@/links/links";
import type { LinkedAnchorKind } from "@/links/links";
import {
  reapplyModeBAnchors,
  buildModeBReapplyRecords,
  type ModeBReapplyRecord,
} from "../reapply-mode-b-anchors";
import { applyLinkedAnchorsImpl } from "../apply-linked-anchors";
import { linkedAnchorRenderAttrs } from "@/lib/tiptap/linked-anchor-attrs";
import { getBus } from "@/lib/tiptap/doc-structure/bus";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

type ParaSpec = {
  uuid: string;
  // Either plain text, or text broken into runs with optional linkedAnchor
  // marks (so a test can mount a doc that already carries a mark).
  text?: string;
  runs?: Array<{ text: string; anchor?: { anchorId: string; kind: string } }>;
};

function mountDoc(paras: ParaSpec[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: paras.map((p) => ({
        type: "paragraph",
        attrs: { uuid: p.uuid },
        content: p.runs
          ? p.runs.map((r) => ({
              type: "text",
              text: r.text,
              ...(r.anchor
                ? {
                    marks: [
                      {
                        type: "linkedAnchor",
                        attrs: {
                          anchorId: r.anchor.anchorId,
                          kind: r.anchor.kind,
                          linkId: r.anchor.anchorId,
                          linkKind: "anchor",
                        },
                      },
                    ],
                  }
                : {}),
            }))
          : [{ type: "text", text: p.text ?? "" }],
      })),
    },
  });
}

/** The REAL handle the moved pass calls — `applyLinkedAnchorsImpl`, the ONE
 *  implementation production (`Editor.tsx`) and these tests share (so the test
 *  can never pass against a stale hand-copied mirror). Reconcile-not-skip:
 *  re-stamps present marks whose attrs disagree with their record, re-anchors
 *  absent ones by snapshot text. */
function applyLinkedAnchorsHandle(editor: Editor) {
  return (records: ModeBReapplyRecord[]): void => {
    applyLinkedAnchorsImpl(editor, records);
  };
}

/** The `linkedAnchor` mark attrs at the given anchorId (or null). */
function markAttrsFor(
  editor: Editor,
  anchorId: string,
): Record<string, unknown> | null {
  let attrs: Record<string, unknown> | null = null;
  editor.state.doc.descendants((node) => {
    if (attrs) return false;
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId) {
        attrs = m.attrs as Record<string, unknown>;
        return false;
      }
    }
    return true;
  });
  return attrs;
}

/** How many distinct runs carry the linkedAnchor mark for the given anchorId. */
function markRunCountFor(editor: Editor, anchorId: string): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (
      node.isText &&
      node.marks.some(
        (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
      )
    ) {
      n += 1;
    }
    return true;
  });
  return n;
}

function countLinkedAnchors(editor: Editor): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === "linkedAnchor")) n += 1;
    return true;
  });
  return n;
}

/** The text spanned by the linkedAnchor mark with the given anchorId. */
function markedTextFor(editor: Editor, anchorId: string): string {
  let out = "";
  editor.state.doc.descendants((node) => {
    if (
      node.isText &&
      node.marks.some(
        (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
      )
    ) {
      out += node.text ?? "";
    }
    return true;
  });
  return out;
}

/** The kinds of every linkedAnchor mark in the doc (for ordering assertions). */
function linkedAnchorKinds(editor: Editor): string[] {
  const kinds: string[] = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name === "linkedAnchor") kinds.push(m.attrs.kind as string);
    }
    return true;
  });
  return kinds;
}

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

// ===========================================================================
// make-or-break #iii — un-re-anchored Mode-B HIGHLIGHT mark re-applied
// ===========================================================================

describe("RC-B — un-re-anchored Mode-B highlight gets its mark re-applied", () => {
  it("re-applies the highlight's linkedAnchor mark from its snapshot (mark lost on reload)", () => {
    const editor = mountDoc([
      { uuid: "para-A", text: "anchor me here please" },
    ]);
    // The persisted highlight: a single linkedRange link, mark NOT in the doc
    // (the reload parse dropped it). textObjectIds carries the live enclosing
    // paragraph — the realistic persisted shape (see RC-B study).
    const highlight = {
      id: "h1",
      kind: "highlight",
      links: [
        {
          id: "h1@anc",
          kind: "anchor",
          anchor: {
            type: "textObject",
            targetKind: "linkedRange",
            textObjectIds: ["para-A"],
            margin: { side: "right" },
            textRange: { anchorId: "anc-h1", textSnapshot: "me here" },
          },
          target: { type: "card", ref: { kind: "highlight", id: "h1" } },
          createdAt: "",
        },
      ],
    } as never;

    expect(countLinkedAnchors(editor)).toBe(0); // reload starts mark-free

    const applied = reapplyModeBAnchors(applyLinkedAnchorsHandle(editor), {
      notes: [],
      todoItems: [],
      comments: [],
      cutterCards: [],
      reports: [],
      highlights: [highlight],
    });

    expect(applied).toBe(1);
    // The highlight tint is back, over exactly the snapshot text.
    expect(countLinkedAnchors(editor)).toBe(1);
    expect(markedTextFor(editor, "anc-h1")).toBe("me here");
    expect(linkedAnchorKinds(editor)).toEqual(["highlight"]);
    editor.destroy();
  });
});

// ===========================================================================
// overlap last-wins — highlight inside a broader revision selection
// ===========================================================================

describe("RC-B — overlap last-wins (highlights applied LAST)", () => {
  it("a highlight inside a broader revision range wins the overlap; no spurious orphan-strip", async () => {
    const editor = mountDoc([
      { uuid: "para-A", text: "the quick brown fox jumps" },
    ]);

    // Revision spans the broad range "quick brown fox"; highlight spans the
    // inner "brown". With highlights applied LAST, the highlight mark replaces
    // the revision mark in the "brown" overlap, so the highlight's anchorId
    // SURVIVES — `LinkedAnchorGuard` then sees no removed highlight anchor and
    // fires no orphan event.
    const revision = {
      id: "r1",
      kind: "comment",
      links: [
        {
          id: "r1@anc",
          kind: "anchor",
          anchor: {
            type: "textObject",
            targetKind: "linkedRange",
            textObjectIds: ["para-A"],
            margin: { side: "right" },
            textRange: { anchorId: "anc-rev", textSnapshot: "quick brown fox" },
          },
          target: { type: "card", ref: { kind: "revision-comment", id: "r1" } },
          createdAt: "",
        },
      ],
    } as never;
    const highlight = {
      id: "h1",
      kind: "highlight",
      links: [
        {
          id: "h1@anc",
          kind: "anchor",
          anchor: {
            type: "textObject",
            targetKind: "linkedRange",
            textObjectIds: ["para-A"],
            margin: { side: "right" },
            textRange: { anchorId: "anc-hl", textSnapshot: "brown" },
          },
          target: { type: "card", ref: { kind: "highlight", id: "h1" } },
          createdAt: "",
        },
      ],
    } as never;

    // Capture any orphan events fired by the guard (the spurious strip signal).
    const orphaned: string[] = [];
    const onOrphan = (e: Event) => {
      orphaned.push((e as CustomEvent).detail?.anchorId);
    };
    window.addEventListener("virgil-anchor-orphaned", onOrphan);

    reapplyModeBAnchors(applyLinkedAnchorsHandle(editor), {
      notes: [],
      todoItems: [],
      comments: [revision],
      cutterCards: [],
      reports: [],
      highlights: [highlight],
    });

    // The highlight anchorId is present over "brown".
    expect(markedTextFor(editor, "anc-hl")).toBe("brown");
    // The guard's orphan event is deferred (setTimeout 0) — let it fire.
    await new Promise((r) => setTimeout(r, 5));
    // No spurious orphan strip of the highlight (the make-or-break of the
    // highlights-LAST ordering).
    expect(orphaned).not.toContain("anc-hl");

    window.removeEventListener("virgil-anchor-orphaned", onOrphan);
    editor.destroy();
  });

  it("CONTROL: revision applied LAST (wrong order) overwrites the highlight → orphan event", async () => {
    // Proves the ordering test above is load-bearing: flip the order so the
    // BROADER revision is applied after the highlight, and the highlight mark
    // is overwritten in the overlap → the guard fires an orphan strip for it.
    const editor = mountDoc([
      { uuid: "para-A", text: "the quick brown fox jumps" },
    ]);
    const apply = applyLinkedAnchorsHandle(editor);

    // Highlight FIRST...
    apply([{ anchorId: "anc-hl", kind: "highlight" as LinkedAnchorKind, text: "brown" }]);
    expect(markedTextFor(editor, "anc-hl")).toBe("brown");

    // ...then the broader revision LAST (the WRONG order) overwrites it.
    const orphaned: string[] = [];
    const onOrphan = (e: Event) => orphaned.push((e as CustomEvent).detail?.anchorId);
    window.addEventListener("virgil-anchor-orphaned", onOrphan);
    apply([{ anchorId: "anc-rev", kind: "revision" as LinkedAnchorKind, text: "quick brown fox" }]);

    await new Promise((r) => setTimeout(r, 5));
    // The highlight's anchorId vanished from the doc → guard fires its strip.
    expect(markedTextFor(editor, "anc-hl")).toBe("");
    expect(orphaned).toContain("anc-hl");

    window.removeEventListener("virgil-anchor-orphaned", onOrphan);
    editor.destroy();
  });
});

// ===========================================================================
// re-anchored hybrid does NOT revert (exclusion) + RC-A heals it
// ===========================================================================

describe("RC-B — re-anchored hybrid is EXCLUDED from re-apply", () => {
  it("no stray mark at P_old; the card is a clean Mode-A on P_new after RC-A", async () => {
    beginDocPipeline("rcb-hybrid");
    // A re-anchored Mode-B todo's inert hybrid: a dead-mark linkedRange link
    // (its old text "old span" still lives at P_old) + a clean Mode-A link on
    // P_new. RC-B must NOT re-stamp the dead anchorId at P_old; RC-A then
    // strips the dead link → single clean Mode-A link.
    mockRead.mockResolvedValue({
      items: [
        {
          id: "t1",
          text: "a todo",
          done: false,
          aiRequest: false,
          createdAt: "",
          links: [
            {
              id: "t1@dead",
              kind: "anchor",
              anchor: {
                type: "textObject",
                targetKind: "linkedRange",
                textObjectIds: [],
                margin: { side: "right" },
                textRange: { anchorId: "anc-dead", textSnapshot: "old span" },
              },
              target: { type: "card", ref: { kind: "todo", id: "t1" } },
              createdAt: "",
            },
            {
              id: "t1@pnew",
              kind: "anchor",
              anchor: {
                type: "textObject",
                targetKind: "paragraph",
                textObjectIds: ["pnew0"],
                margin: { side: "right" },
                paragraphSnapshot: "The new home paragraph.",
              },
              target: { type: "card", ref: { kind: "todo", id: "t1" } },
              createdAt: "",
            },
          ],
        },
      ],
    });

    const editor = mountDoc([
      { uuid: "pold0", text: "old span lives here still" },
      { uuid: "pnew0", text: "The new home paragraph." },
    ]);

    const { result } = renderHook(() => useTodos("rcb-hybrid"));
    await waitFor(() => expect(result.current.items.length).toBe(1));

    // RC-B re-apply pass: the hybrid is EXCLUDED → no mark stamped at P_old.
    const applied = reapplyModeBAnchors(applyLinkedAnchorsHandle(editor), {
      notes: [],
      todoItems: result.current.items,
      comments: [],
      cutterCards: [],
      reports: [],
      highlights: [],
    });
    expect(applied).toBe(0); // excluded
    expect(countLinkedAnchors(editor)).toBe(0); // no stray mark at P_old

    // RC-A reconcile then heals the hybrid → single clean Mode-A on P_new.
    act(() => result.current.reconcileAnchors(editor));
    await waitFor(() => {
      const todo = result.current.items[0];
      expect(todo.links).toHaveLength(1);
      const link = todo.links?.[0];
      if (link?.anchor.type !== "textObject") throw new Error("textObject");
      expect(link.anchor.targetKind).toBe("paragraph");
      expect(link.anchor.textObjectIds).toEqual(["pnew0"]);
      expect(getTextAnchor(todo)).toBeNull();
    });
    expect(countLinkedAnchors(editor)).toBe(0); // still no stray mark
    editor.destroy();
  });
});

// ===========================================================================
// healthy un-re-anchored Mode-B survives reload + RC-A keeps it Mode-B
// (the FULL ordered interaction: re-apply BEFORE reconcile)
// ===========================================================================

describe("RC-B — healthy Mode-B survives the full ordered load (re-apply then reconcile)", () => {
  it("a healthy Mode-B todo keeps its textRange after re-apply + RC-A reconcile", async () => {
    beginDocPipeline("rcb-healthy");
    mockRead.mockResolvedValue({
      items: [
        {
          id: "t1",
          text: "a todo",
          done: false,
          aiRequest: false,
          createdAt: "",
          links: [
            {
              id: "t1@anc",
              kind: "anchor",
              anchor: {
                type: "textObject",
                targetKind: "linkedRange",
                textObjectIds: ["para-A"], // live enclosing paragraph
                margin: { side: "right" },
                textRange: { anchorId: "anc-live", textSnapshot: "me here" },
              },
              target: { type: "card", ref: { kind: "todo", id: "t1" } },
              createdAt: "",
            },
          ],
        },
      ],
    });

    const editor = mountDoc([{ uuid: "para-A", text: "anchor me here please" }]);
    const { result } = renderHook(() => useTodos("rcb-healthy"));
    await waitFor(() => expect(result.current.items.length).toBe(1));

    // ORDER: re-apply FIRST (mark goes live)...
    reapplyModeBAnchors(applyLinkedAnchorsHandle(editor), {
      notes: [],
      todoItems: result.current.items,
      comments: [],
      cutterCards: [],
      reports: [],
      highlights: [],
    });
    expect(markedTextFor(editor, "anc-live")).toBe("me here");

    // ...THEN RC-A reconcile. The live mark makes the resolver hit rung 2
    // (mode:'B'), so the card KEEPS its textRange (not converted to Mode-A).
    act(() => result.current.reconcileAnchors(editor));
    await new Promise((r) => setTimeout(r, 50));
    expect(getTextAnchor(result.current.items[0])).not.toBeNull();
    const link = result.current.items[0].links?.[0];
    if (link?.anchor.type !== "textObject") throw new Error("textObject");
    expect(link.anchor.targetKind).toBe("linkedRange");
    editor.destroy();
  });
});

// ===========================================================================
// All five kinds + ordering — note/todo/revision/cutter/highlight
// ===========================================================================

describe("RC-B — re-apply covers all five kinds with highlights LAST", () => {
  function modeBCard(
    id: string,
    cardKind: string,
    anchorId: string,
    snapshot: string,
  ) {
    return {
      id,
      kind: cardKind,
      links: [
        {
          id: `${id}@anc`,
          kind: "anchor",
          anchor: {
            type: "textObject",
            targetKind: "linkedRange",
            textObjectIds: [],
            margin: { side: "right" },
            textRange: { anchorId, textSnapshot: snapshot },
          },
          target: { type: "card", ref: { kind: cardKind, id } },
          createdAt: "",
        },
      ],
    } as never;
  }

  it("builds records in note → todo → revision → cutter → report → highlight order", () => {
    const records = buildModeBReapplyRecords({
      notes: [modeBCard("n1", "note", "a-note", "note span")],
      todoItems: [modeBCard("t1", "todo", "a-todo", "todo span")],
      comments: [modeBCard("r1", "comment", "a-rev", "rev span")],
      cutterCards: [
        modeBCard("c1", "comment", "a-cut", "cut span"),
        modeBCard("c2", "suggestion", "a-sug", "sug span"),
      ],
      reports: [
        modeBCard("rp1", "report", "a-rep", "rep span"),
        modeBCard("rq1", "report-request", "a-req", "req span"),
      ],
      highlights: [modeBCard("h1", "highlight", "a-hl", "hl span")],
    });
    expect(records.map((r) => r.kind)).toEqual([
      "note",
      "todo",
      "revision",
      "cutter-comment",
      "cutter-suggestion",
      "report", // reports collected AFTER cutters...
      "report-request",
      "highlight", // ...and BEFORE highlights (highlights stay LAST)
    ]);
  });

  it("stamps all six kinds' marks into a real editor", () => {
    const editor = mountDoc([
      {
        uuid: "para-A",
        text: "note span todo span rev span cut span rep span hl span done",
      },
    ]);
    reapplyModeBAnchors(applyLinkedAnchorsHandle(editor), {
      notes: [modeBCard("n1", "note", "a-note", "note span")],
      todoItems: [modeBCard("t1", "todo", "a-todo", "todo span")],
      comments: [modeBCard("r1", "comment", "a-rev", "rev span")],
      cutterCards: [modeBCard("c1", "comment", "a-cut", "cut span")],
      reports: [modeBCard("rp1", "report", "a-rep", "rep span")],
      highlights: [modeBCard("h1", "highlight", "a-hl", "hl span")],
    });
    expect(markedTextFor(editor, "a-note")).toBe("note span");
    expect(markedTextFor(editor, "a-todo")).toBe("todo span");
    expect(markedTextFor(editor, "a-rev")).toBe("rev span");
    expect(markedTextFor(editor, "a-cut")).toBe("cut span");
    expect(markedTextFor(editor, "a-rep")).toBe("rep span");
    expect(markedTextFor(editor, "a-hl")).toBe("hl span");
    editor.destroy();
  });
});

// ===========================================================================
// keystroke sanctity — the pass is LOAD-ONLY
// ===========================================================================

describe("RC-B — keystroke sanctity (load-only)", () => {
  it("typing after the pass adds no mark work and leaves emitCount flat", () => {
    const editor = mountDoc([{ uuid: "para-A", text: "anchor me here please" }]);
    const highlight = {
      id: "h1",
      kind: "highlight",
      links: [
        {
          id: "h1@anc",
          kind: "anchor",
          anchor: {
            type: "textObject",
            targetKind: "linkedRange",
            textObjectIds: ["para-A"],
            margin: { side: "right" },
            textRange: { anchorId: "anc-h1", textSnapshot: "me here" },
          },
          target: { type: "card", ref: { kind: "highlight", id: "h1" } },
          createdAt: "",
        },
      ],
    } as never;

    // Run the load pass once.
    reapplyModeBAnchors(applyLinkedAnchorsHandle(editor), {
      notes: [],
      todoItems: [],
      comments: [],
      cutterCards: [],
      reports: [],
      highlights: [highlight],
    });
    const marksAfterLoad = countLinkedAnchors(editor);
    const bus = getBus(editor);
    const emitBefore = bus?.emitCount ?? 0;

    // Type 10 plain characters at the end of the paragraph. The pass is a
    // plain function, not a subscriber, so it never re-runs on a keystroke.
    const end = editor.state.doc.content.size - 1;
    editor.commands.setTextSelection(end);
    for (let i = 0; i < 10; i++) {
      editor.commands.insertContent("x");
    }

    // No new linkedAnchor marks (the pass didn't re-fire) and the structural
    // bus emitted nothing (plain in-paragraph typing is structurally null).
    expect(countLinkedAnchors(editor)).toBe(marksAfterLoad);
    expect(bus?.emitCount ?? 0).toBe(emitBefore);
    editor.destroy();
  });
});

// ===========================================================================
// BUG1 — reconcile-not-skip (the core Chip-3 behavior)
//
// On reload the parser RESURRECTS every `\vlid` pair as a hardcoded
// `kind:"note"` mark. The old handle SKIPPED any present anchorId, so a
// revision/cutter/todo/report/highlight span reloaded permanently mislabeled
// as a note. `applyLinkedAnchorsImpl` now RECONCILES: a present mark whose
// attrs disagree with its sidecar record is re-stamped in place.
// ===========================================================================

describe("RC-B — BUG1 reconcile-not-skip (present marks re-stamped authoritatively)", () => {
  /** A Mode-B card with one linkedRange link. Optional `highlightColor` exercises
   *  the per-card tint override; `cardId` defaults to `id`. */
  function modeBCard(
    id: string,
    cardKind: string,
    anchorId: string,
    snapshot: string,
    extra?: { highlightColor?: string | null },
  ) {
    return {
      id,
      kind: cardKind,
      ...(extra?.highlightColor !== undefined
        ? { highlightColor: extra.highlightColor }
        : {}),
      links: [
        {
          id: `${id}@anc`,
          kind: "anchor",
          anchor: {
            type: "textObject",
            targetKind: "linkedRange",
            textObjectIds: ["para-A"],
            margin: { side: "right" },
            textRange: { anchorId, textSnapshot: snapshot },
          },
          target: { type: "card", ref: { kind: cardKind, id } },
          createdAt: "",
        },
      ],
    } as never;
  }

  it("a present note-kind mark over a REVISION anchorId is re-stamped to kind:revision", () => {
    // The parse resurrected the revision span as a note mark carrying the
    // original anchorId — the exact BUG1 corruption.
    const editor = mountDoc([
      {
        uuid: "para-A",
        runs: [
          { text: "before " },
          { text: "the span", anchor: { anchorId: "anc-rev", kind: "note" } },
          { text: " after" },
        ],
      },
    ]);
    // Precondition: the doc mark reads as a note (the corruption).
    expect((markAttrsFor(editor, "anc-rev")?.kind as string)).toBe("note");

    reapplyModeBAnchors(applyLinkedAnchorsHandle(editor), {
      notes: [],
      todoItems: [],
      comments: [modeBCard("r1", "comment", "anc-rev", "the span")],
      cutterCards: [],
      reports: [],
      highlights: [],
    });

    // Post-fix: the mark is authoritatively a revision, range + text unchanged,
    // and there is exactly ONE run (re-stamped in place, no duplicate mark).
    const attrs = markAttrsFor(editor, "anc-rev");
    expect(attrs?.kind).toBe("revision");
    // linkCard PRESERVED empty (re-stamp kind + tint only — see the
    // apply-linked-anchors linkCard-policy note). A derived `comment:<id>` would
    // parse to the non-spine kind "comment" and break delete-range for revisions.
    expect(attrs?.linkCard ?? "").toBe("");
    expect(markedTextFor(editor, "anc-rev")).toBe("the span");
    expect(markRunCountFor(editor, "anc-rev")).toBe(1);
    // The render layer paints the revision (purple) token via the KIND fallback,
    // not the note token — the spine `revision-comment:` prefix the CSS purple
    // rule matches (unified with updateLinkedAnchorCard; `comment:` is a legacy alias).
    expect(linkedAnchorRenderAttrs(attrs ?? {})["data-link-card"]).toBe(
      "revision-comment:",
    );
    editor.destroy();
  });

  it("a present highlight mark missing tintColor gets #fbbf24 restored", () => {
    // The reload mark for a highlight carries no tintColor (serializer dropped
    // it); the kind happens to be "highlight" already, so kind agrees — but the
    // tintColor disagrees, so the reconcile must still re-stamp.
    const editor = mountDoc([
      {
        uuid: "para-A",
        runs: [
          { text: "shine " },
          { text: "on me", anchor: { anchorId: "anc-hl", kind: "highlight" } },
          { text: " now" },
        ],
      },
    ]);
    expect(markAttrsFor(editor, "anc-hl")?.tintColor ?? null).toBe(null);

    reapplyModeBAnchors(applyLinkedAnchorsHandle(editor), {
      notes: [],
      todoItems: [],
      comments: [],
      cutterCards: [],
      reports: [],
      highlights: [modeBCard("h1", "highlight", "anc-hl", "on me")],
    });

    const attrs = markAttrsFor(editor, "anc-hl");
    expect(attrs?.kind).toBe("highlight");
    expect(attrs?.tintColor).toBe("#fbbf24");
    expect(markedTextFor(editor, "anc-hl")).toBe("on me");
    expect(markRunCountFor(editor, "anc-hl")).toBe(1);
    editor.destroy();
  });

  it("an in-agreement present mark is a no-op (idempotent; bus emitCount flat)", () => {
    // The reload mark already agrees with the sidecar (kind:revision,
    // tintColor:null) — the reconcile must not touch it. (linkCard is preserved,
    // not compared, so it never forces a re-stamp.)
    const editor = mountDoc([
      {
        uuid: "para-A",
        runs: [
          { text: "left " },
          { text: "middle", anchor: { anchorId: "anc-ok", kind: "revision" } },
          { text: " right" },
        ],
      },
    ]);
    // The mounted mark already matches the record (kind:revision, tint:null), so
    // this first pass is itself a no-op — confirm it left the mark agreeing.
    applyLinkedAnchorsImpl(editor, [
      { anchorId: "anc-ok", kind: "revision", text: "middle", cardId: "r1" },
    ]);
    const attrsBefore = markAttrsFor(editor, "anc-ok");
    expect(attrsBefore?.kind).toBe("revision");
    expect(attrsBefore?.linkCard ?? "").toBe("");

    const bus = getBus(editor);
    const emitBefore = bus?.emitCount ?? 0;
    const versionBefore = editor.state.doc.nodeSize; // proxy: doc unchanged

    // Second pass with the agreeing record — must be a no-op.
    reapplyModeBAnchors(applyLinkedAnchorsHandle(editor), {
      notes: [],
      todoItems: [],
      comments: [modeBCard("r1", "comment", "anc-ok", "middle")],
      cutterCards: [],
      reports: [],
      highlights: [],
    });

    expect(markRunCountFor(editor, "anc-ok")).toBe(1);
    expect(editor.state.doc.nodeSize).toBe(versionBefore);
    expect(bus?.emitCount ?? 0).toBe(emitBefore);
    editor.destroy();
  });

  it("RC-B builds + restamps a report-request range anchor (ordered before highlights)", () => {
    // A report-request reloads as a note mark; reconcile re-stamps it to
    // kind:report-request. Reports are collected AFTER cutters, BEFORE
    // highlights — proven by the ordered record list here.
    const editor = mountDoc([
      {
        uuid: "para-A",
        runs: [
          { text: "ask " },
          { text: "for a report", anchor: { anchorId: "anc-req", kind: "note" } },
          { text: " here" },
        ],
      },
    ]);

    const records = buildModeBReapplyRecords({
      notes: [],
      todoItems: [],
      comments: [],
      cutterCards: [],
      reports: [modeBCard("rq1", "report-request", "anc-req", "for a report")],
      highlights: [modeBCard("h1", "highlight", "anc-hl", "unused")],
    });
    // report-request record exists and is ordered before the highlight.
    const reqIdx = records.findIndex((r) => r.kind === "report-request");
    const hlIdx = records.findIndex((r) => r.kind === "highlight");
    expect(reqIdx).toBeGreaterThanOrEqual(0);
    expect(hlIdx).toBeGreaterThan(reqIdx);

    applyLinkedAnchorsHandle(editor)(records);
    const attrs = markAttrsFor(editor, "anc-req");
    expect(attrs?.kind).toBe("report-request");
    // linkCard preserved empty; render derives the report-request token from kind.
    expect(attrs?.linkCard ?? "").toBe("");
    expect(linkedAnchorRenderAttrs(attrs ?? {})["data-link-card"]).toBe(
      "report-request:",
    );
    expect(markedTextFor(editor, "anc-req")).toBe("for a report");
    editor.destroy();
  });
});
