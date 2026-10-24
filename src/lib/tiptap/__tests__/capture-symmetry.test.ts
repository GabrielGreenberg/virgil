// @vitest-environment jsdom
//
// Task 848 — the WRAP capture predicate answers about MARKS too.
//
// `sliceIsFullyCapturedBy` walked NODES only, so a `"text"` capture over
// `see *this*` answered "fully captured" and the wrap deleted the italic. This
// pins the per-vocabulary mark policy against the real main-editor schema:
//   • "text"   — wrapper marks DROP by declaration (TEXT_CAPTURE_DROPPED_MARKS);
//                a linkedAnchor refuses; inline atoms refuse.
//   • "latex"  — wrappers carried as LaTeX; id-less inline atoms carried;
//                a linkedAnchor or a Card-bearing atom id refuses.
//   • "inline" — every inline leaf travels with its marks.
// And `mathRun` (the "text" caller) is pinned end to end on the same policy.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import {
  sliceIsFullyCapturedBy,
  TEXT_CAPTURE_DROPPED_MARKS,
  TEXT_CAPTURE_TRANSLATED_MARKS,
  captureRangeMathText,
  type CaptureVocabulary,
} from "@/lib/tiptap/capture-symmetry";
import { WRAPPER_MARK_ROWS, WRAPPER_MARK_TYPES, type WrapperMarkRow } from "@/lib/mark-composition";
import { VIRGIL_ACTION_REGISTRY, type ActionContext } from "@/lib/actions/action-registry";

function mount(content: Record<string, unknown>[]): Editor {
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: { type: "doc", content },
  });
}

const para = (content: Record<string, unknown>[]) => ({
  type: "paragraph",
  attrs: { uuid: "p1" },
  content,
});
const text = (t: string, marks?: Record<string, unknown>[]) =>
  marks ? { type: "text", text: t, marks } : { type: "text", text: t };

const ANCHOR = { type: "linkedAnchor", attrs: { anchorId: "a1", kind: "note" } };

/** Answer for the whole of the single paragraph's content. */
function captured(content: Record<string, unknown>[], capture: CaptureVocabulary): boolean {
  const e = mount([para(content)]);
  const end = e.state.doc.firstChild!.content.size + 1;
  return sliceIsFullyCapturedBy(e.state.doc.slice(1, end), capture);
}

describe("sliceIsFullyCapturedBy — marks (task 848)", () => {
  // Task 1272: the drop set is DERIVED per row from `inMath`, never the whole
  // wrapper vocabulary — the census pins that every row declares its answer and
  // that the drop/translate partition covers the vocabulary exactly.
  it("CENSUS: every wrapper row declares its in-math answer; drop ∪ translate = wrappers", () => {
    for (const row of WRAPPER_MARK_ROWS as readonly WrapperMarkRow[]) {
      const ok =
        row.inMath === "drop" ||
        (typeof row.inMath === "object" && row.inMath.open.length > 0 && row.inMath.close.length > 0);
      expect(ok, `${row.mark} must declare inMath`).toBe(true);
      expect(TEXT_CAPTURE_DROPPED_MARKS.has(row.mark)).toBe(row.inMath === "drop");
      expect(TEXT_CAPTURE_TRANSLATED_MARKS.has(row.mark)).toBe(row.inMath !== "drop");
    }
    expect(
      [...TEXT_CAPTURE_DROPPED_MARKS, ...TEXT_CAPTURE_TRANSLATED_MARKS].sort(),
    ).toEqual([...WRAPPER_MARK_TYPES].sort());
  });

  it("sub/superscript are TRANSLATED, not dropped (math spells them)", () => {
    expect(TEXT_CAPTURE_DROPPED_MARKS.has("subscript")).toBe(false);
    expect(TEXT_CAPTURE_DROPPED_MARKS.has("superscript")).toBe(false);
    expect(TEXT_CAPTURE_TRANSLATED_MARKS.has("subscript")).toBe(true);
    expect(TEXT_CAPTURE_TRANSLATED_MARKS.has("superscript")).toBe(true);
    expect(captured([text("H"), text("2", [{ type: "subscript" }]), text("O")], "text")).toBe(true);
  });

  it("plain text: every vocabulary captures it", () => {
    for (const v of ["text", "inline", "latex"] as const) {
      expect(captured([text("plain")], v)).toBe(true);
    }
  });

  it("wrapper marks: text drops by declaration, latex carries, inline carries", () => {
    const content = [text("see "), text("this", [{ type: "italic" }]), text("that", [{ type: "bold" }])];
    expect(captured(content, "text")).toBe(true);
    expect(captured(content, "latex")).toBe(true);
    expect(captured(content, "inline")).toBe(true);
  });

  it("linkedAnchor: text and latex REFUSE; inline carries the mark", () => {
    const content = [text("keep "), text("anchored", [ANCHOR])];
    expect(captured(content, "text")).toBe(false);
    expect(captured(content, "latex")).toBe(false);
    expect(captured(content, "inline")).toBe(true);
  });

  it("id-less inline atom: latex carries it, text refuses", () => {
    const content = [text("x "), { type: "inlineMath", attrs: { latex: "\\lambda" } }];
    expect(captured(content, "latex")).toBe(true);
    expect(captured(content, "text")).toBe(false);
  });

  it("Card-bearing atom WITH an id: latex refuses (identity has no raw-TeX spelling)", () => {
    const withId = [text("x "), { type: "citation", attrs: { citationId: "c1", command: "\\cite{k}" } }];
    const withoutId = [text("x "), { type: "citation", attrs: { command: "\\cite{k}" } }];
    expect(captured(withId, "latex")).toBe(false);
    expect(captured(withoutId, "latex")).toBe(true);
  });
});

