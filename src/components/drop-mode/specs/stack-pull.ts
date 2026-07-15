/**
 * Drop spec for stack pulls (`stack-pull:${stackId}`).
 *
 * Looks the snapshot up in `localStorage` (via `readStackItem`), then
 * dispatches per-payload-kind:
 *  - text     → insert slice at inline-cursor or between-blocks
 *  - paragraph → insert single paragraph at between-blocks with fresh uuid
 *  - heading  → insert heading + body at between-blocks with fresh uuids
 *  - card     → upsert any sidecar bib entries, then materialize a fresh
 *               card via the per-doc factories on `ctx.stack`.
 *
 * Stack pulls are paste-as-new — every id/uuid is regenerated. Block
 * uuids are reminted by `withFreshUuid`; Card-bearing inline-atom ids
 * (footnoteId / citationId, + the unified linkId mirror) by
 * `withFreshAtomIds`. Both run on the pull side so the snapshot stays a
 * faithful copy — the fresh identity is minted exactly where a fresh
 * presence is created. The source stack item is NOT removed (pulls are
 * copy, not pop); the X button on the thumbnail is the only deletion path.
 */

import { Node as PMNode, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { JSONContent } from "@tiptap/react";
import type { DropDecision, DropSpec, Placement } from "../types";
import { readStackItem } from "@/hooks/useStack";
import type { StackItem, StackPayload } from "@/lib/stack/types";
import { generateShortId } from "@/lib/uuid";
import { remintNestedAtomIds } from "@/lib/inline-content";
import { atomMetaForNodeName } from "@/lib/tiptap/atom-registry";

const ALLOWED_PLACEMENTS: ReadonlyArray<Placement["kind"]> = [
  "between-blocks",
  "inline-cursor",
  "paragraph-side",
];

export const stackPullDropSpec: DropSpec = {
  allowedPlacements: ALLOWED_PLACEMENTS,
  targetScope: "main-only",
  classifyDrop(placement, cardKey, ctx): DropDecision {
    const item = lookup(cardKey);
    if (!item) return { kind: "no-op" };
    const main = ctx.mainEditor;
    if (!main) return { kind: "no-op" };
    if (placement.editor !== main) return { kind: "no-op" };
    if (!isPlacementValidFor(item.payload, placement)) return { kind: "no-op" };
    // Cards that need a paragraph anchor but were dropped between blocks
    // succeed as unanchored — never a hard no-op.
    return { kind: "apply" };
  },
  applyDrop(placement, cardKey, ctx) {
    const item = lookup(cardKey);
    if (!item) return;
    const main = ctx.mainEditor;
    if (!main || placement.editor !== main) return;
    const p = item.payload;

    if (p.kind === "text") {
      insertText(main, placement, p);
      return;
    }
    if (p.kind === "paragraph") {
      insertParagraph(main, placement, p);
      return;
    }
    if (p.kind === "heading") {
      insertHeading(main, placement, p);
      return;
    }
    if (p.kind === "card") {
      applyCardDrop(item, placement, ctx);
      return;
    }
  },
  postDrop: "keep",
};

function lookup(cardKey: string): StackItem | null {
  const sep = cardKey.indexOf(":");
  if (sep <= 0) return null;
  const id = cardKey.slice(sep + 1);
  return readStackItem(id);
}

function isPlacementValidFor(
  payload: StackPayload,
  placement: Placement,
): boolean {
  switch (payload.kind) {
    case "text":
      return (
        placement.kind === "inline-cursor" || placement.kind === "between-blocks"
      );
    case "paragraph":
    case "heading":
      return placement.kind === "between-blocks";
    case "card":
      // Cards accept paragraph-side (anchored) or between-blocks
      // (unanchored). Inline-cursor doesn't fit any card kind in v1.
      return (
        placement.kind === "paragraph-side" ||
        placement.kind === "between-blocks"
      );
  }
}

// ── Text payload ──────────────────────────────────────────────────────
function insertText(
  editor: import("@tiptap/react").Editor,
  placement: Placement,
  payload: Extract<StackPayload, { kind: "text" }>,
) {
  if (placement.kind !== "inline-cursor" && placement.kind !== "between-blocks") {
    return;
  }
  // Remint any Card-bearing inline atoms in the slice content so a pulled
  // footnote/citation can't share the source atom's id (the text path is the
  // headline case — select text spanning a footnote → add to Stack → pull).
  const seen = collectAtomIds(editor.state.doc);
  const rawSlice = payload.slice as
    | ({ content?: JSONContent[] } & Record<string, unknown>)
    | null
    | undefined;
  const sliceJson =
    rawSlice && Array.isArray(rawSlice.content)
      ? { ...rawSlice, content: rawSlice.content.map((n) => withFreshAtomIds(n, seen)) }
      : rawSlice;
  let slice: Slice;
  try {
    slice = Slice.fromJSON(
      editor.state.schema,
      sliceJson as Parameters<typeof Slice.fromJSON>[1],
    );
  } catch (err) {
    console.error("[stack-pull] failed to rehydrate text slice:", err);
    return;
  }
  const target =
    placement.kind === "inline-cursor" ? placement.pos : placement.insertPos;
  const tr = editor.state.tr.replace(target, target, slice);
  // Try to select what was inserted so the user can see the landing point.
  try {
    const after = tr.doc.resolve(Math.min(tr.doc.content.size, target + slice.size));
    const $start = tr.doc.resolve(target);
    tr.setSelection(TextSelection.between($start, after));
  } catch {
    /* ignore selection failure — content is in regardless */
  }
  editor.view.dispatch(tr);
  editor.view.focus();
}

// ── Paragraph payload ─────────────────────────────────────────────────
function insertParagraph(
  editor: import("@tiptap/react").Editor,
  placement: Placement,
  payload: Extract<StackPayload, { kind: "paragraph" }>,
) {
  if (placement.kind !== "between-blocks") return;
  const seen = collectAtomIds(editor.state.doc);
  const json = withFreshAtomIds(withFreshUuid(payload.node), seen);
  let node: PMNode | null = null;
  try {
    node = editor.state.schema.nodeFromJSON(
      json as Parameters<typeof editor.state.schema.nodeFromJSON>[0],
    );
  } catch (err) {
    console.error("[stack-pull] failed to rehydrate paragraph:", err);
    return;
  }
  if (!node) return;
  const tr = editor.state.tr.insert(placement.insertPos, node);
  selectInserted(tr, placement.insertPos, node.nodeSize);
  editor.view.dispatch(tr);
  editor.view.focus();
}

// ── Heading payload ───────────────────────────────────────────────────
function insertHeading(
  editor: import("@tiptap/react").Editor,
  placement: Placement,
  payload: Extract<StackPayload, { kind: "heading" }>,
) {
  if (placement.kind !== "between-blocks") return;
  const seen = collectAtomIds(editor.state.doc);
  const nodes: PMNode[] = [];
  for (const j of payload.nodes) {
    try {
      const n = editor.state.schema.nodeFromJSON(
        withFreshAtomIds(withFreshUuid(j), seen) as Parameters<
          typeof editor.state.schema.nodeFromJSON
        >[0],
      );
      if (n) nodes.push(n);
    } catch (err) {
      console.error("[stack-pull] heading node rehydrate failed:", err);
    }
  }
  if (nodes.length === 0) return;
  const tr = editor.state.tr.insert(placement.insertPos, nodes);
  const totalSize = nodes.reduce((s, n) => s + n.nodeSize, 0);
  selectInserted(tr, placement.insertPos, totalSize);
  editor.view.dispatch(tr);
  editor.view.focus();
}

function selectInserted(
  tr: import("@tiptap/pm/state").Transaction,
  pos: number,
  size: number,
) {
  const start = pos + 1;
  const end = pos + size - 1;
  if (end <= start) return;
  try {
    const $start = tr.doc.resolve(start);
    const $end = tr.doc.resolve(end);
    tr.setSelection(TextSelection.between($start, $end));
  } catch {
    /* ignore */
  }
}

/** Recursively replace `attrs.uuid` with a freshly-generated value on the
 *  outer node AND any nested anchorable children. */
function withFreshUuid(json: import("@tiptap/react").JSONContent): import("@tiptap/react").JSONContent {
  if (!json || typeof json !== "object") return json;
  const next: import("@tiptap/react").JSONContent = { ...json };
  if (next.attrs && typeof next.attrs === "object") {
    const attrs = { ...(next.attrs as Record<string, unknown>) };
    if ("uuid" in attrs) attrs.uuid = generateShortId();
    next.attrs = attrs;
  }
  if (Array.isArray(next.content)) {
    next.content = next.content.map(withFreshUuid);
  }
  return next;
}

// ── Inline-atom identity remint ───────────────────────────────────────
/** Every Card-bearing inline-atom id currently live in `doc` — the
 *  `footnoteId`/`citationId` (via the ATOM_REGISTRY `idAttr`) plus its unified
 *  `linkId` mirror. Seeds the remint avoidance-set: on a SAME-doc pull the
 *  source atom stays in the doc (pull is copy, not pop), so its id lives here —
 *  which is exactly the collision `withFreshAtomIds` must never reproduce. */
function collectAtomIds(doc: PMNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    const meta = atomMetaForNodeName(node.type.name);
    if (meta?.idAttr) {
      const own = node.attrs[meta.idAttr];
      if (typeof own === "string" && own) ids.add(own);
      const linkId = node.attrs.linkId;
      if (typeof linkId === "string" && linkId) ids.add(linkId);
    }
    return true;
  });
  return ids;
}

