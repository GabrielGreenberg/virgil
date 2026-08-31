"use client";

import { useCardTheme } from "@/hooks/usePanelTheme";
import type { CardTheme } from "@/lib/panel-theme";
import { CARD_REGISTRY } from "./card-registry";
import type { CardKind } from "./types";

/**
 * The live theme for a CARD KIND — the one place a card's chrome asks "which
 * accent is mine?" (task 493).
 *
 * `CARD_REGISTRY[kind].themeKey` is the SSOT for that binding, and every other
 * consumer already derives from it: `collabClaimScope`, `marker-meta`'s
 * marker→theme map, the AI inbox's chip palette, and (since 493) the popped-out
 * float's accent. The DOCKED cards were the holdouts — fifteen sites spelling
 * `useCardTheme("note")` / `useCardTheme("cut")` / … as literals. They agree
 * with the registry today, so this closes a latent DRIFT rather than a live
 * defect: re-theme a kind in `CARD_REGISTRY` and the float would follow while
 * the docked card kept the old accent, which is two answers to one question.
 *
 * The kind literal stays at the call site and that is correct — `NoteCard` IS
 * the note kind, and there is no second table to keep in step. What moves is
 * the THEME KEY, which is the registry's to state.
 */
export function useCardKindTheme(kind: CardKind): CardTheme {
  return useCardTheme(CARD_REGISTRY[kind].themeKey);
}
