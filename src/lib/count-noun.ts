/**
 * "N thing(s)" — the ONE spelling of a counted noun in UI copy (task 1540).
 *
 * The Cutter goal strip once said "1 words" / "1 words to cut" beside the
 * Revisions strip's hand-rolled `n === 1 ? "revision" : "revisions"`, and the
 * compile pane kept a private copy of the same rule. The count is
 * locale-formatted (`1,240 words`), as every reader already did.
 *
 * `many` defaults to `one + "s"`; pass it for an irregular plural.
 */
export function countNoun(n: number, one: string, many: string = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
