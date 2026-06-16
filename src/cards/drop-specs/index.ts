/**
 * Card drop-spec registration entry point. Mirrors `src/cards/floats/index.tsx`:
 * importing this module folds every card kind's in-document `DropSpec` onto
 * `CARD_REGISTRY[kind].dropSpec` via `registerCardDropSpec`, so `lookupSpec`
 * (`drop-mode/registry.ts`) reads the one registry instead of a parallel
 * prefix-keyed `SPECS` table.
 *
 * Imported once on the drop-dispatch path (`drop-mode/registry.ts`) so the
 * registrations run before any drag session resolves a spec. Kept SEPARATE from
 * `card-registry.tsx` (which stays a runtime leaf) so `predicates.ts` and the
 * low-level modules that consume it never pull the drop machinery in / never
 * cycle.
 *
 * `bib` / `ai` / `error` register nothing — they don't re-anchor by drop, so
 * their `dropSpec` stays `null`. The two revision kinds share `revisionDropSpec`
 * (which the legacy shared `revision` prefix used) — folding away the
 * special-case the Stage-4 `lookupSpec` carried.
 */
import { registerCardDropSpec, assertDropFacetCoverage } from "../card-registry";
import { noteDropSpec, highlightDropSpec } from "@/panels/Notes/drop-spec";
import { todoDropSpec } from "@/panels/Todo/drop-spec";
import { archiveDropSpec } from "@/panels/Archive/drop-spec";
import {
  cutterCommentDropSpec,
  cutterSuggestionDropSpec,
} from "@/panels/Cutter/drop-spec";
import { revisionDropSpec } from "@/panels/Revisions/drop-spec";
import { reportDropSpec, reportRequestDropSpec } from "@/panels/Reports/drop-spec";
import { footnoteDropSpec } from "@/panels/Footnotes/drop-spec";
import { citationDropSpec } from "@/panels/Citations/drop-spec";
import { exampleDropSpec } from "@/panels/Examples/drop-spec";

registerCardDropSpec("note", noteDropSpec);
registerCardDropSpec("highlight", highlightDropSpec);
registerCardDropSpec("todo", todoDropSpec);
registerCardDropSpec("archive", archiveDropSpec);
registerCardDropSpec("cutter-comment", cutterCommentDropSpec);
registerCardDropSpec("cutter-suggestion", cutterSuggestionDropSpec);
registerCardDropSpec("revision-comment", revisionDropSpec);
registerCardDropSpec("revision-suggestion", revisionDropSpec);
registerCardDropSpec("report", reportDropSpec);
registerCardDropSpec("report-request", reportRequestDropSpec);
registerCardDropSpec("footnote", footnoteDropSpec);
registerCardDropSpec("citation", citationDropSpec);
registerCardDropSpec("example", exampleDropSpec);

// Now that every spec is folded onto the registry, pin the declared drop facets
// (droppable / dropPlacement) to the real dropSpec.allowedPlacements so the
// static policy can't drift from the mechanism (mirrors assertMorphCoverage).
assertDropFacetCoverage();
