/**
 * Which `footnote` atom attrs are the user's SOURCE — and so must travel with
 * the footnote when its marker leaves the document — and which are DERIVED
 * (task 947).
 *
 * A footnote's archive/park record (`FootnoteRef`), its orphan record
 * (`OrphanedFootnote`) and the "anchor the unanchored" rebuild
 * (`footnoteDropSpec.createAtom`) each used to keep their OWN hand-picked
 * subset of the atom: the ref had `content` (+ `title` since task 705), the
 * orphan had `thanks` too, the rebuild passed `content` alone. So archiving a
 * `\thanks{…}` and putting it back wrote a plain `\footnote{…}` — which then
 * took a number and renumbered every later footnote — and `\footnote[3]{…}`
 * came back without its `[3]`. That is the capture/schema-symmetry law's loss
 * class: the splice deleted what the capture could not restore.
 *
 * So the classification lives here, ONCE, and every capture and the rebuild
 * read it. The census test (`footnote-source-attrs.test.ts`) pins it against
 * the node's own `addAttributes()`: a new footnote attr fails CI until it is
 * classified as carried or derived.
 *
 * Leaf module (no TipTap import) so `types.ts`-level consumers, the stack
 * snapshot and the drop-mode types can all read it.
 */

/** Every carried attr — the user's source, restored when the atom is rebuilt.
 *  `content` and `title` have their own long-standing homes on every record;
 *  {@link FOOTNOTE_MARKUP_ATTRS} is the subset this module owns the spelling
 *  of. */
export const FOOTNOTE_CARRIED_ATTRS = [
  "content",
  "title",
  "thanks",
  "numberOverride",
] as const;

/** Attrs the atom re-derives on its own (numbering pass, link wiring, its own
 *  id) — never persisted on a record, never passed to a rebuild. */
export const FOOTNOTE_DERIVED_ATTRS = [
  "number",
  "footnoteId",
  "linkId",
  "linkKind",
  "linkCard",
] as const;

/** The carried attrs that are LaTeX MARKUP rather than prose: which command
 *  the `.tex` spells (`\thanks` vs `\footnote`) and its optional mark
 *  (`\footnote[3]`). */
export const FOOTNOTE_MARKUP_ATTRS = ["thanks", "numberOverride"] as const;

/** The markup attrs in their RECORD spelling: absent ≡ the node default
 *  (`thanks: false`, `numberOverride: null`) — one spelling, like `title`. */
export interface FootnoteMarkupAttrs {
  /** The source was `\thanks{…}`: uncounted, badge "A", "Acknowledgement". */
  thanks?: boolean;
  /** The source was `\footnote[<mark>]{…}` (task 376 M5). */
  numberOverride?: string;
}

/** Read the markup attrs off anything shaped like the node's attrs or a record
 *  — the live atom, a `FootnoteRef`, an orphan, a sidecar row of unknown
 *  provenance — in the record spelling (defaults omitted). */
export function pickFootnoteMarkupAttrs(
  raw: object | null | undefined,
): FootnoteMarkupAttrs {
  const out: FootnoteMarkupAttrs = {};
  if (!raw) return out;
  const src = raw as Readonly<Record<string, unknown>>;
  if (src.thanks === true) out.thanks = true;
  const mark = src.numberOverride;
  if (typeof mark === "string" && mark !== "") out.numberOverride = mark;
  return out;
}

/** The same attrs in the NODE spelling, for `footnoteNodeType.create(...)` —
 *  explicit defaults, so a rebuild never inherits anything by omission. */
export function footnoteMarkupNodeAttrs(
  attrs: FootnoteMarkupAttrs,
): { thanks: boolean; numberOverride: string | null } {
  return {
    thanks: attrs.thanks === true,
    numberOverride: attrs.numberOverride ?? null,
  };
}

/** True iff two records spell the same markup (record spelling). */
export function footnoteMarkupEqual(
  a: FootnoteMarkupAttrs,
  b: FootnoteMarkupAttrs,
): boolean {
  return (
    (a.thanks === true) === (b.thanks === true) &&
    (a.numberOverride ?? null) === (b.numberOverride ?? null)
  );
}

/** A footnote title in its ONE record spelling: a blank title is ABSENT
 *  (`undefined`), never `""` — "untitled" has one spelling on the ref, the
 *  orphan record and every pick (task 1337: the orphan title editor stored
 *  `""` where the ref's setter stored absent). */
export function footnoteTitleRecord(title: unknown): string | undefined {
  return typeof title === "string" && title.trim() !== "" ? title : undefined;
}

/** EVERY carried attr in the record spelling — the body, the title, the
 *  markup — as a footnote leaves the document (task 1073). Absent ≡ default
 *  for `title` and the markup, exactly like {@link FootnoteMarkupAttrs}; the
 *  body is always present (`null` for a node that never had one). */
export interface FootnoteCarriedRecord extends FootnoteMarkupAttrs {
  content: unknown;
  title?: string;
}

/** Read every carried attr off a live atom's attrs (or any record of the same
 *  shape) in the record spelling. The ONE pick every capture door — archive,
 *  the flag-ON orphan reconciler, the flag-OFF orphan detector — reads, so a
 *  door cannot carry the body and forget the title or the `\thanks` (task
 *  1073: the legacy orphan event carried `{content}` alone). Keyed off
 *  {@link FOOTNOTE_CARRIED_ATTRS}: the census pins that list against the
 *  node, and this function's own test pins it against the list. */
export function pickFootnoteCarriedAttrs(
  raw: object | null | undefined,
): FootnoteCarriedRecord {
  const src = (raw ?? {}) as Readonly<Record<string, unknown>>;
  const out: FootnoteCarriedRecord = { content: src.content ?? null };
  const title = footnoteTitleRecord(src.title);
  if (title !== undefined) out.title = title;
  return { ...out, ...pickFootnoteMarkupAttrs(raw) };
}

/** The ONE orphan-record builder (task 1073). Both orphan writers — the
 *  flag-ON bus reconciler and the flag-OFF detector's event bridge — build
 *  their record here from a {@link pickFootnoteCarriedAttrs} pick, so the two
 *  can never again carry different subsets of the footnote that left.
 *  Structurally an `OrphanedFootnote` (`@/lib/types`; not imported, this
 *  module stays a leaf). */
export function orphanRecordFor(
  footnoteId: string,
  carried: FootnoteCarriedRecord,
  orphanedAt: string = new Date().toISOString(),
): FootnoteCarriedRecord & { footnoteId: string; orphanedAt: string } {
  return { footnoteId, ...pickFootnoteCarriedAttrs(carried), orphanedAt };
}
