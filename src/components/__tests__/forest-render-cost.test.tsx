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
import { ForestTreeView, borderBoxFromTextWidth } from "@/components/ForestTreeView";
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

// ── The two measurement rungs must be interchangeable ───────────────────────
//
// The DOM rung reports the BORDER BOX; the canvas rung reports TEXT. The engine
// treats whichever it is handed AS the painted box, so a canvas-measured label
// that omitted `.forest-node`'s own horizontal padding would be drawn off-centre
// from where it was placed — and the canvas rung is exactly the one a hidden
// first render takes, so the two failures compound. This leg is a parity claim,
// which no test of either rung alone can see.
describe("the canvas rung reports the same box the DOM rung would", () => {
  const style = {
    paddingLeft: "3px",
    paddingRight: "3px",
    borderLeftWidth: "0px",
    borderRightWidth: "0px",
  };

  it("adds the label's own padding, matching `.forest-node { padding: 0 3px }`", () => {
    expect(borderBoxFromTextWidth(40, style)).toBe(46);
  });

  it("adds borders too, so a future framed label stays interchangeable", () => {
    expect(
      borderBoxFromTextWidth(40, {
        ...style,
        borderLeftWidth: "1px",
        borderRightWidth: "1px",
      }),
    ).toBe(48);
  });

  it("reads an unparseable style as zero rather than NaN", () => {
    expect(
      borderBoxFromTextWidth(40, {
        paddingLeft: "",
        paddingRight: "auto",
        borderLeftWidth: "medium",
        borderRightWidth: "",
      }),
    ).toBe(40);
  });
});

// ── The hidden first render ─────────────────────────────────────────────────
//
// A `forestBlock` inside a FOLDED section stays MOUNTED — `.section-folded` is
// applied as a ProseMirror node decoration, not by unmounting — so its layout
// effect runs while it has no box at all. Every rect reads 0×0, every label
// falls to the estimate rung, and NOTHING in the effect's dependency list
// changes when the section is unfolded: a decoration is added and removed
// without touching `source`. So the estimates would stand for the life of the
// document, with edges converging beside their labels and a roof spanning the
// wrong width — silently, on a starting condition that is persisted per doc and
// restored on open.
//
// jsdom reports 0×0 for everything, which makes it exactly the right harness
// for the hidden case and useless for the visible one — so the leg drives the
// SIGNAL (a stub ResizeObserver delivering the 0 → non-zero transition) rather
// than real geometry, and asserts what the component does with it.
// The stub is MODULE-scope and installed once, because `measure-watch` holds
// ONE observer for the whole app (`ensureObserver`'s singleton) — a leg that
// installs its own stub mid-file gets a `ResizeObserver` constructor nobody
// calls, an empty observed list, and a failure that says nothing about the code.
//
// It is also PER-INSTANCE, which is not tidiness: this file mounts a real
// CodeMirror (every refused pod pins to its source surface) and CodeMirror
// constructs a `ResizeObserver` of its own. A single shared `deliver` binding
// is therefore whichever observer was built LAST — CodeMirror's — so the
// forest host's own callback is never reached and the leg fails for a reason
// that has nothing to do with `measure-watch`. Delivering to the instance that
// actually observed the host is order-independent.
type ROEntry = { target: Element; contentRect: { width: number } };
const roInstances: { cb: (entries: ROEntry[]) => void; seen: Element[] }[] = [];
class StubRO {
  private readonly rec: { cb: (entries: ROEntry[]) => void; seen: Element[] };
  constructor(cb: (entries: ROEntry[]) => void) {
    this.rec = { cb, seen: [] };
    roInstances.push(this.rec);
  }
  observe(el: Element) {
    this.rec.seen.push(el);
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubRO as unknown;

/** Deliver a resize to whichever observer is watching `host`. */
function deliverResize(host: Element, width: number) {
  const rec = roInstances.find((r) => r.seen.includes(host));
  if (!rec) throw new Error("no ResizeObserver is watching the forest host");
  rec.cb([{ target: host, contentRect: { width } }]);
}

describe("a tree measured without a box re-measures when it gets one", () => {
  it("re-runs the measure on the host's 0 → non-zero transition, and only then", async () => {
    const { container } = await mount(TREE);
    const host = container.querySelector(".forest-tree")!;
    resetForestRenderStats();

    // A fire while still hidden (a zero box) must cost nothing — otherwise a
    // display-flip storm would re-measure once per entry.
    await act(async () => {
      deliverResize(host, 0);
      await Promise.resolve();
    });
    expect(forestRenderStats().measure).toBe(0);

    // …and the transition re-measures exactly once.
    await act(async () => {
      deliverResize(host, 240);
      await Promise.resolve();
    });
    expect(forestRenderStats().measure).toBe(1);
    expect(forestRenderStats().layout).toBe(1);
    // The derivation is untouched — this is a re-MEASURE, not a re-parse.
    expect(forestRenderStats().parse).toBe(0);
  });

  // …and the OTHER half of that gate, which had no leg at all until task 388's
  // adversarial pass measured it: deleting `if (!waiter.degraded()) continue;`
  // from `measure-watch.ts` left all 212 legs of this cluster green.
  //
  // The gate is what the module's whole docstring rests on — "a tree measured
  // from real boxes ignores every fire, including the initial one every
  // `observe` delivers". Without it EVERY host size change re-measures a tree
  // whose numbers were already exact, starting with the initial delivery the
  // observer makes on `observe` itself. Bounded (the layout is a pure function
  // of unchanged sizes, so it converges at once) and wasted — which is the
  // class this cluster's own probe exists to name. An invariant with no leg is
  // a habit (task 334).
  //
  // jsdom reports 0×0 for everything, so a NON-degraded first measure is
  // unrepresentable without stubbing the read — which is exactly why the leg
  // above (the hidden case) could ship while its complement could not be seen.
  it("a host measured from REAL boxes ignores the fire entirely", async () => {
    const prevRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function realBox() {
      return {
        width: 40,
        height: 18,
        top: 0,
        left: 0,
        right: 40,
        bottom: 18,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    };
    try {
      const { container } = await mount(TREE);
      const host = container.querySelector(".forest-tree")!;

      resetForestRenderStats();
      await act(async () => {
        deliverResize(host, 240);
        await Promise.resolve();
      });
      // Nothing to redo — the numbers were already read from real boxes.
      expect(forestRenderStats()).toEqual({ parse: 0, measure: 0, layout: 0, render: 0 });
    } finally {
      Element.prototype.getBoundingClientRect = prevRect;
    }
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
