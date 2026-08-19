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
}

export const HEADING_TYPES: readonly HeadingTypeEntry[] = [
  { level: 0, name: "Part",          command: "part" },
  { level: 1, name: "Chapter",       command: "chapter" },
  { level: 2, name: "Section",       command: "section" },
  { level: 3, name: "Subsection",    command: "subsection" },
  { level: 4, name: "Subsubsection", command: "subsubsection" },
  { level: 5, name: "Paragraph",     command: "paragraph" },
  { level: 6, name: "Subparagraph",  command: "subparagraph" },
] as const;

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
