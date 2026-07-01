// @vitest-environment jsdom
//
// CHIP 5 — the synchronous orphan reaper + its create-not-reaped safety.
//
// `reapOrphanLinkedAnchors(editor, aliveIds)` strips every in-doc `linkedAnchor`
// mark whose anchorId is NOT in the alive-set. Pins:
//   - an orphan mark (no owning card) is stripped SYNCHRONOUSLY (no setTimeout
//     await needed) — the BUG1/iii orphan-tint-without-card reap.
//   - a mark WHOSE id is in the alive-set survives (the agree case).
//   - REGRESSION GUARD: a freshly-created note (mark + card committed in ONE
//     gesture) is in the alive-set by the time the sweep runs, so the sync
//     sweep does NOT reap it. The mark and card never split across two React
//     commits (`addNote` is a synchronous `setState`), so this is safe.
//
// Storage stub guards the extension-barrel/@/lib/storage gotcha.
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  reapOrphanLinkedAnchors,
  useLinkedAnchorReconciler,
} from "../useLinkedAnchorReconciler";
import { createLinkedAnchor, updateLinkedAnchorCard } from "@/links/links";

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
  runs: Array<{ text: string; anchor?: { anchorId: string; kind: string } }>;
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
        content: p.runs.map((r) => ({
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
        })),
      })),
    },
  });
}

function hasMark(editor: Editor, anchorId: string): boolean {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (found) return false;
    if (
      node.isText &&
      node.marks.some(
        (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
      )
    ) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
});

describe("reapOrphanLinkedAnchors — synchronous orphan strip", () => {
  it("strips a mark with no owning card SYNCHRONOUSLY", () => {
    const editor = mountDoc([
      {
        uuid: "p1",
        runs: [
          { text: "before " },
          { text: "orphaned", anchor: { anchorId: "ax", kind: "note" } },
          { text: " after" },
        ],
      },
    ]);
    expect(hasMark(editor, "ax")).toBe(true);
    // Empty alive-set: the mark backs no live card.
    reapOrphanLinkedAnchors(editor, new Set<string>());
    // Stripped immediately — no setTimeout await.
    expect(hasMark(editor, "ax")).toBe(false);
    editor.destroy();
  });

  it("KEEPS a mark whose anchorId is in the alive-set", () => {
    const editor = mountDoc([
      {
        uuid: "p1",
        runs: [
          { text: "keep " },
          { text: "alive", anchor: { anchorId: "ay", kind: "revision" } },
        ],
      },
    ]);
    reapOrphanLinkedAnchors(editor, new Set<string>(["ay"]));
    expect(hasMark(editor, "ay")).toBe(true);
    editor.destroy();
  });

  it("accepts a ReadonlyArray alive-set as well as a Set", () => {
    const editor = mountDoc([
      {
        uuid: "p1",
        runs: [
          { text: "x " },
          { text: "live", anchor: { anchorId: "az", kind: "todo" } },
          { text: " y" },
          { text: "dead", anchor: { anchorId: "aw", kind: "note" } },
        ],
      },
    ]);
    reapOrphanLinkedAnchors(editor, ["az"]);
    expect(hasMark(editor, "az")).toBe(true);
    expect(hasMark(editor, "aw")).toBe(false);
    editor.destroy();
  });
});

