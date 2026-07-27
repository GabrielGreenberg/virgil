/**
 * The atom-aware inline-content reader (T3 / C10 read side).
 *
 * The codebase had no single, atom-aware notion of "the inline content of a
 * structured node." Each consumer re-derived it ad hoc, and every ad-hoc
 * derivation silently agreed on the same blind spot: an inline atom carries its
 * payload either (a) in `attrs` (not `node.textContent`) or (b) — for the
 * footnote — as a JSONContent *literal* in `attrs.content`, a place
 * ProseMirror's `doc.descendants()` does NOT enter (the footnote is
 * `inline:true, atom:true`). So a `\cite` / math atom nested inside a footnote
 * was invisible: mis-anchored, dropped from a flatten, or handed a dead jump
 * arrow.
 *
 * This module knows BOTH hiding places and exposes them uniformly. It absorbs
 * and generalizes:
 *   - `src/lib/atom-text.ts` `getAtomText()` (Place A — attr-borne payload),
 *   - `src/components/citation-doc-ops.ts` `walkJsonContentForCitations` /
 *     `removeCitationFromJsonContent` (Place B — footnote-nested literal).
 *
 * `descendInto` defaults to `["footnote"]` — the only atom whose body holds
 * further atoms today (figure/example are block-atoms reached by the doc walk).
 * Add a new atom-with-inner-atoms kind here and EVERY consumer that routes
 * through this module sees it the day it ships, instead of the day someone
 * remembers to patch each walk.
 *
 * Keystroke sanctity: nothing here subscribes to the editor or runs per
 * keystroke. `flattenInlineText` runs only in structural-counter-gated memos /
 * one-shot rename seeds; `findInlineAtomPosDeep` runs only on jump/hover/select.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor, JSONContent } from "@tiptap/react";
// Task 230: the footnote/citation → id-attr map is the registry's `idAttr`
// facet — read it off ATOM_REGISTRY rather than re-encoding the ternary here, so
// this by-id resolver shares the single source of truth (peer: stack-pull.ts,
// which resolves `node.attrs[meta.idAttr]` the same registry way).
import { atomMetaForNodeName } from "./tiptap/atom-registry";

// ---------------------------------------------------------------------------
// Place A — attr-borne atom payload (absorbed from atom-text.ts)
// ---------------------------------------------------------------------------

type AtomTextExtractor = (attrs: Record<string, unknown>) => string;

/**
 * "What's the text representation of this atom node?" Block- and inline-atom
 * nodes don't carry their payload as `textContent` — it lives in attrs
 * (`code`, `latex`, `text`, `src`). Without this, consumers fall back to
 * `textContent` and silently get `""` for every atom.
 *
 * This is the EXACT set the legacy `atom-text.ts` `getAtomText` covered — kept
 * identical so `getAtomText` (and its NodeSelection-copy call site) behaves
 * byte-for-byte as before. Keyed on type name so it works against both a live
 * PM `Node` and a raw `JSONContent` literal (a footnote body).
 */
const ATOM_TEXT: Record<string, AtomTextExtractor> = {
  texBlock: (a) => (a.code as string) || "",
  displayMath: (a) => (a.latex as string) || "",
  inlineMath: (a) => (a.latex as string) || "",
  // latexComment is NOT here: it's no longer an attr-borne atom — it's an
  // editable block with native inline content, so `flattenInlineText` walks its
  // text children directly (and `atomTextOf` returns null for it).
  figureBlock: (a) => (a.src as string) || "",
  graphicsBlock: (a) => (a.src as string) || "",
};

/**
 * Display-text extractors for command-bearing inline atoms — citation/labelRef
 * carry their payload in `command`/`displayText`, not `latex`. These are used
 * by the FLATTEN path (`flattenInlineText`, for outline rows / search text)
 * only; they are intentionally NOT in `ATOM_TEXT` so `getAtomText` (clipboard /
 * archive-label copy) keeps its prior behavior of returning `""` for a selected
 * citation atom.
 */
const ATOM_DISPLAY_TEXT: Record<string, AtomTextExtractor> = {
  citation: (a) => (a.displayText as string) || (a.command as string) || "",
  labelRef: (a) =>
    (a.displayText as string) ||
    (a.command as string) ||
    (a.label as string) ||
    "",
};

/**
 * The core atom-text registry as a name→text lookup (the `getAtomText` set).
 * Returns null when `typeName` is not an attr-borne atom, so a consumer can
 * detect "is this an attr-borne atom?" without re-listing the kinds.
 */
