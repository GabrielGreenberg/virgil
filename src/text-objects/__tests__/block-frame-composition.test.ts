// @vitest-environment jsdom
/**
 * Task 663 — **the geometry SSOT's own COMPOSITION.**
 *
 * `block-frame.ts` exists so every margin affordance reads ONE resolve and they
 * align by construction. Its PARTS were well covered — `resolveMarkerGeometry`,
 * `resolveMarginEm`, `resolveChevronColumnRight` and `resolveHandleLane` each
 * have real legs — and the ASSEMBLY had none. Every leg reached
 * `resolveBlockFrame` through a consumer, and the consumers only ever read
 * `contentLeft` / `contentWidth`; `selection-handle-marker-left.test.ts` builds
 * a `BlockFrame` literal by hand rather than resolving one. So nothing asserted
 * an `opticalCenterY`, a `gapPx`, a `markerLeft`, a `columnRight` or a
 * `chevronRight` **as composed by `resolveBlockFrame`**, and `contentRight` —
 * the figure chrome's "beside" anchor — had no mention in any test file at all.
 *
 * The two fields the module added most recently were the two with the least
 * cover, and the frame whose whole promise is "by construction" had no leg
 * proving the construction. Task 659 is what that costs: the top-level-list
 * shape went unnoticed because no fixture built it.
 *
 * This suite drives the REAL `resolveBlockFrame` over one faithful fixture per
 * kind family and asserts EVERY field of the frame it returns. The fixtures are
 * the shared builder in `_block-frame-fixtures.ts` — the DOM knowledge has one
 * home, so a shape production renders cannot go unbuilt in the way 659's did.
 *
 * Expectations are stated ARITHMETICALLY from the fixture's own numbers
 * (`FIXTURE`, `modelTextWidth`, `capBandCenterOffsetModel`), never by restating
 * the production expression — a leg that computes what the code computes cannot
 * tell a right answer from a consistent one.
 *
 * It COMPOSES with, rather than duplicates, the suites that already own a part:
 * `block-frame-chevron-read-budget.test.ts` owns the chevron branch's read
 * budget + token provenance, `resolve-margin-em.test.ts` the interpreter's
 * rungs, `marker-left-fallback.test.ts` the #49 fallback direction, and
 * `handle-marker-ink-clearance.test.tsx` the ink bound the lane derives.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveBlockFrame, resolveContentEdges } from "@/text-objects/block-frame";
import { clearCapTopCache } from "@/lib/text-metrics";
import {
  FIXTURE,
  buildExampleBlock,
  buildExampleItem,
  buildFigure,
  buildHeading,
  buildNestedList,
  buildParagraph,
  buildSourcePod,
  buildTopLevelList,
  capBandCenterOffsetModel,
  modelTextWidth,
  stubCanvas,
} from "./_block-frame-fixtures";

const { editorLeft: LEFT, top: TOP, width: WIDTH, bandPx: BAND } = FIXTURE;
const PROSE = FIXTURE.fontSizePx;
const GAP = FIXTURE.gapEm * PROSE; // 10
const TRACK = FIXTURE.trackEm * PROSE; // 20
const CHEVRON_RIGHT = LEFT + FIXTURE.chevronOffsetPx + FIXTURE.chevronWidthPx;
/** Where this fixture's "browser" paints a list marker's leftmost ink: the
 *  measured string, minus `MARKER_TRAIL_EM`'s allowance for the counter
 *  suffix's trailing space. Spelled from the FIXTURE's model, so a leg checks
 *  the estimate against the world rather than against itself. */
const MARKER_TRAIL_EM = 0.25;
function paintedMarkerInkLeft(text: string, itemLeft: number, fs = PROSE): number {
  return itemLeft - modelTextWidth(text, fs) - fs * MARKER_TRAIL_EM;
}

/** Every field of a resolved frame, so a leg can assert the WHOLE thing and a
 *  field added later cannot slip in unasserted. */
