"use client";

/**
 * **Float key → `Floatable`, in ONE place** — and the capture door built on it.
 *
 * `FloatHost` had this resolver as a private function and `EditorPane`'s
 * `virgil-stack-drop` handler carried a second copy of it, announced as such in
 * its own comment ("Mirror `FloatHost.resolveFloatable`"). Two copies of a
 * dispatch that has to agree about which registry answers for which domain is
 * the shared-fork shape this repo keeps retiring (`AGENTS.md` → "A registry
 * earns its name by being read"); the copies had already drifted in the small
 * way such copies do — the host's threaded its own `editorRef` for the
 * text-object branch instead of the one hanging off the ctx it already had.
 *
 * The side-effect import of `@/cards/floats` lives here rather than in
 * `FloatHost`, which is what makes the CAPTURE path self-sufficient: before,
 * the host's copy resolved `CARD_REGISTRY[kind].toFloatable` and was correct
 * only because some other module had already rendered a float and run the
 * registration for it.
 *
 * The DECLARED half of the capture question — "may this float be captured at
 * all?" — is `./stack-capture`, deliberately kept light enough for the drag
 * gesture to import. This module is the EXECUTION half and may be heavy.
 */
import { parseAnyKey } from "./float-key";
import { canCaptureToStack } from "./stack-capture";
import type { Floatable } from "./types";
// Side-effect: register every poppable card kind's `toFloatable` builder onto
// CARD_REGISTRY before any popout renders — or any capture resolves (mirrors
// the text-object float registry).
import "@/cards/floats";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { isCardKind } from "@/cards/predicates";
import type { CardFloatCtx } from "@/cards/card-float-ctx";
import { textObjectFloatable } from "@/text-objects/text-object-floatable";
import { isTextObjectKind } from "@/text-objects/text-object-registry";
import type { StackItem } from "@/lib/stack/types";

/**
 * Resolve a stored popout key to the `Floatable` that renders (and serializes)
 * it. Blind to which kind it holds: parse the key, look up the one registry.
 *
 * `parseAnyKey` reads BOTH the legacy `<prefix>:<id>` / `textobject:<kind>:<id>`
 * grammars AND the `float:<domain>:<kind>:<id>` grammar, so callers work
 * whether a key has been migrated or not. Returns null for an unparseable key,
 * an unknown kind, or a not-poppable one (`error` is never registered).
 *
 * **Keystroke sanctity:** O(1) per key — one `parseAnyKey`, one registry
 * lookup, one `toFloatable` (a pure single-entity resolver). No doc walk.
 */
export function resolveFloatable(
  key: string,
  cardCtx: CardFloatCtx,
): Floatable | null {
  const parsed = parseAnyKey(key);
  if (!parsed) return null;
  if (parsed.domain === "textobject") {
    if (!isTextObjectKind(parsed.kind)) return null;
    return textObjectFloatable(
      { kind: parsed.kind, id: parsed.id },
      cardCtx.editorRef,
    );
  }
  // card domain — `error` resolves to null (not poppable; never registered).
  if (!isCardKind(parsed.kind)) return null;
  return CARD_REGISTRY[parsed.kind].toFloatable(parsed.id, cardCtx);
}

/**
 * Capture a float onto the Stack: the ONE door the `virgil-stack-drop` host
 * enters. Returns the `StackItem` on a capture that actually happened, and
 * **null on every refusal** — a kind that cannot be captured, a key that
 * doesn't resolve, a source the snapshot can't find.
 *
 * That null is a REPORT, and the caller owes the user something honest about
 * it: the source float is closed only when an item came back. "The report is
 * the permission" (`AGENTS.md` → "The return half") — the pre-332 host closed
 * the float unconditionally under the comment *"the user's intent is clear"*,
 * which was right about the intent and wrong about the outcome, since the
 * intent was CAPTURE and none had happened.
 *
 * The capability check runs first so a non-capturable kind costs no doc read at
 * all, and so the host and the drag gesture answer the question from the same
 * table (`canCaptureToStack`) rather than from two.
 */
export function captureFloatToStack(
  floatKey: string,
  cardCtx: CardFloatCtx,
  source: { docId: string | null; docTitle?: string },
): StackItem | null {
  if (!canCaptureToStack(floatKey)) return null;
  return resolveFloatable(floatKey, cardCtx)?.snapshotForStack(source) ?? null;
}
