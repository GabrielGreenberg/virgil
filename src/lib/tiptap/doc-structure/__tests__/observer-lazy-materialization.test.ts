// @vitest-environment jsdom
/**
 * Lazy position materialization (typing-latency fix 2a).
 *
 * The observer's per-keystroke invariant, extended: a structurally-null
 * transaction no longer pays the O(entities) `mapStructurePositions` remap
 * (full blocks-Map clone + mapping.map per entry, every character). Instead
 * the tx's StepMaps ACCUMULATE on plugin state (O(steps)) and the remap runs
 * lazily — at consumer-read time (`readDocStructure`, RAF/user-paced), at a
 * structural tx (applyDiff needs coherent positions), or at the
 * MAX_PENDING_MAPS cap.
 *
 * Pinned here:
 *   1. typing leaves `materializeCount` flat (no consumer read → no remap)
 *      while snapshot IDENTITY still bumps per keystroke (identity-keyed
 *      consumer caches must not serve stale positions);
 *   2. the correctness oracle — readDocStructure == fresh buildInitial;
 *   3. resolveTouchedBlock mid-burst == the node's actual position, without
 *      materializing the whole snapshot;
 *   4. a structural tx after a burst folds the accumulated maps + diff into
 *      correct positions;
 *   5. the cap bounds pendingMaps;
 *   6. emitCount stays flat across plain typing (keystroke sanctity);
 *   7. bus.structure (snapshot provider) serves materialized positions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
import type { StepMap } from "@tiptap/pm/transform";
import {
  DocStructureObserver,
  docStructureKey,
  readDocStructure,
  resolveTouchedBlock,
  getBus,
  buildInitial,
} from "@/lib/tiptap/doc-structure";
import {
  getMaterializeCount,
  __resetMaterializeCountForTest,
} from "@/lib/tiptap/doc-structure/observer-plugin";
import { createParagraphWithTitle } from "@/lib/editor-extensions";

function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        heading: false,
        paragraph: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        dropcursor: false,
      }),
      DocStructureObserver,
      createParagraphWithTitle(),
    ],
    content: {
      type: "doc",
      content: Array.from({ length: 6 }, (_, i) => ({
        type: "paragraph",
        attrs: { uuid: `p${i}` },
        content: [{ type: "text", text: `Paragraph number ${i} body text.` }],
      })),
    },
  });
  return { editor, el };
}

/** Positions from a snapshot, keyed by uuid — the comparison unit. */
function positionsOf(s: { blocks: ReadonlyMap<string, { pos: number }> }) {
  return Object.fromEntries([...s.blocks].map(([u, e]) => [u, e.pos]));
}

function pluginState(editor: Editor) {
  return docStructureKey.getState(editor.state) as unknown as {
    structure: { version: number };
    pendingMaps: readonly StepMap[];
  };
}

beforeEach(() => {
  __resetMaterializeCountForTest();
});

describe("observer lazy materialization (2a)", () => {
  it("typing accumulates StepMaps with ZERO materializations; identity bumps per keystroke", () => {
    const { editor } = mount();
    try {
      // Drain any mount-time reads.
      __resetMaterializeCountForTest();
      const before = pluginState(editor);
      const identities: unknown[] = [before.structure];
      for (let i = 0; i < 10; i++) {
        // Type into p1's text (pos 1 + a couple chars in).
        editor.view.dispatch(editor.state.tr.insertText("x", 5, 5));
        identities.push(pluginState(editor).structure);
      }
      expect(getMaterializeCount()).toBe(0);
      expect(pluginState(editor).pendingMaps.length).toBe(10);
      // Identity must bump each keystroke (identity-keyed caches).
      expect(new Set(identities).size).toBe(identities.length);
    } finally {
      editor.destroy();
    }
  });

  it("readDocStructure after a burst equals a fresh buildInitial (correctness oracle) and caches", () => {
    const { editor } = mount();
    try {
      for (let i = 0; i < 8; i++) {
        editor.view.dispatch(editor.state.tr.insertText("y", 5, 5));
      }
      __resetMaterializeCountForTest();
      const read = readDocStructure(editor.state);
      expect(getMaterializeCount()).toBe(1);
      const oracle = buildInitial(editor.state.doc);
      expect(positionsOf(read)).toEqual(positionsOf(oracle));
      // Second read: cached in place — no re-materialization.
      readDocStructure(editor.state);
      expect(getMaterializeCount()).toBe(1);
      expect(pluginState(editor).pendingMaps.length).toBe(0);
    } finally {
      editor.destroy();
    }
  });

  it("resolveTouchedBlock mid-burst returns the live position WITHOUT materializing", () => {
    const { editor } = mount();
    try {
      // Insert 7 chars near the doc start so later paragraphs all shift.
      for (let i = 0; i < 7; i++) {
        editor.view.dispatch(editor.state.tr.insertText("z", 3, 3));
      }
      __resetMaterializeCountForTest();
      const resolved = resolveTouchedBlock(editor.state, "p4");
      expect(getMaterializeCount()).toBe(0);
      const oracle = buildInitial(editor.state.doc);
      expect(resolved?.pos).toBe(oracle.blocks.get("p4")!.pos);
    } finally {
      editor.destroy();
    }
  });

  it("a structural tx after a burst folds accumulated maps + diff into correct positions", () => {
    const { editor } = mount();
    try {
      for (let i = 0; i < 5; i++) {
        editor.view.dispatch(editor.state.tr.insertText("w", 3, 3));
      }
      const para = editor.schema.nodes.paragraph.create(
        { uuid: "p-new" },
        editor.schema.text("Inserted paragraph."),
      );
      editor.view.dispatch(
        editor.state.tr.insert(editor.state.doc.content.size, para),
      );
      // Structural apply materialized: pendingMaps drained, positions exact.
      expect(pluginState(editor).pendingMaps.length).toBe(0);
      const oracle = buildInitial(editor.state.doc);
      expect(positionsOf(readDocStructure(editor.state))).toEqual(
        positionsOf(oracle),
      );
    } finally {
      editor.destroy();
    }
  });

  it("caps pendingMaps at MAX_PENDING_MAPS and stays correct past the cap", () => {
    const { editor } = mount();
    try {
      for (let i = 0; i < 40; i++) {
        editor.view.dispatch(editor.state.tr.insertText("c", 3, 3));
      }
      expect(pluginState(editor).pendingMaps.length).toBeLessThanOrEqual(32);
      const oracle = buildInitial(editor.state.doc);
      expect(positionsOf(readDocStructure(editor.state))).toEqual(
        positionsOf(oracle),
      );
    } finally {
      editor.destroy();
    }
  });

  it("emitCount stays flat across plain typing; bus.structure serves materialized positions", () => {
    const { editor } = mount();
    try {
      const bus = getBus(editor)!;
      const emitBefore = bus.emitCount;
      for (let i = 0; i < 10; i++) {
        editor.view.dispatch(editor.state.tr.insertText("k", 5, 5));
      }
      expect(bus.emitCount).toBe(emitBefore);
      // The snapshot provider materializes at read time.
      const oracle = buildInitial(editor.state.doc);
      expect(positionsOf(bus.structure)).toEqual(positionsOf(oracle));
    } finally {
      editor.destroy();
    }
  });
});
