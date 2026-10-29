/**
 * The Outline panel's ONE structural model (task 1347).
 *
 * View mode and edit mode render the same outline. Until task 1347 they built
 * it twice: view mode nested headings with `buildTree` and indented by TREE
 * DEPTH, while edit mode re-walked its own ancestor stack in `buildPods`,
 * indented by RAW LaTeX level (so `\part`, level 0, hung 18 px off the panel's
 * left edge), pinned every paragraph title at a fake "level 4", and never saw
 * the titles above the first heading at all. Now there is one pipeline:
 *
 *   doc snapshot ─ extractHeadings ─▶ headings + preambleTitles
 *                                   ─ buildTree ─▶ TreeNode[] (each with `depth`)
 *                                   ─ buildPods ─▶ OutlinePod[] = the tree, FLATTENED
 *
 * View mode renders the tree recursively; edit mode renders its flattening.
 * Both indent through `headingIndent` / `parTitleIndent` at the SAME depth, so
 * entering edit mode cannot move a row sideways. Pure and snapshot-driven —
 * `content` is the throttled snapshot, nothing here runs per keystroke.
 */

import type { JSONContent } from "@tiptap/react";
import { projectInline } from "@/lib/inline-content";
import { TITLED_NODE_TYPES } from "@/lib/node-attr-sets";
import { sectionExtentFromHeadings } from "@/lib/tiptap/block-address";

/* ── Indentation model (single source of truth) ─────────────────────────
 * One place defines the outline's left-edge geometry, used by both the view
 * tree and the edit-mode pods (and the focus-band / position measurement that
 * key off the same rows). Goals: minimize the fixed left inset (#4), deepen
 * the per-level step so nesting reads clearly (#5), and give a fixed number
 * column so wrapped heading text hangs like a numbered list (#2). */
export const OUTLINE_BASE_INSET = 2;    // px — fixed left gutter (was 8)
export const OUTLINE_INDENT_STEP = 20;  // px per tree depth (was 16)
export const OUTLINE_TWIST_COL = 15;    // px — chevron / spacer column width
export const OUTLINE_ROW_GAP = 4;       // px — gap between twist column and text

/** Left pad (px) for a heading row at the given tree depth. */
export function headingIndent(depth: number): number {
  return OUTLINE_BASE_INSET + depth * OUTLINE_INDENT_STEP;
}
/** Left pad (px) for a parTitle row under a heading at `depth` — one step
 *  deeper than the heading text so it reads as belonging to the section. A
 *  preamble title (no owning heading) sits at `depth` 0, under Document start. */
export function parTitleIndent(depth: number): number {
  return headingIndent(depth) + OUTLINE_TWIST_COL + OUTLINE_ROW_GAP + OUTLINE_INDENT_STEP;
}

/* ── Extraction ─────────────────────────────────────────────────────── */

export interface ParTitleItem {
  title: string;
  index: number;
  uuid: string | null;
}

export interface HeadingItem {
  id: string;
  /** Durable block uuid — the address the structural-edit mutators key on
   *  (T3 / W3a). Null until the block is hydrated (lazy uuid backfill); a
   *  rename then no-ops gracefully rather than mis-addressing by index. */
  uuid: string | null;
  level: number;
  text: string;
  label: string | null;
  sectionNumber: string | null;
  index: number; // top-level block index in doc.content
  // paragraph titles under this heading — each carries its own durable uuid.
  parTitles: ParTitleItem[];
}

export interface ExtractResult {
  headings: HeadingItem[];
  /** Par titles that appear before the first heading (Document start region). */
  preambleTitles: ParTitleItem[];
}

/** A paragraph title's row/pod identity — its durable uuid, falling back to its
 *  block index until it is hydrated. ONE spelling for the view rows' React keys
 *  and the edit pods' ids (task 1347: the view keyed them by array position). */
export function parTitleId(pt: ParTitleItem): string {
  return pt.uuid ?? `pt-${pt.index}`;
}

