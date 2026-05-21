import { Mark, Extension, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Fragment as PMFragmentCtor, Slice as PMSliceCtor, type Node as PMNode2, type Fragment as PMFragment } from "@tiptap/pm/model";
import type { MutableRefObject } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// LinkedAnchor — invisible mark placed on a text range. Used by Notes,
// Revisions, and Cutter to link a side-panel card to a specific selection.
// The mark is *app state*, not document state: stripped on .tex export,
// re-applied on load from sidecar JSON snapshots. `inclusive: false` so
// typing at the edges does not extend the range.
// ─────────────────────────────────────────────────────────────────────────────

export const LinkedAnchor = Mark.create({
  name: "linkedAnchor",
  inclusive: false,
  spanning: true,

  addAttributes() {
    return {
      // Legacy attrs kept in JSON for persistence but not emitted to HTML —
      // data-link-* carry the same information for parsers.
      anchorId: { default: "", renderHTML: () => ({}) },
      kind: { default: "note", renderHTML: () => ({}) },
      linkId: { default: "", renderHTML: () => ({}) },
      linkKind: { default: "anchor", renderHTML: () => ({}) },
      linkCard: { default: "", renderHTML: () => ({}) },
      // Persistent highlight tint (Adobe-style). When set, CSS paints the
      // anchored text yellow unconditionally — independent of the
      // hover/selection-driven highlight states for other card kinds.
      // Survives kind transitions so a sibling note over a highlight's
      // range doesn't dim the existing yellow.
      tintColor: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-tint-color"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.tintColor ? { "data-tint-color": attrs.tintColor as string } : {},
      },
    };
  },

  parseHTML() {
    // Accept both the historical `data-anchor-id` tag and the new
    // `data-link-id` when `data-link-kind="anchor"`.
    return [
      { tag: "span[data-anchor-id]" },
      { tag: 'span[data-link-kind="anchor"]' },
    ];
  },

  renderHTML({ mark, HTMLAttributes }) {
    const anchorId =
      (mark.attrs.linkId as string) ||
      (mark.attrs.anchorId as string) ||
      "";
    // Prefer the explicit linkCard attr; fall back to a prefix derived
    // from the legacy `kind` attr so older anchors still get a per-kind
    // CSS color and the per-kind highlight toggle reaches them.
    let linkCard = (mark.attrs.linkCard as string) || "";
    if (!linkCard) {
      const legacyKind = (mark.attrs.kind as string) || "";
      const cardKind =
        legacyKind === "revision" ? "comment"
          : legacyKind === "note" ? "note"
          : legacyKind === "highlight" ? "highlight"
          : legacyKind === "cut" ? "cut"
          : "";
      if (cardKind) linkCard = `${cardKind}:`;
    }
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "linked-anchor",
        "data-link-id": anchorId,
        "data-link-kind": "anchor",
        "data-link-card": linkCard,
      }),
      0,
    ];
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// LinkedAnchorGuard — watches the doc for vanishing linkedAnchor ids and
// dispatches `virgil-anchor-orphaned` so each feature hook can clear the
// dead anchorId on its matching item. Also strips the mark from pasted
// slices to prevent duplicate-id collisions via copy-paste.
// ─────────────────────────────────────────────────────────────────────────────

function collectAnchorIds(doc: import("@tiptap/pm/model").Node): Map<string, string> {
  const ids = new Map<string, string>();
  doc.descendants((node) => {
    if (node.isText) {
      for (const m of node.marks) {
        if (m.type.name === "linkedAnchor") {
          const id = m.attrs.anchorId as string | undefined;
          const kind = (m.attrs.kind as string | undefined) || "note";
          if (id) ids.set(id, kind);
        }
      }
    }
    return true;
  });
  return ids;
}

export const LinkedAnchorGuard = Extension.create({
  name: "linkedAnchorGuard",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("linkedAnchorGuard"),
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const oldIds = collectAnchorIds(oldState.doc);
          if (oldIds.size === 0) return null;
          const newIds = collectAnchorIds(newState.doc);
          const vanished: Array<{ anchorId: string; kind: string }> = [];
          for (const [id, kind] of oldIds) {
            if (!newIds.has(id)) vanished.push({ anchorId: id, kind });
          }
          if (vanished.length === 0) return null;
          setTimeout(() => {
            for (const v of vanished) {
              window.dispatchEvent(
                new CustomEvent("virgil-anchor-orphaned", { detail: v })
              );
            }
          }, 0);
          return null;
        },
        props: {
          transformPasted(slice) {
            const rebuild = (frag: PMFragment): PMFragment => {
              const out: PMNode2[] = [];
              frag.forEach((n) => {
                if (n.isText) {
                  const filtered = n.marks.filter((m) => m.type.name !== "linkedAnchor");
                  out.push(filtered.length === n.marks.length ? n : n.mark(filtered));
                } else {
                  out.push(n.copy(rebuild(n.content)));
                }
              });
              return PMFragmentCtor.fromArray(out);
            };
            return new PMSliceCtor(rebuild(slice.content), slice.openStart, slice.openEnd);
          },
        },
      }),
    ];
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// MarginaliaAnchorGuard — prevents paragraph deletion from orphaning the
// cards attached to it. When a UUID-bearing block vanishes and it had
// any kind of card anchor — a gutter marginalia marker (tracked via the
// shared `anchoredUuidsRef`) OR an inline `linkedAnchor` mark inside it
// (notes / cuts / revisions text-range anchors) — the plugin re-inserts
// an empty paragraph carrying the same UUID at the deletion site. The
// card's `links[].anchor.paragraphIds` entry therefore stays valid and
// no card silently goes orphan through editor edits.
//
// To remove a card entirely, the user explicitly deletes it from the
// gutter (see `deleteMarginItem` in `src/lib/cards/delete-margin-item.ts`)
// or via the panel's trash button. This is the unified contract behind
// "cut down on unanchored cards".
// ─────────────────────────────────────────────────────────────────────────────

