"use client";

/**
 * The ONE door between `useAnchoredCard` and the card shell (`EditableCard` /
 * `PanelCard`) — task 963.
 *
 * Before it, every anchored card component (note, highlight, report,
 * report-request, todo, archive, example, citation, footnote, cutter-comment,
 * revision-comment, and the suggestion twins) re-derived the same glue by
 * hand: the pop key, the popped-cards toggle, `compressed = !expanded &&
 * !isPoppedOut`, the `[data-card]` source resolution for jump + body click,
 * the hover publish to the card store (spelled two ways), and the
 * expand/header-activate forwards. Copying the glue also copied its optional
 * override props (`onTogglePopout`, `onHoverChange`) onto every card — and no
 * caller ever supplied them, so the override branch was dead in all twelve.
 *
 * A card now calls this hook and spreads `shell` onto its shell element,
 * keeping only what is genuinely its own (title, body, badges, footer, the
 * occasional documented override such as the citation draft's select-only
 * header). A host that needs to override a shell handler adds a REAL caller
 * then; the dead-prop census (`dead-panel-prop-guardrail`, caller-side leg)
 * fails on an optional card prop nobody passes.
 */

import type { MouseEvent } from "react";
import { makeCompressedSummary } from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { cardPopKey } from "@/panels/panel-registry";
import { useAnchoredCard, type UseAnchoredCardResult } from "@/links/_shared/useAnchoredCard";
import { useCardStore } from "@/links/_shared/anchored-card-store";
import type { CardKind } from "@/cards/types";

export interface AnchoredCardShellOptions {
  kind: CardKind;
  id: string;
  /** The card renders inside its float window (headerless, never compressed). */
  isPoppedOut?: boolean;
  /** The host's MONOTONIC select slot, run on body activation (C15). */
  onSelect?: () => void;
  /** Jump the editor to the card's anchor. Omit when the card has no jump
   *  target (unanchored) — `canJump` then reads false and the body click
   *  selects without jumping. */
  onJump?: (sourceEl: HTMLElement | null) => void;
  /** When the key is present (even with an undefined value), `compressedSummary`
   *  is the standard rich-text summary of it. Cards with a bespoke collapsed
   *  cue (an excerpt, a highlighted passage) omit it and build their own from
   *  `compressedLines`. */
  summaryContent?: unknown;
}

/** The prop bundle a card spreads onto `EditableCard` / `PanelCard`. Every
 *  member is a prop both shells accept under the same name. */
export interface AnchoredCardShellProps {
  cardKey: string;
  isPoppedOut?: boolean;
  chromeless?: boolean;
  onTogglePopout?: (anchor: DOMRect) => void;
  onHoverChange: (hovering: boolean) => void;
  onToggleExpanded: () => void;
  onHeaderActivate: () => void;
  onClick: (e?: MouseEvent) => void;
  canJump: boolean;
  onJump?: (e: MouseEvent) => void;
}

export interface AnchoredCardShell {
  ac: UseAnchoredCardResult;
  cardKey: string;
  /** Collapsed body: neither expanded nor popped out. */
  compressed: boolean;
  compressedLines: number;
  /** `makeCompressedSummary(summaryContent)` while compressed; undefined otherwise. */
  compressedSummary: string | undefined;
  shell: AnchoredCardShellProps;
}

/** The card element a shell click / jump chevron fires inside — the source
 *  rect the jump animates from. */
function cardElementOf(e: MouseEvent | undefined): HTMLElement | null {
  return ((e?.currentTarget as HTMLElement | undefined)?.closest("[data-card]") as HTMLElement | null) ?? null;
}

export function useAnchoredCardShell(opts: AnchoredCardShellOptions): AnchoredCardShell {
  const { kind, id, isPoppedOut, onSelect, onJump } = opts;
  const ac = useAnchoredCard({ kind, id });
  const cardStore = useCardStore();
  const popped = usePoppedCards();
  const compressedLines = useCompressedLines();
  const cardKey = cardPopKey(kind, id);
  const compressed = !ac.expanded && !isPoppedOut;
  const compressedSummary =
    compressed && "summaryContent" in opts
      ? makeCompressedSummary(opts.summaryContent, compressedLines) || ""
      : undefined;

  const onHoverChange = (hovering: boolean) => cardStore.setHoverFor(ac.ref, hovering);
  const onTogglePopout = popped
    ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
    : undefined;
  const onClick = (e?: MouseEvent) => {
    const el = cardElementOf(e);
    ac.onBodyActivate({
      onSelect,
      jump: onJump ? () => onJump(el) : undefined,
    });
  };

  return {
    ac,
    cardKey,
    compressed,
    compressedLines,
    compressedSummary,
    shell: {
      cardKey,
      isPoppedOut,
      chromeless: isPoppedOut,
      onTogglePopout,
      onHoverChange,
      onToggleExpanded: ac.onToggleExpanded,
      onHeaderActivate: ac.onHeaderActivate,
      onClick,
      canJump: !!onJump,
      onJump: onJump ? (e: MouseEvent) => onJump(cardElementOf(e)) : undefined,
    },
  };
}
