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
import type { PanelThemeKey } from "@/lib/panel-theme";

export type FloatDomain = "card" | "textobject";

/** Visual treatment of the window shell. Cards AND text-objects float on
 *  "card" (white surface, 1px ambient border — pop-out continuity #20);
 *  "panel" is the beige pod look, kept for panel-shaped floats. */
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
   *  region (Seam 2 budget: 1 slot + a title override). For cards this is a
   *  `CardChromeTrailing` element (collab pill/dots + three-dot menu +
   *  per-card slot) the factory constructs; React runs its hooks when
   *  `FloatChrome` renders it, and it hosts its own `CardClaimContext`. */
  trailing?: ReactNode;
  /** Replaces the plain title text in the label position (e.g. the revision
   *  morph dropdown). When set, `FloatChrome` renders this instead of the
   *  `title` string. The narrow second domain contribution (the morph
   *  control belongs at the label, not in `trailing`). */
  title?: ReactNode;
}

/** Handed to `renderBody()` at mount/refresh time so a domain body can drive
 *  the chrome it can't reach directly. */
export interface FloatBodyContext {
  /** Override the chrome title for this float instance during its life (e.g. a
   *  heading level → "Chapter"/"Section"/"Subsection"). Pass `null` to clear
   *  back to the static `title`. Generalizes the text-object `setHeaderLabel`.
   *  Card bodies ignore this (their title is static or a `chromeSlots.title`
   *  morph control). */
  setTitle(title: string | null): void;
  /** The stored popout key (the dispatcher's iteration key into
   *  `prefs.poppedOutCards`). Text-object bodies need it to close their own
   *  float (`popped.close(cardKey)`); card bodies ignore it. Until the Stage-4
   *  grammar flip this is the legacy key, not `floatable.key`. */
  windowKey: string;
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

  /** Optional PANEL-THEME KEY this float takes its accent from — pop-out
   *  continuity (#20) + the popped-card WINDOW ring (bug #34). Card floats
   *  set it from `CARD_REGISTRY[kind].themeKey`; text-object floats omit it
   *  (neutral `--surface-muted-strong` strip, neutral ring).
   *
   *  A KEY, never a resolved colour (task 493). A kind's accent is a live
   *  function of the panel-colour store, and a `Floatable` is a DESCRIPTION
   *  of what to render, resolved once when the float map re-derives — so a
   *  baked `headerTint` went stale the moment the user picked a new colour
   *  in that panel's picker, leaving the open float on the old header strip
   *  and the old window ring while the docked card, the margin marker, the
   *  in-text anchor and the highlight band all re-tinted. `FloatWindow`
   *  resolves the pair LIVE through `useFloatAccent` and hands `FloatChrome`
   *  a resolved tint, so the chrome stays card-blind. */
  themeKey?: PanelThemeKey;

  /** The specialized content — **headerless**: `FloatChrome` (owned by
   *  `FloatWindow`) renders the grip/title/trailing/jump/close skeleton above
   *  it. The `ctx` lets the body retitle the chrome (text headings). */
  renderBody(ctx: FloatBodyContext): ReactNode;

  /** Optional header slots the domain contributes (Seam 2). */
  chromeSlots?: FloatChromeSlots;

  /** When true, `FloatWindow` renders NO `FloatChrome` — the body supplies its
   *  own full layout including a bespoke header (today: `bib` / `ai`, pending
   *  their Stage-6 migration to the unified chrome). The window degrades to a
   *  thin draggable frame. */
  bareWindow?: boolean;

  /** Whether the window participates in the panel dock flow (redock proximity
   *  + dock outline). Cards/text-objects: false (panels only). Defaults false. */
  canRedock?: boolean;

  /** Reveal where this thing actually lives (scroll-to + select). */
  jumpToSource(): void;
  /** Whether the float shows the jump affordance (some cards have no anchor). */
  canJump: boolean;

  /** Whether the float shows the (re)anchor drop button (left of the X).
   *  Card floats set this from the static `CARD_REGISTRY[kind].droppable`
   *  facet (read in `cardFloatable`, not here — the float subsystem stays
   *  card-blind); text-object floats omit it (not droppable). `FloatChrome`
   *  pairs it with `key` (its `float:<domain>:<kind>:<id>` string) as the
   *  `dropCardKey` so `beginCardDropGesture` can look the spec up. */
  canDrop?: boolean;

  /** Serialize onto the Stack. Returns null when this kind isn't stackable.
   *  For a CARD float that is `CARD_REGISTRY[kind].stackable === false`
   *  (`report` / `report-request` / `example`; `error` is not poppable at all),
   *  pinned to the Stack's vocabulary by `assertStackCoverage()`; for a
   *  text-object float, a source that can't be resolved. */
  snapshotForStack(source: {
    docId: string | null;
    docTitle?: string;
  }): StackItem | null;

  /** Initial float size. Omit → subsystem default (`FLOAT_DEFAULT_SIZE`). */
  defaultSize?: { w: number; h: number };
}
