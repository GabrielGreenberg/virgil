/**
 * _block-frame-fixtures.ts — the ONE faithful-DOM fixture builder for the
 * geometry SSOT's suites (task 663).
 *
 * `block-frame.ts` resolves a block's frame from its rendered DOM and nothing
 * else, so a suite that hand-rolls an *approximation* of that DOM tests an
 * approximation of the resolve. Task 659 is the cost: the top-level-list shape
 * — a `.list-title-wrapper` **div** carrying the uuid/kind, with the band
 * (`padding-left`) and the counter (`list-style-type`) on the `<ul>`/`<ol>`
 * INSIDE it — was never built by any fixture, because every fixture stamped the
 * kind straight onto the list the way the NESTED shape does. The band was
 * therefore measured on a div (`padding-left: 0`, inherited `disc`) for every
 * top-level numbered list in the app, and nothing failed.
 *
 * So "what the DOM actually looks like" is knowledge with ONE home rather than
 * one copy per suite. Each builder here mirrors a real renderer, named beside
 * it, and the two list shapes are deliberately SEPARATE functions — collapsing
 * them back is precisely how 659 happened.
 *
 * jsdom lays nothing out, so a fixture also has to supply the boxes the resolve
 * reads: every builder stubs `getBoundingClientRect` on the elements the
 * resolve touches ({@link stubRect}), and can record the reads so a suite can
 * count them per element ({@link BlockBoxOptions.reads}). jsdom has no 2D
 * context either, so the measured half of the marker-ink boundary needs
 * {@link stubCanvas} — whose width/metric model is stated here, once, with
 * {@link modelTextWidth} and {@link capBandCenterOffsetModel} as the fixture's
 * own arithmetic. A leg that wants to know what the fixture PAINTS asks those,
 * never the production estimate it is checking.
 */

import { vi } from "vitest";

/**
 * The fixture world's geometry, in one block so a leg can state an expectation
 * arithmetically rather than as a magic number. The em tokens and the marker
 * band carry the values `globals.css` ships (pinned against it by
 * `handle-marker-ink-clearance.test.tsx`).
 */
export const FIXTURE = {
  /** Viewport left of the editor's text column — the default block-box left. */
  editorLeft: 200,
  /** Default block-box width. */
  width: 500,
  /** Default block box top / bottom. */
  top: 300,
  bottom: 340,
  /** Inset of a descended text target's box inside its wrapper's, so a leg can
   *  tell "read the wrapper" from "read the target" by the number alone. */
  targetTopInset: 2,
  targetLeftInset: 10,
  /** The editor's nominal prose font-size. */
  fontSizePx: 16,
  /** `--margin-handle-gap` / `--margin-track-width`, as authored (em). */
  gapEm: 0.625,
  trackEm: 1.25,
  /** `.tiptap ul/ol { padding-left }` — the shipped marker band (2.5em @16px). */
  bandPx: 40,
  /** `--margin-col-chevron` / `--margin-col-chevron-width`, as authored (px). */
  chevronOffsetPx: -44,
  chevronWidthPx: 14,
} as const;

/** A DOMRect from its edges — jsdom's own constructor is not available. */
export function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * Give `el` a fixed box. When `reads` is supplied every read is appended to it,
 * so a suite can count reads PER ELEMENT (the convention
 * `block-frame-chevron-read-budget.test.ts` set — a total pins an incidental
 * sum, a per-element count names the duplicate).
 */
export function stubRect(
  el: HTMLElement,
  box: DOMRect,
  reads?: HTMLElement[],
): void {
  el.getBoundingClientRect = () => {
    reads?.push(el);
    return box;
  };
}

/** Per-character width model for the canvas stub. Ratios are em fractions in
 *  the ballpark of a serif text face; nothing depends on their exact values,
 *  only on a two-digit counter being materially wider than a bullet. */
const CHAR_EM: Record<string, number> = { "•": 0.35, ".": 0.28 };
const DIGIT_EM = 0.55;

/** What {@link stubCanvas} reports `text` measures at `fontSizePx`. */
export function modelTextWidth(text: string, fontSizePx: number): number {
  let w = 0;
  for (const ch of text) {
    w += (/[0-9]/.test(ch) ? DIGIT_EM : (CHAR_EM[ch] ?? 0.5)) * fontSizePx;
  }
  return w;
}

