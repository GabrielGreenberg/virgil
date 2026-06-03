import { Mark, Extension, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Fragment as PMFragmentCtor, Slice as PMSliceCtor, type Node as PMNode2, type Fragment as PMFragment } from "@tiptap/pm/model";
import type { MutableRefObject } from "react";
import { readPendingDiff } from "@/lib/tiptap/doc-structure";
import { linkedAnchorRenderAttrs } from "@/lib/tiptap/linked-anchor-attrs";

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
      // `kind` drives the per-kind colour fallback in renderHTML. The
      // sentinel value "transient" marks the plain selection grab's
      // cardless range handle — renderHTML then omits data-link-card so the
      // anchor is invisible (see linked-anchor-attrs.ts).
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
    // Attribute policy (incl. the transient/cardless rule) lives in the
    // pure, unit-tested `linkedAnchorRenderAttrs`. A transient anchor (the
    // plain selection grab's invisible range handle) omits data-link-card
    // so no per-kind colour rule paints it; every other anchor is
    // byte-identical to before.
    return [
      "span",
      mergeAttributes(HTMLAttributes, linkedAnchorRenderAttrs(mark.attrs)),
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

export const LinkedAnchorGuard = Extension.create({
  name: "linkedAnchorGuard",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("linkedAnchorGuard"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          // Read the diff already computed by DocStructureObserver
          // (which runs before us). No doc walks — just the typed
          // delta the observer published.
          const diff = readPendingDiff(newState);
          if (!diff || diff.removedAnchors.length === 0) return null;
          setTimeout(() => {
            for (const a of diff.removedAnchors) {
              window.dispatchEvent(
                new CustomEvent("virgil-anchor-orphaned", {
                  detail: { anchorId: a.id, kind: a.kind },
                }),
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
// TextObjectOrphanGuard — sibling of LinkedAnchorGuard for Mode A links.
//
// Mode B (linkedAnchor marks) and Mode A (paragraphId / textObjectIds
// fields on the card itself) are two different schema mechanisms for
// anchoring a card to text. LinkedAnchorGuard above sweeps Mode B on
// mark removal. This plugin sweeps Mode A on BLOCK removal — when a
// paragraph / heading / listItem / etc. vanishes from the doc, Mode A
// cards that had recorded its uuid as `paragraphId` / `textObjectIds`
// are notified so they can drop the stale link.
//
// Pattern: read `diff.removedBlocks` from DocStructureObserver (already
// computed, O(1) per transaction), emit `virgil-textobject-orphaned`
// CustomEvents in a `setTimeout(0)` so the transaction commits first.
// Each Mode A hook (useTodos / useReports / useExamples / useArchive)
// listens and sweeps its own `links[]`. The handler MUST be O(removed)
// per event — pre-build an inverted index inside each hook so the
// listener doesn't walk every card on every removal.
//
// Overlap with MarginaliaAnchorGuard (below): that guard re-inserts a
// uuid-bearing empty paragraph when an *anchored* block vanishes, so
// blocks present in `anchoredUuidsRef` never actually become orphans.
// This guard is the safety net for blocks Mode-A-anchored but NOT
// gutter-tracked — common for cascade-extended deletions that swallow
// a wrapper (list / exampleBlock) whose uuid was anchored. See
// ACTION-MENU-DIAGNOSIS.md cluster C3.
// ─────────────────────────────────────────────────────────────────────────────

export const TextObjectOrphanGuard = Extension.create({
  name: "textObjectOrphanGuard",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("textObjectOrphanGuard"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const diff = readPendingDiff(newState);
          if (!diff || diff.removedBlocks.length === 0) return null;
          setTimeout(() => {
            for (const block of diff.removedBlocks) {
              window.dispatchEvent(
                new CustomEvent("virgil-textobject-orphaned", {
                  detail: { uuid: block.uuid, typeName: block.typeName },
                }),
              );
            }
          }, 0);
          return null;
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
// card's `links[].anchor.textObjectIds` entry therefore stays valid and
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
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          // Consume the typed diff already computed by
          // DocStructureObserver — no doc walks needed.
          const diff = readPendingDiff(newState);
          if (!diff) return null;
          if (
            diff.removedBlocks.length === 0 &&
            diff.removedAnchors.length === 0
          ) {
            return null;
          }

          // A block "needs preserving" if it had a gutter marker
          // (anchoredUuidsRef) or hosted any linkedAnchor mark
          // (signalled by removedAnchors that landed in the same range).
          const anchored = anchoredUuidsRef.current;
          // Track which removed-block UUIDs hosted a linkedAnchor we
          // also saw vanish. We can't recompute it after the fact, so
          // be conservative: if any anchor was removed, treat all
          // removed blocks as candidates (the orphan-event consumer
          // for inline anchors clears the card anyway; preserving the
          // paragraph here keeps gutter cards consistent).
          const anchorVanished = diff.removedAnchors.length > 0;

          type Vanished = { uuid: string; pos: number };
          const vanished: Vanished[] = [];
          for (const b of diff.removedBlocks) {
            if (anchored.has(b.uuid) || anchorVanished) {
              vanished.push({ uuid: b.uuid, pos: b.pos });
            }
          }
          if (vanished.length === 0) return null;

          const paraType = newState.schema.nodes.paragraph;
          if (!paraType) return null;
          const tr = newState.tr;
          const docChangedMappings = transactions
            .filter((t) => t.docChanged)
            .map((t) => t.mapping);

          // Map each vanished block's old start-position forward
          // through the transaction mapping. Bias -1 lands the
          // placeholder at the deletion site, not past it.
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

          inserts.sort((a, b) => b.pos - a.pos);
          for (const spec of inserts) {
            const emptyPara = paraType.create({ uuid: spec.uuid });
            const insertPos = Math.min(spec.pos, tr.doc.content.size);
            try {
              tr.insert(insertPos, emptyPara);
            } catch {
              try {
                tr.insert(tr.doc.content.size, emptyPara);
              } catch {
                /* give up — better than crashing the doc */
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