describe("useLinkedAnchorReconciler — load-order `ready` gate (DATA-LOSS guard)", () => {
  // The catastrophic case: on doc-open the editor mounts with `linkedAnchor`
  // marks already parsed from the `.tex`, but the card sidecars are still
  // loading, so the alive-set is transiently EMPTY. A sweep fired then would
  // reap EVERY live annotation. The `ready` gate (= allCardSidecarsLoaded &&
  // docContentReady) must suppress the sweep until the alive-set is authoritative.
  function emptyCollections() {
    return {
      notes: [], highlights: [], cutterCards: [],
      comments: [], reportCards: [], todos: [],
    };
  }

  it("does NOT reap marks while NOT ready, even with an empty alive-set", () => {
    const editor = mountDoc([
      {
        uuid: "p1",
        runs: [
          { text: "a " },
          { text: "live-note", anchor: { anchorId: "n1", kind: "note" } },
          { text: " b " },
          { text: "live-rev", anchor: { anchorId: "r1", kind: "revision" } },
        ],
      },
    ]);
    // ready:false models "sidecars still loading" — alive-set empty.
    renderHook(() =>
      useLinkedAnchorReconciler({
        editor,
        ready: false,
        ...emptyCollections(),
      }),
    );
    // Both marks SURVIVE — the gate prevented the empty-set sweep.
    expect(hasMark(editor, "n1")).toBe(true);
    expect(hasMark(editor, "r1")).toBe(true);
    editor.destroy();
  });

  it("a sidecar LOAD ERROR maps to ready:false, so marks survive a (non-authoritative) empty alive-set", () => {
    // DATA-LOSS guard, load-error arm: when a card sidecar's initial read THREW
    // (corrupt/truncated JSON, transient FSA error), `usePersistentState` flips
    // `loaded:true` but leaves `loadError:true` with the collection at the EMPTY
    // default. At the EditorPane call site `anyCardSidecarLoadError` ORs across
    // the six hooks and forces `ready: allCardSidecarsLoaded && docContentReady
    // && !anyCardSidecarLoadError` to FALSE — the SAME gate this `ready:false`
    // render exercises. So even though `loaded` is true, the alive-set is NOT
    // authoritative (the errored kind contributed zero anchors) and the reaper
    // must hold. Two live marks with an empty alive-set: BOTH must survive.
    const editor = mountDoc([
      {
        uuid: "p1",
        runs: [
          { text: "a " },
          { text: "live-note", anchor: { anchorId: "le1", kind: "note" } },
          { text: " b " },
          { text: "live-todo", anchor: { anchorId: "le2", kind: "todo" } },
        ],
      },
    ]);
    // loadError → ready:false at the call site; empty collections model the
    // errored kind's non-authoritative empty default.
    renderHook(() =>
      useLinkedAnchorReconciler({
        editor,
        ready: false,
        ...emptyCollections(),
      }),
    );
    expect(hasMark(editor, "le1")).toBe(true);
    expect(hasMark(editor, "le2")).toBe(true);
    editor.destroy();
  });

  it("reaps a TRUE orphan once ready (sidecars loaded, alive-set authoritative)", () => {
    const editor = mountDoc([
      {
        uuid: "p1",
        runs: [
          { text: "keep ", },
          { text: "kept", anchor: { anchorId: "k1", kind: "note" } },
          { text: " drop ", },
          { text: "orphan", anchor: { anchorId: "o1", kind: "note" } },
        ],
      },
    ]);
    // ready:true with only k1 alive → o1 is a true orphan and is reaped; the
    // live card's mark survives.
    renderHook(() =>
      useLinkedAnchorReconciler({
        editor,
        ready: true,
        ...emptyCollections(),
        // a single live note whose Mode-B anchor is k1.
        notes: [
          {
            id: "card-k1",
            links: [
              {
                id: "k1",
                kind: "anchor",
                anchor: {
                  type: "textObject",
                  targetKind: "linkedRange",
                  textObjectIds: ["p1"],
                  margin: { side: "right" },
                  textRange: { anchorId: "k1", textSnapshot: "kept" },
                },
                target: { type: "card", ref: { kind: "note", id: "card-k1" } },
                createdAt: "",
              },
            ],
          },
        ],
      }),
    );
    expect(hasMark(editor, "k1")).toBe(true); // live card → survives
    expect(hasMark(editor, "o1")).toBe(false); // true orphan → reaped
    editor.destroy();
  });
});

describe("reapOrphanLinkedAnchors — create-not-reaped regression guard", () => {
  it("does NOT reap a mark that was just created (in the alive-set)", () => {
    // Simulate the create gesture: stamp the mark, then (in the SAME
    // synchronous handler) the card lands in its collection. By the time the
    // reaper runs, the new anchorId is already in the alive-set.
    const editor = mountDoc([
      { uuid: "p1", runs: [{ text: "select this passage" }] },
    ]);
    // Stamp a real linkedAnchor over a range (the create-time mark).
    editor.commands.setTextSelection({ from: 1, to: 7 }); // "select"
    const record = createLinkedAnchor(editor, "note");
    expect(record).not.toBeNull();
    const anchorId = record!.anchorId;
    updateLinkedAnchorCard(editor, anchorId, "note", "card-1");
    expect(hasMark(editor, anchorId)).toBe(true);

    // The card committed into the alive-set in the same gesture → present.
    const aliveAfterCreate = new Set<string>([anchorId]);
    reapOrphanLinkedAnchors(editor, aliveAfterCreate);

    // NOT reaped: the just-created mark survives.
    expect(hasMark(editor, anchorId)).toBe(true);
    editor.destroy();
  });
});

describe("reapOrphanLinkedAnchors — pending-ai-change marks are applicator-managed", () => {
  // The fresh-apply reap bug: a fresh auto-apply stamps the blue
  // `pending-ai-change` mark ONE React commit before the card flips to
  // `applied` / gets its `appliedChange.anchorId`, so the card-derived alive-set
  // transiently EXCLUDES it and the sweep reaped the just-applied blue mark (it
  // vanished on fresh apply while a reload re-stamp stuck — that asymmetry was
  // the bug). Pending marks are lifecycle-managed by the applicator (stamped on
  // apply, unset on Keep/Revert), so the reaper must never strip them by kind.
  it("KEEPS a pending-ai-change mark even when its anchorId is NOT in the alive-set", () => {
    const editor = mountDoc([
      {
        uuid: "p1",
        runs: [
          { text: "kept " },
          { text: "AI edit", anchor: { anchorId: "pac1", kind: "pending-ai-change" } },
          { text: " tail" },
        ],
      },
    ]);
    expect(hasMark(editor, "pac1")).toBe(true);
    // Empty alive-set (card not `applied` yet) — a normal mark WOULD be reaped.
    reapOrphanLinkedAnchors(editor, new Set<string>());
    expect(hasMark(editor, "pac1")).toBe(true); // survives — protected by kind
    editor.destroy();
  });

  it("still reaps a genuine orphan of another kind in the same pass", () => {
    const editor = mountDoc([
      {
        uuid: "p1",
        runs: [
          { text: "a " },
          { text: "pending", anchor: { anchorId: "pac2", kind: "pending-ai-change" } },
          { text: " b " },
          { text: "orphan-note", anchor: { anchorId: "on1", kind: "note" } },
        ],
      },
    ]);
    reapOrphanLinkedAnchors(editor, new Set<string>());
    expect(hasMark(editor, "pac2")).toBe(true); // protected by kind
    expect(hasMark(editor, "on1")).toBe(false); // orphan note still reaped
    editor.destroy();
  });
});
