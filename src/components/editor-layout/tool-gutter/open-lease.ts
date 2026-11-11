/**
 * The expansion a gutter row's open LEASES (task 1571). `GutterList` calls an
 * acquire when a row becomes open and runs the release it returns exactly once
 * when that row stops being open, however it stops. These two doors are the
 * acquires for the two expansion owners — the doc's card store and the
 * diagnostics owner (error cards) — and both keep one rule: a card that was
 * already expanded before the open is not the lease's to collapse.
 */
import type { AnchoredCardRef, CardStore } from "@/links/_shared/anchored-card-store";
import type { UseDiagnostics } from "@/hooks/useDiagnostics";

export type Release = () => void;

export function leaseCardExpansion(
  store: Pick<CardStore, "expand" | "collapse" | "isExpanded">,
  ref: AnchoredCardRef,
): Release | undefined {
  if (store.isExpanded(ref)) return undefined;
  store.expand(ref);
  return () => store.collapse(ref);
}

export function leaseErrorExpansion(
  diagnostics: Partial<Pick<UseDiagnostics, "expandedErrorIds" | "expandError" | "collapseError">>,
  id: string,
): Release | undefined {
  if (!diagnostics.expandError || diagnostics.expandedErrorIds?.has(id)) return undefined;
  diagnostics.expandError(id);
  const { collapseError } = diagnostics;
  return () => collapseError?.(id);
}