function snapshot(el: HTMLElement) {
  const f = resolveBlockFrame(el);
  return {
    el: f.el,
    target: f.target,
    firstLineRect: {
      left: f.firstLineRect.left,
      top: f.firstLineRect.top,
      width: f.firstLineRect.width,
    },
    opticalCenterY: f.opticalCenterY,
    contentLeft: f.contentLeft,
    contentWidth: f.contentWidth,
    contentRight: f.contentRight,
    markerLeft: f.markerLeft,
    columnRight: f.columnRight,
    chevronRight: f.chevronRight,
    inkLeft: f.inkLeft,
    gapPx: f.gapPx,
  };
}

beforeEach(() => {
  clearCapTopCache();
  stubCanvas();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  clearCapTopCache();
});

describe("resolveBlockFrame — markerless prose (the baseline)", () => {
  it("composes every field for a plain paragraph", () => {
    const { block } = buildParagraph();
    expect(snapshot(block)).toEqual({
      el: block,
      target: block, // a bare <p> matches no wrapper branch: it IS its own line
      firstLineRect: { left: LEFT, top: TOP, width: WIDTH },
      opticalCenterY: TOP + capBandCenterOffsetModel(PROSE),
      contentLeft: LEFT,
      contentWidth: WIDTH,
      contentRight: LEFT + WIDTH,
      // No marker of its own, and no column above it → the prose IS the ink and
      // the anchor, and the handle takes the ordinary gutter slot.
      markerLeft: LEFT,
      columnRight: null,
      chevronRight: null,
      inkLeft: LEFT,
      gapPx: GAP,
    });
  });

  it("scales the em gap with the block's OWN font, not a constant", () => {
    const { block } = buildParagraph({ fontSizePx: 24 });
    const f = resolveBlockFrame(block);
    expect(f.gapPx).toBeCloseTo(FIXTURE.gapEm * 24, 5);
    expect(f.opticalCenterY).toBeCloseTo(TOP + capBandCenterOffsetModel(24), 5);
  });
});

describe("resolveBlockFrame — heading (the wrapper/target split)", () => {
  it("composes from the TARGET for text and the BLOCK for the chevron column", () => {
    const { block, heading } = buildHeading(2);
    const headingFont = PROSE * 1.5; // the display font the fixture gives <h2>
    expect(snapshot(block)).toEqual({
      el: block,
      // The `.heading-wrapper` hosts the section pod; the <h2> carries the line.
      target: heading,
      firstLineRect: {
        left: LEFT + FIXTURE.targetLeftInset,
        top: TOP + FIXTURE.targetTopInset,
        width: WIDTH - FIXTURE.targetLeftInset,
      },
      opticalCenterY:
        TOP + FIXTURE.targetTopInset + capBandCenterOffsetModel(headingFont),
      contentLeft: LEFT + FIXTURE.targetLeftInset,
      contentWidth: WIDTH - FIXTURE.targetLeftInset,
      contentRight: LEFT + WIDTH,
      markerLeft: LEFT + FIXTURE.targetLeftInset,
      columnRight: null,
      // Measured from the BLOCK's border-box left (200), not the <h2>'s (210) —
      // the chevron's positioning origin is `.heading-wrapper`.
      chevronRight: CHEVRON_RIGHT,
      inkLeft: LEFT + FIXTURE.targetLeftInset,
      gapPx: FIXTURE.gapEm * headingFont,
    });
  });
});

describe("resolveBlockFrame — source pods (target IS the block)", () => {
  for (const kind of ["texBlock", "forestBlock"] as const) {
    it(`composes every field for a ${kind}`, () => {
      const { block } = buildSourcePod(kind);
      expect(snapshot(block)).toEqual({
        el: block,
        // The `[data-uuid]` node DOM is the `.react-renderer` wrapper, which
        // matches no descent branch — so the frame's target is the block.
        target: block,
        firstLineRect: { left: LEFT, top: TOP, width: WIDTH },
        opticalCenterY: TOP + capBandCenterOffsetModel(PROSE),
        contentLeft: LEFT,
        contentWidth: WIDTH,
        contentRight: LEFT + WIDTH,
        markerLeft: LEFT,
        columnRight: null,
        chevronRight: CHEVRON_RIGHT,
        inkLeft: LEFT,
        gapPx: GAP,
      });
    });
  }
});