export function extractHeadings(doc: JSONContent | null): ExtractResult {
  if (!doc || !doc.content) return { headings: [], preambleTitles: [] };
  const headings: HeadingItem[] = [];
  let pendingTitles: ParTitleItem[] = [];
  const preambleTitles: ParTitleItem[] = [];

  doc.content.forEach((node, idx) => {
    if (node.type === "heading" && typeof node.attrs?.level === "number") {
      // Attach any pending parTitles to the previous heading. Titles
      // before the first heading go to the preamble list so they can
      // appear under the "Document start" row.
      if (pendingTitles.length > 0) {
        if (headings.length > 0) {
          headings[headings.length - 1].parTitles.push(...pendingTitles);
        } else {
          preambleTitles.push(...pendingTitles);
        }
      }
      pendingTitles = [];
      // OUT-A2-01: key the heading's stable address on its durable block `uuid`,
      // NOT its positional `heading-${idx}`. The persisted fold/collapse Set
      // (and the pods parent-chain) keys on `id`; an index-based id DRIFTS the
      // moment a block is inserted above a collapsed section — the heading
      // formerly `heading-3` becomes `heading-4`, so the saved fold key no
      // longer matches and the section silently un-collapses (and an unrelated
      // section may collapse). The block uuid is insert-stable, so the fold
      // survives. Un-hydrated headings (uuid still null — lazy-backfilled on
      // first interaction) fall back to the positional id so they remain
      // foldable until they earn a uuid; once hydrated they key durably.
      const uuid = (node.attrs.uuid as string | null) || null;
      headings.push({
        id: uuid ?? `heading-${idx}`,
        uuid,
        level: node.attrs.level as number,
        // Task 707: the EDITABLE projection — the rename box is seeded from
        // this and `buildHeadingRenameFragment` splices it back through the
        // same `projectInline`, so the two cannot disagree. A footnote is an
        // opaque zero-width atom here (its body is not heading text).
        text: projectInline(node).text || "Untitled",
        label: (node.attrs.label as string) || null,
        sectionNumber: (node.attrs.sectionNumber as string) || null,
        index: idx,
        parTitles: [],
      });
    } else if (TITLED_NODE_TYPES.has(node.type ?? "") && node.attrs?.parTitle) {
      // Task 404: the SET, not a three-name copy of it. A title on a
      // texBlock / forestBlock / exampleBlock is written and persisted like
      // any other, so it gets a row like any other — DISPLAY is deliberately
      // undifferentiated (one `--par-title-color-dense` ink for every titled
      // kind), because that is what the set already means; typing the rows by
      // kind is a STYLE_GUIDE decision worth its own pass.
      pendingTitles.push({
        title: node.attrs.parTitle as string,
        index: idx,
        uuid: (node.attrs.uuid as string | null) || null,
      });
    }
  });
  if (pendingTitles.length > 0) {
    if (headings.length > 0) {
      headings[headings.length - 1].parTitles.push(...pendingTitles);
    } else {
      preambleTitles.push(...pendingTitles);
    }
  }
  return { headings, preambleTitles };
}

/* ── The tree ───────────────────────────────────────────────────────── */

export interface TreeNode {
  heading: HeadingItem;
  /** Nesting depth in the tree (roots are 0) — what BOTH modes indent by. A
   *  skipped level (`\section` → `\subsubsection`) is one step, not two, and a
   *  `\part` root sits at 0 like an article's top `\section`. */
  depth: number;
  /** The enclosing heading's id — the chain a fold walks. */
  parentId: string | undefined;
  children: TreeNode[];
}

/** Nest headings: each one's parent is its nearest preceding heading of a
 *  strictly SHALLOWER LaTeX level (smaller number). */
