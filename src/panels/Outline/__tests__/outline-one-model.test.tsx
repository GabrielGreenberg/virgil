// @vitest-environment jsdom
//
// Task 1347 — the Outline's view mode and edit mode render ONE model.
//
// Edit mode used to build its pods from a second walk (`buildPods(headings)`)
// that never saw the titles above the first heading, indented by RAW LaTeX
// level (`headingIndent(level - 1)`, so `\part` sat at −18 px), and pinned every
// paragraph title at a fake "level 4". The pods are now the view tree,
// FLATTENED, and indent through the same helpers at the same depth.

import { describe, it, expect, vi, afterEach } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({}));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

import OutlinePanel from "../OutlinePanel";
import {
  OUTLINE_BASE_INSET,
  buildPods,
  buildTree,
  computeHiddenPods,
  extractHeadings,
  headingIndent,
  parTitleIndent,
  podIndent,
  type TreeNode,
} from "../outline-model";

afterEach(cleanup);

const h = (level: number, uuid: string, text: string): JSONContent => ({
  type: "heading", attrs: { level, uuid }, content: [{ type: "text", text }],
});
const titled = (uuid: string, parTitle: string): JSONContent => ({
  type: "paragraph", attrs: { uuid, parTitle }, content: [{ type: "text", text: "Body." }],
});

// [par-titled p, \part, \section, par-titled p, \subsubsection, \paragraph, par-titled p]
const DOC: JSONContent = {
  type: "doc",
  content: [
    titled("pre", "Before everything"),
    h(0, "part", "A Part"),
    h(2, "sec", "A Section"),
    titled("t-sec", "Under section"),
    h(4, "subsub", "Skipped to subsub"),
    h(5, "para", "A paragraph heading"),
    titled("t-para", "Under paragraph"),
  ],
};

function depthsOf(tree: TreeNode[], out = new Map<string, number>()): Map<string, number> {
  for (const n of tree) {
    out.set(n.heading.id, n.depth);
    depthsOf(n.children, out);
  }
  return out;
}

describe("one outline model (task 1347)", () => {
  const outline = extractHeadings(DOC);
  const tree = buildTree(outline.headings);
  const pods = buildPods(outline, DOC.content!.length, tree);
  const byId = new Map(pods.map((p) => [p.id, p]));

  it("the pods include the preamble title, in document order", () => {
    expect(pods.map((p) => p.id)).toEqual(["pre", "part", "sec", "t-sec", "subsub", "para", "t-para"]);
    expect(pods.map((p) => p.blockIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const pre = byId.get("pre")!;
    expect(pre).toMatchObject({ type: "parTitle", depth: 0, blockCount: 1, uuid: "pre", parentHeadingId: undefined });
  });

  it("no pod indents left of the base inset (\\part no longer hangs off the edge)", () => {
    for (const p of pods) expect(podIndent(p)).toBeGreaterThanOrEqual(OUTLINE_BASE_INSET);
    expect(podIndent(byId.get("part")!)).toBe(OUTLINE_BASE_INSET);
  });

  it("heading pods sit at their VIEW-tree depth — a skipped level is one step", () => {
    const viewDepths = depthsOf(tree);
    for (const p of pods.filter((x) => x.type === "heading")) {
      expect(p.depth).toBe(viewDepths.get(p.id));
      expect(podIndent(p)).toBe(headingIndent(viewDepths.get(p.id)!));
    }
    expect(viewDepths.get("sec")).toBe(1);
    expect(viewDepths.get("subsub")).toBe(2); // \section → \subsubsection: one step, not two
    expect(viewDepths.get("para")).toBe(3);
  });

  it("each paragraph title indents exactly as its view row: one step past its OWNING heading", () => {
    for (const [ptId, ownerId] of [["t-sec", "sec"], ["t-para", "para"]] as const) {
      const pt = byId.get(ptId)!;
      const owner = byId.get(ownerId)!;
      expect(pt.parentHeadingId).toBe(ownerId);
      expect(pt.depth).toBe(owner.depth);
      expect(podIndent(pt)).toBe(parTitleIndent(owner.depth));
      expect(podIndent(pt)).toBeGreaterThan(podIndent(owner));
    }
    // The preamble title sits where view mode puts it, under Document start.
    expect(podIndent(byId.get("pre")!)).toBe(parTitleIndent(0));
  });

  it("folding hides the section's descendants and never the preamble titles", () => {
    const hidden = computeHiddenPods(pods, new Set(["part"]));
    expect([...hidden].sort()).toEqual(["para", "sec", "subsub", "t-para", "t-sec"]);
    expect(hidden.has("pre")).toBe(false);
  });
});

describe("edit mode renders the one model (task 1347)", () => {
  function enterEditMode(content: JSONContent) {
    const utils = render(
      <OutlinePanel
        content={content}
        onScrollTo={() => {}}
        onReorderBlocks={() => {}}
        onRenameHeading={() => {}}
        onRenameParTitle={() => {}}
      />,
    );
    const toggle = utils.container.querySelector('[data-hint="Edit mode"]') as HTMLElement;
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    return utils;
  }

  it("a doc whose only titles precede the first heading shows those pods, not 'No sections yet.'", () => {
    const { container, queryByText } = enterEditMode({
      type: "doc",
      content: [titled("p1", "First title"), titled("p2", "Second title")],
    });
    expect(queryByText("No sections yet.")).toBeNull();
    expect(queryByText("First title")).toBeTruthy();
    expect(queryByText("Second title")).toBeTruthy();
    expect(container.querySelectorAll('[draggable="true"]').length).toBe(2);
  });

  it("no rendered pod has a negative margin", () => {
    const { container } = enterEditMode(DOC);
    const pods = container.querySelectorAll<HTMLElement>('[draggable="true"]');
    expect(pods.length).toBe(7);
    for (const el of pods) expect(parseFloat(el.style.marginLeft)).toBeGreaterThanOrEqual(OUTLINE_BASE_INSET);
  });
});