/**
 * Remint every Card-bearing inline-atom id (footnoteId / citationId, plus the
 * unified linkId mirror kept in lock-step) inside a rehydrated blob, so a Stack
 * pull can never introduce a second atom that shares the SOURCE atom's id — a
 * same-doc paste-as-new would otherwise strand two footnote/citation atoms on
 * ONE id, and every id-keyed consumer (jump / edit / delete / pop-key, the
 * DocStructureObserver footnote/citation maps) resolves ambiguously to the
 * wrong atom. Atom kinds that own no cloneable Card identity (inlineMath /
 * labelRef → `idAttr: null`) are left untouched. `seen` accumulates every id
 * already live in the destination doc AND every id minted so far in this pull,
 * so no two atoms — existing or freshly-pulled — collide.
 *
 * The atom-id twin of `withFreshUuid`: block uuids and inline-atom ids are the
 * two identity axes a paste-as-new must regenerate. Reuses `remintNestedAtomIds`
 * so a `\cite` nested inside a footnote body (`attrs.content`) is reached the
 * same way the live editor reads it.
 */
function withFreshAtomIds(json: JSONContent, seen: Set<string>): JSONContent {
  return remintNestedAtomIds(json, (typeName) => {
    const meta = atomMetaForNodeName(typeName);
    if (!meta?.idAttr) return null; // ref / inline-math own no Card identity
    const fresh = generateShortId(seen);
    seen.add(fresh);
    return fresh;
  }).content;
}