export function buildTree(headings: HeadingItem[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];

  for (const h of headings) {
    while (stack.length > 0 && stack[stack.length - 1].heading.level >= h.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    const node: TreeNode = { heading: h, depth: stack.length, parentId: parent?.heading.id, children: [] };
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  return roots;
}

/* ── Edit-mode pods: the tree, flattened ────────────────────────────── */

export interface OutlinePod {
  type: "heading" | "parTitle";
  /** Tree depth — a heading pod's own node depth; a parTitle pod carries its
   *  OWNING heading's depth (0 for a preamble title), and indents one step past
   *  it through `parTitleIndent`, exactly as its view-mode row does. */
  depth: number;
  /** The heading's LaTeX level (its type scale); null on a parTitle pod. */
  level: number | null;
  text: string;
  blockIndex: number;   // top-level block index in doc.content (reorder/scroll)
  blockCount: number;   // how many top-level blocks this pod covers
  id: string;
  /** Durable block uuid — the address the rename/label mutators key on (T3 /
   *  W3a). Null when the block hasn't earned a uuid yet; rename then no-ops. */
  uuid: string | null;
  /** The heading a fold of which hides this pod; undefined for a root heading
   *  and for a preamble title (nothing above it can fold). */
  parentHeadingId?: string;
  hasCollapsibleChildren?: boolean; // headings only — true when something
                                    // would be hidden by collapsing
}

/** A pod's left indent — the SAME helpers, at the SAME depth, as its view row. */
export function podIndent(pod: OutlinePod): number {
  return pod.type === "heading" ? headingIndent(pod.depth) : parTitleIndent(pod.depth);
}

/**
 * Flatten the outline into edit-mode pods, in document order: the preamble
 * titles first (Document start's rows), then each heading followed by its own
 * paragraph titles and then its sub-sections.
 *
 * `showTitles` semantics: edit mode ALWAYS includes paragraph-title pods,
 * whatever the view toggle says — a pod is the handle that renames and moves
 * its block, and hiding it in the one mode built for restructuring would make
 * a titled block unmovable. View mode honours the toggle; edit mode is a
 * superset of it.
 */
export function buildPods(
  { headings, preambleTitles }: ExtractResult,
  totalBlocks: number,
  tree: TreeNode[] = buildTree(headings),
): OutlinePod[] {
  const pods: OutlinePod[] = [];
  const pushTitles = (titles: ParTitleItem[], depth: number, parentHeadingId: string | undefined) => {
    for (const pt of titles) {
      pods.push({
        type: "parTitle",
        depth,
        level: null,
        text: pt.title,
        blockIndex: pt.index,
        blockCount: 1,
        id: parTitleId(pt),
        uuid: pt.uuid,
        parentHeadingId,
      });
    }
  };
  const visit = (node: TreeNode) => {
    const h = node.heading;
    pods.push({
      type: "heading",
      depth: node.depth,
      level: h.level,
      text: h.text,
      blockIndex: h.index,
      // From this heading to the next heading of same/higher level — through
      // the SHARED section rule (task 285), whose doc-side adapter the reorder
      // handler uses. The indicator paints from this snapshot copy and the drop
      // lands by the live one, so a second implementation here would be a line
      // that can lie about where the blocks go.
      blockCount: sectionExtentFromHeadings(h.index, headings, totalBlocks),
      id: h.id,
      uuid: h.uuid,
      parentHeadingId: node.parentId,
      hasCollapsibleChildren: node.children.length > 0 || h.parTitles.length > 0,
    });
    pushTitles(h.parTitles, node.depth, h.id);
    node.children.forEach(visit);
  };

  pushTitles(preambleTitles, 0, undefined);
  tree.forEach(visit);
  return pods;
}

/**
 * Decide which pods are hidden because some ancestor heading is collapsed.
 * A pod is hidden if any heading on its parent chain is in `collapsed`.
 */
export function computeHiddenPods(
  pods: OutlinePod[],
  collapsed: Set<string>,
): Set<string> {
  const hidden = new Set<string>();
  // Map each heading id to its parent heading id for fast walks.
  const parentOf = new Map<string, string | undefined>();
  for (const p of pods) {
    if (p.type === "heading") parentOf.set(p.id, p.parentHeadingId);
  }
  const isAncestorCollapsed = (startParentId: string | undefined): boolean => {
    let cur = startParentId;
    while (cur) {
      if (collapsed.has(cur)) return true;
      cur = parentOf.get(cur);
    }
    return false;
  };
  for (const p of pods) {
    if (isAncestorCollapsed(p.parentHeadingId)) hidden.add(p.id);
  }
  return hidden;
}
