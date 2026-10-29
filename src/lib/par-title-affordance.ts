/**
 * # Which title controls a source pod OFFERS (task 1345)
 *
 * A source pod (`texBlock`, `forestBlock`) has two surfaces — the in-place
 * `SourcePodNodeView` and the popped float's `FloatTitleField` — and both
 * paint the same `par-title-*` strip. Task 728 gated the title WRITE on the
 * float (`canEdit`), but not the AFFORDANCE: on a read-only doc the float still
 * painted a `+T`, a "Remove title ×" and a `button`-role container whose
 * handlers had become no-ops — controls that do nothing — while the in-place
 * pod hid them. Two hand-spelled predicates for one pod had diverged.
 *
 * This is the ONE predicate both surfaces read:
 *
 *   - `live` — the strip accepts gestures at all: the doc is editable and the
 *     pod is open (a collapsed pod's title is a label, not a control).
 *   - `show` — the strip renders: a title always shows (as plain text when not
 *     live); an untitled pod shows its `+T` only when live, else nothing.
 *   - `canClear` — the `×` renders: live and there is a title to remove.
 *
 * A surface without a fold (the float) passes `collapsed: false`.
 */
export interface ParTitleAffordance {
  show: boolean;
  live: boolean;
  canClear: boolean;
}

export function parTitleAffordance({
  title,
  editable,
  collapsed,
}: {
  title: string | null | undefined;
  editable: boolean;
  collapsed: boolean;
}): ParTitleAffordance {
  const live = editable && !collapsed;
  return { show: !!title || live, live, canClear: live && !!title };
}