// ── Card payload ──────────────────────────────────────────────────────
function applyCardDrop(
  item: StackItem,
  placement: Placement,
  ctx: import("../types").DropCtx,
) {
  const stack = ctx.stack;
  if (!stack) return;
  const p = item.payload;
  if (p.kind !== "card") return;
  const card = p.card;
  const paragraphId =
    placement.kind === "paragraph-side" ? placement.paragraphId : null;

  // Citation — upsert bib sidecars first so the destination doc can
  // resolve cite keys, then re-attach their user-authored annotations
  // (which live in a per-doc sidecar, not on the BibEntry, so they'd be
  // dropped by a cross-doc pull otherwise).
  if (card.cardKind === "citation") {
    const entries = "bibEntries" in card ? card.bibEntries : undefined;
    if (entries) {
      for (const e of entries) stack.upsertBibEntry(e);
    }
    const anns = "bibAnnotations" in card ? card.bibAnnotations : undefined;
    if (anns) {
      for (const [key, html] of Object.entries(anns)) {
        if (html) stack.setAnnotation?.(key, html);
      }
    }
  }

  switch (card.cardKind) {
    case "note":
      stack.addNote(paragraphId, {
        title: card.data.title,
        content: card.data.content,
      });
      return;
    case "highlight":
      // Highlights ride a text-range mark in the source doc — we have
      // no mark to attach here. v1: create a paragraph-anchored
      // placeholder if the spec exposes addHighlight, else fall back to
      // a note created from the highlight color (unusual; skip when
      // addHighlight is absent).
      stack.addHighlight?.(paragraphId);
      return;
    case "footnote":
      stack.addFootnote(card.data);
      return;
    case "citation":
      stack.addCitation(card.data);
      return;
    case "bibliography":
      stack.upsertBibEntry(card.data);
      // Re-attach the user-authored annotation carried by the snapshot so a
      // cross-doc pull doesn't silently lose it. Only fires when the snapshot
      // carried one, so a same-doc pull writes nothing spurious.
      if ("annotation" in card && card.annotation) {
        stack.setAnnotation?.(card.data.key, card.annotation);
      }
      return;
    case "todo":
      stack.addTodo(paragraphId, { text: card.data.text });
      return;
    case "archive":
      stack.addArchive(paragraphId, {
        title: card.data.title,
        content: card.data.content,
      });
      return;
    case "revision-comment":
      stack.addRevisionComment(paragraphId, card.data);
      return;
    case "revision-suggestion":
      stack.addRevisionSuggestion(paragraphId, card.data);
      return;
    case "cutter-comment":
      stack.addCutterComment(paragraphId, card.data);
      return;
    case "cutter-suggestion":
      stack.addCutterSuggestion(paragraphId, card.data);
      return;
    case "example":
      // Examples are tied to in-text \ex{...} blocks; the panel ref is
      // a sidecar mirror, not the source of truth. v1: no-op (the user
      // can't usefully drop a sidecar-only example into a new doc
      // without the matching \ex block). Future: synthesize an
      // exampleBlock node.
      return;
  }
}
