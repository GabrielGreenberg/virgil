"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import {
  cardJumpGate,
  type CardAnchorPass,
  type DockedJumpGate,
} from "@/links/card-anchor-rows";
import type { CardWithLinks } from "@/links/links";

/**
 * The pane's ONE card-anchor pass (task 369's authority), published once.
 *
 * `EditorPane` builds `buildCardAnchorPass(editor)` gated on the structural
 * counters (`rev.anchors` / `rev.blocks` — plain typing bumps neither) and
 * feeds it to the margin markers and the floats. Before task 699 the omni host
 * built a SECOND copy from the same counters, and the six docked panels built
 * none at all: they gated Jump on "the card STORES a link"
 * (`getLinkedTextObjectIds(card).length > 0`), which is true of a card whose
 * paragraph was deleted (a Jump that silently does nothing) and false of a
 * range-only highlight whose mark `resolveLink` finds (a working Jump hidden).
 *
 * Every surface that asks "where is this card anchored?" or "may this card
 * offer Jump?" now reads THIS pass — one index per structural change, one
 * answer per card.
 */
const CardAnchorCtx = createContext<CardAnchorPass | null>(null);

export function CardAnchorProvider({
  value,
  children,
}: {
  value: CardAnchorPass;
  children: ReactNode;
}) {
  return <CardAnchorCtx.Provider value={value}>{children}</CardAnchorCtx.Provider>;
}

export function useCardAnchorPass(): CardAnchorPass {
  const v = useContext(CardAnchorCtx);
  if (!v) throw new Error("useCardAnchorPass must be used inside CardAnchorProvider");
  return v;
}

/**
 * The gate every docked panel takes as its `jumpGate` prop — the SAME
 * `cardJumpGate` the omni rows and the floats apply, over the SAME resolver.
 * A panel never re-derives the decision; it hands its handler to
 * `jumpGate(card).withJump(…)` and renders whatever comes back.
 */
export function useDockedJumpGate(): DockedJumpGate {
  const { resolve } = useCardAnchorPass();
  return useCallback((card: CardWithLinks) => cardJumpGate(card, resolve), [resolve]);
}
