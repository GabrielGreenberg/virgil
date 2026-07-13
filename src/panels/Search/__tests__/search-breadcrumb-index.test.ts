// @vitest-environment jsdom
//
// Task 119 — breadcrumbs derive from ONE indexed walk, not a doc walk per hit.
//
// The old `buildBreadcrumb` ran a full `doc.descendants` pass PER anchored
// hit — O(hits × doc), the quadratic core of the per-character search freeze
// (hit count scales with doc length for short queries). The replacement
// builds a `BreadcrumbIndex` in one walk (folded heading-ancestry snapshots,
// parTitle spans with a prefix-max bound, the doc title) and resolves each
// hit by binary search (`breadcrumbAt`).
//
// The load-bearing pin is EXHAUSTIVE OUTPUT EQUIVALENCE: for every position
// in a fixture exercising the tricky cases (skip-level headings, same-level
// siblings, nested parTitle containers, empty paragraphs, a titleField), the
// indexed resolver must return exactly what the old per-hit walk returned.
// The reference implementation below is the old code, verbatim.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Storage stub (the editor extension stack pulls @/lib/storage transitively).
vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
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

import { Editor, type Content, type JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  buildBreadcrumbIndex,
  breadcrumbAt,
  foldHeadingAncestry,
} from "@/panels/Search/SearchPanel";

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

/** The retired per-hit walk, verbatim (minus the extracted fold, which is
 *  still the shared `foldHeadingAncestry`) — the equivalence oracle. */
type Segment = ReturnType<typeof foldHeadingAncestry>[number];

function referenceGetDocTitle(editor: Editor): string {
  let title = "";
  editor.state.doc.forEach((node) => {
    if (node.type.name === "titleField" && node.attrs?.field === "title") {
      const text = node.textContent?.trim() || "";
      if (text) title = text;
    }
  });
  return title;
}

function referenceBuildBreadcrumb(editor: Editor, pos: number): Segment[] {
  const headings: { level: number; text: string }[] = [];
  let parTitle = "";

  editor.state.doc.descendants((node, nodePos) => {
    if (nodePos >= pos) return false;

    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      const text = node.textContent?.trim() || "Untitled";
      headings.push({ level, text });
      return true;
    }

    const titleAttr = node.attrs?.parTitle as string | null | undefined;
    if (
      titleAttr &&
      (node.type.name === "paragraph" ||
        node.type.name === "bulletList" ||
        node.type.name === "orderedList") &&
      nodePos + node.nodeSize > pos
    ) {
      parTitle = titleAttr;
    }

    return true;
  });

  const sections = foldHeadingAncestry(headings);
  let crumbs: Segment[];
  if (sections.length > 0) {
    crumbs = sections;
  } else {
    const docTitle = referenceGetDocTitle(editor);
    crumbs = docTitle
      ? [{ text: docTitle, kind: "title" }]
      : [{ text: "Document start", kind: "documentStart" }];
  }

  if (parTitle) {
    crumbs.push({ text: parTitle, kind: "parTitle" });
  }

  return crumbs;
}

function para(uuid: string, text: string, parTitle?: string): JSONContent {
  return {
    type: "paragraph",
    attrs: { uuid, ...(parTitle ? { parTitle } : {}) },
    content: text ? [{ type: "text", text }] : undefined,
  };
}

function heading(uuid: string, level: number, text: string): JSONContent {
  return {
    type: "heading",
    attrs: { uuid, level },
    content: [{ type: "text", text }],
  };
}

// Skip-level headings (H1 → H4, H4 sibling, then H2 popping both), parTitles
// on a plain paragraph AND nested inside a parTitle-bearing bulletList (the
// innermost-wins case), an empty paragraph, and content before any heading.
function makeContent(withTitleField: boolean): Content {
  const content: JSONContent[] = [];
  if (withTitleField) {
    content.push({
      type: "titleField",
      attrs: { field: "title" },
      content: [{ type: "text", text: "My Paper Title" }],
    });
  }
  content.push(
    para("p-pre", "Intro before any heading."),
    heading("h-1", 1, "H1"),
    para("p-1", "Under H1."),
    heading("h-4a", 4, "H4-a"),
    para("p-2", "Under H4-a with a titled paragraph.", "PT-plain"),
    heading("h-4b", 4, "H4-b"),
    para("p-3", "Under H4-b."),
    {
      type: "bulletList",
      attrs: { parTitle: "PT-list" },
      content: [
        {
          type: "listItem",
          content: [para("p-li-1", "Plain list item.")],
        },
        {
          type: "listItem",
          content: [para("p-li-2", "Titled inner item.", "PT-inner")],
        },
      ],
    },
    heading("h-2", 2, "H2 pops the H4s"),
    para("p-empty", ""),
    para("p-tail", "Tail paragraph."),
  );
  return { type: "doc", content } as Content;
}

