/**
 * Canonical document-TYPE SSOT.
 *
 * A "doc type" is the user-facing choice in the new-document flow — *blank*,
 * *article*, *book*, *report* — that fixes the LaTeX `\documentclass` and the
 * shape of the starter body (title block, table of contents, top-level
 * sectioning command). It deliberately separates **doc-type** (which class)
 * from the old template list's conflated **feature toggles** (bib-vs-no-bib,
 * blank-vs-titled): every typed class now scaffolds bibliography material by
 * default; only *blank* stays deliberately bare.
 *
 * This is the shared foundation consumed by:
 *   - the new-document modal (`NewDocumentModal`) — renders the doc-type list,
 *   - `document-templates.ts` — derives `DOCUMENT_TEMPLATES` from these entries
 *     so the whole create-file pipeline (storage-fsa / storage-dev / dev route)
 *     keeps working on the existing `DocumentTemplate` shape,
 *   - the Style-panel "change doc type" control (task 098) — reads the
 *     `documentClass` + `classOptions` here and cross-checks the body against
 *     `CLASS_COMMANDS` in `document-class.ts`.
 *
 * The per-class body skeleton mirrors `CLASS_COMMANDS` (article → `\section`;
 * report/book → `\chapter` + `\tableofcontents`; book additionally uses the
 * `\frontmatter`/`\mainmatter` conventions) so a fresh doc always starts with
 * sectioning commands valid for its class.
 */

import { buildPreamble } from "@/lib/latex-requirements";
import type { SectioningCommand } from "@/lib/document-class";

export interface DocType {
  /** Stable id — also the `templateId` string threaded through create-file. */
  id: string;
  /** Display name in the picker. */
  label: string;
  /** Short one-liner shown under the name. */
  description: string;
  /** The `\documentclass{…}` name (e.g. "article", "book", "report"). */
  documentClass: string;
  /** Class `[options]` list without brackets (e.g. "11pt"), or null for none. */
  classOptions: string | null;
  /** The main `.tex` filename written to disk. */
  mainTexFilename: string;
  /** Scaffold `references.bib` + `\bibliographystyle`/`\bibliography` lines. */
  includeBib: boolean;
  /** Geometry + hyperref + `\title`/`\author`/`\date` block, and `\maketitle`. */
  titled: boolean;
  /** Emit `\tableofcontents` (chaptered classes). */
  toc: boolean;
  /** Use book/memoir `\frontmatter`/`\mainmatter` matter switches. */
  frontMatter: boolean;
  /** Opening sectioning command for the starter body, or null for a bare body. */
  starterSection: SectioningCommand | null;
  /** Starter heading text (used only when `starterSection` is set). */
  starterHeading: string;
  /** Value for `\title{…}` when `titled`. */
  documentTitle: string;
}

/**
 * The shared `references.bib` scaffolded into every bib-bearing doc type.
 * A single placeholder entry so `\citep{example2024}` resolves out of the box.
 */
export const STARTER_REFERENCES_BIB = `@article{example2024,
  author  = {Last, First},
  title   = {An example reference},
  journal = {Journal of Examples},
  year    = {2024},
  volume  = {1},
  number  = {1},
  pages   = {1--10},
}
`;

/**
 * The canonical doc-type list. Order is the picker order; the first entry is
 * the default selection. `blank` is the deliberate escape hatch — bare article
 * class, no title, no bib. The typed classes all carry bibliography material.
 */
