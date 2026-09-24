// @vitest-environment jsdom
//
// Task 660 — **"which element shows this block's first line" is ONE question,
// so it gets ONE door and one declared answer per kind.**
//
// It had two of each. The descent lived in two layers: the WRAPPER half
// (`resolveInlineContextElement`, public in `text-metrics.ts`) and the full
// answer (`resolveFirstLineTarget`, PRIVATE inside `block-frame.ts` — wrapper
// half plus the CONTAINER descent, because a `<ul>`/`<ol>`/`.expex-block` has
// no text line of its own). Only the block frame reached the full one; every
// other consumer reached past it to the shallow half and seated its chrome on
// the container itself. And the wrapper half is a hand-listed table of classes
// and tags with a silent `return anchorDom` fall-through, so a kind it has
// never heard of is correct only if someone remembered — and two were not.
//
// The teeth here are in three groups, and only the first two can catch the
// NEXT instance of this:
//
//   A. THE VOCABULARY CENSUS. Every kind the editor can anchor
//      (`UUID_BEARING_NODE_TYPES`) declares exactly one answer — no text line,
//      a container's child's line, or its own — and the two sets that say so
//      are PINNED to `TEXT_OBJECT_REGISTRY`: `TEXTLESS_BLOCK_NODE_TYPES` is
//      exactly the registry's `chromeAnchor: "block-top"` set, and
//      `TEXT_LINE_CONTAINER_NODE_TYPES` is exactly its sub-object
//      `parentKinds`. A kind added to the registry without
//      an answer here fails, which is what turns "we remembered `latexComment`"
//      into "it cannot be forgotten".
//
//   B. THE ONE-DOOR CENSUS. Production code names `resolveInlineContextElement`
//      in exactly one module: its own. No behavioural leg can see a second
//      consumer being wired to the shallow half — that is precisely how this
//      shipped — so the census is the leg that carries the finding.
//
//   C. The behavioural legs for the two kinds that were wrong, and for the
//      agreement between the two surfaces that disagreed.
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import {
  TEXTLESS_BLOCK_NODE_TYPES,
  TEXT_LINE_CONTAINER_NODE_TYPES,
  UUID_BEARING_NODE_TYPES,
} from "@/lib/node-attr-sets";
import {
  blockHasOwnTextLine,
  isTextLineContainer,
  resolveFirstLineTarget,
  resolveInlineContextElement,
} from "@/lib/text-metrics";
import { TEXT_OBJECT_REGISTRY } from "@/text-objects/text-object-registry";
import { resolveBlockFrame } from "@/text-objects/block-frame";
import { measureBlock } from "@/hooks/useMarginaliaRegistry";
import type { Editor } from "@tiptap/react";

const SRC = join(process.cwd(), "src");

