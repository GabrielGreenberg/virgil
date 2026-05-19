import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface SectionFoldingState {
  folded: Set<string>;
}

export const sectionFoldingPluginKey = new PluginKey<SectionFoldingState>(
  "sectionFolding",
);

type Meta =
  | { action: "toggle"; uuid: string }
  | { action: "collapseAll" }
  | { action: "expandAll" }
  | { action: "setFolded"; uuids: string[] };

/**
 * Collect the UUIDs of every top-level heading in the document. Folding only
 * applies to top-level headings (direct children of the doc) since that's
 * where the chevron is rendered.
 */
function collectHeadingUuids(doc: PMNode): string[] {
  const uuids: string[] = [];
  doc.forEach((node) => {
    if (node.type.name === "heading" && node.attrs?.uuid) {
      uuids.push(node.attrs.uuid as string);
    }
  });
  return uuids;
}

/**
 * Returns the list of top-level block ranges that should be hidden because
 * they sit under a folded heading. A folded heading hides everything until
 * the next heading of the same or higher (smaller-level-number) level.
 */
function computeFoldedChildIndices(
  doc: PMNode,
  folded: Set<string>,
): Set<number> {
  const hidden = new Set<number>();
  if (folded.size === 0) return hidden;
  // Stack of active fold levels. A heading at level L closes every active
  // fold whose level is >= L. Blocks inside any active fold are hidden,
  // including nested sub-headings.
  const foldStack: number[] = [];
  doc.forEach((node, _offset, i) => {
    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      while (foldStack.length > 0 && foldStack[foldStack.length - 1] >= level) {
        foldStack.pop();
      }
      if (foldStack.length > 0) hidden.add(i);
      const uuid = node.attrs.uuid as string | null;
      if (uuid && folded.has(uuid)) {
        foldStack.push(level);
      }
    } else if (foldStack.length > 0) {
      hidden.add(i);
    }
  });
  return hidden;
}

export function getSectionFoldingState(
  state: EditorState,
): SectionFoldingState {
  return (
    sectionFoldingPluginKey.getState(state) ?? { folded: new Set<string>() }
  );
}

export function isHeadingFolded(state: EditorState, uuid: string): boolean {
  return getSectionFoldingState(state).folded.has(uuid);
}

const EMPTY_HIDDEN_INDICES: ReadonlySet<number> = new Set<number>();

/**
 * Set of top-level doc child indices that are currently hidden because they
 * sit under a folded heading. Reference-stable empty set when nothing is
 * folded, suitable for use as a memo dependency.
 */
export function getHiddenTopLevelIndices(
  state: EditorState,
): ReadonlySet<number> {
  const { folded } = getSectionFoldingState(state);
  if (folded.size === 0) return EMPTY_HIDDEN_INDICES;
  return computeFoldedChildIndices(state.doc, folded);
}

/** Are there any headings currently folded? */
export function hasFolded(state: EditorState): boolean {
  return getSectionFoldingState(state).folded.size > 0;
}

/** Are there any top-level headings not folded? (used to enable collapseAll) */
export function hasExpanded(state: EditorState): boolean {
  const { folded } = getSectionFoldingState(state);
  const all = collectHeadingUuids(state.doc);
  return all.some((u) => !folded.has(u));
}

export function sectionFoldingPlugin(): Plugin<SectionFoldingState> {
  return new Plugin<SectionFoldingState>({
    key: sectionFoldingPluginKey,
    state: {
      init: () => ({ folded: new Set<string>() }),
      apply(tr, value, _oldState, newState): SectionFoldingState {
        const meta = tr.getMeta(sectionFoldingPluginKey) as Meta | undefined;
        if (meta) {
          if (meta.action === "toggle") {
            const next = new Set(value.folded);
            if (next.has(meta.uuid)) next.delete(meta.uuid);
            else next.add(meta.uuid);
            return { folded: next };
          }
          if (meta.action === "collapseAll") {
            return { folded: new Set(collectHeadingUuids(newState.doc)) };
          }
          if (meta.action === "expandAll") {
            return { folded: new Set() };
          }
          if (meta.action === "setFolded") {
            const alive = new Set(collectHeadingUuids(newState.doc));
            const next = new Set<string>();
            for (const u of meta.uuids) if (alive.has(u)) next.add(u);
            return { folded: next };
          }
        }
        // Doc may have changed — prune UUIDs that no longer exist so fold
        // state doesn't linger on removed headings.
        if (tr.docChanged && value.folded.size > 0) {
          const alive = new Set(collectHeadingUuids(newState.doc));
          let changed = false;
          const next = new Set<string>();
          for (const u of value.folded) {
            if (alive.has(u)) next.add(u);
            else changed = true;
          }
          if (changed) return { folded: next };
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        const folded = this.getState(state)?.folded;
        if (!folded || folded.size === 0) return DecorationSet.empty;
        const hiddenIdx = computeFoldedChildIndices(state.doc, folded);
        if (hiddenIdx.size === 0) return DecorationSet.empty;
        const decos: Decoration[] = [];
        let offset = 0;
        state.doc.forEach((node, _o, i) => {
          if (hiddenIdx.has(i)) {
            decos.push(
              Decoration.node(offset, offset + node.nodeSize, {
                class: "section-folded",
              }),
            );
          }
          offset += node.nodeSize;
        });
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}
