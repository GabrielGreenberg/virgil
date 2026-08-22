// @vitest-environment jsdom
//
// Task 408 — a COLLAPSED source pod carries its whole SOURCE into the DOM as a
// paper body, and carries it with NO dependency on print state.
//
// The CSS half of this posture is asserted in
// `src/lib/__tests__/print-fold-posture.test.ts`; jsdom cannot answer "does this
// paint on paper?" at all (no media queries, no cascade origins). What jsdom CAN
// answer is the half the CSS cannot: **is the source actually in the document,
// whole, while the pod is collapsed** — because the shipped screen body is a
// deliberate two-line truncation, and a print rule that reveals a `.print-only`
// element which was never rendered reveals nothing at all.
//
// Both wearers are driven, because the pod is SHARED: the bug reads as
// forest-specific and is not. `texBlock` is the older wearer and the one with no
// derived view, so it is the case where the collapsed body is the ONLY body.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

import { useEffect } from "react";
import { render, cleanup, act } from "@testing-library/react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { ForestBlock } from "@/lib/tiptap/forest-block";
import { TexBlock } from "@/lib/tiptap/tex-block";

/** Five lines, so the two-line screen preview is a STRICT truncation — a
 *  three-line fixture would let a leg pass on an implementation that prints the
 *  preview's own lines. The trailing lines carry distinctive words for that
 *  reason. */
const TREE = [
  "\\begin{forest}",
  "[S",
  "  [NP [Det [the]] [N [dog]]]",
  "  [VP [V [barks]]]",
  "]",
  "\\end{forest}",
].join("\n");

const TEX = [
  "\\begin{tabular}{ll}",
  "  alpha & beta \\\\",
  "  gamma & delta \\\\",
  "  epsilon & zeta \\\\",
  "\\end{tabular}",
].join("\n");

const held: { editor: Editor | null } = { editor: null };

function Harness({ kind, source }: { kind: "forest" | "tex"; source: string }) {
  const ed = useEditor({
    immediatelyRender: false,
    extensions: [
      Document,
      Paragraph,
      Text,
      ForestBlock.configure({ surface: "main", cardContext: false }),
      TexBlock.configure({ surface: "main", cardContext: false }),
    ],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        kind === "forest"
          ? { type: "forestBlock", attrs: { source, uuid: "aaaa", collapsed: true } }
          : { type: "texBlock", attrs: { code: source, uuid: "bbbb", collapsed: true } },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    },
  });
  useEffect(() => {
    held.editor = ed ?? null;
  }, [ed]);
  return ed ? <EditorContent editor={ed} /> : null;
}

async function mountCollapsed(kind: "forest" | "tex", source: string) {
  const utils = render(<Harness kind={kind} source={source} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return utils;
}

afterEach(() => {
  cleanup();
  held.editor = null;
});

describe.each([
  ["forestBlock", "forest" as const, TREE, "barks"],
  ["texBlock", "tex" as const, TEX, "epsilon"],
])("a collapsed %s pod", (_label, kind, source, tailWord) => {
  it("is actually collapsed — the screen body is the truncated preview", () => {
    // The guard that keeps every leg below from passing vacuously on a pod that
    // rendered EXPANDED (in which case its source is trivially present).
    return mountCollapsed(kind, source).then(({ container }) => {
      const preview = container.querySelector(".source-pod-preview");
      expect(preview, "the pod mounted collapsed").not.toBeNull();
      expect(preview!.textContent).not.toContain(tailWord);
    });
  });

  it("carries the WHOLE source in a `.print-only` paper body", async () => {
    const { container } = await mountCollapsed(kind, source);
    const paper = container.querySelector<HTMLElement>(".source-pod-print-source");
    expect(paper, "the collapsed pod renders a paper body").not.toBeNull();
    expect(paper!.classList.contains("print-only")).toBe(true);
    // WHOLE, byte-for-byte — not the preview's lines, not a normalization.
    expect(paper!.textContent).toBe(source);
  });

  it("renders it with no print-state condition — both print doors, one answer", async () => {
    // `runPrint` stamps `html[data-printing]`; the browser's own File → Print
    // stamps nothing. So the paper body must be present with the flag ABSENT,
    // which is the state every one of these mounts is already in — asserted
    // explicitly, because "we never read the flag" is exactly the claim.
    expect(document.documentElement.dataset.printing).toBeUndefined();
    const { container } = await mountCollapsed(kind, source);
    expect(container.querySelector(".source-pod-print-source")).not.toBeNull();
  });
});

describe("an EXPANDED pod does not double-print", () => {
  it("renders no second paper body beside its real one", async () => {
    const { container } = await (async () => {
      const utils = render(
        <Harness kind="tex" source={TEX} />,
      );
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      return utils;
    })();
    // The harness mounts collapsed, so this leg would pass vacuously on a pod
    // that never expanded — pin both ends.
    expect(container.querySelector(".source-pod-preview")).not.toBeNull();
    expect(container.querySelector(".source-pod-print-source")).not.toBeNull();
    await act(async () => {
      const ed = held.editor!;
      const { state } = ed;
      state.doc.descendants((n, pos) => {
        if (n.type.name === "texBlock") {
          ed.view.dispatch(state.tr.setNodeAttribute(pos, "collapsed", false));
          return false;
        }
        return true;
      });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.querySelector(".source-pod-preview")).toBeNull();
    expect(container.querySelector(".source-pod-print-source")).toBeNull();
  });
});
