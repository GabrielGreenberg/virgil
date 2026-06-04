/**
 * The `Floatable` presence contract — the single thin behavioral role that a
 * `Card` and a `TextObject` both satisfy *by composition* when popped into a
 * floating window. The float subsystem (the rest of `src/floats/`, built by
 * AF-impl) is blind to which kind it holds; it operates only on this contract.
 *
 * Composition, NOT a base class: a Card *has* a floating presence; a TextObject
 * *has* a floating presence. The two ontologies stay ontologically distinct —
 * they only both *produce* a `Floatable`.
 *
 * Designed in `docs/card-refactor/AF-floatable-audit.md` §2. This file is
 * created by the **A0-impl** chip (the card spine needs the type so
 * `CARD_REGISTRY[kind].toFloatable(id, ctx)` can satisfy it). **AF-impl OWNS
 * this module** and builds the rest of it (FloatWindow / FloatChrome /
 * FloatHost / float-key / float-policy) AROUND this file — AF must NOT recreate
 * `types.ts`.
 */
import type { ReactNode } from "react";
import type { StackItem } from "@/lib/stack/types";

export type FloatDomain = "card" | "textobject";

/** Visual treatment of the window shell (today: cards → "panel", text → "card"). */
export type FloatSurface = "panel" | "card";

/** Context handed to `renderBody()` at mount/refresh time. Domain-specific; the
 *  subsystem passes the matching bag through opaquely. The CARD bag is
 *  `CardFloatCtx` (≈ today's `PoppedCardDeps`, owned by the card spine); the
 *  TEXTOBJECT bag is `{ editorRef }`. AF does NOT define their internals — only
 *  that `toFloatable()` receives one. */
export type FloatRenderCtx = unknown;

export interface FloatChromeSlots {
  /** Narrow region between title and jump/close: status dot, claim pill, AI
   *  checkbox, source-missing indicator. The ONLY domain-contributed header
   *  region (Seam 2 budget: 1 slot + a title override). */
  trailing?: ReactNode;
}

export interface Floatable {
  /** Unified popout key — `float:<domain>:<kind>:<id>`. Parses back via
   *  `parseFloatKey()` (AF-owned). */
  key: string;
  domain: FloatDomain;
  kind: string; // CardKind | TextObjectKind (string at this layer)
  id: string;

  /** Header label. May be overridden per-instance during the float's life
   *  (e.g. a heading level → "Chapter"/"Section"). */
  title: string;

  /** Visual shell treatment. */
  surface: FloatSurface;

  /** The specialized content. Per AF §2 this is headerless once AF moves the
   *  header into `FloatChrome`; until then A0's card bodies render their own
   *  (existing) header and self-wrap in `<FloatCard>`. */
  renderBody(): ReactNode;

  /** Optional header slots the domain contributes (Seam 2). */
  chromeSlots?: FloatChromeSlots;

  /** Reveal where this thing actually lives (scroll-to + select). */
  jumpToSource(): void;
  /** Whether the float shows the jump affordance (some cards have no anchor). */
  canJump: boolean;

  /** Serialize onto the Stack. Returns null when this kind isn't stackable
   *  (ai / error / examples / text-object sub-objects). */
  snapshotForStack(source: {
    docId: string | null;
    docTitle?: string;
  }): StackItem | null;

  /** Initial float size. Omit → subsystem default (`FLOAT_DEFAULT_SIZE`). */
  defaultSize?: { w: number; h: number };
  /** Rect to spawn at (lift-off hands the cursor rect; otherwise computed from
   *  the trigger anchor via `computeSpawnPosition`). */
  spawnHint?: DOMRect;
}
