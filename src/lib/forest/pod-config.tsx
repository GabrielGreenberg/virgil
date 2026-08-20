"use client";

/**
 * THE forest source-pod derivation — the one function that turns a
 * `forestBlock`'s bytes into what the pod shows.
 *
 * It exists so the tree and the badge come from ONE parse. They are the two
 * halves of a single verdict ("did the subset grammar accept these bytes?"),
 * and a surface that asked twice — or asked in two places — could paint a badge
 * over a rendered tree, or a tree over a badge, at which point the loud refusal
 * the whole design rests on is no longer trustworthy.
 *
 * Both pod surfaces read it: the in-place `SourcePodNodeView` and the popped
 * `SourcePodFloatBody`. That is the same "one implementation, per surface" rule
 * the pod chrome itself follows — a float that badged differently from the
 * docked block would make the release from a lift change the diagnosis.
 */

import { ForestRefusalBadge } from "@/components/ForestRefusalBadge";
import { ForestTreeView } from "@/components/ForestTreeView";
import { parseForestSource } from "./grammar";
import type { SourcePodDerived } from "@/components/source-pod-derive";
import type { SourcePodConfig } from "@/components/SourcePodNodeView";

/**
 * Derive the pod's body and chrome from a forest env's source.
 *
 * Module-scope (not a closure minted per render) so the pod's `useMemo` keys on
 * `source` alone — a derivation whose identity changed every render would
 * re-parse, re-measure and re-lay-out the tree on any unrelated re-render of
 * the block.
 */
export function deriveForestPod(source: string): SourcePodDerived {
  const parse = parseForestSource(source);
  if (parse.ok) {
    return { preview: <ForestTreeView tree={parse.tree} />, banner: null };
  }
  return { preview: null, banner: <ForestRefusalBadge refusal={parse.refusal} /> };
}

/**
 * THE `forestBlock` source-pod config — one object, module-scope.
 *
 * Two reasons it is a constant rather than an inline literal at the NodeView.
 * It is the pod's memo KEY together with `source`, so a per-render literal
 * would re-derive (and re-measure, and re-lay-out) the tree on every unrelated
 * re-render of the block — the cost this task's own suite measures. And a
 * config spelled at its call site is a config that drifts from the one a test
 * drives, at which point the suite stops speaking for what ships.
 */
export const FOREST_POD_CONFIG: SourcePodConfig = {
  hostClass: "forest-block",
  sourceAttr: "source",
  chipLabel: "forest",
  kindLabel: "forest tree",
  emptyLabel: "(empty tree)",
  confirmMessage:
    "This will remove the forest tree and its source. You can undo with Cmd+Z.",
  derive: deriveForestPod,
};
