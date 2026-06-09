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

  /** Opt in to the auto-fit grow-burst (a text float spawned at default size
   *  grows to fit its content, capped by `POPOUT_MAX_VH`). Replaces the old
   *  `.par-float-body` DOM sniff; cards never set it. */
  autoFitBody?: boolean;

  /** Whether the window participates in the panel dock flow (redock proximity
   *  + dock outline). Cards/text-objects: false (panels only). Defaults false. */
  canRedock?: boolean;

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