describe("resolveBlockFrame — list item (the measured marker band)", () => {
  it("composes every field, with the band read off the <ul>", () => {
    const { items, itemLeft } = buildNestedList("ul");
    const ink = paintedMarkerInkLeft("•", itemLeft);
    expect(snapshot(items[0])).toEqual({
      el: items[0],
      target: items[0].querySelector("p"),
      firstLineRect: {
        left: itemLeft,
        top: TOP + FIXTURE.targetTopInset,
        width: WIDTH - BAND,
      },
      opticalCenterY:
        TOP + FIXTURE.targetTopInset + capBandCenterOffsetModel(PROSE),
      contentLeft: itemLeft,
      contentWidth: WIDTH - BAND,
      contentRight: LEFT + WIDTH,
      // An item's own marker column is FULL on its row, so it HUGS the glyph
      // and the anchor and the ink are one number.
      markerLeft: ink,
      columnRight: null,
      chevronRight: null,
      inkLeft: ink,
      gapPx: GAP,
    });
    // The anchor is the MEASURED string, not the band middle — the band middle
    // (`itemLeft − band/2`) is the fallback for a build that cannot measure.
    expect(ink).not.toBeCloseTo(itemLeft - BAND / 2, 1);
  });

  it("a wide `10.` counter reads FURTHER LEFT than a bullet", () => {
    const { items, itemLeft } = buildNestedList("ol", { itemCount: 10 });
    const f = resolveBlockFrame(items[0]);
    expect(f.inkLeft).toBeCloseTo(paintedMarkerInkLeft("10.", itemLeft), 5);
    expect(f.inkLeft).toBeLessThan(paintedMarkerInkLeft("•", itemLeft));
  });

  it("an item with no list ancestor falls back to contentLeft", () => {
    // `resolveMarkerGeometry`'s `closest("ul, ol")` → null branch. Unreachable
    // in the document (a `listItem` is always inside its list) and reachable in
    // a float / an unfaithful clone that kept the item and dropped the list.
    const orphan = document.createElement("li");
    orphan.setAttribute("data-uuid", "orphan");
    orphan.setAttribute("data-text-object-kind", "listItem");
    const p = document.createElement("p");
    p.style.fontSize = `${PROSE}px`;
    p.style.setProperty("--margin-handle-gap", `${FIXTURE.gapEm}em`);
    orphan.appendChild(p);
    document.body.appendChild(orphan);
    p.getBoundingClientRect = () =>
      ({ left: 260, top: TOP, right: 760, bottom: TOP + 40, width: 500, height: 40, x: 260, y: TOP, toJSON: () => ({}) }) as DOMRect;
    const f = resolveBlockFrame(orphan);
    expect(f.markerLeft).toBe(260);
    expect(f.inkLeft).toBe(260);
    expect(f.columnRight).toBeNull();
  });
});

