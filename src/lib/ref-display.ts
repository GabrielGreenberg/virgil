import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  collectExampleBodyLabels,
  type ExampleNodeAccessors,
} from "@/lib/example-refs";
import { figureNodeEmitsCaption } from "@/lib/figures/env-body";

/**
 * REF DISPLAY — the ONE answer to "what does `\ref{label}` show?" (task 550).
 *
 * A `\ref` resolves to a NUMBER the document derives: a heading's section
 * number, an example's `(N)` / `(Na)`, a figure's `Figure N`. Three places
 * used to derive it, each with its own walk and its own vocabulary:
 *
 *   • the PARSER (`latex-parser.ts` — `numberHeadings` + `numberFigures` +
 *     `resolveRefs`, over JSON, at load);
 *   • the NUMBERER (`editor-extensions.ts` `sectionNumbers`, over the live
 *     ProseMirror doc, on every structural change);
 *   • the POPOVER's `resolveLabelDisplay` (`card-actions/ref.ts`, over the
 *     live doc, at insert / re-point time — and, through `EditorPane`, the
 *     card bodies' load-time refresh).
 *
 * They had drifted in BOTH directions: the popover copy had no figure branch,
 * so re-pointing a chip at `fig:x` wrote `??` into the atom; and the numberer
 * copy never registered a flat sub-item label (`\a \label{foo}` → "3a"), so a
 * ref the parser had resolved correctly at load flipped to `??` on the first
 * structural edit. Task 341's twin rule, with a third member.
 *
 * This leaf is generic over the node representation — the same shape
 * `example-refs.ts` already uses — so the JSON parser and the two ProseMirror
 * readers build ONE index (`buildRefTargetIndex`) and read ONE resolution
 * (`resolveRefDisplay`). The index also carries the two NUMBERING facts the
 * parser and the numberer each used to compute privately (heading section
 * numbers, figure numbers), so "what number does this heading have" and "what
 * number does a ref to it show" cannot disagree: they are one table.
 *
 * Import discipline: type-only TipTap imports plus two light leaves
 * (`example-refs`, `figures/env-body`), so the TipTap-free parser can read it.
 *
 * Precedence, stated once: heading > example > figure for a key that two
 * kinds both declare (a duplicate `\label` is a LaTeX error either way; the
 * order is the numberer's and the parser's). Within a kind, the FIRST
 * declaration in document order wins. The dotted `parent.sub` form is asked
 * only after every exact key has missed.
 */

export type RefCommand = "ref" | "getref" | "getfullref";

export type RefTargetKind = "heading" | "example" | "figure";

export interface RefIndexAccessors<N> extends ExampleNodeAccessors<N> {
  attrs: (n: N) => Record<string, unknown>;
  /**
   * Depth-first walk of every descendant of `root` in document order, with
   * ProseMirror's `Node.descendants` position semantics: `pos` is relative to
   * `root`'s content start (absolute when `root` is the doc), or -1 where the
   * representation has no positions (JSON). Return `false` to skip the node's
   * children.
   */
  descendants: (root: N, visit: (n: N, pos: number) => boolean | void) => void;
  /** Whether this `figureBlock` will carry a `\caption` — LaTeX's own rule for
   *  whether the float takes a number (task 319). */
  figureEmitsCaption: (n: N) => boolean;
}

export interface HeadingNumberRow<N> {
  node: N;
  pos: number;
  level: number;
  numbered: boolean;
  label: string | null;
  /** The `sectionNumber` the node CARRIES. */
  current: string | null;
  /** The section number the document DERIVES for it (null when unnumbered). */
  number: string | null;
}

export interface FigureNumberRow<N> {
  node: N;
  pos: number;
  label: string | null;
  /** The `figureNumber` the node CARRIES, normalized. */
  current: number | null;
  /** The number the document DERIVES (null when the float takes none). */
  number: number | null;
}

export interface RefTarget {
  kind: RefTargetKind;
  number: string;
  /** The declaring node's position (ProseMirror), or -1 for JSON. For a flat
   *  sub-item label this is the ITEM; for a body-line label the enclosing
   *  BLOCK (the raw `\label` text node is where a jump lands, see
   *  `useRefActions.handleRefJump`). */
  pos: number;
}

