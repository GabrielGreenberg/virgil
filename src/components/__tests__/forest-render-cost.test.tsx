// @vitest-environment jsdom
//
// Task 384 — the forest renderer's KEYSTROKE COST, and the equality bail it
// rests on.
//
// The keystroke-sanctity law's question for a DERIVED VIEW is not "does it
// subscribe to the editor?" (this one deliberately does not) but "does a
// keystroke somewhere else in the document cost it anything?" — because a React
// NodeView is re-rendered by its own host for reasons it does not control, and
// a re-render that re-parses, re-measures and re-lays-out a tree is O(tree) per
// keystroke however innocent its subscription list looks. That is the shape
// `float-sync` sat on the permitted-subscriber list with for a year: an
// accurate claim about the SUBSCRIBER and a silent one about the CALLBACK.
//
// So this suite drives the REAL `ForestBlock` NodeView inside a REAL editor and
// counts the three kinds of work separately (`__forestRenderStats`): a parse per
// render means a missing memo, a measure per render means a missing effect
// dependency, a layout per render means the pure engine is being re-run on
// unchanged sizes. Each names its own regression.
//
// Both legs open by asserting the tree ACTUALLY RENDERED — without that, every
// counter reads zero and the whole suite passes vacuously on a NodeView that
// never mounted, which in jsdom is the likeliest way to be wrong.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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
import {
  forestRenderStats,
  resetForestRenderStats,
} from "@/lib/forest/stats";
import SourcePodNodeView from "@/components/SourcePodNodeView";
import { FOREST_POD_CONFIG } from "@/lib/forest/pod-config";
import { ForestTreeView } from "@/components/ForestTreeView";
import { parseForestSource, type ForestRenderNode } from "@/lib/forest/grammar";

const TREE = "\\begin{forest}\n[S [NP [Det [the]] [N [dog]]] [VP [V [barks]]]]\n\\end{forest}";
const REFUSED = "\\begin{forest}\nfor tree={s sep=2cm}\n[S [NP]]\n\\end{forest}";

/** The mounted editor, handed out through an EFFECT rather than assigned during
 *  render — reassigning a module binding in a render body is a side effect in
 *  render, which the React Compiler lint correctly refuses. */
const held: { editor: Editor | null } = { editor: null };

function Harness({ source }: { source: string }) {
  const ed = useEditor({
    immediatelyRender: false,
    extensions: [
      Document,
      Paragraph,
      Text,
      // The REAL node, with the REAL React NodeView and the REAL derivation.
      ForestBlock.configure({ surface: "main", cardContext: false }),
    ],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        { type: "forestBlock", attrs: { source, uuid: "aaaa" } },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    },
  });
  useEffect(() => {
    held.editor = ed ?? null;
  }, [ed]);
  return ed ? <EditorContent editor={ed} /> : null;
}

async function mount(source: string) {
  const utils = render(<Harness source={source} />);
  // `immediatelyRender: false` + the NodeView's own measure effects.
  await act(async () => {
    await Promise.resolve();
  });
  return utils;
}

/** Type ONE character into the trailing paragraph — a plain keystroke with no
 *  structural consequence, which is the condition the law is about. */
function typeElsewhere(chars: number) {
  const ed = held.editor!;
  const at = ed.state.doc.content.size - 2;
  for (let i = 0; i < chars; i++) {
    ed.commands.insertContentAt(at + i, "x");
  }
}

beforeEach(() => {
  resetForestRenderStats();
});

afterEach(() => {
  cleanup();
  held.editor = null;
});

describe("a plain keystroke elsewhere costs the tree nothing", () => {
  it("renders the tree, then stays flat across a typing burst", async () => {
    const { container } = await mount(TREE);

    // The leg only means something if the NodeView really mounted.
    expect(container.querySelector(".forest-tree")).not.toBeNull();
    expect(container.querySelectorAll(".forest-node").length).toBeGreaterThan(5);
    expect(forestRenderStats().parse).toBeGreaterThan(0);
    expect(forestRenderStats().layout).toBeGreaterThan(0);

    resetForestRenderStats();
    await act(async () => {
      typeElsewhere(20);
      await Promise.resolve();
    });

    expect(forestRenderStats()).toEqual({ parse: 0, measure: 0, layout: 0, render: 0 });
  });

  it("a REFUSED tree is just as flat — the badge is derived once, not per render", async () => {
    const { container } = await mount(REFUSED);

    expect(container.querySelector(".forest-refusal-badge")).not.toBeNull();
    expect(container.querySelector(".forest-tree")).toBeNull();
    expect(forestRenderStats().parse).toBeGreaterThan(0);

    resetForestRenderStats();
    await act(async () => {
      typeElsewhere(20);
      await Promise.resolve();
    });

    expect(forestRenderStats().parse).toBe(0);
  });
});