describe("resolveBlockFrame — the two list SHAPES (task 659)", () => {
  it("a NESTED list inside an item OCCUPIES the column above it", () => {
    const { block, list, itemLeft } = buildNestedList("ul", { insideItem: true });
    const ink = paintedMarkerInkLeft("•", itemLeft);
    expect(snapshot(block)).toEqual({
      el: list,
      target: list.querySelector("p"),
      firstLineRect: {
        left: itemLeft,
        top: TOP + FIXTURE.targetTopInset,
        width: WIDTH - BAND,
      },
      opticalCenterY:
        TOP + FIXTURE.targetTopInset + capBandCenterOffsetModel(PROSE),
      contentLeft: itemLeft,
      contentWidth: WIDTH - BAND,
      contentRight: LEFT + WIDTH,
      // Markerless container: its anchor is its OWN border-box left, and
      // because its parent is a `listItem` that left IS a column it may sit in.
      markerLeft: LEFT,
      columnRight: LEFT,
      chevronRight: null,
      // Its ink is its first ITEM's bullet — same row, same boundary.
      inkLeft: ink,
      gapPx: GAP,
    });
  });

  it("a TOP-LEVEL list has no column above it and reads its band off the <ol>", () => {
    const { block, list, itemLeft } = buildTopLevelList("ol");
    // The post-659 answer: `decimal` + the 40px band, read off the `<ol>`. Read
    // off the `.list-title-wrapper` instead — `padding-left: 0`, inherited
    // `disc` — this would be the BULLET's ink, ~8px further RIGHT, i.e. wrong
    // in the unsafe direction for every top-level numbered list in the app.
    const ink = paintedMarkerInkLeft("1.", itemLeft);
    expect(ink).toBeLessThan(paintedMarkerInkLeft("•", itemLeft));
    expect(snapshot(block)).toEqual({
      el: block,
      target: list.querySelector("p"),
      firstLineRect: {
        left: itemLeft,
        top: TOP + FIXTURE.targetTopInset,
        width: WIDTH - BAND,
      },
      opticalCenterY:
        TOP + FIXTURE.targetTopInset + capBandCenterOffsetModel(PROSE),
      contentLeft: itemLeft,
      contentWidth: WIDTH - BAND,
      contentRight: LEFT + WIDTH,
      markerLeft: LEFT,
      // Nothing uuid-bearing above it → no column to occupy → it reads as an
      // ordinary markerless block and takes the paragraph gutter slot.
      columnRight: null,
      chevronRight: null,
      inkLeft: ink,
      gapPx: GAP,
    });
  });

  it("honours `<ol start>` when sizing the widest marker", () => {
    // `markerProbeText`'s `start` branch — nothing had ever set it.
    const { block, itemLeft } = buildTopLevelList("ol", { itemCount: 3, start: 8 });
    // start 8 + 3 items → the widest row is `10.`
    expect(resolveBlockFrame(block).inkLeft).toBeCloseTo(
      paintedMarkerInkLeft("10.", itemLeft),
      5,
    );
  });

  it("a `reversed` list counts DOWN, so its widest marker is the FIRST", () => {
    // `markerProbeText`'s `reversed` branch — likewise never set.
    //
    // The numbers straddle a DIGIT-COUNT boundary on purpose: the fixture's
    // width model gives every digit one width, so `12.` and `14.` measure the
    // same and a leg written on those two would pass whether the `reversed`
    // branch existed or not. Reversed from 9 over 3 rows means the widest row is
    // `9.`; forwards it would be `11.` — one digit against two.
    const { block, itemLeft } = buildTopLevelList("ol", {
      itemCount: 3,
      start: 9,
      reversed: true,
    });
    expect(resolveBlockFrame(block).inkLeft).toBeCloseTo(
      paintedMarkerInkLeft("9.", itemLeft),
      5,
    );
    expect(resolveBlockFrame(block).inkLeft).toBeGreaterThan(
      paintedMarkerInkLeft("11.", itemLeft),
    );
  });

  it("an un-modeled counter style is answered with the WHOLE band", () => {
    const { block, itemLeft } = buildTopLevelList("ol", {
      listStyleType: "upper-roman",
    });
    // `null` from `markerProbeText` → assume the marker fills its band. The
    // conservative direction: further left than any glyph could reach.
    expect(resolveBlockFrame(block).inkLeft).toBe(itemLeft - BAND);
  });

  it("`list-style-type: none` puts the ink at the item's own content edge", () => {
    const { block, itemLeft } = buildTopLevelList("ul", { listStyleType: "none" });
    expect(resolveBlockFrame(block).inkLeft).toBe(itemLeft);
  });

  it("a container with NO grabbable child falls back to contentLeft for ink", () => {
    // The container no-child branch. `resolveFirstLineTarget` also finds no
    // child, so the target is the wrapper itself and `contentLeft` is its own
    // left — which is then both the anchor and the ink.
    const { block } = buildTopLevelList("ul", { itemCount: 0 });
    const f = resolveBlockFrame(block);
    expect(f.target).toBe(block);
    expect(f.contentLeft).toBe(LEFT);
    expect(f.inkLeft).toBe(LEFT);
    expect(f.markerLeft).toBe(LEFT);
  });
});

