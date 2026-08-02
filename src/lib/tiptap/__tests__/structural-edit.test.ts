// @vitest-environment jsdom
//
// W3a / T3 — the node-tree-preserving structural-edit primitive.
//
// Pins the C2 DATA-LOSS fix (OUT-F5-01): renaming a heading
// `\section{The $G$-action on \citet{foo}}` must PRESERVE the inline math and
// the citation atom — the old `delete(from,to).insertText(plainText)` path
// flattened them away. Also pins the drift class (parTitle on a heading is a
// NO-OP, not a mis-write — OUT-F8-04 / OUT-F5-02) and the duplicate-label block
// (OUT-F8-03 / OUT-F5-03), plus a rename-then-serialize round-trip proving the
// preserved atoms survive to `.tex`.
//
// Builds the REAL main editor stack so the schema, uuid backfill, and the
// LaTeX serializer all behave faithfully (the borrowed-atoms-smoke pattern).
import { describe, it, expect, vi } from "vitest";

// Figure / graphics / tex-block React NodeViews transitively import
// `@/lib/storage`; stub it (same pattern as the smoke test).
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

import { Editor, type Content } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { getBus } from "@/lib/tiptap/doc-structure";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import {
  editStructuredNodeByUuid,
  renameHeadingByUuid,
  renameParTitleByUuid,
  updateHeadingLabelByUuid,
  findNodeByUuid,
  shallowEqualAttrs,
} from "@/lib/tiptap/structural-edit";

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

// A doc with a heading carrying leading text + inline math + a citation
// (`The $G$-action on \citet{foo}`), a plain paragraph (parTitle target), and a
// second heading (drift / label target). UUIDs are pre-stamped for
// deterministic addressing.
const HEADING_UUID = "uuid-heading-1";
const PARA_UUID = "uuid-para-1";
const HEADING2_UUID = "uuid-heading-2";

function makeContent(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2, uuid: HEADING_UUID },
        content: [
          { type: "text", text: "The " },
          { type: "inlineMath", attrs: { latex: "G" } },
          { type: "text", text: "-action on " },
          {
            type: "citation",
            attrs: { citationId: "c1", command: "\\citet{foo}", displayText: "Foo 2020" },
          },
        ],
      },
      {
        type: "paragraph",
        attrs: { uuid: PARA_UUID },
        content: [{ type: "text", text: "Body paragraph." }],
      },
      {
        type: "heading",
        attrs: { level: 2, uuid: HEADING2_UUID, label: "sec:two" },
        content: [{ type: "text", text: "Second section" }],
      },
    ],
  };
}

function mount(): { editor: Editor; cleanup: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: makeContent(),
  });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

/** The live heading node carrying HEADING_UUID. */
function headingNode(editor: Editor) {
  const hit = findNodeByUuid(editor, HEADING_UUID);
  return hit?.node ?? null;
}

/** Count atoms of a given type in a node's direct inline content. */
function countInlineAtoms(node: ReturnType<typeof headingNode>, typeName: string): number {
  if (!node) return 0;
  let n = 0;
  node.forEach((child) => {
    if (child.type.name === typeName) n++;
  });
  return n;
}

