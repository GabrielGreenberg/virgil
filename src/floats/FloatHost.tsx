"use client";

import { FloatWindow } from "./FloatWindow";
// The key→`Floatable` dispatch (and the `@/cards/floats` registration
// side-effect it carries) lives in its own module: the stack-capture host reads
// the SAME resolver rather than mirroring it (task 332).
import { resolveFloatable } from "./resolve-floatable";
import type { CardFloatCtx } from "@/cards/card-float-ctx";

/**
 * The generic float dispatcher — AF's successor to `renderPoppedCard`. Maps
 * each stored popout key in `prefs.poppedOutCards` to a `Floatable` (card or
 * text-object) and mounts it through the unified `FloatWindow`. Blind to which
 * kind it holds: it parses the key, looks up the one registry, and renders.
 *
 * **Keystroke sanctity:** O(1) per key — one `parseAnyKey`, one registry
 * lookup, one `toFloatable` (a pure single-entity resolver). No doc walk, no
 * `editor.on()` subscriber. The key list changes identity only on open/close,
 * never on a plain keystroke, so typing re-derives nothing here.
 *
 * `parseAnyKey` reads BOTH the legacy `<prefix>:<id>` / `textobject:<kind>:<id>`
 * grammars AND the Stage-4 `float:<domain>:<kind>:<id>` grammar — so the flip is
 * non-breaking. It also normalizes `revision:s:<id>` → `revision-suggestion`
 * (stripping the `s:`), which fixes the long-standing popped-suggestion-blank
 * bug by construction. `windowKey` (the stored key) keys the window ops until
 * the flip converges it with `floatable.key`.
 */
export function FloatHost({
  keys,
  cardCtx,
}: {
  keys: readonly string[];
  cardCtx: CardFloatCtx;
}) {
  return (
    <>
      {keys.map((key) => {
        const f = resolveFloatable(key, cardCtx);
        if (!f) return null;
        return <FloatWindow key={key} floatable={f} windowKey={key} />;
      })}
    </>
  );
}