// ── The equality bail, driven directly ──────────────────────────────────────
//
// The burst legs above prove the SHIPPED cost: ProseMirror does not re-render a
// NodeView whose node did not change, so a keystroke three paragraphs away
// never reaches this component at all. That is the user-visible contract and it
// is what those legs are for — but it also means they would stay green with the
// pod's `useMemo` deleted, which was MEASURED (neutering the memo fails
// nothing above). So the bail gets a leg that can actually see it: re-render the
// REAL pod, with an UNCHANGED source, from a parent that has its own reasons to
// re-render — a context change, a prop identity change, a `memo` someone
// removes later. Without the memo each of those is a full re-parse, re-measure
// and re-layout of the tree.
describe("the equality bail", () => {
  function podNode(source: string) {
    return {
      attrs: { source, parTitle: null, collapsed: false },
    } as unknown as Parameters<typeof SourcePodNodeView>[0]["node"];
  }

  function Parent({ source, tick }: { source: string; tick: number }) {
    return (
      <div data-tick={tick}>
        <SourcePodNodeView
          node={podNode(source)}
          updateAttributes={() => {}}
          deleteNode={() => {}}
          cardContext={false}
          config={FOREST_POD_CONFIG}
        />
      </div>
    );
  }

  it("an unrelated re-render of the pod costs zero parses, measures and layouts", async () => {
    const { rerender, container } = render(<Parent source={TREE} tick={0} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector(".forest-tree")).not.toBeNull();
    expect(forestRenderStats().parse).toBeGreaterThan(0);

    resetForestRenderStats();
    for (let i = 1; i <= 10; i++) {
      await act(async () => {
        rerender(<Parent source={TREE} tick={i} />);
        await Promise.resolve();
      });
    }
    expect(forestRenderStats()).toEqual({ parse: 0, measure: 0, layout: 0, render: 0 });
  });

  // The pod's memo hands back the IDENTICAL element on an unchanged source, so
  // React bails before `ForestTreeView` is reached at all — which means the
  // view's own comparator is invisible to the leg above (measured: neutering it
  // fails nothing there). It is not decoration, though: a caller that mints its
  // element fresh — a second surface, a wrapper someone adds, a future
  // `derive` that returns a new node for an equal tree — pays a full
  // re-measure and re-layout without it. So it gets the one leg that can see it.
  it("the view runs NOTHING when handed the SAME tree by a fresh element", async () => {
    const t = parseForestSource(TREE);
    if (!t.ok) throw new Error("fixture refused");
    function TreeParent({ tick }: { tick: number }) {
      return (
        <div data-tick={tick}>
          <ForestTreeView tree={(t as { ok: true; tree: ForestRenderNode }).tree} />
        </div>
      );
    }
    const { rerender } = render(<TreeParent tick={0} />);
    await act(async () => {
      await Promise.resolve();
    });
    resetForestRenderStats();
    for (let i = 1; i <= 8; i++) {
      await act(async () => {
        rerender(<TreeParent tick={i} />);
        await Promise.resolve();
      });
    }
    expect(forestRenderStats()).toEqual({ parse: 0, measure: 0, layout: 0, render: 0 });
  });

  it("…and a real source change still re-derives exactly once", async () => {
    const { rerender } = render(<Parent source={TREE} tick={0} />);
    await act(async () => {
      await Promise.resolve();
    });
    resetForestRenderStats();
    await act(async () => {
      rerender(
        <Parent source={"\\begin{forest}\n[S [NP] [VP]]\n\\end{forest}"} tick={1} />,
      );
      await Promise.resolve();
    });
    const stats = forestRenderStats();
    expect(stats.parse).toBe(1);
    expect(stats.measure).toBe(1);
    expect(stats.layout).toBe(1);
  });
});

describe("editing the tree's own source re-derives it — once", () => {
  it("one source change costs one parse, one measure, one layout", async () => {
    await mount(TREE);
    resetForestRenderStats();

    await act(async () => {
      held.editor!.commands.command(({ tr, state, dispatch }) => {
        let pos = -1;
        state.doc.forEach((node, p) => {
          if (node.type.name === "forestBlock") pos = p;
        });
        if (pos < 0 || !dispatch) return false;
        dispatch(
          tr.setNodeMarkup(pos, undefined, {
            ...state.doc.nodeAt(pos)!.attrs,
            source: "\\begin{forest}\n[S [NP] [VP]]\n\\end{forest}",
          }),
        );
        return true;
      });
      await Promise.resolve();
    });

    const stats = forestRenderStats();
    expect(stats.parse).toBe(1);
    expect(stats.measure).toBe(1);
    expect(stats.layout).toBe(1);
  });

  it("a source that becomes unsupported swaps the tree for the badge", async () => {
    const { container } = await mount(TREE);
    expect(container.querySelector(".forest-tree")).not.toBeNull();

    await act(async () => {
      held.editor!.commands.command(({ tr, state, dispatch }) => {
        let pos = -1;
        state.doc.forEach((node, p) => {
          if (node.type.name === "forestBlock") pos = p;
        });
        if (pos < 0 || !dispatch) return false;
        dispatch(
          tr.setNodeMarkup(pos, undefined, {
            ...state.doc.nodeAt(pos)!.attrs,
            source: REFUSED,
          }),
        );
        return true;
      });
      await Promise.resolve();
    });

    expect(container.querySelector(".forest-refusal-badge")).not.toBeNull();
    expect(container.querySelector(".forest-tree")).toBeNull();
  });
});