describe("resolveBlockFrame — expex (a DOM marker, not a pseudo)", () => {
  it("composes every field for an exampleItem", () => {
    const { block, paragraph } = buildExampleItem();
    const bodyLeft = LEFT + FIXTURE.targetLeftInset;
    expect(snapshot(block)).toEqual({
      el: block,
      target: paragraph, // `.expex-item` → `.expex-item-body p`
      firstLineRect: {
        left: bodyLeft,
        top: TOP + FIXTURE.targetTopInset,
        width: WIDTH - FIXTURE.targetLeftInset,
      },
      opticalCenterY:
        TOP + FIXTURE.targetTopInset + capBandCenterOffsetModel(PROSE),
      contentLeft: bodyLeft,
      contentWidth: WIDTH - FIXTURE.targetLeftInset,
      contentRight: LEFT + WIDTH,
      // `.expex-item-marker` is a real element: its rect IS the ink, so nothing
      // is estimated and the two fields are one measurement.
      markerLeft: LEFT,
      columnRight: null,
      chevronRight: null,
      inkLeft: LEFT,
      gapPx: GAP,
    });
  });

  it("composes every field for an exampleBlock (a container with a marker)", () => {
    const { block, items } = buildExampleBlock();
    const itemLeft = LEFT + FIXTURE.targetLeftInset * 2;
    const bodyLeft = itemLeft + FIXTURE.targetLeftInset;
    expect(snapshot(block)).toEqual({
      el: block,
      // Container: the descent recurses into the first `.expex-item` and on to
      // that item's inner `<p>` — never the `(n)` chip's `0.95em` metrics.
      target: items[0].paragraph,
      firstLineRect: {
        left: bodyLeft,
        top: TOP + FIXTURE.targetTopInset,
        width: WIDTH - FIXTURE.targetLeftInset * 3,
      },
      opticalCenterY:
        TOP + FIXTURE.targetTopInset + capBandCenterOffsetModel(PROSE),
      contentLeft: bodyLeft,
      contentWidth: WIDTH - FIXTURE.targetLeftInset * 3,
      contentRight: LEFT + WIDTH,
      // Its `(n)` is a measured element, so — like an item — it HUGS rather
      // than occupying a column, even though it is a container.
      markerLeft: LEFT,
      columnRight: null,
      chevronRight: null,
      inkLeft: LEFT,
      gapPx: GAP,
    });
  });
});

describe("BlockFrame.contentRight (chip 4b — the figure chrome's anchor)", () => {
  it("is the first line's RIGHT edge, and equals contentLeft + contentWidth", () => {
    const { block } = buildParagraph({ left: 140, width: 380 });
    const f = resolveBlockFrame(block);
    expect(f.contentRight).toBe(520);
    expect(f.contentRight).toBe(f.contentLeft + f.contentWidth);
    expect(f.contentRight).toBe(f.firstLineRect.right);
  });

  it("follows the box handed in — the figure HUG box, not its full-width host", () => {
    // The chrome's one subtlety (`FigureBlockNodeView`): a figure's `[data-uuid]`
    // node DOM is the full-COLUMN-width `.react-renderer` host — the box the
    // drop indicator correctly spans — while the chrome's "beside" anchor has
    // to hug the RENDERED IMAGE, so it resolves the frame on the inner
    // `.figure-block`. Two different right edges from one resolve, which is
    // only true because `contentRight` follows the element.
    const { host, hug } = buildFigure({ hugWidth: 220 });
    expect(resolveBlockFrame(host).contentRight).toBe(LEFT + WIDTH);
    expect(resolveBlockFrame(hug).contentRight).toBe(LEFT + 220);
  });

  it("the lean `resolveContentEdges` door agrees with the composed frame", () => {
    // The drop indicator takes `resolveContentEdges` directly to skip the
    // marker work; the frame COMPOSES it. Same numbers, by construction.
    const { items } = buildNestedList("ol", { itemCount: 4 });
    const frame = resolveBlockFrame(items[0]);
    const edges = resolveContentEdges(items[0]);
    expect(edges.target).toBe(frame.target);
    expect(edges.contentLeft).toBe(frame.contentLeft);
    expect(edges.contentWidth).toBe(frame.contentWidth);
    expect(edges.contentRight).toBe(frame.contentRight);
  });
});

