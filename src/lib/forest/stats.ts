/**
 * The forest renderer's work probe — `window.__forestRenderStats()`, the
 * sibling of `__virgilBusStats` / `__geometryStats` / `__docProductsStats`.
 *
 * It exists for ONE question, and it is the question the keystroke-sanctity law
 * asks of every derived view: **does typing elsewhere in the document cost this
 * NodeView anything?** A forest tree is derived from `source` and from nothing
 * else, so a plain keystroke in another paragraph must leave all three counters
 * flat — no re-parse, no re-measure, no re-layout.
 *
 * Counting the three separately rather than as a total is deliberate: they fail
 * for different reasons (a parse per render means a missing memo, a measure per
 * render means a missing effect dependency, a layout per render means the pure
 * engine is being re-run on unchanged sizes), so a regression names itself.
 */
export type ForestWorkKind = "parse" | "measure" | "layout" | "render";

export interface ForestRenderStats {
  parse: number;
  measure: number;
  layout: number;
  /**
   * Executions of the tree view's own body. Bumped DURING render, which is a
   * side effect in render and is stated as one: it is a diagnostic counter, so
   * a discarded concurrent render over-counts and nothing is wired to it.
   *
   * It is here because it is the only thing that can SEE the view's `memo`
   * comparator. The measure and layout counters cannot: the effect deps are the
   * tree, so an unbailed re-render reconciles every label element and re-runs
   * no effect — cheap enough to be invisible to them, and O(nodes) all the
   * same. An invariant with no leg is a habit (task 334), so this is the leg.
   */
  render: number;
}

const counters: ForestRenderStats = { parse: 0, measure: 0, layout: 0, render: 0 };

export function noteForestWork(kind: ForestWorkKind): void {
  counters[kind]++;
}

export function forestRenderStats(): ForestRenderStats {
  return { ...counters };
}

export function resetForestRenderStats(): void {
  counters.parse = 0;
  counters.measure = 0;
  counters.layout = 0;
  counters.render = 0;
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__forestRenderStats = forestRenderStats;
  (window as unknown as Record<string, unknown>).__forestRenderStatsReset =
    resetForestRenderStats;
}
