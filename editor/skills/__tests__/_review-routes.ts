// Shared parser for `/editor/review`'s step-3 dispatch table.
//
// NOT a test file (no `.test.` in the name, so vitest does not collect it) —
// a helper two guards read, because both need the same answer to the same
// question and a second copy of this regex is the fork this repo legislates
// against everywhere else. `dispatch-coverage.test.ts` pins the table against
// `ai_request_routing.json`; `ask-shape-doctrine.test.ts` DERIVES its
// population from it. Because the table is pinned to the manifest, that
// population is a two-hop derivation from the manifest — the umbrella's own
// routing, never a hand list.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** editor/skills/__tests__/ → repo root is three levels up. */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const readRepo = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

export const REVIEW = "editor/skills/review.md";
export const MANIFEST = "editor/scripts/ai_request_routing.json";

/** A parsed route from the umbrella's step-3 dispatch list. */
export interface Route {
  kind: string;
  /** null ⇒ the kind-only fallback (matches any panel, and the unbridged row). */
  panel: string | null;
  /** The skill file the route names, repo-relative. */
  file: string;
}

// A route line looks like one of
//   `kind: "todo"` → `/editor/answer-todo-request <docPath> <id>`
//   `kind: "suggestion"` + `panel: "cutter"` →
//      `/editor/answer-cutter-comment <docPath> <id>`
// The arrow may end the line (the skill wraps onto the next one), so parse the
// two halves independently rather than requiring them on one physical line —
// this prose is hard-wrapped and future edits will re-wrap it freely.
export function parseReviewRoutes(md: string): Route[] {
  // Collapse only NEWLINES (not all whitespace) so a wrapped route still reads
  // as one logical line while list items stay separated by their leading digit.
  const flat = md.replace(/\n\s*/g, " ");
  const re =
    /`kind:\s*"([a-z-]+)"`(?:\s*\+\s*`panel:\s*"([a-z-]+)"`)?\s*→\s*`\/editor\/([a-z-]+)/g;
  const out: Route[] = [];
  for (const m of flat.matchAll(re)) {
    out.push({
      kind: m[1],
      panel: m[2] ?? null,
      file: `editor/skills/${m[3]}.md`,
    });
  }
  return out;
}

export const reviewRoutes = (): Route[] => parseReviewRoutes(readRepo(REVIEW));

export interface RoutingManifest {
  routing: Record<string, { kind: string; linkPanel: string }>;
}

export const routingManifest = (): RoutingManifest =>
  JSON.parse(readRepo(MANIFEST)) as RoutingManifest;

/**
 * The route that answers a manifest `(kind, panel)` pair: the exact
 * `(kind, panel)` route if the table has one, else the kind-only fallback.
 * Mirrors `/editor/review`'s own "match the most specific route first" rule,
 * and is the same resolution `dispatch-coverage.test.ts` asserts is total.
 */
export function routeForPair(
  routes: Route[],
  kind: string,
  panel: string,
): Route | undefined {
  return (
    routes.find((r) => r.kind === kind && r.panel === panel) ??
    routes.find((r) => r.kind === kind && r.panel === null)
  );
}
