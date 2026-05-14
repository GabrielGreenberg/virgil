/**
 * Drop-spec registry. Each card kind (note, todo, paragraph, footnote,
 * ...) contributes one `DropSpec` here. The controller calls
 * `lookupSpec(kind)` when a drop session begins.
 *
 * Specs are co-located with their panel under
 * src/panels/<panel>/drop-spec.ts for attachment cards, and under
 * src/components/drop-mode/specs/ for document-level kinds
 * (paragraph, heading, selection). Each spec is imported here and
 * added to the SPECS record below.
 *
 * Phase 0 ships with no specs registered — shift-grab is a no-op. Each
 * subsequent phase wires its specs in by editing this file.
 */

import type { DropSpec } from "./types";
import { paragraphDropSpec } from "./specs/paragraph";
import { headingDropSpec } from "./specs/heading";
import { selectionDropSpec } from "./specs/selection";
import { aiRequestDropSpec } from "./specs/ai-request";
import { noteDropSpec, highlightDropSpec } from "@/panels/Notes/drop-spec";
import { todoDropSpec } from "@/panels/Todo/drop-spec";
import { quotationDropSpec } from "@/panels/Quotations/drop-spec";
import { archiveDropSpec } from "@/panels/Archive/drop-spec";
import {
  cutterCommentDropSpec,
  cutterSuggestionDropSpec,
} from "@/panels/Cutter/drop-spec";
import { revisionDropSpec } from "@/panels/Revisions/drop-spec";
import { footnoteDropSpec } from "@/panels/Footnotes/drop-spec";
import { citationDropSpec } from "@/panels/Citations/drop-spec";
import { exampleDropSpec } from "@/panels/Examples/drop-spec";

/**
 * Spec by card-key prefix. The prefix is what `cardKey.split(":")[0]`
 * yields — e.g. "note", "paragraph", "footnote".
 *
 * `bib` is intentionally absent — bib entries don't anchor to text.
 */
const SPECS: Record<string, DropSpec | undefined> = {
  paragraph: paragraphDropSpec,
  heading: headingDropSpec,
  selection: selectionDropSpec,
  example: exampleDropSpec,
  note: noteDropSpec,
  highlight: highlightDropSpec,
  todo: todoDropSpec,
  quotation: quotationDropSpec,
  archive: archiveDropSpec,
  "cutter-comment": cutterCommentDropSpec,
  "cutter-suggestion": cutterSuggestionDropSpec,
  revision: revisionDropSpec,
  footnote: footnoteDropSpec,
  citation: citationDropSpec,
  ai: aiRequestDropSpec,
};

export function lookupSpec(kind: string): DropSpec | undefined {
  return SPECS[kind];
}