/** The font metrics {@link stubCanvas} reports, as em fractions. */
const CAP_HEIGHT_EM = 0.7; // actualBoundingBoxAscent
const ASCENT_EM = 0.9; // fontBoundingBoxAscent
const DESCENT_EM = 0.2; // fontBoundingBoxDescent

/**
 * `capBandCenterOffset` for a target of `fontSizePx` under {@link stubCanvas},
 * with an unspecified `line-height` (so `resolveLineHeightPx` answers
 * `fontSize * 1.2`) — the fixture's own arithmetic, not the production
 * expression, so a leg asserting `opticalCenterY` is checking the composition
 * rather than restating it.
 *
 * `halfLeading + (ascent − capHeight) + capHeight / 2`, i.e.
 * `(1.2 − 1.1)/2 + (0.9 − 0.7) + 0.35 = 0.6` em.
 */
export function capBandCenterOffsetModel(
  fontSizePx: number = FIXTURE.fontSizePx,
): number {
  const lineHeight = fontSizePx * 1.2;
  const ascent = fontSizePx * ASCENT_EM;
  const descent = fontSizePx * DESCENT_EM;
  const capHeight = fontSizePx * CAP_HEIGHT_EM;
  const halfLeading = (lineHeight - (ascent + descent)) / 2;
  const capTop = Math.max(halfLeading + (ascent - capHeight), 0);
  return capTop + capHeight / 2;
}

/**
 * Install a deterministic 2D context. jsdom returns `null` from
 * `getContext("2d")`, which every measurement in `text-metrics.ts` reads as "no
 * opinion" — so without this the measured marker ink and every font metric
 * degrade to their fallbacks and the branches that matter are never reached.
 */