export function atomTextOf(
  typeName: string,
  attrs: Record<string, unknown> | undefined | null,
): string | null {
  const fn = ATOM_TEXT[typeName];
  if (!fn) return null;
  return fn(attrs ?? {});
}

/** Like `atomTextOf` but also covers command-bearing display atoms
 *  (citation/labelRef). Used by the flatten path. */
function displayTextOf(
  typeName: string,
  attrs: Record<string, unknown>,
): string | null {
  const core = ATOM_TEXT[typeName];
  if (core) return core(attrs);
  const disp = ATOM_DISPLAY_TEXT[typeName];
  if (disp) return disp(attrs);
  return null;
}

// ---------------------------------------------------------------------------
// Shared node shape — works for a live PM Node OR a raw JSONContent literal
// ---------------------------------------------------------------------------

const DEFAULT_DESCEND: readonly string[] = ["footnote"];

interface InlineContentOpts {
  /** Atom kinds whose `attrs.content` JSONContent literal we recurse into.
   *  Defaults to `["footnote"]` — the only atom holding further atoms today. */
  descendInto?: readonly string[];
}

/** A normalized view over either a PM Node or a JSONContent literal. */
interface NodeShape {
  typeName: string;
  attrs: Record<string, unknown>;
  /** Plain text for a text node (only meaningful when `typeName === "text"`). */
  text?: string;
  /** Direct children, normalized. */
  children: NodeShape[];
}

function shapeOfPM(node: PMNode): NodeShape {
  const children: NodeShape[] = [];
  node.forEach((child) => children.push(shapeOfPM(child)));
  return {
    typeName: node.type.name,
    attrs: (node.attrs as Record<string, unknown>) ?? {},
    text: node.isText ? node.text ?? "" : undefined,
    children,
  };
}

function shapeOfJSON(json: JSONContent): NodeShape {
  const children = Array.isArray(json.content)
    ? json.content.map((c) => shapeOfJSON(c))
    : [];
  return {
    typeName: json.type ?? "",
    attrs: (json.attrs as Record<string, unknown>) ?? {},
    text: json.type === "text" ? json.text ?? "" : undefined,
    children,
  };
}

function toShape(node: PMNode | JSONContent): NodeShape {
  // A PM Node has a `.type` object with a `.name`; a JSONContent has a string
  // `.type`. Discriminate on that.
  if (
    typeof (node as PMNode).type === "object" &&
    (node as PMNode).type !== null
  ) {
    return shapeOfPM(node as PMNode);
  }
  return shapeOfJSON(node as JSONContent);
}

/** Pull the JSONContent literal stashed in an atom's `attrs.content`, if any. */
function nestedContentOf(shape: NodeShape): JSONContent | null {
  const content = shape.attrs.content;
  if (content && typeof content === "object") return content as JSONContent;
  return null;
}

// ---------------------------------------------------------------------------
// inlineAtoms — the single atom-aware traversal
// ---------------------------------------------------------------------------

export interface InlineAtomHit {
  kind: string;
  /** The atom's stable id: `linkId` ?? `citationId`/`footnoteId` ?? "". */
  id: string;
  command?: string;
  displayText?: string;
  /** Type-name path from the root to this atom, e.g. ["footnote","citation"].
   *  Length > 1 means the atom is nested inside another atom's literal. */
  path: string[];
  /** The id of the nearest enclosing descend-into atom (e.g. the host
   *  footnote), or null when the hit is top-level. */
  nestedInId: string | null;
}

function idOf(attrs: Record<string, unknown>): string {
  return (
    (attrs.linkId as string) ||
    (attrs.citationId as string) ||
    (attrs.footnoteId as string) ||
    ""
  );
}

/**
 * Walk a node's inline content INCLUDING atoms' `attrs.content` literals,
 * yielding every atom (text nodes are skipped — use `flattenInlineText` for
 * text). The footnote-nested `\cite` that `descendants()` can't see is yielded
 * with `path: ["footnote","citation"]` and `nestedInId` = the host footnote id.
 *
 * Accepts a live PM `Node` OR a raw `JSONContent` literal (so it works on a
 * footnote body directly). This is the single generalization of
 * `walkJsonContentForCitations` (filter `kind === "citation"`) and the citation
 * collectors.
 */