export const MarginaliaAnchorGuard = Extension.create<{
  anchoredUuidsRef: MutableRefObject<Set<string>>;
}>({
  name: "marginaliaAnchorGuard",

  addOptions() {
    return {
      anchoredUuidsRef: { current: new Set() } as MutableRefObject<Set<string>>,
    };
  },

  addProseMirrorPlugins() {
    const { anchoredUuidsRef } = this.options;
    return [
      new Plugin({
        key: new PluginKey("marginaliaAnchorGuard"),
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const anchored = anchoredUuidsRef.current;
          // Cheap short-circuit: if nothing in the doc is anchored, there
          // is nothing to preserve.
          const oldHasAnchorIds = collectAnchorIds(oldState.doc).size > 0;
          if (anchored.size === 0 && !oldHasAnchorIds) return null;

          // Walk oldState: collect every UUID-bearing block with its
          // start position and whether it hosted a linkedAnchor mark.
          // A block is worth preserving if it had a gutter marker
          // (anchored set) OR an inline text-range anchor (hasLinkedAnchor).
          type OldBlock = { uuid: string; pos: number; hasLinkedAnchor: boolean };
          const oldBlocks: OldBlock[] = [];
          oldState.doc.descendants((node, pos) => {
            const uuid = node.attrs?.uuid as string | undefined;
            if (!uuid) return true;
            let hasLinkedAnchor = false;
            node.descendants((child) => {
              if (hasLinkedAnchor) return false;
              if (
                child.isText &&
                child.marks.some((m) => m.type.name === "linkedAnchor")
              ) {
                hasLinkedAnchor = true;
                return false;
              }
              return true;
            });
            oldBlocks.push({ uuid, pos, hasLinkedAnchor });
            return true;
          });
          if (oldBlocks.length === 0) return null;

          const newUuids = new Set<string>();
          newState.doc.descendants((node) => {
            const uuid = node.attrs?.uuid as string | undefined;
            if (uuid) newUuids.add(uuid);
            return true;
          });

          const vanished: OldBlock[] = [];
          for (const ob of oldBlocks) {
            if (newUuids.has(ob.uuid)) continue;
            if (anchored.has(ob.uuid) || ob.hasLinkedAnchor) {
              vanished.push(ob);
            }
          }
          if (vanished.length === 0) return null;

          const paraType = newState.schema.nodes.paragraph;
          if (!paraType) return null;
          const tr = newState.tr;
          const docChangedMappings = transactions
            .filter((t) => t.docChanged)
            .map((t) => t.mapping);

          // Map each vanished block's old start-position forward through
          // the transaction mapping to find where to drop the placeholder.
          // Bias `-1` keeps us to the left of any deletion so the
          // placeholder lands at the deletion site, not past it.
          // Defensive fallback to end-of-doc if the result is out of range.
          type InsertSpec = { pos: number; uuid: string };
          const inserts: InsertSpec[] = [];
          const docSize = tr.doc.content.size;
          for (const v of vanished) {
            let pos = v.pos;
            for (const m of docChangedMappings) {
              pos = m.map(pos, -1);
            }
            if (!Number.isFinite(pos) || pos < 0) pos = docSize;
            if (pos > docSize) pos = docSize;
            inserts.push({ pos, uuid: v.uuid });
          }

          // Insert from the highest position backwards so each insert
          // doesn't shift the others. Earlier inserts at the same pos
          // stack in document order.
          inserts.sort((a, b) => b.pos - a.pos);
          for (const spec of inserts) {
            const emptyPara = paraType.create({ uuid: spec.uuid });
            const insertPos = Math.min(spec.pos, tr.doc.content.size);
            try {
              tr.insert(insertPos, emptyPara);
            } catch {
              // Schema may reject (e.g. position inside a non-block-
              // accepting container). Fall back to the end of the doc.
              try {
                tr.insert(tr.doc.content.size, emptyPara);
              } catch {
                /* give up on this one — better than crashing the doc */
              }
            }
          }
          tr.setMeta("addToHistory", false);
          return tr.steps.length > 0 ? tr : null;
        },
      }),
    ];
  },
});
