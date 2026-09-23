/**
 * Action SCOPE — the one owner of "which doc range does this action act on?"
 *
 * There is exactly one rule here, and before task 732 it was written out
 * three separate times (`resolveRefRange` + `outerRangeFor` in
 * `drag-handle-actions.ts`, `cardResolveScope` in `action-registry.ts`) and
 * DERIVED zero times:
 *
 *   > An ANNOTATION action (highlight / note / footnote / citation / todo /
 *   > suggest-edit / cutter / report) acts on the text the user is annotating;
 *   > a LIFECYCLE action (duplicate / archive / delete) acts on the structural
 *   > region the object owns.
 *
 * For every kind but `heading` those two coincide, which is exactly why the
 * three copies could agree for as long as they did while being free to drift.
 * The thing they guard is not cosmetic: ACTION-MENU-DIAGNOSIS.md clusters
 * C9 + C11 — a heading × Highlight that took the SECTION range wrote the
 * `\vlidend{}` closer inside `\section{...}` braces and stripped every other
 * `linkedAnchor` pair in the doc on the next save/reload round trip.
 *
 * `TEXT_OBJECT_REGISTRY` already declared the two per-kind hooks that own the
 * asymmetry — `collectMoveSource` (lifecycle) and `collectAnnotationRange`
 * (annotation). This module is the door that READS them, for ANY kind, so
 * `types.ts`'s advertised extension ("other kinds may grow scope asymmetry
 * later, e.g. `exampleBlock` annotating its intro line") is a registry edit
 * rather than a third hand-written copy of the rule.
 *
 * "A registry earns its name by being read" (AGENTS.md).
 */
import type { Node as PMNode } from "@tiptap/pm/model";

import { TEXT_OBJECT_REGISTRY } from "./text-object-registry";
import type { DragHandleAction, TextObjectKind } from "./types";

// ---------------------------------------------------------------------------
// The action class
// ---------------------------------------------------------------------------

/** Which side of the split an action sits on. */
export type ActionScopeClass = "annotation" | "lifecycle";

/**
 * THE lifecycle (structural) action ids. Both action vocabularies —
 * `DragHandleAction` (the grab-bar menu) and `CardActionId` (the registry's
 * card rows) — derive their own typed set from this tuple rather than
 * hand-copying the members, so a fourth lifecycle action is one edit and the
 * two sets cannot drift. The literal tuple type is what makes each derivation
 * a genuine type-level pin: `new Set<CardActionId>(LIFECYCLE_ACTION_IDS)`
 * compiles only while every member is a member of that union too.
 */
export const LIFECYCLE_ACTION_IDS = [
  "duplicate",
  "archive",
  "delete",
] as const;

export type LifecycleActionId = (typeof LIFECYCLE_ACTION_IDS)[number];

// Type-level pin on this side: every lifecycle id is a real `DragHandleAction`.
const _LIFECYCLE_IDS_ARE_DRAG_HANDLE_ACTIONS: readonly DragHandleAction[] =
  LIFECYCLE_ACTION_IDS;
void _LIFECYCLE_IDS_ARE_DRAG_HANDLE_ACTIONS;

const LIFECYCLE_ACTION_SET: ReadonlySet<string> = new Set<string>(
  LIFECYCLE_ACTION_IDS,
);

/** Is this action id a lifecycle (structural) action? */
export function isLifecycleAction(actionId: string): boolean {
  return LIFECYCLE_ACTION_SET.has(actionId);
}

/** The scope class an action id resolves under. Everything that is not a
 *  declared lifecycle action is an annotation action. */
export function actionScopeClass(actionId: string): ActionScopeClass {
  return isLifecycleAction(actionId) ? "lifecycle" : "annotation";
}

// ---------------------------------------------------------------------------
// The per-kind scope override
// ---------------------------------------------------------------------------

/**
 * The answer a scope override can give. Three states, because "this kind
 * declares no override" and "this kind's override could not locate the object"
 * are different facts and the callers must treat them differently:
 *
 *   - `none`       → no hook for this class; the caller applies its own
 *                    generic fallback (the node's own bounds / content range).
 *   - `resolved`   → the hook answered; use this range verbatim.
 *   - `unresolved` → the hook is declared but could not find the object
 *                    (stale uuid / unmapped node). The caller BAILS — it must
 *                    not silently fall back to a range the kind has explicitly
 *                    said is the wrong one.
 */
export type ScopeOverride =
  | { status: "none" }
  | {
      status: "resolved";
      from: number;
      to: number;
      nodes: ReadonlyArray<PMNode>;
    }
  | { status: "unresolved" };

const NO_OVERRIDE: ScopeOverride = { status: "none" };

/**
 * Ask the registry for `kind`'s scope under `scopeClass`. Kind-agnostic by
 * construction: it reads the hook slot for the class and never mentions any
 * particular kind. Pure — reads only `doc` + the registry row.
 */
export function collectScopeOverride(
  doc: PMNode,
  kind: TextObjectKind,
  uuid: string,
  scopeClass: ActionScopeClass,
): ScopeOverride {
  const meta = TEXT_OBJECT_REGISTRY[kind];
  const hook =
    scopeClass === "lifecycle"
      ? meta.collectMoveSource
      : meta.collectAnnotationRange;
  if (!hook) return NO_OVERRIDE;
  const source = hook(doc, uuid);
  if (!source) return { status: "unresolved" };
  return {
    status: "resolved",
    from: source.from,
    to: source.to,
    nodes: source.nodes,
  };
}

/**
 * Convenience wrapper for the two range-only callers: the override's plain
 * `{from, to}`, or `null` when the hook is declared and failed. `undefined`
 * means "no override — apply your own fallback", which is deliberately NOT
 * `null` so a caller cannot collapse the bail and the fallback by accident.
 */
export function scopeOverrideRange(
  doc: PMNode,
  kind: TextObjectKind,
  uuid: string,
  scopeClass: ActionScopeClass,
): { from: number; to: number } | null | undefined {
  const override = collectScopeOverride(doc, kind, uuid, scopeClass);
  if (override.status === "none") return undefined;
  if (override.status === "unresolved") return null;
  return { from: override.from, to: override.to };
}
