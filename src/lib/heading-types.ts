/**
 * The seven LaTeX sectioning control words.
 *
 * Declared HERE rather than in `document-class.ts` (which owns the
 * class-compatibility tables and re-exports this) because this file is the
 * VOCABULARY and must be an import-free LEAF: the lexer's sectioning door
 * reads it, and `latex-lexer.ts` is itself a leaf every low-level consumer
 * takes. A facet the layer that needs it cannot import will be re-copied —
 * which is exactly what had happened four times over (task 376).
 */
export type SectioningCommand =
  | "part"
  | "chapter"
  | "section"
  | "subsection"
  | "subsubsection"
  | "paragraph"
  | "subparagraph";

export interface HeadingTypeEntry {
  level: number;
  name: string;
  command: SectioningCommand;
  /** A display qualifier for a picker that ALSO offers a "Body text" row
   *  (the ¶ block-type dropdown), where a bare "Paragraph" would read as a
   *  synonym of body text. Pickers read it through `headingLevelOptions`
   *  (`document-class.ts`) as `menuLabel` — the ONE place the qualifier is
   *  spelled, so the dropdown no longer keeps a second list (task 752). */
  menuLabel?: string;
}

export const HEADING_TYPES: readonly HeadingTypeEntry[] = [
  { level: 0, name: "Part",          command: "part" },
  { level: 1, name: "Chapter",       command: "chapter" },
  { level: 2, name: "Section",       command: "section" },
  { level: 3, name: "Subsection",    command: "subsection" },
  { level: 4, name: "Subsubsection", command: "subsubsection" },
  { level: 5, name: "Paragraph",     command: "paragraph",    menuLabel: "Paragraph heading" },
  { level: 6, name: "Subparagraph",  command: "subparagraph", menuLabel: "Subparagraph heading" },
] as const;

/** The outermost sectioning level (`\part` = 0), DERIVED from the table.
 *  A heading-chain walk climbs until it has pushed a heading at this level —
 *  never until a hand-written `> 1` (task 587: that literal stopped the
 *  breadcrumb at a `\chapter`, so a part above a chapter never showed). */
export const OUTERMOST_HEADING_LEVEL: number = Math.min(
  ...HEADING_TYPES.map((h) => h.level),
);

/** A heading node's level, or null when it carries none. The ONE reader of
 *  `attrs.level` for "is this a sectioning heading?": a truthiness test
 *  (`node.attrs?.level`) answers NO for `\part`, whose level is 0 — the
 *  shape both legacy breadcrumb walks shipped (task 587). */
export function headingLevelOf(
  attrs: { level?: unknown } | null | undefined,
): number | null {
  const level = attrs?.level;
  return typeof level === "number" && Number.isFinite(level) ? level : null;
}

export function headingTypeName(level: number): string {
  const clamped = Math.max(0, Math.min(level, 6));
  return HEADING_TYPES[clamped].name;
}

/** The level → control-word half of the table, read by the serializer's
 *  `heading` arm. Until task 376 this had no callers anywhere while the
 *  serializer kept its own level-indexed `commands` array — the dead-SSOT
 *  shape (task 202), and the reason the vocabulary could drift four ways. */
export function headingTypeCommand(level: number): SectioningCommand {
  const clamped = Math.max(0, Math.min(level, 6));
  return HEADING_TYPES[clamped].command;
}
