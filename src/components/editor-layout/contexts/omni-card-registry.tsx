"use client";

/**
 * The OMNI CARD REGISTRY — the cards OmniHost has built, readable from the
 * other side of the pane.
 *
 * OmniHost assembles every card kind's real card element (with the same
 * handlers, selection and AI-request wiring the right gutter uses). The tool
 * gutter's lists open a row IN PLACE into that kind's card, and rather than
 * re-wire every kind a second time they read the element OmniHost already
 * built — so an open row and the right gutter's card are the same card.
 *
 * One registry per pane (EditorPane creates it), written per side by each
 * OmniHost in an effect (never per keystroke — OmniHost's `items` are memoized
 * on data and selection), read with `useSyncExternalStore`. A side that stops
 * hosting cards (a collapsed gutter) keeps its last cards, so an open row can
 * still show its card.
 */

import { cloneElement, createContext, isValidElement, useContext, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import type { OmniItem } from "@/panels/_shared/types";
import { anchorRowBaseId } from "@/links/card-anchor-rows";

export interface OmniCardRegistry {
  set(side: string, items: readonly OmniItem[]): void;
  /** The card for an entity id (a note's, a to-do's, an error's id…), and the
   *  card kind it was built as. Null when no host has built it. */
  find(entityId: string): { kind: string; content: ReactNode } | null;
  subscribe(cb: () => void): () => void;
  version(): number;
}

export function createOmniCardRegistry(): OmniCardRegistry {
  const bySide = new Map<string, readonly OmniItem[]>();
  const subs = new Set<() => void>();
  let v = 0;
  return {
    set(side, items) {
      if (bySide.get(side) === items) return;
      bySide.set(side, items);
      v += 1;
      for (const cb of subs) cb();
    },
    find(entityId) {
      for (const items of bySide.values()) {
        for (const it of items) {
          // `float:card:<kind>:<id>`, any `@<pid>` row suffix stripped.
          const base = anchorRowBaseId(it.id);
          const parts = base.split(":");
          if (parts.slice(3).join(":") !== entityId) continue;
          return { kind: parts[2] ?? "", content: it.content };
        }
      }
      return null;
    },
    subscribe(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    version: () => v,
  };
}

const Ctx = createContext<OmniCardRegistry | null>(null);
export const OmniCardRegistryProvider = Ctx.Provider;

export function useOmniCardRegistry(): OmniCardRegistry | null {
  return useContext(Ctx);
}

const NOOP_SUBSCRIBE = () => () => {};
const ZERO = () => 0;

/** The card OmniHost built for `entityId`, without the omni-only
 *  `data-omni-entry` attribute (the right gutter's measure and pin passes
 *  look cards up by it, so a second copy must not carry it). */
export function useOmniCard(entityId: string | null): { kind: string; content: ReactNode } | null {
  const reg = useOmniCardRegistry();
  useSyncExternalStore(reg?.subscribe ?? NOOP_SUBSCRIBE, reg?.version ?? ZERO, ZERO);
  if (!reg || !entityId) return null;
  const hit = reg.find(entityId);
  if (!hit) return null;
  const el = hit.content;
  return {
    kind: hit.kind,
    content: isValidElement(el)
      ? cloneElement(el as ReactElement<{ extraDataAttrs?: Record<string, string> }>, { extraDataAttrs: undefined })
      : el,
  };
}
