/**
 * borrowed-render — static HTML for a borrowed card body (perf Wave 3, T1).
 *
 * The presence-tier system renders a COLLAPSED card body as static HTML
 * instead of mounting a read-only TipTap editor per card (the diagnosis's
 * 881-live-editors problem). This module is the render SSOT for that tier:
 * the SAME normalize → citation-refresh → serialize pipeline the live
 * `BorrowedMainText` runs, ending in `generateHTML` over the SAME extension
 * list `buildCardBodySchema` composes — byte-identical schema by
 * construction, never a hand copy (the task-308 discipline: a static tier
 * is a THIRD body surface bound by the same scope rule as the other two).
 *
 * What the static output does NOT contain: KaTeX. The math atoms'
 * `renderHTML` emits the raw dollar-wrapped source with a `data-latex`
 * attribute (math.ts); `StaticBorrowedText` runs the one-shot KaTeX pass
 * over those spans after commit. Everything else (citations, label refs,
 * nested footnote markers, latex command/verbatim marks) renders faithfully
 * from `renderHTML` alone.
 *
 * Failure is a REFUSAL, not a blank: TipTap swallows schema mismatches into
 * empty documents elsewhere (the task-308 lesson), but `generateHTML`
 * throws on an unknown node type — so `renderBorrowedHtml` catches and
 * returns null, and the caller falls back to the plain-text summary. A card
 * the static tier can't render keeps showing its text rather than nothing.
 */

import { generateHTML, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/react";
import {
  buildCardBodySchema,
  starterKitConfigForScope,
  type CardBodySchemaScope,
} from "@/lib/tiptap/borrowed-schema";
import { normalizeRichContent } from "@/lib/footnote-content";

/**
 * Rewrite citation nodes so their `displayText` reflects the current
 * bibliography lookup (persisted nodes often saved `displayText=""`). Pure.
 * Factored out of BorrowedMainText (its sole owner pre-Wave-3) so the live
 * editor and the static tier resolve citations through ONE walk — the
 * `resolve(command) || command` fallback included.
 */
export function refreshCitationDisplay(
  doc: JSONContent,
  resolve: ((command: string) => string) | undefined,
): JSONContent {
  if (!resolve) return doc;
  function walk(node: JSONContent): JSONContent {
    if (node.type === "citation" && node.attrs) {
      const command = (node.attrs.command as string) || "";
      const desired = resolve!(command) || command;
      if (node.attrs.displayText !== desired) {
        return { ...node, attrs: { ...node.attrs, displayText: desired } };
      }
      return node;
    }
    if (node.content) {
      return { ...node, content: node.content.map(walk) };
    }
    return node;
  }
  return walk(doc);
}

// One extension list per scope, cached — generateHTML builds a Schema from
// it per call, but the ARRAY (and each extension's configure result) is
// composed once. Composition mirrors BorrowedMainText's editor construction
// exactly (StarterKit at the scope's config + the borrowed sub-schema with
// includeLabelRefFootnote), which is also what borrowed-schema's own
// `schemaForScope` composes for the capture guard.
const EXTENSIONS_CACHE = new Map<CardBodySchemaScope, Extensions>();

function extensionsForScope(scope: CardBodySchemaScope): Extensions {
  const cached = EXTENSIONS_CACHE.get(scope);
  if (cached) return cached;
  const exts: Extensions = [
    StarterKit.configure({ ...starterKitConfigForScope(scope) }),
    ...buildCardBodySchema(scope, { includeLabelRefFootnote: true }),
  ];
  EXTENSIONS_CACHE.set(scope, exts);
  return exts;
}

/**
 * Render a borrowed card body to static HTML. Returns null when the body
 * cannot be represented in this scope's schema (unknown node/mark) — the
 * caller must fall back to a text summary, never render a blank.
 */
export function renderBorrowedHtml(
  value: unknown,
  scope: CardBodySchemaScope,
  resolveCitation?: (command: string) => string,
): string | null {
  try {
    const resolved = refreshCitationDisplay(
      normalizeRichContent(value),
      resolveCitation,
    );
    return generateHTML(resolved, extensionsForScope(scope));
  } catch {
    return null;
  }
}
