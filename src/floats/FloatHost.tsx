"use client";

import { FloatWindow } from "./FloatWindow";
import { parseAnyKey } from "./float-key";
import type { Floatable } from "./types";
// Side-effect: register every poppable card kind's `toFloatable` builder onto
// CARD_REGISTRY before any popout renders (mirrors the text-object float
// registry). Must run on the float-render path.
import "@/cards/floats";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { isCardKind } from "@/cards/predicates";
import type { CardFloatCtx } from "@/cards/card-float-ctx";
import { textObjectFloatable } from "@/text-objects/text-object-floatable";
import { isTextObjectKind } from "@/text-objects/text-object-registry";

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

function resolveFloatable(key: string, cardCtx: CardFloatCtx): Floatable | null {
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
