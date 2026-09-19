// @vitest-environment jsdom
//
// Defect-2 regression (adversarial review of the footnote-atoms change): a
// RELOADED footnote-nested `\ref` rendered as "??" because RichTextField had a
// `refreshCitationDisplay` pass but NO ref-display equivalent, and the doc-level
// ref-display pass (editor-extensions.ts) can't recurse into a footnote's opaque
// `attrs.content` sub-doc. The fix resolves each labelRef's number against the
// MAIN doc via `resolveLabelDisplay` — the SAME resolver the create flow
// (`handleInsertRef`) already uses, so create-time and load-time agree.
//
// This pins that shared resolver: given a MAIN doc holding a labelled heading /
// example, resolving a footnote-nested label against it yields the number — not
// "??". (A footnote body owns no headings/examples, so resolving against the
// footnote's own doc would always give "??"; the resolver MUST read MAIN.)

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { describe, it, expect, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { resolveLabelDisplay } from "@/lib/ref-display";

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

/** Mount a real MAIN editor with a labelled heading as its SECOND section.
 *  RENEGOTIATED (task 550): the resolver used to READ `sectionNumber` off the
 *  heading, so this fixture seeded "2" on a lone heading and expected "2".
 *  The one resolver (`@/lib/ref-display`) DERIVES the number from the
 *  document — the same derivation the parser writes at load and the numberer
 *  keeps in sync — so a lone heading is "1" whatever its attr says. The
 *  seeded attr stays as a stale-attr canary (see the last leg); the heading
 *  is now genuinely second so the expected "2" is the derived answer. */
function mountMain(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, uuid: "h-0" },
          content: [{ type: "text", text: "Preface" }],
        },
        {
          type: "heading",
          attrs: { level: 1, uuid: "h-1", label: "sec:intro", sectionNumber: "2" },
          content: [{ type: "text", text: "Introduction" }],
        },
        { type: "paragraph", attrs: { uuid: "para-A" }, content: [{ type: "text", text: "body" }] },
      ],
    },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("resolveLabelDisplay against MAIN (footnote-nested ref load-time refresh SSOT)", () => {
  it("resolves a heading label to its section number (NOT '??')", () => {
    const main = mountMain();
    const { display, targetKind } = resolveLabelDisplay(main.state.doc, "sec:intro", "ref");
    expect(display).toBe("2");
    expect(targetKind).toBe("heading");
    main.destroy();
  });

  it("wraps the number in parens for \\getref / \\getfullref", () => {
    const main = mountMain();
    expect(resolveLabelDisplay(main.state.doc, "sec:intro", "getref").display).toBe("(2)");
    expect(resolveLabelDisplay(main.state.doc, "sec:intro", "getfullref").display).toBe("(2)");
    main.destroy();
  });

  it("DERIVES the number — a stale seeded `sectionNumber` does not win (task 550)", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const main = new Editor({
      element,
      editable: true,
      extensions: buildEditorExtensions(mainCtx()),
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1, uuid: "h-1", label: "sec:intro", sectionNumber: "7" },
            content: [{ type: "text", text: "Only" }],
          },
        ],
      },
    });
    expect(resolveLabelDisplay(main.state.doc, "sec:intro", "ref").display).toBe("1");
    main.destroy();
  });

  it("returns '??' for an unknown label (caller then KEEPS its persisted displayText)", () => {
    const main = mountMain();
    // RichTextField.refreshRefDisplay treats this "??" as "couldn't place" and
    // does NOT clobber the existing displayText — so the resolver returning "??"
    // here is the signal the refresh pass keys on.
    expect(resolveLabelDisplay(main.state.doc, "sec:nonexistent", "ref").display).toBe("??");
    main.destroy();
  });
});