describe("mathRun — the \"text\" capture's mark policy, end to end (task 848)", () => {
  const inlineRow = VIRGIL_ACTION_REGISTRY["inline-math"]!;
  const run = (e: Editor, from: number, to: number) => {
    e.commands.setTextSelection({ from, to });
    inlineRow.run({
      editor: e,
      view: e.view,
      ref: { kind: "selection", from, to, paragraphId: "" },
      surface: "lightning",
      canEdit: true,
    } as ActionContext);
  };
  const countMath = (e: Editor) => {
    let n = 0;
    e.state.doc.descendants((node) => {
      if (node.type.name === "inlineMath") n++;
    });
    return n;
  };

  it("italic text wraps; the italic is DROPPED by declaration", () => {
    const e = mount([para([text("E=mc^2", [{ type: "italic" }])])]);
    run(e, 1, 7);
    expect(countMath(e)).toBe(1);
    let latex = "";
    e.state.doc.descendants((n) => {
      if (n.type.name === "inlineMath") latex = n.attrs.latex as string;
    });
    expect(latex).toBe("E=mc^2");
  });

  it("anchored text REFUSES — the card's anchor is not destroyed", () => {
    const e = mount([para([text("E=mc^2", [ANCHOR])])]);
    const before = e.state.doc.toJSON();
    run(e, 1, 7);
    expect(countMath(e)).toBe(0);
    expect(e.state.doc.toJSON()).toEqual(before);
  });
});

describe("captureRangeMathText — the \"text\" capture's seed (task 1272)", () => {
  const seed = (content: Record<string, unknown>[]) => {
    const e = mount([para(content)]);
    const end = e.state.doc.firstChild!.content.size + 1;
    return captureRangeMathText(e.state.doc, 1, end);
  };
  const SUB = { type: "subscript" };
  const SUP = { type: "superscript" };

  it("plain text equals textBetween", () => {
    const e = mount([para([text("a b")]), { ...para([text("c")]), attrs: { uuid: "p2" } }]);
    const { size } = e.state.doc.content;
    expect(captureRangeMathText(e.state.doc, 0, size)).toBe(e.state.doc.textBetween(0, size, " "));
  });

  it("subscript → _{…}, superscript → ^{…}", () => {
    expect(seed([text("H"), text("2", [SUB]), text("O")])).toBe("H_{2}O");
    expect(seed([text("1"), text("st", [SUP])])).toBe("1^{st}");
  });

  it("a subscript split by an inner dropped mark opens ONCE (no double subscript)", () => {
    expect(seed([text("x"), text("a", [SUB]), text("b", [SUB, { type: "italic" }]), text("c", [SUB])])).toBe(
      "x_{abc}",
    );
  });

  it("dropped marks contribute nothing", () => {
    expect(seed([text("E=mc"), text("2", [{ type: "bold" }])])).toBe("E=mc2");
  });
});

describe("mathRun — sub/superscript survive the wrap (task 1272)", () => {
  const latexOf = (e: Editor, name: string) => {
    let latex: string | null = null;
    e.state.doc.descendants((n) => {
      if (n.type.name === name) latex = n.attrs.latex as string;
    });
    return latex;
  };
  for (const [id, name] of [
    ["inline-math", "inlineMath"],
    ["display-math", "displayMath"],
  ] as const) {
    it(`${id}: H\\textsubscript{2}O seeds H_{2}O`, () => {
      const e = mount([para([text("H"), text("2", [{ type: "subscript" }]), text("O")])]);
      e.commands.setTextSelection({ from: 1, to: 4 });
      VIRGIL_ACTION_REGISTRY[id]!.run({
        editor: e,
        view: e.view,
        ref: { kind: "selection", from: 1, to: 4, paragraphId: "" },
        surface: "lightning",
        canEdit: true,
      } as ActionContext);
      expect(latexOf(e, name)).toBe("H_{2}O");
    });
  }
});