export function stubCanvas(): void {
  const ctx = {
    font: `${FIXTURE.fontSizePx}px serif`,
    measureText(text: string) {
      const fs = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? "16");
      return {
        width: modelTextWidth(text, fs),
        actualBoundingBoxAscent: fs * CAP_HEIGHT_EM,
        fontBoundingBoxAscent: fs * ASCENT_EM,
        fontBoundingBoxDescent: fs * DESCENT_EM,
      } as unknown as TextMetrics;
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
}

/** Shared knobs every builder takes. */
export interface BlockBoxOptions {
  /** Where to append the block. Default `document.body`. */
  parent?: HTMLElement;
  /** Viewport left of the BLOCK box. Default {@link FIXTURE.editorLeft}. */
  left?: number;
  /** Block-box width. Default {@link FIXTURE.width}. */
  width?: number;
  /** Block-box top. Default {@link FIXTURE.top}. */
  top?: number;
  /** Block-box height. Default `FIXTURE.bottom − FIXTURE.top`. */
  height?: number;
  /** Font-size for the text target. Default {@link FIXTURE.fontSizePx}. */
  fontSizePx?: number;
  /** `data-uuid` on the block element. */
  uuid?: string;
  /** Collect every stubbed rect read, in call order. */
  reads?: HTMLElement[];
}

interface Resolved {
  parent: HTMLElement;
  left: number;
  width: number;
  top: number;
  height: number;
  fontSizePx: number;
  uuid: string;
  reads?: HTMLElement[];
}

function opts(o: BlockBoxOptions = {}): Resolved {
  return {
    parent: o.parent ?? document.body,
    left: o.left ?? FIXTURE.editorLeft,
    width: o.width ?? FIXTURE.width,
    top: o.top ?? FIXTURE.top,
    height: o.height ?? FIXTURE.bottom - FIXTURE.top,
    fontSizePx: o.fontSizePx ?? FIXTURE.fontSizePx,
    uuid: o.uuid ?? "b1",
    reads: o.reads,
  };
}

/**
 * The em margin tokens, on the element the resolve reads them from. jsdom
 * inherits custom properties through `getComputedStyle`, exactly as a browser
 * does, so stating them on the BLOCK is faithful to `:root` authorship and
 * still lets a leg override one on a descendant to test provenance.
 */
export function applyMarginTokens(el: HTMLElement): void {
  el.style.setProperty("--margin-handle-gap", `${FIXTURE.gapEm}em`);
  el.style.setProperty("--margin-track-width", `${FIXTURE.trackEm}em`);
}

/** The chevron column's tokens, as `globals.css` authors them (px literals). */
export function applyChevronTokens(el: HTMLElement): void {
  el.style.setProperty("--margin-col-chevron", `${FIXTURE.chevronOffsetPx}px`);
  el.style.setProperty(
    "--margin-col-chevron-width",
    `${FIXTURE.chevronWidthPx}px`,
  );
}

function stamp(el: HTMLElement, kind: string, uuid: string): void {
  el.setAttribute("data-uuid", uuid);
  el.setAttribute("data-text-object-kind", kind);
}

/** What every builder returns: the `[data-uuid]` block element the resolve is
 *  given, and the element the first-line descent is expected to reach. */
export interface BlockFixture {
  /** The `[data-uuid]` node DOM — what `editor.view.nodeDOM(pos)` returns. */
  block: HTMLElement;
  /** The element `resolveFirstLineTarget(block)` must arrive at. */
  target: HTMLElement;
}

/**
 * A plain paragraph — `ParagraphWithTitle` renders an UNTITLED paragraph as a
 * bare `<p>` carrying the stamp, so block box and text target are one element.
 * The markerless baseline: `markerLeft === contentLeft`, no column, no chevron.
 */
export function buildParagraph(o: BlockBoxOptions = {}): BlockFixture {
  const r = opts(o);
  const p = document.createElement("p");
  stamp(p, "paragraph", r.uuid);
  p.style.fontSize = `${r.fontSizePx}px`;
  applyMarginTokens(p);
  p.textContent = "prose";
  r.parent.appendChild(p);
  stubRect(p, rect(r.left, r.top, r.width, r.height), r.reads);
  return { block: p, target: p };
}

/**
 * A section heading — `createHeadingNodeView` stamps the uuid/kind on a
 * `.heading-wrapper` div hosting the section pod, and the `<hN>` inside it
 * carries the line. Two genuinely different boxes, which is what makes it the
 * kind that proves the chevron branch reads the BLOCK's style and origin
 * (task 662) rather than the target's.
 */
export function buildHeading(
  level = 2,
  o: BlockBoxOptions = {},
): BlockFixture & { heading: HTMLElement } {
  const r = opts(o);
  const wrapper = document.createElement("div");
  wrapper.className = "heading-wrapper";
  stamp(wrapper, "heading", r.uuid);
  // The BLOCK's own font — the chevron column's em base comes from here, never
  // from the `<hN>`'s larger display font (task 662). Stated rather than left to
  // inherit so a leg asserting an `em` chevron token has a number to assert.
  wrapper.style.fontSize = `${r.fontSizePx}px`;
  applyMarginTokens(wrapper);
  applyChevronTokens(wrapper);
  const h = document.createElement(`h${level}`);
  // A heading's display font is LARGER than the prose it sits above — the
  // reason the chevron column's em base may not come from it.
  h.style.fontSize = `${r.fontSizePx * 1.5}px`;
  h.textContent = "Heading";
  wrapper.appendChild(h);
  r.parent.appendChild(wrapper);
  stubRect(wrapper, rect(r.left, r.top, r.width, r.height), r.reads);
  stubRect(
    h,
    rect(
      r.left + FIXTURE.targetLeftInset,
      r.top + FIXTURE.targetTopInset,
      r.width - FIXTURE.targetLeftInset,
      r.height - FIXTURE.targetTopInset * 2,
    ),
    r.reads,
  );
  return { block: wrapper, target: h, heading: h };
}

/**
 * A source pod (`texBlock` / `forestBlock`) — `SourcePodNodeView`'s
 * `[data-uuid]` node DOM is the `.react-renderer` wrapper, which matches NO
 * branch of the wrapper descent, so the frame's target is the block itself.
 * The kind where `firstLineRect` and the chevron origin are the same read.
 */
export function buildSourcePod(
  kind: "texBlock" | "forestBlock",
  o: BlockBoxOptions = {},
): BlockFixture {
  const r = opts(o);
  const el = document.createElement("div");
  el.className = "react-renderer";
  stamp(el, kind, r.uuid);
  el.style.fontSize = `${r.fontSizePx}px`;
  applyMarginTokens(el);
  applyChevronTokens(el);
  r.parent.appendChild(el);
  stubRect(el, rect(r.left, r.top, r.width, r.height), r.reads);
  return { block: el, target: el };
}

/**
 * A figure — the `[data-uuid]` node DOM is the full-COLUMN-width
 * `.react-renderer` host (what the drop indicator correctly spans), and the
 * `.figure-block` inside it is the HUG box whose right edge IS the rendered
 * image. `FigureBlockNodeView` deliberately resolves the frame on the hug box,
 * so a fixture has to be able to hand over either.
 */
export function buildFigure(
  o: BlockBoxOptions & { hugWidth?: number } = {},
): BlockFixture & { host: HTMLElement; hug: HTMLElement } {
  const r = opts(o);
  const host = document.createElement("div");
  host.className = "react-renderer";
  stamp(host, "figureBlock", r.uuid);
  host.style.fontSize = `${r.fontSizePx}px`;
  applyMarginTokens(host);
  const hug = document.createElement("div");
  hug.className = "figure-block";
  host.appendChild(hug);
  r.parent.appendChild(host);
  stubRect(host, rect(r.left, r.top, r.width, r.height), r.reads);
  stubRect(
    hug,
    rect(r.left, r.top, o.hugWidth ?? Math.round(r.width / 2), r.height),
    r.reads,
  );
  return { block: host, target: host, host, hug };
}

export interface ListFixture extends BlockFixture {
  /** The `<ul>`/`<ol>` that carries the band + counter — the LIST box, which is
   *  not always the block box (that gap is task 659). */
  list: HTMLElement;
  /** The `<li>` rows, each stamped `listItem`. */
  items: HTMLElement[];
  /** Each item's inner `<p>` — where its line box lives. */
  paragraphs: HTMLElement[];
  /** Viewport left of an item's content edge (`listLeft + band`). */
  itemLeft: number;
}

interface ListOptions extends BlockBoxOptions {
  /** Marker band (`padding-left`) on the list. Default {@link FIXTURE.bandPx}. */
  bandPx?: number;
  itemCount?: number;
  /** `<ol start>` — only meaningful for `ol`. */
  start?: number;
  /** `<ol reversed>` — the widest marker is then the FIRST. */
  reversed?: boolean;
  /** `list-style-type` override (e.g. `"none"`, `"upper-roman"`). */
  listStyleType?: string;
}

function buildItems(
  list: HTMLElement,
  r: Resolved,
  itemLeft: number,
  itemCount: number,
): { items: HTMLElement[]; paragraphs: HTMLElement[] } {
  const items: HTMLElement[] = [];
  const paragraphs: HTMLElement[] = [];
  for (let i = 0; i < itemCount; i++) {
    const li = document.createElement("li");
    stamp(li, "listItem", `${r.uuid}-li${i + 1}`);
    const rowTop = r.top + i * r.height;
    stubRect(li, rect(itemLeft, rowTop, r.width - (itemLeft - r.left), r.height), r.reads);
    const p = document.createElement("p");
    p.textContent = `item ${i + 1}`;
    p.style.fontSize = `${r.fontSizePx}px`;
    stubRect(
      p,
      rect(
        itemLeft,
        rowTop + FIXTURE.targetTopInset,
        r.width - (itemLeft - r.left),
        r.height - FIXTURE.targetTopInset * 2,
      ),
      r.reads,
    );
    li.appendChild(p);
    list.appendChild(li);
    items.push(li);
    paragraphs.push(p);
  }
  return { items, paragraphs };
}

function styleList(list: HTMLElement, o: ListOptions, bandPx: number, fontSizePx: number): void {
  list.style.paddingLeft = `${bandPx}px`;
  list.style.fontSize = `${fontSizePx}px`;
  list.style.listStyleType =
    o.listStyleType ?? (list.tagName === "UL" ? "disc" : "decimal");
  if (o.start !== undefined) list.setAttribute("start", String(o.start));
  if (o.reversed) list.setAttribute("reversed", "");
}

/**
 * A NESTED list — the bare `<ul>`/`<ol>` IS the `[data-uuid]` node DOM, so the
 * block box and the list box coincide. Pass `insideItem` to hang it under a
 * `listItem` parent, which is what gives it a marker COLUMN to occupy
 * (`columnRight` non-null, task 487); without one it reads as an ordinary
 * markerless block in the gutter.
 */
export function buildNestedList(
  tag: "ul" | "ol",
  o: ListOptions & { insideItem?: boolean } = {},
): ListFixture & { hostItem: HTMLElement | null } {
  const r = opts(o);
  const bandPx = o.bandPx ?? FIXTURE.bandPx;
  let hostItem: HTMLElement | null = null;
  let parent = r.parent;
  if (o.insideItem) {
    hostItem = document.createElement("li");
    stamp(hostItem, "listItem", `${r.uuid}-host`);
    stubRect(hostItem, rect(r.left, r.top, r.width, r.height), r.reads);
    r.parent.appendChild(hostItem);
    parent = hostItem;
  }
  const list = document.createElement(tag);
  stamp(list, tag === "ul" ? "bulletList" : "orderedList", r.uuid);
  styleList(list, o, bandPx, r.fontSizePx);
  applyMarginTokens(list);
  parent.appendChild(list);
  stubRect(list, rect(r.left, r.top, r.width, r.height), r.reads);
  const itemLeft = r.left + bandPx;
  const { items, paragraphs } = buildItems(list, r, itemLeft, o.itemCount ?? 1);
  return { block: list, target: paragraphs[0] ?? list, list, items, paragraphs, itemLeft, hostItem };
}

/**
 * A TOP-LEVEL list — `createListTitleNodeView` (`src/lib/editor-extensions.ts`)
 * wraps the list in a `.list-title-wrapper` div to host the par-title
 * annotation and stamps the uuid/kind on the WRAPPER. The wrapper carries
 * NEITHER fact a band is made of: its `padding-left` is `0` and its
 * `list-style-type` falls back to the inherited initial `disc`, because
 * `.tiptap ol { list-style-type: decimal }` matches the `<ol>` alone.
 *
 * Deliberately a separate function from {@link buildNestedList} — the two
 * shapes differ in exactly the way task 659 turned on, and one function with a
 * flag is how they came to be conflated in the first place.
 */
export function buildTopLevelList(
  tag: "ul" | "ol",
  o: ListOptions = {},
): ListFixture & { wrapper: HTMLElement } {
  const r = opts(o);
  const bandPx = o.bandPx ?? FIXTURE.bandPx;
  const wrapper = document.createElement("div");
  wrapper.className = "list-title-wrapper has-text";
  stamp(wrapper, tag === "ul" ? "bulletList" : "orderedList", r.uuid);
  // No horizontal padding, border or margin, so the wrapper's left IS the
  // list's — the two numbers coincide and still answer different questions.
  wrapper.style.paddingLeft = "0px";
  applyMarginTokens(wrapper);
  const annot = document.createElement("div");
  annot.className = "par-title-annotation";
  wrapper.appendChild(annot);
  const list = document.createElement(tag);
  styleList(list, o, bandPx, r.fontSizePx);
  wrapper.appendChild(list);
  r.parent.appendChild(wrapper);
  stubRect(wrapper, rect(r.left, r.top, r.width, r.height), r.reads);
  stubRect(list, rect(r.left, r.top, r.width, r.height), r.reads);
  const itemLeft = r.left + bandPx;
  const { items, paragraphs } = buildItems(list, r, itemLeft, o.itemCount ?? 1);
  return {
    block: wrapper,
    target: paragraphs[0] ?? wrapper,
    wrapper,
    list,
    items,
    paragraphs,
    itemLeft,
  };
}

export interface ExampleItemFixture extends BlockFixture {
  /** `.expex-item-marker` — the `a.` glyph, a real DOM element (unlike a
   *  list's `::marker`, which has no rect). */
  marker: HTMLElement;
  body: HTMLElement;
  paragraph: HTMLElement;
}

/**
 * An `exampleItem` — `expex.ts`'s NodeView stamps the uuid/kind on the
 * `.expex-item` div, which holds an `.expex-item-row` grid of
 * `.expex-item-marker` + `.expex-item-body`, the body carrying the inner `<p>`.
 * `markerPresent: false` strips the marker span, which is the #49
 * fallback-direction case (the handle must still anchor LEFT of content).
 */
export function buildExampleItem(
  o: BlockBoxOptions & { markerPresent?: boolean; markerLeft?: number } = {},
): ExampleItemFixture {
  const r = opts(o);
  const item = document.createElement("div");
  item.className = "expex-item";
  stamp(item, "exampleItem", r.uuid);
  item.style.fontSize = `${r.fontSizePx}px`;
  applyMarginTokens(item);
  const row = document.createElement("div");
  row.className = "expex-item-row";
  item.appendChild(row);
  const marker = document.createElement("span");
  marker.className = "expex-item-marker";
  marker.textContent = "a.";
  if (o.markerPresent !== false) row.appendChild(marker);
  const body = document.createElement("div");
  body.className = "expex-item-body";
  row.appendChild(body);
  const p = document.createElement("p");
  p.textContent = "the example sentence";
  p.style.fontSize = `${r.fontSizePx}px`;
  body.appendChild(p);
  r.parent.appendChild(item);
  const bodyLeft = r.left + FIXTURE.targetLeftInset;
  stubRect(item, rect(r.left, r.top, r.width, r.height), r.reads);
  stubRect(marker, rect(o.markerLeft ?? r.left, r.top, 12, r.height), r.reads);
  stubRect(body, rect(bodyLeft, r.top, r.width - FIXTURE.targetLeftInset, r.height), r.reads);
  stubRect(
    p,
    rect(
      bodyLeft,
      r.top + FIXTURE.targetTopInset,
      r.width - FIXTURE.targetLeftInset,
      r.height - FIXTURE.targetTopInset * 2,
    ),
    r.reads,
  );
  return { block: item, target: p, marker, body, paragraph: p };
}

/**
 * An `exampleBlock` — `expex.ts` stamps the uuid/kind on the OUTER
 * `.par-title-wrapper.expex-par-wrapper`, which hosts the par-title annotation
 * and the `.expex-block` body (the `(n)` chip in `.expex-number`, then
 * `.expex-body` holding the items). A CONTAINER kind, so the first-line descent
 * recurses into its first `.expex-item` and on to that item's `<p>`.
 */
export function buildExampleBlock(
  o: BlockBoxOptions & { numberPresent?: boolean; numberLeft?: number } = {},
): BlockFixture & {
  number: HTMLElement;
  items: ExampleItemFixture[];
} {
  const r = opts(o);
  const wrapper = document.createElement("div");
  wrapper.className = "par-title-wrapper expex-par-wrapper";
  stamp(wrapper, "exampleBlock", r.uuid);
  wrapper.style.fontSize = `${r.fontSizePx}px`;
  applyMarginTokens(wrapper);
  const annot = document.createElement("div");
  annot.className = "par-title-annotation";
  wrapper.appendChild(annot);
  const blockBody = document.createElement("div");
  blockBody.className = "expex-block expex-block-multi";
  wrapper.appendChild(blockBody);
  const numberEl = document.createElement("span");
  numberEl.className = "expex-number";
  numberEl.textContent = "(1)";
  if (o.numberPresent !== false) blockBody.appendChild(numberEl);
  const body = document.createElement("div");
  body.className = "expex-body";
  blockBody.appendChild(body);
  r.parent.appendChild(wrapper);
  stubRect(wrapper, rect(r.left, r.top, r.width, r.height), r.reads);
  stubRect(blockBody, rect(r.left, r.top, r.width, r.height), r.reads);
  stubRect(
    numberEl,
    rect(o.numberLeft ?? r.left, r.top, 18, r.height),
    r.reads,
  );
  const items = [
    buildExampleItem({
      ...o,
      parent: body,
      uuid: `${r.uuid}-a`,
      left: r.left + FIXTURE.targetLeftInset * 2,
      width: r.width - FIXTURE.targetLeftInset * 2,
      markerLeft: r.left + FIXTURE.targetLeftInset * 2,
    }),
  ];
  return { block: wrapper, target: items[0].target, number: numberEl, items };
}
