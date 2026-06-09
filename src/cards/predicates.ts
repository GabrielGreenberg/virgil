/**
 * Canonical card-kind predicates — all derived from `CARD_REGISTRY`. These
 * replace the six parallel kind-enums and the polymorphic-panel branches
 * (audit §4.4): every "is this kind X?" / "which kinds belong to panel P?"
 * question reads the registry, never a hand-kept list.
 *
 * Keep these over the STATIC registry only — never filter live records (that
 * would re-introduce a doc walk; keystroke sanctity). They are O(1) map reads.
 *
 * `resolveCardKind(key|record, ctx)` — the one residue of comment/suggestion
 * polymorphism — is added in stage A0.7 (it needs `CardFloatCtx` + the three
 * suggestion key forms), alongside retiring the polymorphic tables.
 */
import { CARD_REGISTRY } from "./card-registry";
import type { CardKind } from "./types";
import type { PanelKind } from "@/panels/_shared/types";

/** All card kinds, in registry declaration order. */
export const CARD_KINDS = Object.keys(CARD_REGISTRY) as CardKind[];

export const isCardKind = (s: string): s is CardKind => s in CARD_REGISTRY;

/** Replaces `ANCHORED_CARD_KINDS` / `EntityKind` / `MarginaliaMarker.entityKind`
 *  and the polymorphic-panel anchor branches. */
export const isAnchoredCardKind = (k: CardKind): boolean => CARD_REGISTRY[k].anchored;

export const isSystemCardKind = (k: CardKind): boolean =>
  CARD_REGISTRY[k].origin === "system";

/** Replaces `CARD_KEY_PREFIXES` + the `popKey`/`cardPopKey` token lookup. */
export const cardKeyPrefix = (k: CardKind): string => CARD_REGISTRY[k].keyPrefix;

/** Replaces `getPanelByCardKind` + `POLYMORPHIC_CARD_PANEL`. */
export const panelForCardKind = (k: CardKind): PanelKind | null =>
  CARD_REGISTRY[k].panel;

/** Derives polymorphic-panel membership (notes → [note, highlight], etc.).
 *  Replaces `PANEL_REGISTRY.card` + `POLYMORPHIC_CARD_PANEL` entirely, and is
 *  the morph-set accessor A9's chevron consumes. */
export const cardKindsForPanel = (p: PanelKind): CardKind[] =>
  CARD_KINDS.filter((k) => CARD_REGISTRY[k].panel === p);

/** The set of kinds that can serialize onto the Stack. Replaces the hand-kept
 *  `StackCardKind` union. */
export const stackableCardKinds = (): CardKind[] =>
  CARD_KINDS.filter((k) => CARD_REGISTRY[k].stackable);

/** Whether a kind can pop out into a `Floatable` window. Registry-derived SSOT
 *  for the docked one-click pop-out control (and `registerCardFloatable`'s
 *  registration guard). Only `error` is false (ratified not-poppable, §3.5). */
export const isPoppable = (k: CardKind): boolean => CARD_REGISTRY[k].poppable;