/** Every production `.ts`/`.tsx` under `src/`, tests and fixtures excluded. */
function productionFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      productionFiles(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

// ── A. The vocabulary census ───────────────────────────────────────────────

describe("first-line answer — the vocabulary census", () => {
  it("TEXTLESS_BLOCK_NODE_TYPES is exactly the registry's `chromeAnchor: \"block-top\"` set", () => {
    // The grab handle already reads `chromeAnchor` to decide "text line or
    // border box". Stating the same fact twice is what let the marginalia
    // registry answer differently for `latexComment` and `figureBlock`.
    const blockTop = new Set(
      Object.entries(TEXT_OBJECT_REGISTRY)
        .filter(([, meta]) => meta.chromeAnchor === "block-top")
        .map(([kind]) => kind),
    );
    expect([...TEXTLESS_BLOCK_NODE_TYPES].sort()).toEqual([...blockTop].sort());
  });

  it("TEXT_LINE_CONTAINER_NODE_TYPES is exactly the registry's sub-object parentKinds", () => {
    // Since task 743 `listItem` declares BOTH list kinds, so `orderedList` is
    // derived like every other member — no stated exception remains.
    const parents = new Set(
      Object.values(TEXT_OBJECT_REGISTRY).flatMap(
        (meta) => (meta.parentKinds ?? []) as readonly string[],
      ),
    );
    expect([...TEXT_LINE_CONTAINER_NODE_TYPES].sort()).toEqual(
      [...parents].sort(),
    );
  });

  it("every anchorable kind declares EXACTLY ONE answer, and the three sets do not overlap", () => {
    const undeclared: string[] = [];
    const doubled: string[] = [];
    for (const kind of UUID_BEARING_NODE_TYPES) {
      const textless = TEXTLESS_BLOCK_NODE_TYPES.has(kind);
      const container = TEXT_LINE_CONTAINER_NODE_TYPES.has(kind);
      if (textless && container) doubled.push(kind);
      // "Its own line" is the third answer and needs no set — but it is only
      // an ANSWER if the registry agrees the kind seats chrome on text.
      const meta = TEXT_OBJECT_REGISTRY[kind as keyof typeof TEXT_OBJECT_REGISTRY];
      if (!meta) continue; // `maketitleMarker` is anchorable but not grabbable
      if (!textless && meta.chromeAnchor === "block-top") undeclared.push(kind);
      if (textless && meta.chromeAnchor === "text-top") undeclared.push(kind);
    }
    expect({ undeclared, doubled }).toEqual({ undeclared: [], doubled: [] });
  });
});

// ── B. The one-door census ─────────────────────────────────────────────────

describe("first-line answer — one door", () => {
  it("only `text-metrics.ts` itself names `resolveInlineContextElement`", () => {
    const offenders = productionFiles(SRC)
      .filter((f) => readFileSync(f, "utf8").includes("resolveInlineContextElement"))
      .map((f) => relative(SRC, f))
      .filter((f) => f !== "lib/text-metrics.ts");
    // A consumer that needs "where is this block's first line" asks
    // `resolveFirstLineTarget`. The wrapper half is a STEP that door composes;
    // reaching it directly is how a `<ul>`-anchored card came to be measured
    // on the `<ul>`'s own root-inherited font metrics while the grab handle for
    // the same block sat on its first item's `<p>`.
    expect(offenders).toEqual([]);
  });
});

// ── C. The behavioural legs ────────────────────────────────────────────────

function rect(top: number, height: number, left = 100): DOMRect {
  return {
    top,
    left,
    right: left + 300,
    bottom: top + height,
    width: 300,
    height,
    x: left,
    y: top,
    toJSON() {},
  } as DOMRect;
}

function withRect<T extends HTMLElement>(el: T, top: number, height: number, left = 100): T {
  el.getBoundingClientRect = () => rect(top, height, left);
  return el;
}

/** The real top-level `bulletList` shape (`createListTitleNodeView`): the
 *  identity lives on a `.list-title-wrapper` div hosting the annotation and
 *  the `<ul>`, and the text lives in each `<li>`'s inner `<p>`. */
function buildList(itemCount = 3): { wrapper: HTMLElement; firstPara: HTMLElement } {
  const wrapper = withRect(document.createElement("div"), 200, 40 * itemCount);
  wrapper.className = "list-title-wrapper";
  wrapper.setAttribute("data-uuid", "list1");
  wrapper.setAttribute("data-text-object-kind", "bulletList");
  const annot = document.createElement("div");
  annot.className = "par-title-annotation";
  wrapper.appendChild(annot);

  const ul = withRect(document.createElement("ul"), 200, 40 * itemCount);
  wrapper.appendChild(ul);

  let firstPara: HTMLElement | null = null;
  for (let i = 0; i < itemCount; i++) {
    const li = withRect(document.createElement("li"), 200 + i * 40, 40, 140);
    li.setAttribute("data-uuid", `li${i + 1}`);
    li.setAttribute("data-text-object-kind", "listItem");
    const p = withRect(document.createElement("p"), 202 + i * 40, 36, 140);
    p.style.lineHeight = "36px";
    p.style.fontSize = "20px";
    li.appendChild(p);
    ul.appendChild(li);
    if (i === 0) firstPara = p;
  }
  document.body.appendChild(wrapper);
  return { wrapper, firstPara: firstPara! };
}

/**
 * The NESTED list shape: the `<ul>` itself carries the identity (no
 * `.list-title-wrapper`, because the par-title annotation is a top-level
 * affordance). This is the shape the wrapper table has NO branch for — the
 * top-level one is in the table by name and was therefore right by luck, which
 * is why an agreement leg written over it cannot fail.
 */
function buildBareList(itemCount = 3): { list: HTMLElement; firstPara: HTMLElement } {
  const ul = withRect(document.createElement("ul"), 200, 40 * itemCount);
  ul.setAttribute("data-uuid", "nested1");
  ul.setAttribute("data-text-object-kind", "bulletList");
  let firstPara: HTMLElement | null = null;
  for (let i = 0; i < itemCount; i++) {
    const li = withRect(document.createElement("li"), 200 + i * 40, 40, 140);
    li.setAttribute("data-uuid", `ni${i + 1}`);
    li.setAttribute("data-text-object-kind", "listItem");
    const p = withRect(document.createElement("p"), 202 + i * 40, 36, 140);
    p.style.lineHeight = "36px";
    p.style.fontSize = "20px";
    li.appendChild(p);
    ul.appendChild(li);
    if (i === 0) firstPara = p;
  }
  document.body.appendChild(ul);
  return { list: ul, firstPara: firstPara! };
}

describe("resolveFirstLineTarget — the composed descent", () => {
  it("a top-level bulletList resolves THROUGH to its first item's inner <p> — the wrapper half alone does not", () => {
    const { wrapper, firstPara } = buildList();
    expect(resolveFirstLineTarget(wrapper)).toBe(firstPara);
    // The shallow answer, stated so the two cannot silently converge: the
    // wrapper half sees `.list-title-wrapper`, descends to the first `<li>`'s
    // `<p>` by its OWN branch — the numbers agree here only because this
    // wrapper class happens to be in the table. Its real gap is the BARE list.
    const bare = withRect(document.createElement("ul"), 200, 120);
    bare.setAttribute("data-uuid", "l2");
    bare.setAttribute("data-text-object-kind", "bulletList");
    const li = withRect(document.createElement("li"), 200, 40, 140);
    li.setAttribute("data-uuid", "l2i1");
    li.setAttribute("data-text-object-kind", "listItem");
    const p = withRect(document.createElement("p"), 202, 36, 140);
    li.appendChild(p);
    bare.appendChild(li);
    document.body.appendChild(bare);

    expect(resolveInlineContextElement(bare)).toBe(bare); // the shallow answer
    expect(resolveFirstLineTarget(bare)).toBe(p); // the door's answer
    document.body.removeChild(bare);
    document.body.removeChild(wrapper);
  });

  it("a nested list descends through both levels, and the guard bounds the walk", () => {
    const outer = document.createElement("ul");
    outer.setAttribute("data-uuid", "o");
    outer.setAttribute("data-text-object-kind", "bulletList");
    const inner = document.createElement("ol");
    inner.setAttribute("data-uuid", "i");
    inner.setAttribute("data-text-object-kind", "orderedList");
    const li = document.createElement("li");
    li.setAttribute("data-uuid", "i1");
    li.setAttribute("data-text-object-kind", "listItem");
    const p = document.createElement("p");
    li.appendChild(p);
    inner.appendChild(li);
    outer.appendChild(inner);
    document.body.appendChild(outer);
    expect(resolveFirstLineTarget(outer)).toBe(p);
    document.body.removeChild(outer);
  });
});

describe("blockHasOwnTextLine — the two kinds that were wrong", () => {
  it("a latexComment has NO text line (it is not a schema atom, which is why it took the prose branch)", () => {
    const el = document.createElement("div");
    el.className = "latex-comment";
    el.setAttribute("data-uuid", "c1");
    el.setAttribute("data-text-object-kind", "latexComment");
    const content = document.createElement("div");
    content.className = "latex-comment-content";
    el.appendChild(content);
    expect(blockHasOwnTextLine(el)).toBe(false);
    // And the wrapper table has no branch for it, so the shallow answer would
    // have been the padded outer div — a marker ~4.8px above the real cap-band.
    expect(resolveInlineContextElement(el)).toBe(el);
  });

  it("a figureBlock has NO text line — matching the registry's `chromeAnchor: \"block-top\"`", () => {
    const el = document.createElement("div");
    el.className = "figure-block";
    el.setAttribute("data-uuid", "f1");
    el.setAttribute("data-text-object-kind", "figureBlock");
    expect(blockHasOwnTextLine(el)).toBe(false);
    expect(TEXT_OBJECT_REGISTRY.figureBlock.chromeAnchor).toBe("block-top");
  });

  it("a paragraph and a list both HAVE a text line, and only the list is a container", () => {
    const p = document.createElement("p");
    p.setAttribute("data-uuid", "p1");
    p.setAttribute("data-text-object-kind", "paragraph");
    expect(blockHasOwnTextLine(p)).toBe(true);
    expect(isTextLineContainer(p)).toBe(false);

    const { wrapper } = buildList(1);
    expect(blockHasOwnTextLine(wrapper)).toBe(true);
    expect(isTextLineContainer(wrapper)).toBe(true);
    document.body.removeChild(wrapper);
  });

  it("fails OPEN on an unstamped element — an un-decorated NodeView keeps the text branch", () => {
    const el = document.createElement("div");
    expect(blockHasOwnTextLine(el)).toBe(true);
    expect(isTextLineContainer(el)).toBe(false);
  });
});

// ── D. The two surfaces that disagreed ─────────────────────────────────────

/** A fake editor whose `nodeDOM` returns `dom` and whose `coordsAtPos` returns
 *  a sentinel — any result equal to it proves a caret branch is live. */
function fakeEditor(dom: HTMLElement): Editor {
  return {
    view: {
      nodeDOM: () => dom,
      coordsAtPos: () => ({ top: 9999, bottom: 9999, left: 0, right: 0 }),
    },
  } as unknown as Editor;
}

const HOST_RECT = rect(0, 0, 0);

/** The marker centre the grid renders for row 0 = `top + lineHeight/2` — the
 *  block's optical centre, the number the grab handle seats on. */
function markerCenter(m: { top: number; lineHeight: number }): number {
  return m.top + m.lineHeight / 2;
}

describe("measureBlock and resolveBlockFrame agree on the block's first line", () => {
  it("a NESTED bulletList: the marginalia marker's row-0 centre IS the frame's opticalCenterY", () => {
    // The bare shape deliberately. `.list-title-wrapper` is a named row in the
    // wrapper table, so the TOP-LEVEL list already agreed pre-fix — an
    // agreement leg written over it is a leg that cannot fail, which is worse
    // than no leg when it is dressed as the proof. The nested list is the
    // shape the table has never heard of, and it is the one a card anchored to
    // a sub-list actually gets.
    const { list, firstPara } = buildBareList(3);
    const m = measureBlock(fakeEditor(list), 1, false, HOST_RECT, "nested1")!;
    const frame = resolveBlockFrame(list);

    // jsdom has no canvas, so `capBandCenterOffset` is 0 and both reduce to the
    // resolved target's line-box top. Stated as the FRAME's answer rather than
    // as a literal, so the two sides cannot drift together.
    expect(frame.target).toBe(firstPara);
    expect(markerCenter(m)).toBeCloseTo(frame.opticalCenterY, 3);
    // And explicitly NOT the container's own top — the pre-fix answer, which is
    // where the card sat while the grab handle for the same block sat 2px down
    // on the item's `<p>`.
    expect(markerCenter(m)).not.toBeCloseTo(
      list.getBoundingClientRect().top,
      1,
    );
    document.body.removeChild(list);
  });

  it("a TOP-LEVEL bulletList agrees too — a NET, not the proof: it agreed before the fix as well", () => {
    const { wrapper, firstPara } = buildList(3);
    const m = measureBlock(fakeEditor(wrapper), 1, false, HOST_RECT, "list1")!;
    const frame = resolveBlockFrame(wrapper);
    expect(frame.target).toBe(firstPara);
    expect(markerCenter(m)).toBeCloseTo(frame.opticalCenterY, 3);
    document.body.removeChild(wrapper);
  });

  it("a bulletList's row capacity divides the LIST's height by the ITEM's pitch", () => {
    // Three 40px rows in a 120px list, each `<p>` a 36px line box. The rows are
    // the list's, the pitch is the prose's. Pre-fix the numerator was right and
    // the DENOMINATOR was the container's inherited leading — and
    // `metricsWithinEpsilon` compares `lineCount` EXACTLY, so the wrong value
    // was never absorbed as sub-pixel wobble.
    const { list } = buildBareList(3);
    const m = measureBlock(fakeEditor(list), 1, false, HOST_RECT, "nested1")!;
    expect(m.lineHeight).toBeCloseTo(36, 3);
    expect(m.lineCount).toBe(Math.round(120 / 36));
    document.body.removeChild(list);
  });

  it("a latexComment takes the BORDER-BOX branch even though the schema says it is not an atom", () => {
    const el = withRect(document.createElement("div"), 300, 30);
    el.className = "latex-comment";
    el.setAttribute("data-uuid", "c1");
    el.setAttribute("data-text-object-kind", "latexComment");
    const content = withRect(document.createElement("div"), 306, 18);
    content.className = "latex-comment-content";
    content.style.lineHeight = "18px";
    el.appendChild(content);
    document.body.appendChild(el);

    // `isAtom: false` — the caller's SCHEMA fact, passed through unchanged, and
    // exactly what made this block take the prose branch before task 660.
    const m = measureBlock(fakeEditor(el), 1, false, HOST_RECT, "c1")!;
    expect(m.isAtom).toBe(false);
    expect(m.top).toBeCloseTo(300, 3);
    expect(m.lineHeight).toBeCloseTo(30, 3);
    expect(m.lineCount).toBe(1);
    // The prose branch's answer, which is what it used to return: an optical
    // centre on the OUTER div's padded top, ~6px above the real cap-band.
    expect(markerCenter(m)).not.toBeCloseTo(300 + 30 / 2 - 15, 1);
    document.body.removeChild(el);
  });

  it("a figureBlock takes the border-box branch, matching its registry chromeAnchor", () => {
    const el = withRect(document.createElement("div"), 400, 260);
    el.className = "figure-block";
    el.setAttribute("data-uuid", "f1");
    el.setAttribute("data-text-object-kind", "figureBlock");
    document.body.appendChild(el);
    const m = measureBlock(fakeEditor(el), 1, false, HOST_RECT, "f1")!;
    expect(m.top).toBeCloseTo(400, 3);
    expect(m.lineHeight).toBeCloseTo(260, 3);
    expect(m.lineCount).toBe(1);
    document.body.removeChild(el);
  });

  it("an ordinary paragraph is untouched by all of it", () => {
    const p = withRect(document.createElement("p"), 500, 24);
    p.setAttribute("data-uuid", "p1");
    p.setAttribute("data-text-object-kind", "paragraph");
    p.style.lineHeight = "24px";
    document.body.appendChild(p);
    const m = measureBlock(fakeEditor(p), 1, false, HOST_RECT, "p1")!;
    expect(markerCenter(m)).toBeCloseTo(500, 3);
    expect(m.lineCount).toBe(1);
    document.body.removeChild(p);
  });
});
