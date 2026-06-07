"use client";

/**
 * Provenance chips — small status pills indicating where a citekey lives
 * (local bib, central master.bib, custom libraries) and the bib-state of
 * the library entry. Used by:
 *
 *   - BibliographyPanel cards: full set, including bib-state.
 *   - LibraryEntryMenu rows: memberships only (the menu surfaces
 *     verified/unverified through its own right-side pill instead).
 */

import type { LibraryBibState } from "@/lib/library/library-types";
import type { LibraryMembership } from "@/hooks/useLibrary";

export type ProvenanceChip =
  | { kind: "local" }
  | { kind: "central" }
  | { kind: "custom"; id: string; label: string }
  | { kind: "bib-state"; state: LibraryBibState };

export function provenanceFor(
  _citekey: string,
  scope: "local" | "library",
  info: {
    inLocal: boolean;
    inCentral: boolean;
    customLibraries: LibraryMembership[] | undefined;
    bibState: LibraryBibState | undefined;
  },
): ProvenanceChip[] {
  const chips: ProvenanceChip[] = [];
  if (info.inLocal && scope !== "local") chips.push({ kind: "local" });
  if (info.inCentral && scope !== "library") chips.push({ kind: "central" });
  for (const m of info.customLibraries ?? []) {
    chips.push({ kind: "custom", id: m.id, label: m.label });
  }
  if (info.bibState && info.bibState !== "none") {
    chips.push({ kind: "bib-state", state: info.bibState });
  }
  return chips;
}

/** Membership-only variant — drops the bib-state chip. */
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

export function provenanceChipKey(chip: ProvenanceChip): string {
  switch (chip.kind) {
    case "local":
      return "local";
    case "central":
      return "central";
    case "custom":
      return `custom:${chip.id}`;
    case "bib-state":
      return `bib:${chip.state}`;
  }
}

export function provenanceChipStyle(
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
    case "bib-state":
      switch (chip.state) {
        case "authenticated":
          return {
            text: "auth",
            tooltip:
              "Library entry verified against authoritative sources (Crossref / OpenAlex / etc.)",
            className:
              "text-emerald-700 bg-emerald-50 border border-emerald-200",
          };
        case "unverified":
          return {
            text: "unverified",
            tooltip:
              "Library entry partially matched a source — fields are best-effort",
            className: "text-amber-700 bg-amber-50 border border-amber-200",
          };
        case "failed":
          return {
            text: "unverified",
            tooltip:
              "Library entry couldn't be verified against external sources",
            className: "text-rose-700 bg-rose-50 border border-rose-200",
          };
        case "manuscript":
          return {
            text: "manuscript",
            tooltip:
              "Unpublished or forthcoming work — no external source applies",
            className: "text-sky-700 bg-sky-50 border border-sky-200",
          };
        case "canonical":
          return {
            text: "canonical",
            tooltip:
              "Pre-digital classic — no DOI/ISBN registry will ever index it",
            className: "text-indigo-700 bg-indigo-50 border border-indigo-200",
          };
        default:
          return {
            text: chip.state,
            tooltip: chip.state,
            className: "text-ink-muted bg-surface border border-edge-subtle",
          };
      }
  }
}

export function ProvenanceChips({ chips }: { chips: ProvenanceChip[] }) {
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

/** Membership-only chip strip — used in the LibraryEntryMenu's expansion. */
export function LibraryMembershipChips({
  chips,
}: {
  chips: ProvenanceChip[];
}) {
  const filtered = chips.filter((c) => c.kind !== "bib-state");
  if (filtered.length === 0) return null;
  return <ProvenanceChips chips={filtered} />;
}
