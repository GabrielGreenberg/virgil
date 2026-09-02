import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { isLabelTaken } from "@/lib/labels";

/**
 * LABEL RENAME — the ONE door every rename of a `\label{…}` declaration enters
 * (task 534).
 *
 * A label is a KEY that other places in the paper point at through `\ref`, so
 * renaming the declaration is never a one-node edit: every `labelRef` naming
 * the old key either follows it or is orphaned (a `??` in the compiled PDF).
 * Three surfaces rename a label — the heading strip's lozenge (a vanilla-DOM
 * NodeView, `editor-extensions.ts`), the figure's lozenge (`FigureAnnotation`,
 * a React NodeView), and the Outline panel's inline label editor (through
 * `useEditorOps.handleUpdateLabel`) — and pre-534 the first two each carried a
 * private copy of the "collect refs → ask → rewrite in the same transaction"
 * walk while the third carried none. Both copies were DEAD: they read their
 * confirm handler off a prop (`onConfirmLabelRename`) that `EditorPane` never
 * supplied, so `updateRefs` was `false` on every path in production and every
 * rename orphaned every ref, silently, for the five months since `0f1761ef`.
 *
 * The rule the door states once:
 *
 *   • the DECLARING node is located by the caller (`locate`), against the
 *     editor that holds the SOURCE OF TRUTH — main, even when the gesture
 *     happens in a popped-out float, which is what lets the ref walk cover the
 *     whole document rather than the float's one section;
 *   • a candidate already claimed by ANOTHER declaration is REFUSED — the same
 *     `@/lib/labels` predicate the live "label already in use" warning reads,
 *     so the warning and the commit can never disagree (the rule the Outline
 *     commit earned as OUT-F8-03, now held by every surface);
 *   • when the rename has refs to carry, the door ASKS (`confirm`) and, on
 *     yes, moves the declaration AND every ref in ONE transaction — one undo
 *     step, one autosave arm, no window in which the paper is inconsistent;
 *   • a rename with NO confirm handler in hand carries its refs. That is the
 *     fail-toward-not-orphaning default: the confirm exists to let a user
 *     deliberately KEEP refs on the old key (they mean to re-declare it), and
 *     "nobody wired a dialog" is not that decision. The census
 *     (`editor-callback-producer-census.test.ts`) keeps production from ever
 *     reaching this default — every optional callback `Editor.tsx` consumes
 *     has a producer at the one `<VirgilEditor>` mount — so the default is a
 *     statement about harnesses and about what a missing wire must COST.
 *
 * What the door deliberately does NOT do: touch a ref's `displayText`. The
 * heading/figure/example NUMBERER (`editor-extensions.ts`) re-derives every
 * `labelRef`'s display on any structural change — and a label rename IS one
 * (`changedHeadings` / `changedFigures`) — so the display follows on the same
 * dispatch's `appendTransaction`. Two writers of one derived attr is how they
 * come to disagree.
 */

export type LabelRenameConfirm = (
  oldLabel: string,
  newLabel: string,
  refCount: number,
) => Promise<boolean>;

export type LabelRenameOutcome =
  /** The declaration (and, when carried, its refs) moved in one transaction. */
  | "renamed"
  /** Old and new key are equal after trimming — nothing to write. */
  | "unchanged"
  /** The candidate is claimed by ANOTHER declaration — refused, nothing written. */
  | "conflict"
  /** `locate` answered null (before or after the confirm) — nothing written. */
  | "unresolved";

export interface LabelRenameOptions {
  /** Resolve the declaring node in `target` — by live position on the page,
   *  by uuid from a float or the Outline. Called twice when a confirm is
   *  awaited (the doc may have moved under the modal). */
  locate: () => { pos: number; node: PMNode } | null;
  /** The new key. Empty / whitespace / `null` clears the label. */
  newLabel: string | null;
  /** Asked only for a NON-EMPTY → NON-EMPTY rename that has refs to carry.
   *  `null` / `undefined` ⇒ the refs are carried without asking (see above). */
  confirm?: LabelRenameConfirm | null;
}

