// @vitest-environment jsdom
//
// T3 / C10 — the atom-aware inline-content reader.
//
// The codebase had no single, atom-aware notion of "the inline content of a
// structured node": a `\cite`/math atom either lives in `attrs` (not
// `textContent`) or — for the footnote — inside `attrs.content`, a JSONContent
// literal `doc.descendants()` won't enter. These pins drive the single reader
// (`inlineAtoms` / `flattenInlineText` / `findInlineAtomPosDeep`) against BOTH
// raw JSONContent literals and a real Editor mounting StarterKit + Citation +
// Footnote + InlineMath, the same way footnote-nested-citation-delete.test.ts
// mounts.
//
// The storage stub guards against the barrel/storage gotcha (importing the
// extension chain can pull `@/lib/storage`).
import { describe, it, expect, vi } from "vitest";

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
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Citation } from "@/lib/tiptap/citation";
import { Footnote } from "@/lib/tiptap/footnote";
import { InlineMath } from "@/lib/tiptap/math";
import {
  atomTextOf,
  flattenInlineText,
  findInlineAtomPosDeep,
  inlineAtoms,
  walkJsonContentForCitations,
} from "@/lib/inline-content";

// ---------------------------------------------------------------------------
// Raw-JSONContent fixtures (no Editor needed — the reader accepts literals)
// ---------------------------------------------------------------------------

/** A heading body with leading text + inline math + a citation + trailing text:
 *  `Step 3: $n+1$ see \citet{foo}`. */
const HEADING_BODY: JSONContent = {
  type: "heading",
  attrs: { level: 2 },
  content: [
    { type: "text", text: "Step 3: " },
    { type: "inlineMath", attrs: { latex: "n+1" } },
    { type: "text", text: " see " },
    {
      type: "citation",
      attrs: { citationId: "c-top", command: "\\citet{foo}", displayText: "Foo 2020" },
    },
  ],
};

/** A footnote body holding a nested citation:
 *  `see also \cite{jones2019} on this point`. */
const FOOTNOTE_BODY: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "see also " },
        {
          type: "citation",
          attrs: {
            citationId: "c-nested",
            command: "\\cite{jones2019}",
            displayText: "Jones 2019",
          },
        },
        { type: "text", text: " on this point" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Editor harness
// ---------------------------------------------------------------------------

function mount(content: JSONContent): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: [StarterKit, Citation, Footnote, InlineMath],
    content,
  });
}

/** A doc with a TOP-LEVEL citation in a paragraph + a footnote whose body holds
 *  a DIFFERENT, nested citation. */