function mount(withTitleField: boolean): {
  editor: Editor;
  cleanup: () => void;
} {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: makeContent(withTitleField),
  });
  return {
    editor,
    cleanup: () => {
      editor.destroy();
      element.remove();
    },
  };
}

describe("task 119 — breadcrumbAt over the one-walk index ≡ the old per-hit doc walk", () => {
  let editor: Editor;
  let teardown: () => void;

  beforeEach(() => {
    const m = mount(true);
    editor = m.editor;
    teardown = m.cleanup;
    return () => teardown();
  });

  it("matches the reference at EVERY document position (exhaustive sweep)", () => {
    const index = buildBreadcrumbIndex(editor);
    const size = editor.state.doc.content.size;
    for (let pos = 0; pos <= size; pos++) {
      expect(breadcrumbAt(index, pos), `pos ${pos}`).toEqual(
        referenceBuildBreadcrumb(editor, pos),
      );
    }
  });

  it("skip-level sibling replaces, not appends (the SR-F1-05 case, indexed)", () => {
    const index = buildBreadcrumbIndex(editor);
    // A hit inside "Under H4-b." — ancestry must be [H1, H4-b], never
    // [H1, H4-a, H4-b].
    let pos = -1;
    editor.state.doc.descendants((node, nodePos) => {
      if (node.attrs?.uuid === "p-3") pos = nodePos + 2;
      return true;
    });
    expect(pos).toBeGreaterThan(0);
    expect(breadcrumbAt(index, pos).map((s) => s.text)).toEqual(["H1", "H4-b"]);
  });

  it("innermost parTitle wins inside a titled list (nested containers)", () => {
    const index = buildBreadcrumbIndex(editor);
    let pos = -1;
    editor.state.doc.descendants((node, nodePos) => {
      if (node.attrs?.uuid === "p-li-2") pos = nodePos + 2;
      return true;
    });
    expect(pos).toBeGreaterThan(0);
    const crumbs = breadcrumbAt(index, pos);
    expect(crumbs[crumbs.length - 1]).toEqual({
      text: "PT-inner",
      kind: "parTitle",
    });
  });

  it("falls back to the doc title before any heading, and to Document start without one", () => {
    const withTitle = buildBreadcrumbIndex(editor);
    // A hit inside the pre-heading paragraph.
    let pos = -1;
    editor.state.doc.descendants((node, nodePos) => {
      if (node.attrs?.uuid === "p-pre") pos = nodePos + 2;
      return true;
    });
    expect(breadcrumbAt(withTitle, pos)).toEqual([
      { text: "My Paper Title", kind: "title" },
    ]);

    const bare = mount(false);
    try {
      let barePos = -1;
      bare.editor.state.doc.descendants((node, nodePos) => {
        if (node.attrs?.uuid === "p-pre") barePos = nodePos + 2;
        return true;
      });
      expect(breadcrumbAt(buildBreadcrumbIndex(bare.editor), barePos)).toEqual([
        { text: "Document start", kind: "documentStart" },
      ]);
    } finally {
      bare.cleanup();
    }
  });

  it("ancestry snapshots equal foldHeadingAncestry over each heading prefix", () => {
    // The incremental copy-on-write snapshots must be the SAME fold the
    // shared helper computes — pinned per prefix so the pop rule can't drift.
    const index = buildBreadcrumbIndex(editor);
    const flat: { level: number; text: string }[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "heading") {
        flat.push({
          level: node.attrs.level as number,
          text: node.textContent?.trim() || "Untitled",
        });
      }
      return true;
    });
    expect(index.headings).toHaveLength(flat.length);
    index.headings.forEach((h, i) => {
      expect(h.ancestry).toEqual(foldHeadingAncestry(flat.slice(0, i + 1)));
    });
  });
});