/** Every `labelRef` in `doc` that names `label`, by position. */
export function collectLabelRefPositions(doc: PMNode, label: string): number[] {
  const out: number[] = [];
  doc.descendants((nd, pos) => {
    if (nd.type.name === "labelRef" && nd.attrs.label === label) out.push(pos);
  });
  return out;
}

/** The value a CLEARED label takes on this node — the schema's own default
 *  (`null` on a heading, `""` on a figure), never a per-kind hand list. */
function clearedLabelFor(node: PMNode): unknown {
  const spec = node.type.spec.attrs?.label;
  return spec && "default" in spec ? spec.default : null;
}

function currentLabelOf(node: PMNode): string | null {
  const v = node.attrs.label;
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function renameLabelWithRefs(
  target: Editor,
  opts: LabelRenameOptions,
): Promise<LabelRenameOutcome> {
  const first = opts.locate();
  if (!first) return "unresolved";
  const oldLabel = currentLabelOf(first.node);
  const trimmed = opts.newLabel?.trim() ?? "";
  const newLabel: string | null = trimmed.length > 0 ? trimmed : null;
  if (newLabel === oldLabel) return "unchanged";

  // The commit gate reads the SAME predicate the live warnings read.
  if (newLabel && isLabelTaken(target, newLabel, oldLabel)) return "conflict";

  // Refs are carried only for a rename between two non-empty keys: an ADD has
  // no refs yet, and a CLEAR has nowhere to point them.
  const refPositions =
    oldLabel && newLabel ? collectLabelRefPositions(target.state.doc, oldLabel) : [];

  let carryRefs = refPositions.length > 0;
  if (carryRefs && oldLabel && newLabel && opts.confirm) {
    carryRefs = await opts.confirm(oldLabel, newLabel, refPositions.length);
  }

  // Re-resolve after the await — the modal is blocking, but a stale position
  // is cheap insurance and the second resolve is what a uuid-addressed caller
  // (a float, the Outline) relies on.
  const after = opts.locate();
  if (!after) return "unresolved";

  const tr = target.state.tr;
  tr.setNodeMarkup(after.pos, undefined, {
    ...after.node.attrs,
    label: newLabel ?? clearedLabelFor(after.node),
  });

  if (carryRefs && oldLabel && newLabel) {
    // labelRef is an inline ATOM of fixed size, so an attr write keeps every
    // other collected position valid inside the same transaction.
    for (const rPos of refPositions) {
      const rNode = target.state.doc.nodeAt(rPos);
      if (rNode && rNode.type.name === "labelRef" && rNode.attrs.label === oldLabel) {
        tr.setNodeMarkup(rPos, undefined, { ...rNode.attrs, label: newLabel });
      }
    }
  }

  target.view.dispatch(tr);
  return "renamed";
}

/**
 * The words the "Update references?" confirm says — spelled ONCE, read by the
 * dialog producer (`EditorPane`). Kept beside the door so the question and the
 * mechanism it gates cannot drift apart.
 */
export function labelRenameConfirmCopy(
  oldLabel: string,
  newLabel: string,
  refCount: number,
): { title: string; message: string; confirmLabel: string; cancelLabel: string } {
  const noun = refCount === 1 ? "1 reference" : `${refCount} references`;
  return {
    title: "Update references?",
    message:
      `${noun} in this document point${refCount === 1 ? "s" : ""} at ` +
      `"${oldLabel}". Update ${refCount === 1 ? "it" : "them"} to "${newLabel}"? ` +
      `Leaving ${refCount === 1 ? "it" : "them"} keeps ${refCount === 1 ? "it" : "them"} ` +
      `pointing at "${oldLabel}", which nothing will declare.`,
    confirmLabel: "Update references",
    cancelLabel: "Leave references",
  };
}