export function* inlineAtoms(
  node: PMNode | JSONContent,
  opts?: InlineContentOpts,
): Generator<InlineAtomHit> {
  const descendInto = opts?.descendInto ?? DEFAULT_DESCEND;
  yield* walkAtoms(toShape(node), [], null, descendInto);
}

/** An atom kind is "tracked" — yielded by `inlineAtoms` — if it carries a
 *  payload (math/cite/ref/tex/figure) or is itself a descend-into container
 *  (footnote). Plain text and structural containers (paragraph/doc/list) are
 *  not atoms; they're traversed but not yielded. */
function isTrackedAtomKind(
  typeName: string,
  descendInto: readonly string[],
): boolean {
  if (typeName === "text" || typeName === "") return false;
  return (
    typeName in ATOM_TEXT ||
    typeName in ATOM_DISPLAY_TEXT ||
    typeName === "footnote" ||
    descendInto.includes(typeName)
  );
}

function* walkAtoms(
  shape: NodeShape,
  path: string[],
  nestedInId: string | null,
  descendInto: readonly string[],
): Generator<InlineAtomHit> {
  for (const child of shape.children) {
    const childId = idOf(child.attrs);
    const childPath = [...path, child.typeName];

    // Emit the child itself if it is an atom kind we track.
    if (isTrackedAtomKind(child.typeName, descendInto)) {
      yield {
        kind: child.typeName,
        id: childId,
        command: child.attrs.command as string | undefined,
        displayText: child.attrs.displayText as string | undefined,
        path: childPath,
        nestedInId,
      };
    }

    // Recurse into structural children (paragraph, doc, list, …).
    if (child.children.length > 0) {
      yield* walkAtoms(child, childPath, nestedInId, descendInto);
    }

    // Descend into an atom's `attrs.content` literal (the footnote body):
    // anything inside is nested under this child's id.
    if (descendInto.includes(child.typeName)) {
      const nested = nestedContentOf(child);
      if (nested) {
        yield* walkAtoms(
          shapeOfJSON(nested),
          childPath,
          childId || nestedInId,
          descendInto,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// flattenInlineText — atom-aware text projection (replacement for extractText)
// ---------------------------------------------------------------------------

/**
 * Flatten a node's inline content to display text, atom-aware: an attr-borne
 * atom (`inlineMath` → its latex, `citation` → its display) contributes its
 * text instead of the empty string a naive `if (type==="text")` walk returns,
 * and footnote bodies are descended into. This is THE replacement for the
 * flatten-lossy `OutlinePanel.extractText` / `getDocTitle` / drag-ghost label
 * (`OUT-F1-01`, `OUT-F4-01`) and the footnote-content search descent
 * (`SR-F4-01`) — those call sites are rewired in a later wave.
 *
 * Accepts a live PM `Node` OR a raw `JSONContent` literal.
 */
export function flattenInlineText(
  node: PMNode | JSONContent,
  opts?: InlineContentOpts,
): string {
  const descendInto = opts?.descendInto ?? DEFAULT_DESCEND;
  return flattenShape(toShape(node), descendInto);
}

function flattenShape(shape: NodeShape, descendInto: readonly string[]): string {
  // A text leaf contributes its text.
  if (shape.typeName === "text") return shape.text ?? "";

  // A footnote (or other descend-into atom) contributes its body's flattened
  // text — its attr-text would be the empty payload, so prefer body.
  if (descendInto.includes(shape.typeName)) {
    const nested = nestedContentOf(shape);
    if (nested) return flattenShape(shapeOfJSON(nested), descendInto);
    return displayTextOf(shape.typeName, shape.attrs) ?? "";
  }

  // An attr-borne / display atom contributes its registered text
  // (math latex, citation display) instead of an empty string.
  const attrText = displayTextOf(shape.typeName, shape.attrs);
  if (attrText !== null && shape.children.length === 0) return attrText;

  // Otherwise it's a container — concatenate children.
  return shape.children.map((c) => flattenShape(c, descendInto)).join("");
}

// ---------------------------------------------------------------------------
// findInlineAtomPosDeep — atom position by id, descending into footnotes
// ---------------------------------------------------------------------------

/**
 * The resolved location of an inline atom.
 *  - top-level hit → `{ pos }` (the atom's own PM position).
 *  - footnote-nested hit → `{ pos: <host footnote pos>, nested: true,
 *      hostFootnoteId }` — the nested atom has NO own DOM, so the only
 *      scrollable target is the host footnote's superscript marker.
 */
export type InlineAtomLocation =
  | { pos: number; nested: false }
  | { pos: number; nested: true; hostFootnoteId: string };

/**
 * Resolve the PM position of an inline atom by id.
 *
 * 1. **Top-level fast-path** (de-risk, keystroke-cheap): a `doc.descendants`
 *    scan for a same-kind node carrying the id, exactly as the legacy
 *    `findInlineAtomPos` did. A top-level atom resolves IDENTICALLY to today
 *    (`{ pos, nested: false }`). The scan early-exits on the first hit.
 * 2. **Footnote descent on miss only**: if not found at top level, scan
 *    footnotes' `attrs.content` literals for the id. A hit returns the HOST
 *    footnote's pos with `nested: true` so the jump path scrolls to the marker
 *    (`BIB-F3-01` / `CI-F3-01`).
 *
 * Returns null if the id is nowhere in the doc.
 */
export function findInlineAtomPosDeep(
  editor: Editor,
  nodeName: "footnote" | "citation",
  id: string,
  opts?: InlineContentOpts,
): InlineAtomLocation | null {
  const idAttr = atomMetaForNodeName(nodeName)?.idAttr;
  // The registry guarantees a non-null idAttr for footnote/citation (the two
  // Card-bearing atoms), so this guard never fires for the typed inputs — it
  // just restores the exact non-null `string` the old ternary produced.
  if (!idAttr) return null;

  // --- 1. Top-level fast-path (unchanged behavior for the common case) ---
  let topPos: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (topPos != null) return false;
    if (node.type.name !== nodeName) return true;
    const attrs = node.attrs as Record<string, unknown>;
    if (attrs.linkId === id || attrs[idAttr] === id) {
      topPos = pos;
      return false;
    }
    return true;
  });
  if (topPos != null) return { pos: topPos, nested: false };

  // --- 2. Footnote descent (only on a top-level miss) ---
  const descendInto = opts?.descendInto ?? DEFAULT_DESCEND;
  // Only worth descending if footnotes are a descend-into kind and we're
  // looking for a kind that can live inside one (any inline atom can).
  if (!descendInto.includes("footnote")) return null;

  let hostPos: number | null = null;
  let hostFootnoteId = "";
  editor.state.doc.descendants((node, pos) => {
    if (hostPos != null) return false;
    if (node.type.name !== "footnote" || !node.attrs.content) return true;
    const body = node.attrs.content as JSONContent;
    for (const hit of inlineAtoms(body, { descendInto })) {
      if (hit.kind === nodeName && hit.id === id) {
        hostPos = pos;
        hostFootnoteId =
          (node.attrs.linkId as string) ||
          (node.attrs.footnoteId as string) ||
          "";
        return false;
      }
    }
    return true;
  });
  if (hostPos != null) {
    return { pos: hostPos, nested: true, hostFootnoteId };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Re-implemented citation-doc-ops walkers on top of inlineAtoms.
// Kept here so the two partial walkers stop drifting; citation-doc-ops.ts
// re-exports these (named exports + their tests preserved).
// ---------------------------------------------------------------------------

/**
 * Walk a JSONContent tree and invoke `visit` for every citation node, INCLUDING
 * cites nested inside footnote bodies. Generalization of the old
 * `walkJsonContentForCitations`: filters `inlineAtoms` to the `citation` kind.
 */
export function walkJsonContentForCitations(
  json: JSONContent | null | undefined,
  visit: (cit: {
    citationId: string;
    command: string;
    displayText: string;
  }) => void,
): void {
  if (!json) return;
  // The legacy walker treated the ROOT node itself as a possible citation
  // (a bare citation literal). Preserve that.
  if (json.type === "citation" && json.attrs) {
    const a = json.attrs as Record<string, unknown>;
    visit({
      citationId: (a.citationId as string) || "",
      command: (a.command as string) || "",
      displayText: (a.displayText as string) || "",
    });
  }
  for (const hit of inlineAtoms(json)) {
    if (hit.kind !== "citation") continue;
    visit({
      citationId: hit.id,
      command: hit.command ?? "",
      displayText: hit.displayText ?? "",
    });
  }
}

/**
 * Return a deep copy of a JSON tree with every nested `citation` whose id
 * matches `citationId` removed, plus whether any was removed. Matches on either
 * `citationId` or the unified `linkId` attr. Pure (no input mutation); returns
 * the original reference untouched when nothing matched so callers can skip a
 * no-op transaction. (Unchanged behavior — the prune is structural, not
 * traversal-blind-spot-prone, so it stays a direct recursion.)
 */
export function removeCitationFromJsonContent(
  json: JSONContent,
  citationId: string,
): { content: JSONContent; removed: boolean } {
  let removed = false;
  const prune = (node: JSONContent): JSONContent | null => {
    if (node.type === "citation" && node.attrs) {
      const a = node.attrs as Record<string, unknown>;
      if (a.citationId === citationId || a.linkId === citationId) {
        removed = true;
        return null; // drop this node
      }
    }
    if (Array.isArray(node.content)) {
      const kept = node.content
        .map((child) => prune(child))
        .filter((c): c is JSONContent => c !== null);
      return { ...node, content: kept };
    }
    return { ...node };
  };
  const next = prune(json) ?? json;
  return { content: next, removed };
}

/** The id attrs an inline atom carries. Re-identifying an atom means replacing
 *  whichever of these currently holds the old id (plus the unified `linkId`
 *  mirror, kept in lock-step so an identity-cascade-managed atom stays unified). */
const ATOM_ID_ATTRS = ["citationId", "footnoteId", "linkId"] as const;

export interface RemintedAtom {
  typeName: string;
  oldId: string;
  newId: string;
}

/**
 * Return a deep copy of a JSONContent blob (e.g. a footnote body) with every
 * nested inline-atom id re-minted via `remint` — the WRITE-side twin of
 * {@link removeCitationFromJsonContent}. For each node carrying an atom id
 * (`citationId` / `footnoteId`, or the unified `linkId`), calls
 * `remint(typeName, oldId)`; a non-null return replaces the id attr(s), a null
 * (or an unchanged id) leaves the atom untouched — for atom kinds with no
 * cloneable sidecar identity (`inlineMath` / `labelRef`) or when the caller
 * declines. Recurses into `content` arrays AND into any atom's own
 * `attrs.content` literal, so a `\cite` inside a footnote inside … is reached
 * the same way `inlineAtoms` reads it.
 *
 * WHY THIS EXISTS: an inline atom's identity can hide inside a footnote's
 * `attrs.content` blob — the one place `doc.descendants()` won't enter. The
 * duplicate-slice walker re-identifies every TOP-LEVEL atom (clone sidecar +
 * remint id) but treated the footnote as an opaque atom and copied its body
 * verbatim, so a footnote-nested `\cite` kept the SOURCE's citationId with no
 * cloned CitationRef — two footnotes stranded on one citation identity, a
 * duplicate-id sidecar, and a delete that struck both (task 080). This lets the
 * walker re-identify a footnote-nested atom the SAME way it does a top-level one.
 *
 * Pure — never mutates the input; returns the original reference untouched when
 * nothing was reminted so callers can skip a no-op write.
 */
export function remintNestedAtomIds(
  blob: JSONContent,
  remint: (typeName: string, oldId: string) => string | null,
): { content: JSONContent; remapped: RemintedAtom[] } {
  const remapped: RemintedAtom[] = [];

  const walk = (node: JSONContent): JSONContent => {
    let out = node;

    // 1. Re-identify this node if it is an atom carrying an id the caller wants
    //    reminted. `idOf` reads linkId ?? citationId ?? footnoteId.
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (attrs && node.type) {
      const oldId = idOf(attrs);
      if (oldId) {
        const newId = remint(node.type, oldId);
        if (newId && newId !== oldId) {
          const nextAttrs: Record<string, unknown> = { ...attrs };
          for (const key of ATOM_ID_ATTRS) {
            if (nextAttrs[key] === oldId) nextAttrs[key] = newId;
          }
          out = { ...out, attrs: nextAttrs };
          remapped.push({ typeName: node.type, oldId, newId });
        }
      }
    }

    // 2. Descend into this atom's own content blob (a footnote body), if any —
    //    symmetric with `inlineAtoms`' descend-into-`attrs.content`.
    const nested = out.attrs?.content;
    if (nested && typeof nested === "object") {
      const rewritten = walk(nested as JSONContent);
      if (rewritten !== nested) {
        out = { ...out, attrs: { ...out.attrs, content: rewritten } };
      }
    }

    // 3. Recurse into structural children (doc → paragraph → citation …).
    if (Array.isArray(out.content)) {
      const kids = out.content.map(walk);
      if (kids.some((k, i) => k !== (out.content as JSONContent[])[i])) {
        out = { ...out, content: kids };
      }
    }

    return out;
  };

  return { content: walk(blob), remapped };
}
