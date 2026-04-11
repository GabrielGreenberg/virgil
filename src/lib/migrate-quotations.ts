import { generateEntityId } from "@/lib/uuid";
import type { QuotationGroup, QuotationsState, Reference, Quote } from "@/lib/types";

/**
 * Legacy shapes — kept here only for migration. The current model lives in
 * src/lib/types.ts.
 */
interface LegacyQuotation {
  id: string;
  title?: string;
  text: string;
  page: string;
}

interface LegacyQuotationGroup {
  id: string;
  title?: string;
  citeKey?: string;
  paragraphId: string | null;
  quotations?: LegacyQuotation[];
  notes?: string;
  createdAt: string;
}

interface UnknownState {
  groups?: unknown[];
}

function isLegacyGroup(g: unknown): g is LegacyQuotationGroup {
  if (!g || typeof g !== "object") return false;
  const obj = g as Record<string, unknown>;
  return Array.isArray(obj.quotations) && !("references" in obj);
}

function isModernGroup(g: unknown): g is QuotationGroup {
  if (!g || typeof g !== "object") return false;
  const obj = g as Record<string, unknown>;
  return Array.isArray(obj.references);
}

/**
 * Wrap a legacy {citeKey, quotations[]} group into the new
 * {references: [{citeKey, quotes[]}]} shape.
 *
 * - The group title comes from the legacy group title; if it was empty we
 *   fall back to the first quote's title (which used to live on each entry).
 * - Per-quote titles are dropped — the group now owns the title.
 */
function migrateGroup(legacy: LegacyQuotationGroup): QuotationGroup {
  const quotes: Quote[] = (legacy.quotations ?? []).map((q) => ({
    id: q.id ?? generateEntityId(),
    text: q.text ?? "",
    page: q.page ?? "",
  }));

  // If the legacy group had no title but its first quote did, promote it.
  const firstQuoteTitle =
    (legacy.quotations ?? []).find((q) => q.title && q.title.trim())?.title ?? "";
  const title = (legacy.title && legacy.title.trim()) || firstQuoteTitle || "";

  const reference: Reference = {
    id: generateEntityId(),
    citeKey: legacy.citeKey ?? "",
    quotes,
  };

  return {
    id: legacy.id,
    title,
    references: [reference],
    paragraphIds: legacy.paragraphId ? [legacy.paragraphId] : [],
    notes: legacy.notes ?? "",
    createdAt: legacy.createdAt,
  };
}

/**
 * Idempotent: returns a clean QuotationsState whether the input is in the
 * legacy or modern shape (or a mix of both).
 */
export function migrateQuotationsState(
  raw: QuotationsState | UnknownState | null | undefined
): QuotationsState {
  if (!raw || !Array.isArray(raw.groups)) return { groups: [] };

  const groups: QuotationGroup[] = [];
  for (const g of raw.groups) {
    if (isModernGroup(g)) {
      // Defensive: ensure refs and quotes have ids and required fields.
      // Migrate legacy `paragraphId` string → `paragraphIds` array
      const raw = g as QuotationGroup & { paragraphId?: string | null };
      const paragraphIds = Array.isArray(g.paragraphIds)
        ? g.paragraphIds
        : raw.paragraphId
          ? [raw.paragraphId]
          : [];
      groups.push({
        id: g.id,
        title: g.title ?? "",
        references: (g.references ?? []).map((r) => ({
          id: r.id ?? generateEntityId(),
          citeKey: r.citeKey ?? "",
          quotes: (r.quotes ?? []).map((q) => ({
            id: q.id ?? generateEntityId(),
            text: q.text ?? "",
            page: q.page ?? "",
          })),
        })),
        paragraphIds,
        notes: g.notes ?? "",
        createdAt: g.createdAt,
      });
    } else if (isLegacyGroup(g)) {
      groups.push(migrateGroup(g));
    }
    // Anything that matches neither shape is dropped silently — there's
    // nothing meaningful we can do with it.
  }

  return { groups };
}
