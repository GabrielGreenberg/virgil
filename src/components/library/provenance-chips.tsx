"use client";

/**
 * Provenance chips — small status pills indicating WHERE a citekey lives:
 * the paper's own references.bib, the central master.bib, or a custom
 * library. Used by the BibliographyPanel cards, the bib-entry picker and the
 * LibraryEntryMenu rows.
 *
 * MEMBERSHIP ONLY. This file used to carry a fourth `bib-state` chip kind with
 * its own 7-branch colour table — one of FOUR renderers of the bib-auth axis,
 * and the dead one: its only producer (`provenanceFor`) had no production
 * caller, and its only consumer (`LibraryMembershipChips`) filtered the kind
 * out, so the whole arm was unreachable while looking the most complete of the
 * four. Task 500 deleted it. The bib-auth state is rendered by
 * `library-entry-status.tsx` (the Bibliography panel), `StatusPill.tsx` (the
 * Library list) and `BibEntryPickerMenu.tsx`'s `VerifiedPill` (the picker
 * row), all three reading the one tone table in `@/lib/library/status-tone`.
 * Do not re-add a bib-state chip here — wire whatever needs it to that
 * resolution instead.
 */

import type { LibraryMembership } from "@/hooks/useLibrary";

export type ProvenanceChip =
  | { kind: "local" }
  | { kind: "central" }
  | { kind: "custom"; id: string; label: string };

export function membershipChipsFor(info: {
  inLocal: boolean;
  inCentral: boolean;
  customLibraries: LibraryMembership[] | undefined;
}): ProvenanceChip[] {
  const chips: ProvenanceChip[] = [];
  if (info.inLocal) chips.push({ kind: "local" });
  if (info.inCentral) chips.push({ kind: "central" });
  for (const m of info.customLibraries ?? []) {
    chips.push({ kind: "custom", id: m.id, label: m.label });
  }
  return chips;
}

/** Internal — the three below are the RENDERER's pieces, reached only through
 *  {@link LibraryMembershipChips}. Un-exported in task 500 for the reason that
 *  task's own deletion rests on: an exported piece is an invitation to build a
 *  second chip strip out of it, which is how the retired `bib-state` arm came
 *  to have a producer nobody called. Publish whole operations. */
function provenanceChipKey(chip: ProvenanceChip): string {
  switch (chip.kind) {
    case "local":
      return "local";
    case "central":
      return "central";
    case "custom":
      return `custom:${chip.id}`;
  }
}

function provenanceChipStyle(
  chip: ProvenanceChip,
): { text: string; tooltip: string; className: string } {
  switch (chip.kind) {
    case "local":
      return {
        text: "local",
        tooltip: "This citekey is in your paper's references.bib",
        className: "text-slate-700 bg-slate-50 border border-slate-200",
      };
    case "central":
      return {
        text: "central",
        tooltip: "This citekey is in your central library's master.bib",
        className: "text-blue-700 bg-blue-50 border border-blue-200",
      };
    case "custom":
      return {
        text: chip.label,
        tooltip: `Member of custom library "${chip.label}"`,
        className: "text-violet-700 bg-violet-50 border border-violet-200",
      };
  }
}

function ProvenanceChips({ chips }: { chips: ProvenanceChip[] }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      {chips.map((c) => {
        const style = provenanceChipStyle(c);
        return (
          <span
            key={provenanceChipKey(c)}
            className={`text-[9px] uppercase tracking-wide px-1 py-0.5 rounded whitespace-nowrap ${style.className}`}
            data-hint={style.tooltip} aria-label={style.tooltip}
          >
            {style.text}
          </span>
        );
      })}
    </div>
  );
}

/** Membership-only chip strip — used in the LibraryEntryMenu's expansion.
 *  Renders nothing rather than an empty strip when the entry belongs nowhere.
 *  (Pre-500 this also filtered out a `bib-state` kind its input could not
 *  contain; the kind is gone, and so is the filter.) */
export function LibraryMembershipChips({
  chips,
}: {
  chips: ProvenanceChip[];
}) {
  if (chips.length === 0) return null;
  return <ProvenanceChips chips={chips} />;
}