export interface RefTargetIndex<N> {
  headings: readonly HeadingNumberRow<N>[];
  figures: readonly FigureNumberRow<N>[];
  /** Every `labelRef` atom in the walk (footnote sub-docs excluded — those
   *  are opaque `attrs.content` and are refreshed by their own surface). */
  refs: readonly { node: N; pos: number }[];
  targets: ReadonlyMap<string, RefTarget>;
  /** example parent key → (item key → item subLabel), for the dotted form. */
  exampleItems: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

const HEADING_LEVELS = 7; // 0..6 — Part..Subparagraph; 7 is the "above all" sentinel

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function normalizeFigureNumber(cur: unknown): number | null {
  if (typeof cur === "number") return Number.isFinite(cur) ? cur : null;
  if (typeof cur === "string" && cur !== "") {
    const n = parseInt(cur, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function buildRefTargetIndex<N>(
  root: N,
  acc: RefIndexAccessors<N>,
): RefTargetIndex<N> {
  const headingsRaw: { node: N; pos: number }[] = [];
  const examples: { node: N; pos: number }[] = [];
  const figuresRaw: { node: N; pos: number }[] = [];
  const refs: { node: N; pos: number }[] = [];

  acc.descendants(root, (n, pos) => {
    switch (acc.typeName(n)) {
      case "heading":
        headingsRaw.push({ node: n, pos });
        return;
      case "exampleBlock":
        examples.push({ node: n, pos });
        return false; // its items are walked below, per block
      case "figureBlock":
        figuresRaw.push({ node: n, pos });
        return false; // a figureCaption holds no nested declarations
      case "labelRef":
        refs.push({ node: n, pos });
        return false;
      default:
        return;
    }
  });

  // ── Headings: hierarchical numbering (the numberer's / parser's algorithm)
  let topLevel = HEADING_LEVELS;
  const headings: HeadingNumberRow<N>[] = headingsRaw.map(({ node, pos }) => {
    const a = acc.attrs(node);
    const rawLevel = typeof a.level === "number" ? a.level : 2;
    const level = Math.max(0, Math.min(rawLevel, HEADING_LEVELS - 1));
    const numbered = a.numbered !== false;
    if (numbered && level < topLevel) topLevel = level;
    return {
      node,
      pos,
      level,
      numbered,
      label: str(a.label) || null,
      current: typeof a.sectionNumber === "string" ? a.sectionNumber : null,
      number: null,
    };
  });
  const counters = new Array<number>(HEADING_LEVELS).fill(0);
  for (const h of headings) {
    if (!h.numbered || topLevel >= HEADING_LEVELS) continue;
    counters[h.level]++;
    for (let i = h.level + 1; i < HEADING_LEVELS; i++) counters[i] = 0;
    const parts: number[] = [];
    for (let i = topLevel; i <= h.level; i++) parts.push(counters[i]);
    h.number = parts.join(".");
  }

  // ── Figures: sequential numbering over the floats that emit a caption
  let figureCounter = 0;
  const figures: FigureNumberRow<N>[] = figuresRaw.map(({ node, pos }) => {
    const a = acc.attrs(node);
    const takesNumber = a.numbered !== false && acc.figureEmitsCaption(node);
    const number = takesNumber ? ++figureCounter : null;
    return {
      node,
      pos,
      label: str(a.label) || null,
      current: normalizeFigureNumber(a.figureNumber),
      number,
    };
  });

  // ── The target table. Heading > example > figure; first declaration wins.
  const targets = new Map<string, RefTarget>();
  const exampleItems = new Map<string, Map<string, string>>();
  const claim = (key: string, target: RefTarget) => {
    if (key && !targets.has(key)) targets.set(key, target);
  };

  for (const h of headings) {
    if (h.label && h.number) claim(h.label, { kind: "heading", number: h.number, pos: h.pos });
  }

  for (const { node, pos: blockPos } of examples) {
    const a = acc.attrs(node);
    const number = str(a.number);
    if (!number || number === "0") continue;
    const parentTag = str(a.tag);
    const parentLabel = str(a.label);
    const items = new Map<string, string>();
    const parent: RefTarget = { kind: "example", number, pos: blockPos };
    if (parentTag) exampleItems.set(parentTag, items);
    if (parentLabel) exampleItems.set(parentLabel, items);
    claim(parentTag, parent);
    claim(parentLabel, parent);
    // Items — nested xlist tiers included. A sub-item key resolves flat
    // (`\ref{foo}` → "3a", matching expex's own \refstepcounter) AND feeds the
    // dotted `parent.foo` form through `items`.
    acc.descendants(node, (child, rel) => {
      if (acc.typeName(child) !== "exampleItem") return;
      const sub = str(acc.subLabel(child));
      if (!sub) return;
      const itemPos = blockPos >= 0 && rel >= 0 ? blockPos + 1 + rel : -1;
      const ca = acc.attrs(child);
      for (const key of [str(ca.tag), str(ca.label)]) {
        if (!key) continue;
        if (!items.has(key)) items.set(key, sub);
        claim(key, { kind: "example", number: `${number}${sub}`, pos: itemPos });
      }
    });
    // Body-line `\label{…}` (the shared capture): parent-bound → N, item-bound
    // → N+sub. Explicit attr keys above win.
    for (const bl of collectExampleBodyLabels(node, acc)) {
      if (bl.subLabel == null) {
        claim(bl.key, parent);
      } else {
        claim(bl.key, { kind: "example", number: `${number}${bl.subLabel}`, pos: blockPos });
        if (!items.has(bl.key)) items.set(bl.key, bl.subLabel);
      }
    }
  }

  for (const f of figures) {
    if (f.label && f.number != null) {
      claim(f.label, { kind: "figure", number: String(f.number), pos: f.pos });
    }
  }

  return { headings, figures, refs, targets, exampleItems };
}

/** The target a label names, the dotted `parent.sub` form included; null when
 *  nothing in the document declares it. */
export function resolveRefTarget<N>(
  index: RefTargetIndex<N>,
  label: string,
): RefTarget | null {
  if (!label) return null;
  const exact = index.targets.get(label);
  if (exact) return exact;
  const dot = label.lastIndexOf(".");
  if (dot > 0) {
    const parentKey = label.slice(0, dot);
    const subKey = label.slice(dot + 1);
    const parent = index.targets.get(parentKey);
    if (parent && parent.kind === "example") {
      const sub = index.exampleItems.get(parentKey)?.get(subKey) || subKey;
      return { kind: "example", number: `${parent.number}${sub}`, pos: parent.pos };
    }
  }
  return null;
}

/** `\ref` → the bare number; `\getref` / `\getfullref` → parenthesized. */
export function formatRefDisplay(number: string, refCommand: RefCommand | string): string {
  return refCommand === "ref" ? number : `(${number})`;
}

export interface RefDisplay {
  display: string;
  targetKind: RefTargetKind | null;
}

/** What a `labelRef` atom SHOWS for `label` under `refCommand` — `"??"` when
 *  the document declares no such target. */
export function resolveRefDisplay<N>(
  index: RefTargetIndex<N>,
  label: string,
  refCommand: RefCommand | string,
): RefDisplay {
  const target = resolveRefTarget(index, label);
  if (!target) return { display: "??", targetKind: null };
  return { display: formatRefDisplay(target.number, refCommand), targetKind: target.kind };
}

// ── ProseMirror accessors ────────────────────────────────────────────────────

function pmChildren(n: PMNode): PMNode[] {
  const kids: PMNode[] = [];
  n.forEach((c) => kids.push(c));
  return kids;
}

export const PM_REF_INDEX_ACCESSORS: RefIndexAccessors<PMNode> = {
  typeName: (n) => n.type.name,
  subLabel: (n) => (n.attrs.subLabel as string | undefined) ?? null,
  text: (n) => n.text,
  children: pmChildren,
  attrs: (n) => n.attrs,
  descendants: (root, visit) => {
    root.descendants((nd, pos) => visit(nd, pos) !== false);
  },
  figureEmitsCaption: (n) => figureNodeEmitsCaption(n),
};

export function buildRefTargetIndexPM(doc: PMNode): RefTargetIndex<PMNode> {
  return buildRefTargetIndex(doc, PM_REF_INDEX_ACCESSORS);
}

/**
 * The live-document door: resolve `label` against `doc` in one call. Builds
 * the index per call — O(doc), so it is for USER-PACED moments (a popover
 * commit, a card body's load-time refresh), never a per-keystroke path. A
 * consumer with many labels to resolve builds the index once and reads
 * `resolveRefDisplay` per label, as the numberer does.
 */
export function resolveLabelDisplay(
  doc: PMNode,
  label: string,
  refCommand: RefCommand,
): RefDisplay {
  return resolveRefDisplay(buildRefTargetIndexPM(doc), label, refCommand);
}

// ── JSONContent accessors (the parser's representation) ─────────────────────

function jsonDescendants(
  root: JSONContent,
  visit: (n: JSONContent, pos: number) => boolean | void,
): void {
  const walk = (n: JSONContent) => {
    for (const child of n.content ?? []) {
      if (visit(child, -1) !== false) walk(child);
    }
  };
  walk(root);
}

export const JSON_REF_INDEX_ACCESSORS: RefIndexAccessors<JSONContent> = {
  typeName: (n) => n.type ?? "",
  subLabel: (n) => (n.attrs?.subLabel as string | undefined) ?? null,
  text: (n) => n.text,
  children: (n) => n.content ?? [],
  attrs: (n) => n.attrs ?? {},
  descendants: jsonDescendants,
  // `hasCaption` alone is the whole test on freshly parsed JSON, unlike the
  // live twin (which also asks whether the caption node has content): here
  // the caption child is built from `figAttrs.caption` and both come from ONE
  // scan, so `hasCaption === false` implies an empty caption child and the
  // content arm could never change the answer (the parser's stated reason).
  figureEmitsCaption: (n) => n.attrs?.hasCaption !== false,
};

export function buildRefTargetIndexJSON(doc: JSONContent): RefTargetIndex<JSONContent> {
  return buildRefTargetIndex(doc, JSON_REF_INDEX_ACCESSORS);
}