describe("the fixture builder is the ONE home for this DOM (task 663)", () => {
  // A shared builder that nothing reaches is a second copy, not a replacement —
  // and the copy a new suite finds is whichever one is nearest. So the boundary
  // is held by a census rather than by a comment in the module.
  const SRC = join(process.cwd(), "src");

  /** This file, which is excluded from its own sweep: it carries the patterns it
   *  searches for as regex literals, so it matches itself and nothing else. */
  const SELF = "text-objects/__tests__/block-frame-composition.test.ts";

  function testFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.test\.tsx?$/.test(name) || name.startsWith("_")) out.push(full);
      }
    };
    walk(SRC);
    return out.filter((f) => relative(SRC, f) !== SELF);
  }

  /**
   * Files allowed to CONSTRUCT a `.list-title-wrapper` themselves, each with the
   * reason it is not the builder's job. An entry is an argument, not an
   * exemption: a new suite needing this shape comes through the builder, or
   * states here why it cannot.
   */
  const LIST_WRAPPER_BUILDERS: Record<string, string> = {
    "text-objects/__tests__/_block-frame-fixtures.ts":
      "the builder itself — the door this census exists to keep singular",
    "lib/__tests__/first-line-target-census.test.ts":
      "task 660's census builds the top-level AND the bare shape SIDE BY SIDE to " +
      "show the wrapper table is right by luck on one and has no branch for the " +
      "other; those two fixtures ARE its argument, so they stay local to it",
    "lib/__tests__/text-metrics.test.ts":
      "exercises `resolveInlineContextElement`'s class table directly with a bare " +
      "markup string — no uuid, no kind, no geometry, so nothing a block-frame " +
      "fixture provides is in play",
  };

  it("nothing else hand-rolls the top-level-list shape", () => {
    // The shape task 659 turned on: uuid/kind on a `.list-title-wrapper` div,
    // band + counter on the `<ul>`/`<ol>` inside it. No fixture built it, so the
    // band was measured on a div — `padding-left: 0`, inherited `disc` — for
    // every top-level numbered list in the app, and nothing failed.
    const CONSTRUCTS = /(?:className\s*=\s*"list-title-wrapper|class="list-title-wrapper)/;
    const offenders = testFiles()
      .filter((f) => CONSTRUCTS.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f))
      .filter((rel) => !(rel in LIST_WRAPPER_BUILDERS));
    expect(offenders).toEqual([]);
  });

  it("every allowlisted builder still exists", () => {
    // An allowlist that outlives its entries stops being a boundary and starts
    // being a list of names.
    const constructing = new Set(
      testFiles()
        .filter((f) =>
          /(?:className\s*=\s*"list-title-wrapper|class="list-title-wrapper)/.test(
            readFileSync(f, "utf8"),
          ),
        )
        .map((f) => relative(SRC, f)),
    );
    for (const rel of Object.keys(LIST_WRAPPER_BUILDERS)) {
      expect(constructing.has(rel), `${rel} no longer builds one`).toBe(true);
    }
  });

  it("the canvas width model exists once", () => {
    // The fixture IS the world the production estimate is checked against. Two
    // copies of that world can drift apart without either suite failing, which
    // would leave a marker-ink leg comparing a good estimate to a stale model.
    const owners = testFiles()
      .filter((f) => /\bDIGIT_EM\b/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(owners).toEqual(["text-objects/__tests__/_block-frame-fixtures.ts"]);
  });

  it("the two list builders stay two — the nested shape has no wrapper", () => {
    // The 659 invariant, as a structural fact rather than a comment: collapsing
    // them into one function with a flag is how they came to be conflated.
    const nested = buildNestedList("ol");
    expect(nested.block.tagName).toBe("OL");
    expect(nested.block.closest(".list-title-wrapper")).toBeNull();
    const top = buildTopLevelList("ol");
    expect(top.block.classList.contains("list-title-wrapper")).toBe(true);
    expect(top.block).not.toBe(top.list);
    expect(top.list.tagName).toBe("OL");
  });
});