describe("editStructuredNodeByUuid — addressing + guards", () => {
  it("no-ops cleanly when the uuid is not in the doc", () => {
    const { editor, cleanup } = mount();
    try {
      const ok = editStructuredNodeByUuid(editor, "no-such-uuid", {
        setAttrs: (a) => ({ ...a, parTitle: "X" }),
      });
      expect(ok).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("assertType blocks a write to the wrong node kind (OUT-F5-02 drift)", () => {
    const { editor, cleanup } = mount();
    try {
      // The PARA_UUID resolves to a paragraph; an assertType:'heading' edit must
      // refuse rather than mis-write.
      const ok = editStructuredNodeByUuid(editor, PARA_UUID, {
        assertType: "heading",
        setAttrs: (a) => ({ ...a, label: "oops" }),
      });
      expect(ok).toBe(false);
      // The paragraph is untouched.
      const para = findNodeByUuid(editor, PARA_UUID)?.node;
      expect(para?.attrs.label).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});

describe("editStructuredNodeByUuid — setAttrs no-op bail (phantom-undo class)", () => {
  it("an unchanged attr commit dispatches nothing and returns false", () => {
    const { editor, cleanup } = mount();
    try {
      const spy = vi.spyOn(editor.view, "dispatch");
      const stateBefore = editor.state;
      // HEADING2 already has label "sec:two"; re-setting the SAME value must bail.
      const ok = editStructuredNodeByUuid(editor, HEADING2_UUID, {
        setAttrs: (a) => ({ ...a, label: "sec:two" }),
      });
      expect(ok).toBe(false);
      expect(spy).not.toHaveBeenCalled();
      // No transaction → state identity is unchanged (doc not dirtied, no undo
      // step added).
      expect(editor.state).toBe(stateBefore);
      spy.mockRestore();
    } finally {
      cleanup();
    }
  });

  it("a null → null label commit (blur the '+' on an unlabeled heading) is a no-op", () => {
    const { editor, cleanup } = mount();
    try {
      const spy = vi.spyOn(editor.view, "dispatch");
      // HEADING1 has no label (undefined attr); committing `null` must normalize
      // to equal and bail — the real Outline "+"-then-blur trigger.
      const ok = updateHeadingLabelByUuid(
        editor,
        HEADING_UUID,
        null,
        () => false,
      );
      expect(ok).toBe(false);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    } finally {
      cleanup();
    }
  });

  it("a same-string parTitle rename is a no-op", () => {
    const { editor, cleanup } = mount();
    try {
      // Seed a parTitle, then re-commit the identical value.
      expect(renameParTitleByUuid(editor, PARA_UUID, "My Title")).toBe(true);
      const spy = vi.spyOn(editor.view, "dispatch");
      const ok = renameParTitleByUuid(editor, PARA_UUID, "My Title");
      expect(ok).toBe(false);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    } finally {
      cleanup();
    }
  });

  it("a genuine attr change still dispatches exactly one tx and returns true", () => {
    const { editor, cleanup } = mount();
    try {
      const spy = vi.spyOn(editor.view, "dispatch");
      const ok = updateHeadingLabelByUuid(
        editor,
        HEADING2_UUID,
        "sec:renamed",
        () => false,
      );
      expect(ok).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(findNodeByUuid(editor, HEADING2_UUID)?.node.attrs.label).toBe(
        "sec:renamed",
      );
      spy.mockRestore();
    } finally {
      cleanup();
    }
  });
});

describe("shallowEqualAttrs — undefined ≡ null normalization", () => {
  it("treats an absent key as equal to an explicit null", () => {
    expect(shallowEqualAttrs({ label: undefined }, { label: null })).toBe(true);
    expect(shallowEqualAttrs({}, { label: null })).toBe(true);
    expect(shallowEqualAttrs({ level: 2, label: null }, { level: 2 })).toBe(true);
  });
  it("detects a genuine value change", () => {
    expect(shallowEqualAttrs({ label: "a" }, { label: "b" })).toBe(false);
    expect(shallowEqualAttrs({ label: null }, { label: "b" })).toBe(false);
    expect(shallowEqualAttrs({ level: 2 }, { level: 3 })).toBe(false);
  });
});

describe("renameHeadingByUuid — atom preservation (OUT-F5-01)", () => {
  it("preserves inline math + the citation atom when renaming around them", () => {
    const { editor, cleanup } = mount();
    try {
      const before = headingNode(editor);
      expect(countInlineAtoms(before, "inlineMath")).toBe(1);
      expect(countInlineAtoms(before, "citation")).toBe(1);

      // The rename input was seeded from the flattened projection:
      // "The G-action on Foo 2020". The user edits ONLY the surrounding text:
      // "The G-action upon Foo 2020".
      const ok = renameHeadingByUuid(
        editor,
        HEADING_UUID,
        "The G-action upon Foo 2020",
      );
      expect(ok).toBe(true);

      const after = headingNode(editor);
      // Atoms SURVIVE — the old flatten path would have dropped both.
      expect(countInlineAtoms(after, "inlineMath")).toBe(1);
      expect(countInlineAtoms(after, "citation")).toBe(1);
      // The edited surrounding text landed.
      expect(after?.textContent).toContain("-action upon ");
      // The citation atom is the SAME instance (id preserved).
      let citId = "";
      after?.forEach((c) => {
        if (c.type.name === "citation") citId = c.attrs.citationId as string;
      });
      expect(citId).toBe("c1");
    } finally {
      cleanup();
    }
  });

  it("rename-then-serialize round-trips the atoms to .tex", () => {
    const { editor, cleanup } = mount();
    try {
      renameHeadingByUuid(editor, HEADING_UUID, "The G-action upon Foo 2020");
      const tex = serializeBodyOnly(editor.getJSON());
      // The math + citation survive to the serialized LaTeX.
      expect(tex).toContain("$G$");
      expect(tex).toContain("\\citet{foo}");
      // The edited text is present.
      expect(tex).toContain("-action upon");
    } finally {
      cleanup();
    }
  });

  it("a plain heading (no atoms) renames losslessly", () => {
    const { editor, cleanup } = mount();
    try {
      const ok = renameHeadingByUuid(editor, HEADING2_UUID, "Renamed second");
      expect(ok).toBe(true);
      const node = findNodeByUuid(editor, HEADING2_UUID)?.node;
      expect(node?.textContent).toBe("Renamed second");
    } finally {
      cleanup();
    }
  });

  it("renaming to the IDENTICAL flattened text is a no-op (no empty tx)", () => {
    const { editor, cleanup } = mount();
    try {
      // The flattened projection of HEADING2 ("Second section") is unchanged.
      const ok = renameHeadingByUuid(editor, HEADING2_UUID, "Second section");
      expect(ok).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("preserves a bold mark on the heading text after a rename", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      editable: true,
      extensions: buildEditorExtensions(mainCtx()),
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2, uuid: "bold-h" },
            content: [
              { type: "text", text: "Bold ", marks: [{ type: "bold" }] },
              { type: "inlineMath", attrs: { latex: "x" } },
            ],
          },
        ],
      },
    });
    try {
      // Flattened seed is "Bold x"; edit the text run to "Boldly x".
      const ok = renameHeadingByUuid(editor, "bold-h", "Boldly x");
      expect(ok).toBe(true);
      const h = findNodeByUuid(editor, "bold-h")?.node;
      let sawBold = false;
      h?.forEach((c) => {
        if (c.isText && c.marks.some((m) => m.type.name === "bold")) sawBold = true;
      });
      expect(sawBold).toBe(true);
      // The math atom survives.
      let mathCount = 0;
      h?.forEach((c) => { if (c.type.name === "inlineMath") mathCount++; });
      expect(mathCount).toBe(1);
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  it("the fallback never DELETES an atom even when the user retypes over it", () => {
    const { editor, cleanup } = mount();
    try {
      // The user types a string that does NOT contain the citation's display
      // "Foo 2020" (they retyped over the atom's position). The fallback must
      // keep the atom — worst case appended — never silently delete it.
      const ok = renameHeadingByUuid(editor, HEADING_UUID, "Totally new text");
      expect(ok).toBe(true);
      const after = headingNode(editor);
      // Both atoms still present.
      expect(countInlineAtoms(after, "inlineMath")).toBe(1);
      expect(countInlineAtoms(after, "citation")).toBe(1);
    } finally {
      cleanup();
    }
  });
});

describe("renameParTitleByUuid — drift guard (OUT-F8-04)", () => {
  it("sets parTitle on a paragraph", () => {
    const { editor, cleanup } = mount();
    try {
      const ok = renameParTitleByUuid(editor, PARA_UUID, "My Title");
      expect(ok).toBe(true);
      expect(findNodeByUuid(editor, PARA_UUID)?.node.attrs.parTitle).toBe("My Title");
    } finally {
      cleanup();
    }
  });

  it("refuses to stamp parTitle onto a heading (no-op, not a mis-write)", () => {
    const { editor, cleanup } = mount();
    try {
      const ok = renameParTitleByUuid(editor, HEADING_UUID, "Wrong");
      expect(ok).toBe(false);
      // The heading is untouched — no parTitle attr, atoms intact.
      const h = headingNode(editor);
      expect(h?.attrs.parTitle).toBeFalsy();
      expect(countInlineAtoms(h, "citation")).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("clears parTitle when given empty text", () => {
    const { editor, cleanup } = mount();
    try {
      renameParTitleByUuid(editor, PARA_UUID, "First");
      renameParTitleByUuid(editor, PARA_UUID, "   ");
      expect(findNodeByUuid(editor, PARA_UUID)?.node.attrs.parTitle).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("updateHeadingLabelByUuid — duplicate-label block (OUT-F8-03)", () => {
  // A predicate matching the central registry's contract: taken when another
  // heading already claims it (excluding our own label).
  const takenByOther = (taken: Set<string>) =>
    (candidate: string, exclude: string | null) => {
      const k = candidate.trim();
      if (!k) return false;
      if (exclude && k === exclude) return false;
      return taken.has(k);
    };

  it("blocks committing a label already taken by another heading", () => {
    const { editor, cleanup } = mount();
    try {
      // "sec:two" is already on HEADING2. Try to put it on HEADING1 — blocked.
      const isTaken = takenByOther(new Set(["sec:two"]));
      const ok = updateHeadingLabelByUuid(editor, HEADING_UUID, "sec:two", isTaken);
      expect(ok).toBe(false);
      expect(headingNode(editor)?.attrs.label).toBeFalsy();
    } finally {
      cleanup();
    }
  });

  it("allows a fresh, unused label", () => {
    const { editor, cleanup } = mount();
    try {
      const isTaken = takenByOther(new Set(["sec:two"]));
      const ok = updateHeadingLabelByUuid(editor, HEADING_UUID, "sec:fresh", isTaken);
      expect(ok).toBe(true);
      expect(headingNode(editor)?.attrs.label).toBe("sec:fresh");
    } finally {
      cleanup();
    }
  });

  it("allows clearing a label even though the registry would report it taken", () => {
    const { editor, cleanup } = mount();
    try {
      // Clearing HEADING2's own "sec:two" — the guard short-circuits on clear.
      const isTaken = takenByOther(new Set(["sec:two"]));
      const ok = updateHeadingLabelByUuid(editor, HEADING2_UUID, null, isTaken);
      expect(ok).toBe(true);
      expect(findNodeByUuid(editor, HEADING2_UUID)?.node.attrs.label).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("lets a heading keep its OWN label (exclude self) — now a no-op bail, label preserved", () => {
    const { editor, cleanup } = mount();
    try {
      const isTaken = takenByOther(new Set(["sec:two"]));
      // Re-commit HEADING2's own label — not a self-collision, so NOT blocked.
      // Since the value is unchanged, the setAttrs equality bail makes this a
      // true no-op (returns false, no phantom tx) rather than the old
      // dispatch-anyway behavior. The user-facing contract that matters — the
      // label is neither blocked-and-cleared nor errored — still holds.
      const ok = updateHeadingLabelByUuid(editor, HEADING2_UUID, "sec:two", isTaken);
      expect(ok).toBe(false);
      expect(findNodeByUuid(editor, HEADING2_UUID)?.node.attrs.label).toBe("sec:two");
    } finally {
      cleanup();
    }
  });
});

describe("keystroke sanctity — a structural rename emits, plain typing does not", () => {
  it("rename dispatches a structural tx; plain typing leaves emitCount flat", () => {
    const { editor, cleanup } = mount();
    try {
      const bus = getBus(editor);
      expect(bus).not.toBeNull();

      // A rename is a structural edit — it goes through a normal tx the observer
      // maps; it is NOT per-keystroke work.
      renameHeadingByUuid(editor, HEADING2_UUID, "Renamed");
      // (We don't assert the emit count of the rename itself — only that plain
      // typing AFTER it stays flat, which is the keystroke-sanctity invariant.)

      // Warm-up keystroke (BlockUuidBackfill one-off), then measure steady state.
      let typePos: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (typePos == null && node.type.name === "text") {
          typePos = pos + 1;
          return false;
        }
        return true;
      });
      editor.view.dispatch(editor.state.tr.insertText("a", typePos!));

      const emitBefore = bus!.emitCount;
      for (let i = 0; i < 8; i++) {
        editor.view.dispatch(editor.state.tr.insertText("a", typePos! + 1 + i));
      }
      // Plain typing fired ZERO structural emits.
      expect(bus!.emitCount).toBe(emitBefore);
    } finally {
      cleanup();
    }
  });
});
