/**
 * Drop-spec registry. Each card kind (note, todo, paragraph, footnote,
 * ...) contributes one `DropSpec` here. The controller calls
 * `lookupSpec(kind)` when a drop session begins.
 *
 * Specs are co-located with their panel under
 * src/panels/<panel>/drop-spec.ts for attachment cards, and under
 * src/components/drop-mode/specs/ for document-level kinds. Each spec
 * is imported here and added to the SPECS record below.
 *
 * Phase 0 ships with no specs registered — shift-grab is a no-op. Each
 * subsequent phase wires its specs in by editing this file.
 */

import type { DropSpec } from "./types";
import { textObjectDropSpec } from "./specs/textobject";
import { textRangeMoveDropSpec } from "./specs/text-range-move";
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
import { stackPullDropSpec } from "./specs/stack-pull";
import { STACK_PULL_PREFIX } from "@/lib/stack/types";

/**
 * Spec by card-key prefix. The prefix is what `cardKey.split(":")[0]`
 * yields — e.g. "note", "paragraph", "footnote".
 *
 * `bib` is intentionally absent — bib entries don't anchor to text.
 */
const SPECS: Record<string, DropSpec | undefined> = {
  // Unified spec for every block lift — paragraph, heading, list,
  // texBlock, exampleBlock, linkedRange, sub-objects. Resolves via
  // the TextObject registry's `dropAdapter` (wrap vs. drop-direct)
  // and `collectMoveSource` (single node vs. section range).
  textobject: textObjectDropSpec,
  // The Examples *panel-card* popout (a sibling of `note:` / `todo:` /
  // `bib:`). The in-editor exampleBlock popout goes through
  // `textobject:exampleBlock:<id>` instead.
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
  [STACK_PULL_PREFIX]: stackPullDropSpec,
};

/**
 * Resolve the drop spec for a full cardKey. Most kinds dispatch on the prefix
 * (`cardKey.split(":")[0]`). The one exception is `linkedRange`: a plain text
 * selection lifts as `textobject:linkedRange:<id>` — it shares the
 * `textobject:` prefix with every block lift but moves as a text SLICE at an
 * inline caret, NOT a block between blocks, so it routes to its own
 * `text-range-move` spec rather than `textObjectDropSpec` (L3f-2). The full
 * cardKey is passed so this one carve-out can be made here, keeping the
 * routing in the registry.
 */
export function lookupSpec(cardKey: string): DropSpec | undefined {
  if (cardKey.startsWith("textobject:linkedRange:")) {
    return textRangeMoveDropSpec;
  }
  const sep = cardKey.indexOf(":");
  const kind = sep === -1 ? cardKey : cardKey.slice(0, sep);
  return SPECS[kind];
}