export const DOC_TYPES: DocType[] = [
  {
    id: "blank",
    label: "Blank",
    description: "Minimal article — just the essentials, no scaffolding.",
    documentClass: "article",
    classOptions: null,
    mainTexFilename: "document.tex",
    includeBib: false,
    titled: false,
    toc: false,
    frontMatter: false,
    starterSection: null,
    starterHeading: "",
    documentTitle: "",
  },
  {
    id: "article",
    label: "Article",
    description: "Titled article with margins, hyperref, and a bibliography.",
    documentClass: "article",
    classOptions: "11pt",
    mainTexFilename: "main.tex",
    includeBib: true,
    titled: true,
    toc: false,
    frontMatter: false,
    starterSection: "section",
    starterHeading: "Introduction",
    documentTitle: "Untitled",
  },
  {
    id: "book",
    label: "Book",
    description: "Chapters, front/main matter, table of contents, bibliography.",
    documentClass: "book",
    classOptions: "11pt",
    mainTexFilename: "main.tex",
    includeBib: true,
    titled: true,
    toc: true,
    frontMatter: true,
    starterSection: "chapter",
    starterHeading: "Introduction",
    documentTitle: "Untitled Book",
  },
  {
    id: "report",
    label: "Report",
    description: "Chapters, table of contents, report class, bibliography.",
    documentClass: "report",
    classOptions: "11pt",
    mainTexFilename: "main.tex",
    includeBib: true,
    titled: true,
    toc: true,
    frontMatter: false,
    starterSection: "chapter",
    starterHeading: "Introduction",
    documentTitle: "Untitled Report",
  },
];

/** The default doc-type id when the caller doesn't specify one. */
export const DEFAULT_DOC_TYPE_ID = "blank";

export function getDocType(id: string): DocType | undefined {
  return DOC_TYPES.find((d) => d.id === id);
}

/** Build the `\documentclass[…]{…}` line for a doc type. */
function documentClassLine(dt: DocType): string {
  const opts = dt.classOptions != null ? `[${dt.classOptions}]` : "";
  return `\\documentclass${opts}{${dt.documentClass}}`;
}

/** The preamble extras (geometry/hyperref/title block) for a titled type. */
function preambleExtras(dt: DocType): string[] {
  if (!dt.titled) return [];
  return [
    "\\usepackage[margin=1in]{geometry}",
    "\\usepackage{hyperref}",
    "",
    `\\title{${dt.documentTitle}}`,
    "\\author{}",
    "\\date{\\today}",
  ];
}

/**
 * Assemble the starter body (everything after `\begin{document}`, through
 * `\end{document}`) for a doc type — matter switches, `\maketitle`, TOC, the
 * opening sectioning command, prose, and the bibliography block.
 */
function buildBody(dt: DocType): string {
  const lines: string[] = [];

  if (dt.frontMatter) lines.push("\\frontmatter");
  if (dt.titled) lines.push("\\maketitle");
  if (dt.toc) lines.push("\\tableofcontents");
  if (dt.frontMatter) lines.push("", "\\mainmatter");

  if (lines.length > 0) lines.push("");

  if (dt.starterSection) {
    lines.push(`\\${dt.starterSection}{${dt.starterHeading}}`, "");
  }

  lines.push(
    dt.includeBib
      ? "Start writing here. Cite a source like this: \\citep{example2024}."
      : "Start writing here...",
  );

  if (dt.includeBib) {
    lines.push(
      "",
      "\\bibliographystyle{plainnat}",
      "\\bibliography{references}",
    );
  }

  lines.push("", "\\end{document}", "");
  return lines.join("\n");
}

/**
 * Build the complete main `.tex` source for a doc type: the shared baseline
 * preamble (via `buildPreamble`, which keeps `\documentclass` as the first
 * line and injects the Virgil baseline packages + entity-id shims) followed by
 * the per-type starter body.
 */
export function buildDocTypeTex(dt: DocType): string {
  return buildPreamble(documentClassLine(dt), preambleExtras(dt)) + buildBody(dt);
}

/** All files a fresh doc of this type starts with, keyed by filename. */
export function buildDocTypeFiles(dt: DocType): Record<string, string> {
  const files: Record<string, string> = {
    [dt.mainTexFilename]: buildDocTypeTex(dt),
  };
  if (dt.includeBib) files["references.bib"] = STARTER_REFERENCES_BIB;
  return files;
}
