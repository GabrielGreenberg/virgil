import type { SectioningCommand } from "./document-class";

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

export function headingTypeCommand(level: number): SectioningCommand {
  const clamped = Math.max(0, Math.min(level, 6));
  return HEADING_TYPES[clamped].command;
}