function docWithTopAndNestedCite(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Top cite " },
          {
            type: "citation",
            attrs: {
              citationId: "c-top",
              command: "\\cite{smith2020}",
              displayText: "Smith 2020",
            },
          },
          { type: "text", text: " then a footnote" },
          {
            type: "footnote",
            attrs: { footnoteId: "fn-host", number: 1, content: FOOTNOTE_BODY },
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// atomTextOf — round-trip parity with the legacy getAtomText table
// ---------------------------------------------------------------------------

describe("atomTextOf — attr-borne atom text registry", () => {
  it("returns the registered attr text for each attr-borne kind", () => {
    expect(atomTextOf("inlineMath", { latex: "n+1" })).toBe("n+1");
    expect(atomTextOf("displayMath", { latex: "\\sum x" })).toBe("\\sum x");
    expect(atomTextOf("texBlock", { code: "\\foo" })).toBe("\\foo");
    expect(atomTextOf("figureBlock", { src: "fig.png" })).toBe("fig.png");
    expect(atomTextOf("graphicsBlock", { src: "g.pdf" })).toBe("g.pdf");
  });

  it("returns null for non-attr-atom kinds (text / citation / labelRef / latexComment)", () => {
    // citation/labelRef are intentionally NOT in the core table — they are
    // display atoms handled by the flatten path, so getAtomText keeps its
    // prior behavior of `""` for a selected citation. latexComment is no longer
    // an attr-borne atom either (task 017: atom→editable block with native
    // inline content), so it too returns null — `flattenInlineText` walks its
    // text children directly.
    expect(atomTextOf("text", { text: "hi" })).toBeNull();
    expect(atomTextOf("citation", { command: "\\cite{x}" })).toBeNull();
    expect(atomTextOf("paragraph", {})).toBeNull();
    expect(atomTextOf("latexComment", {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// flattenInlineText — atom-aware text projection (OUT-F1-01 / OUT-F4-01)
// ---------------------------------------------------------------------------

describe("flattenInlineText", () => {
  it("preserves inline-math and citation text in a heading (OUT-F1-01)", () => {
    // The naive `if (type==="text")` walk yields "Step 3:  see " — dropping
    // the math and cite. The atom-aware reader keeps them.
    const flat = flattenInlineText(HEADING_BODY);
    expect(flat).toContain("Step 3: ");
    expect(flat).toContain("n+1"); // inline math survives
    expect(flat).toContain("Foo 2020"); // citation display survives
  });

  it("descends into a footnote body (default descendInto=['footnote'])", () => {
    const doc = docWithTopAndNestedCite();
    const flat = flattenInlineText(doc);
    expect(flat).toContain("Top cite ");
    expect(flat).toContain("Smith 2020"); // top-level cite
    // Footnote-nested text + cite are included (SR-F4-01 findability seed).
    expect(flat).toContain("see also ");
    expect(flat).toContain("Jones 2019");
    expect(flat).toContain("on this point");
  });

  it("can be told NOT to descend into footnotes", () => {
    const doc = docWithTopAndNestedCite();
    const flat = flattenInlineText(doc, { descendInto: [] });
    expect(flat).toContain("Smith 2020");
    expect(flat).not.toContain("Jones 2019"); // footnote body skipped
  });

  it("works against a live PM node (parity with the JSONContent path)", () => {
    const editor = mount(docWithTopAndNestedCite());
    const flat = flattenInlineText(editor.state.doc);
    expect(flat).toContain("Smith 2020");
    expect(flat).toContain("Jones 2019");
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// inlineAtoms — the single traversal
// ---------------------------------------------------------------------------

describe("inlineAtoms", () => {
  it("yields a top-level cite and a footnote-nested cite with path + nestedInId", () => {
    const doc = docWithTopAndNestedCite();
    const cites = [...inlineAtoms(doc)].filter((h) => h.kind === "citation");
    const byId = new Map(cites.map((h) => [h.id, h]));

    const top = byId.get("c-top");
    expect(top).toBeDefined();
    expect(top!.path).toEqual(["paragraph", "citation"]);
    expect(top!.nestedInId).toBeNull();

    const nested = byId.get("c-nested");
    expect(nested).toBeDefined();
    // path threads through the host footnote node.
    expect(nested!.path).toContain("footnote");
    expect(nested!.path[nested!.path.length - 1]).toBe("citation");
    expect(nested!.nestedInId).toBe("fn-host");
  });

  it("yields the host footnote itself as a tracked atom", () => {
    const doc = docWithTopAndNestedCite();
    const fns = [...inlineAtoms(doc)].filter((h) => h.kind === "footnote");
    expect(fns).toHaveLength(1);
    expect(fns[0].id).toBe("fn-host");
    expect(fns[0].nestedInId).toBeNull();
  });

  it("yields inline math from a heading", () => {
    const math = [...inlineAtoms(HEADING_BODY)].filter((h) => h.kind === "inlineMath");
    expect(math).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// findInlineAtomPosDeep — top-level fast-path + footnote descent
// ---------------------------------------------------------------------------

describe("findInlineAtomPosDeep", () => {
  it("resolves a TOP-LEVEL citation to its own pos (nested:false)", () => {
    const editor = mount(docWithTopAndNestedCite());
    const loc = findInlineAtomPosDeep(editor, "citation", "c-top");
    expect(loc).not.toBeNull();
    expect(loc!.nested).toBe(false);
    // Sanity: the pos points at the citation node.
    const node = editor.state.doc.nodeAt(loc!.pos);
    expect(node?.type.name).toBe("citation");
    expect(node?.attrs.citationId).toBe("c-top");
    editor.destroy();
  });

  it("resolves a FOOTNOTE-NESTED citation to the HOST footnote pos (nested:true) — CI-F3-01/BIB-F3-01", () => {
    const editor = mount(docWithTopAndNestedCite());
    const loc = findInlineAtomPosDeep(editor, "citation", "c-nested");
    expect(loc).not.toBeNull();
    if (loc && loc.nested) {
      expect(loc.hostFootnoteId).toBe("fn-host");
      // The returned pos is the HOST footnote (the scrollable marker target),
      // NOT the invisible nested cite.
      const node = editor.state.doc.nodeAt(loc.pos);
      expect(node?.type.name).toBe("footnote");
    } else {
      throw new Error("expected a nested location");
    }
    editor.destroy();
  });

  it("returns null for an id that exists nowhere", () => {
    const editor = mount(docWithTopAndNestedCite());
    expect(findInlineAtomPosDeep(editor, "citation", "ghost")).toBeNull();
    editor.destroy();
  });

  it("does NOT descend when descendInto omits footnote (legacy contract)", () => {
    const editor = mount(docWithTopAndNestedCite());
    // The nested cite is invisible to a descendants-only resolve.
    expect(
      findInlineAtomPosDeep(editor, "citation", "c-nested", { descendInto: [] }),
    ).toBeNull();
    // …but the top-level one still resolves.
    expect(
      findInlineAtomPosDeep(editor, "citation", "c-top", { descendInto: [] }),
    ).not.toBeNull();
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// walkJsonContentForCitations — the C10 generalization (footnote descent)
// ---------------------------------------------------------------------------

describe("walkJsonContentForCitations (generalized via inlineAtoms)", () => {
  it("collects a citation living directly in a paragraph", () => {
    const ids: string[] = [];
    walkJsonContentForCitations(
      { type: "doc", content: HEADING_BODY.content! },
      (c) => ids.push(c.citationId),
    );
    expect(ids).toContain("c-top");
  });

  it("collects a citation nested inside a footnote body", () => {
    const ids: string[] = [];
    // Passing the footnote BODY directly (the existing call shape).
    walkJsonContentForCitations(FOOTNOTE_BODY, (c) => ids.push(c.citationId));
    expect(ids).toContain("c-nested");
  });

  it("collects a footnote-nested cite even when handed the WHOLE doc (new reach)", () => {
    // Passing the doc node whose footnote ATTR holds the cite — descendants
    // can't reach this; the generalized walker now does.
    const ids: string[] = [];
    walkJsonContentForCitations(docWithTopAndNestedCite(), (c) =>
      ids.push(c.citationId),
    );
    expect(ids).toContain("c-top");
    expect(ids).toContain("c-nested");
  });

  it("treats a bare citation literal as a hit (legacy root behavior)", () => {
    const ids: string[] = [];
    walkJsonContentForCitations(
      { type: "citation", attrs: { citationId: "bare", command: "", displayText: "" } },
      (c) => ids.push(c.citationId),
    );
    expect(ids).toEqual(["bare"]);
  });
});
