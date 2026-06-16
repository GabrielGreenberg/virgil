/**
 * `CARD_REGISTRY` — the single source of truth for the card spine. One
 * `CardMeta` descriptor per `CardKind`, mirroring `TEXT_OBJECT_REGISTRY`
 * (`src/text-objects/text-object-registry.ts`). Adding a card kind = one entry
 * here (+ membership in the anchor list / lifecycle provider); the scattered
 * satellite tables (`CARD_KEY_PREFIXES`, `CARD_TYPE_LABELS`, `CARD_TITLE_LABELS`,
 * `POLYMORPHIC_CARD_PANEL`, …) are now registry-DERIVED (see `predicates.ts`
 * and `panel-registry.ts`).
 *
 * **This module is deliberately LIGHT** — it imports only `./types` and
 * type-only `Floatable`/`CardFloatCtx`. No card UI, no drop-specs, nothing that
 * transitively reaches `panel-registry`. That matters because `predicates.ts`
 * imports this, and low-level modules (`panel-registry`, `entity-hover`,
 * `marginalia`) import predicates — so any heavy/looping import here would form
 * a cycle (`panel-registry → predicates → card-registry → … → panel-registry`).
 * The two heavy concerns are decoupled:
 *   - **`toFloatable`** is registered at boot by `src/cards/floats/index.tsx`
 *     (the `registerFloatBody` pattern); each entry holds a `null` placeholder.
 *   - **`dropSpec`** stays `null` for now. The in-document drop wiring still
 *     lives in `src/components/drop-mode/registry.ts` (`SPECS`, keyed by
 *     prefix); folding it onto `CardMeta.dropSpec` requires the same
 *     registration indirection (a `registerCardDropSpec` from the drop path)
 *     and is deferred until `lookupSpec` is rewired to read the registry
 *     (AF / a follow-up). Importing the spec objects here directly reintroduces
 *     the cycle, so it is intentionally avoided.
 */
import type { CardKind, CardMeta } from "./types";
import type { CardFloatCtx } from "./card-float-ctx";
import type { Floatable } from "@/floats/types";
import type { DropSpec, PlacementKind } from "@/components/drop-mode/types";

/**
 * `toFloatable` registration — mirrors the text-object registry's
 * `registerFloatBody` (`text-object-registry.ts:1101`). Each entry below holds
 * a PLACEHOLDER that returns `null`; the real per-kind builders (which import
 * the card UI) are registered at boot by `src/cards/floats/index.tsx`, imported
 * once on the float-render path.
 *
 * `error` is intentionally NEVER registered (ratified: not poppable, audit
 * §3.5) — it keeps the placeholder, so `CARD_REGISTRY.error.toFloatable()`
 * returns `null`.
 */
export type CardFloatableBuilder = (
  id: string,
  ctx: CardFloatCtx,
) => Floatable | null;

const PLACEHOLDER_TO_FLOATABLE: CardFloatableBuilder = () => null;

/** Install a kind's real `toFloatable` builder (called from `cards/floats`). */
export function registerCardFloatable(
  kind: CardKind,
  build: CardFloatableBuilder,
): void {
  // Poppability is the registry's declarative SSOT (`CardMeta.poppable`); a
  // non-poppable kind (`error`) silently ignores a stray registration.
  if (!CARD_REGISTRY[kind].poppable) return;
  CARD_REGISTRY[kind].toFloatable = build;
}

/**
 * Install a kind's in-document `dropSpec` (called from `cards/drop-specs`, the
 * same registration indirection as `registerCardFloatable`). Keeps this module
 * a runtime LEAF — the spec objects (which transitively reach the drop-mode
 * machinery + panel hooks) are imported only by the registration module, never
 * here, so `predicates.ts` and the low-level modules that consume it never
 * cycle. `lookupSpec` (`drop-mode/registry.ts`) then reads
 * `CARD_REGISTRY[kind].dropSpec`. The two revision kinds register the SAME
 * shared `revisionDropSpec`.
 */
export function registerCardDropSpec(kind: CardKind, spec: DropSpec): void {
  CARD_REGISTRY[kind].dropSpec = spec;
}

/**
 * Morph-converter registration (A9) — the same runtime-leaf indirection as
 * `registerCardFloatable`/`registerCardDropSpec`. A morph transform is a PURE
 * per-card data salvage: `(card) => convertedCard` flips the on-disk data kind
 * and carries across the fields the target shape can hold. The per-doc hook
 * (`useRevisions.convertCard`, `useCutter.convertCard`, …) delegates to the
 * registered transform so the docked dropdown, the popped FloatChrome title
 * control, and the omni surface all morph through one body.
 *
 * Kept OUT of this card-UI-free module so `predicates.ts` (and the low-level
 * modules that consume it) never pull a transform's imports in / never cycle —
 * the transforms are registered at boot by `src/cards/morphs/index.ts`. Each
 * entry below holds a `null` placeholder; a dev assertion
 * (`assertMorphCoverage`) verifies every `morph !== null` kind got a real one.
 *
 * The transform is intentionally untyped here (`CardMorphConverter` takes/returns
 * `unknown`) because each pair's card shape lives in `@/lib/types`, which this
 * leaf must not import. The registering module owns the concrete narrowing.
 */
export type CardMorphConverter = (card: unknown) => unknown;

const morphConverters: Partial<Record<CardKind, CardMorphConverter>> = {};

/** Install a kind's morph data transform (called from `cards/morphs`). A kind
 *  with `morph === null` silently ignores a stray registration. */
export function registerCardMorph(
  kind: CardKind,
  convert: CardMorphConverter,
): void {
  if (CARD_REGISTRY[kind].morph == null) return;
  morphConverters[kind] = convert;
}

/** The registered morph transform for `kind`, or `null` if none. */
export function getCardMorphConverter(kind: CardKind): CardMorphConverter | null {
  return morphConverters[kind] ?? null;
}

/** Dev-only: verify the morph declarations are internally consistent and fully
 *  wired. For every `morph !== null` kind: (1) a converter was registered via
 *  `registerCardMorph`, and (2) `morph.to` shares the kind's panel (so the
 *  chevron's `cardKindsForPanel(panel)` options always include the target).
 *  Also checks the pairing is symmetric — the target's `morph.to` points back.
 *  Mirrors `assertLifecycleCoverage`; call from the morphs boot module after
 *  every `registerCardMorph`. */
export function assertMorphCoverage(): void {
  if (process.env.NODE_ENV === "production") return;
  for (const k of Object.keys(CARD_REGISTRY) as CardKind[]) {
    const m = CARD_REGISTRY[k].morph;
    if (m == null) continue;
    if (!morphConverters[k]) {
      console.error(
        `[CardMorph] "${k}" declares morph→"${m.to}" but no converter was ` +
          `registered (registerCardMorph). The kind-chevron will no-op.`,
      );
    }
    if (CARD_REGISTRY[m.to].panel !== CARD_REGISTRY[k].panel) {
      console.error(
        `[CardMorph] "${k}".morph.to = "${m.to}" but they live in different ` +
          `panels (${CARD_REGISTRY[k].panel} ≠ ${CARD_REGISTRY[m.to].panel}); ` +
          `the chevron derives options from cardKindsForPanel(panel).`,
      );
    }
    const back = CARD_REGISTRY[m.to].morph;
    if (!back || back.to !== k) {
      console.error(
        `[CardMorph] "${k}".morph.to = "${m.to}" is not reciprocated ` +
          `("${m.to}".morph.to = ${back ? `"${back.to}"` : "null"}).`,
      );
    }
  }
}

/**
 * Dev-only: pin the declared drop facets (`droppable` / `dropPlacement`) to the
 * REAL drop mechanism (`dropSpec.allowedPlacements`), so the static policy can't
 * silently drift from what a drag session actually does. MUST be called AFTER
 * the `@/cards/drop-specs` side-effect import has folded the specs onto the
 * registry (i.e. from `src/cards/drop-specs/index.ts`, the boot module) — at
 * predicates.ts load time the specs are still `null` (the cycle-avoidance the
 * static facet exists for), so this can't live in predicates.ts's load block.
 *
 * The invariant is PLACEMENT-KEYED, not `droppable ⇔ dropSpec != null`: `example`
 * carries a `dropSpec` (`blockMoveSpec`, `["between-blocks"]`) yet is
 * `droppable:false`, because a `between-blocks` content-MOVE is not a card
 * re-anchor (SYNTHESIS §7). So:
 *   - `dropPlacement === "in-text"` ⇔ the spec exists AND allows `inline-cursor`
 *   - `dropPlacement === "margin"`  ⇔ the spec exists AND allows `paragraph-side`
 *   - `dropPlacement === null` (≡ `!droppable`) ⇔ the spec allows NEITHER
 *     (`between-blocks`-only like example, OR no spec at all like bib/ai/error)
 * and `droppable ⇔ dropPlacement !== null` throughout. Mirrors
 * `assertMorphCoverage`; the contract test (`drop-facet-contract.test.ts`)
 * imports `@/cards/drop-specs` and asserts the same matrix with teeth.
 */
export function assertDropFacetCoverage(): void {
  if (process.env.NODE_ENV === "production") return;
  for (const k of Object.keys(CARD_REGISTRY) as CardKind[]) {
    const meta = CARD_REGISTRY[k];
    const allows = (p: PlacementKind): boolean =>
      meta.dropSpec?.allowedPlacements.includes(p) ?? false;
    const expected: CardMeta["dropPlacement"] = allows("inline-cursor")
      ? "in-text"
      : allows("paragraph-side")
        ? "margin"
        : null;
    if (meta.dropPlacement !== expected) {
      console.error(
        `[DropFacet] "${k}" declares dropPlacement="${meta.dropPlacement}" but ` +
          `its dropSpec.allowedPlacements (${
            meta.dropSpec
              ? JSON.stringify(meta.dropSpec.allowedPlacements)
              : "no spec"
          }) imply "${expected}". The declared facet drifted from the mechanism.`,
      );
    }
    if (meta.droppable !== (meta.dropPlacement !== null)) {
      console.error(
        `[DropFacet] "${k}" has droppable=${meta.droppable} but ` +
          `dropPlacement=${JSON.stringify(meta.dropPlacement)} — droppable must ` +
          `equal (dropPlacement !== null).`,
      );
    }
  }
}

/** Dev-only: verify the `bodyClass` declarations are panel-consistent — every
 *  card kind that shares a panel agrees on its class. `DEFAULT_PANEL_TYPOGRAPHY`
 *  derives each panel's row from a single primary kind's `bodyClass`, so a
 *  morph sibling declaring a *different* class would silently render with the
 *  wrong typography after a morph. This makes that loud. Call once at boot
 *  (alongside `assertMorphCoverage`). */
export function assertPanelTypographyCoverage(): void {
  if (process.env.NODE_ENV === "production") return;
  const byPanel = new Map<string, { kind: CardKind; cls: string }[]>();
  for (const k of Object.keys(CARD_REGISTRY) as CardKind[]) {
    const panel = CARD_REGISTRY[k].panel;
    if (panel == null) continue; // ai is cross-panel — exempt
    const row = byPanel.get(panel) ?? [];
    row.push({ kind: k, cls: CARD_REGISTRY[k].bodyClass });
    byPanel.set(panel, row);
  }
  for (const [panel, members] of byPanel) {
    const classes = new Set(members.map((m) => m.cls));
    if (classes.size > 1) {
      console.error(
        `[CardBodyClass] panel "${panel}" has mixed bodyClass across its ` +
          `kinds (${members.map((m) => `${m.kind}=${m.cls}`).join(", ")}); ` +
          `DEFAULT_PANEL_TYPOGRAPHY derives one row per panel, so morph ` +
          `siblings must agree.`,
      );
    }
  }
}

export const CARD_REGISTRY: Record<CardKind, CardMeta> = {
  note: {
    label: "Note",
    titleLabel: "Note",
    keyPrefix: "note",
    themeKey: "note",
    collabClaims: true,
    aiRequest: { kind: "note", linkPanel: "notes" }, // R29 — frozen wire contract
    panel: "notes",
    origin: "user",
    anchored: true,
    markerType: "note",
    lifecycle: { clone: true, delete: true, bindAnchor: true },
    dropSpec: null,
    droppable: true,
    dropPlacement: "margin",
    // note → highlight discards the rich note body + title (the highlight has
    // none) → lossy. The reverse direction is also lossy (a highlight has no
    // body to seed the note with); a confirm guards the body-dropping case.
    morph: { to: "highlight", lossy: true },
    bodyClass: "sans",
    stackable: true,
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  highlight: {
    label: "Highlight",
    titleLabel: null,
    keyPrefix: "highlight",
    themeKey: "highlight",
    collabClaims: false,
    aiRequest: { kind: "highlight", linkPanel: "notes" }, // R29 — frozen wire contract
    panel: "notes",
    origin: "user",
    anchored: true,
    markerType: null, // tint, no gutter icon
    lifecycle: { clone: true, delete: true, bindAnchor: true },
    dropSpec: null,
    droppable: true,
    dropPlacement: "margin",
    morph: { to: "note", lossy: true },
    bodyClass: "sans",
    stackable: true,
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  footnote: {
    label: "Footnote",
    titleLabel: "Footnote",
    keyPrefix: "footnote",
    themeKey: "footnote",
    collabClaims: true,
    panel: "footnotes",
    origin: "user",
    anchored: true,
    markerType: null, // in-text atom
    lifecycle: { clone: true, delete: true, bindAnchor: false },
    dropSpec: null,
    droppable: true,
    dropPlacement: "in-text",
    morph: null,
    bodyClass: "borrowed", // serif, 15px — quotes document prose
    stackable: true,
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  archive: {
    label: "Archive",
    titleLabel: "Archive Text",
    keyPrefix: "archive",
    themeKey: "archive",
    collabClaims: true,
    panel: "archive",
    origin: "user",
    anchored: true,
    markerType: "archive",
    // R18 ratified: NO cascade — archive survives anchor-paragraph deletion.
    lifecycle: { clone: false, delete: false, bindAnchor: false },
    dropSpec: null,
    droppable: true,
    dropPlacement: "margin",
    morph: null,
    bodyClass: "borrowed", // serif, 15px — quotes document prose
    stackable: true,
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  todo: {
    label: "Task",
    titleLabel: "Task",
    keyPrefix: "todo",
    themeKey: "todo",
    collabClaims: false,
    aiRequest: { kind: "todo", linkPanel: "todos" }, // R29 — frozen wire contract
    panel: "todo",
    origin: "user",
    anchored: true,
    markerType: "todo",
    // permanent: Mode-A paragraph-anchored, no text-range anchor for the cascade to reach.
    lifecycle: { clone: false, delete: false, bindAnchor: false },
    dropSpec: null,
    droppable: true,
    dropPlacement: "margin",
    morph: null,
    bodyClass: "sans",
    stackable: true,
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  bib: {
    label: "Bibliography",
    titleLabel: null,
    keyPrefix: "bib",
    themeKey: "bib",
    collabClaims: false,
    panel: "bibliography",
    origin: "system",
    anchored: false,
    markerType: null,
    lifecycle: { clone: false, delete: false, bindAnchor: false },
    dropSpec: null, // intentional: bib entries don't anchor to text
    droppable: false,
    dropPlacement: null,
    morph: null,
    bodyClass: "sans",
    stackable: true, // StackCardKind: "bibliography"
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  citation: {
    label: "Citation",
    titleLabel: null,
    keyPrefix: "citation",
    themeKey: "citation",
    collabClaims: false,
    panel: "citations",
    origin: "user",
    anchored: true,
    markerType: null, // in-text atom
    lifecycle: { clone: true, delete: true, bindAnchor: false },
    dropSpec: null,
    droppable: true,
    dropPlacement: "in-text",
    morph: null,
    bodyClass: "sans",
    stackable: true,
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  "revision-comment": {
    label: "Comment",
    titleLabel: null,
    // Shared `revision` popout prefix for BOTH revision kinds (revision-suggestion
    // pops under `revision:s:<id>`). Kept byte-for-byte; AF's float: grammar
    // normalizes the kind-in-key split. The float dispatch disambiguates from
    // the record's data kind (`cardKindForPopoutKey`).
    keyPrefix: "revision",
    themeKey: "revision",
    collabClaims: true,
    aiRequest: { kind: "suggestion", linkPanel: "revisions" }, // R29 — frozen wire contract
    panel: "revisions",
    origin: "user",
    anchored: true,
    markerType: "revision",
    lifecycle: { clone: true, delete: true, bindAnchor: true },
    dropSpec: null,
    droppable: true,
    dropPlacement: "margin",
    // comment ⇄ suggestion is a non-destructive salvage both ways (the body
    // text rides into `user_text` on the way out, back into the body on the
    // way in), so neither direction is lossy.
    morph: { to: "revision-suggestion", lossy: false },
    bodyClass: "sans",
    stackable: true,
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  "cutter-comment": {
    label: "Comment",
    titleLabel: null,
    keyPrefix: "cutter-comment",
    themeKey: "cut",
    collabClaims: true,
    aiRequest: { kind: "suggestion", linkPanel: "cutter" }, // R29 — frozen wire contract
    panel: "cutter",
    origin: "user",
    anchored: true,
    markerType: "cut",
    lifecycle: { clone: true, delete: true, bindAnchor: true },
    dropSpec: null,
    droppable: true,
    dropPlacement: "margin",
    // Same non-destructive comment ⇄ suggestion salvage as the revision pair.
    morph: { to: "cutter-suggestion", lossy: false },
    bodyClass: "sans",
    stackable: true,
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  "cutter-suggestion": {
    label: "Suggestion",
    titleLabel: null,
    keyPrefix: "cutter-suggestion",
    themeKey: "cut",
    collabClaims: false,
    panel: "cutter",
    origin: "user",
    anchored: true,
    markerType: "cut",
    lifecycle: { clone: true, delete: true, bindAnchor: true },
    dropSpec: null,
    droppable: true,
    dropPlacement: "margin",
    morph: { to: "cutter-comment", lossy: false },
    bodyClass: "sans",
    stackable: true,
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  "revision-suggestion": {
    label: "Revision",
    titleLabel: null,
    keyPrefix: "revision-suggestion", // legacy keyPrefix preserved; the LIVE card key is float:card:revision-suggestion:<id> via cardPopKey (panel-registry)
    themeKey: "revision",
    collabClaims: false,
    panel: "revisions",
    origin: "user",
    anchored: true,
    markerType: "revision",
    lifecycle: { clone: true, delete: true, bindAnchor: true }, // provider re-keyed suggestion→here at the flip
    dropSpec: null,
    droppable: true,
    dropPlacement: "margin",
    morph: { to: "revision-comment", lossy: false },
    bodyClass: "sans",
    stackable: true,
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  report: {
    label: "Report",
    titleLabel: "Report",
    keyPrefix: "report",
    themeKey: "report",
    collabClaims: true,
    panel: "reports",
    origin: "user",
    anchored: true,
    markerType: "report",
    // permanent: Mode-A paragraph-anchored, no cascade reaches it.
    lifecycle: { clone: false, delete: false, bindAnchor: false },
    dropSpec: null,
    droppable: true,
    dropPlacement: "margin",
    // report ⇄ report-request drops a field each way (a report's title + author
    // byline have no home on a request; a request's aiRequest flag has none on
    // a report) → lossy both directions; the body rich-text carries across.
    morph: { to: "report-request", lossy: true },
    bodyClass: "sans", // R11: Report is apparatus → 12px Inter (fixes the variant=footnote serif declared-vs-rendered mismatch)
    stackable: false, // not in StackCardKind
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  "report-request": {
    label: "Report Request",
    titleLabel: null,
    keyPrefix: "report-request",
    themeKey: "report",
    collabClaims: true,
    aiRequest: { kind: "report", linkPanel: "reports" }, // R29 — frozen wire contract
    panel: "reports",
    origin: "user",
    anchored: true,
    markerType: "report",
    // permanent: Mode-A paragraph-anchored, no cascade reaches it.
    lifecycle: { clone: false, delete: false, bindAnchor: false },
    dropSpec: null,
    droppable: true,
    dropPlacement: "margin",
    morph: { to: "report", lossy: true },
    bodyClass: "sans",
    stackable: false,
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  example: {
    label: "Example",
    titleLabel: "Example",
    keyPrefix: "example",
    themeKey: "example",
    collabClaims: false,
    panel: "examples",
    origin: "derived", // mirrors the doc exampleBlock harvested by useExamples
    anchored: true,
    markerType: null,
    // PERMANENT (R19): the lifecycle is the exampleBlock TextObject's
    // (origin:derived); a card-level clone/delete would double-act = two-kinds
    // violation.
    lifecycle: { clone: false, delete: false, bindAnchor: false },
    dropSpec: null,
    // NO drop button: example carries a `dropSpec` (exampleDropSpec) but it is a
    // `between-blocks` block content-MOVE, not a card re-anchor — the drop button
    // is for (re)anchoring, so example is excluded (drop-button SYNTHESIS §7
    // design call). The contract test pins this: a `between-blocks`-only spec ⇔
    // droppable:false / dropPlacement:null.
    droppable: false,
    dropPlacement: null,
    morph: null,
    bodyClass: "borrowed", // serif, 15px — quotes document prose (fixes example 12→15)
    stackable: true, // declared in StackCardKind (its float's snapshotForStack returns null today — R2)
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  ai: {
    label: "AI Request",
    titleLabel: null,
    keyPrefix: "ai",
    themeKey: "aiRequest",
    collabClaims: false,
    panel: null, // cross-panel: renders in Footnotes/Notes/Reports/Citations/Todo
    origin: "system",
    anchored: false,
    markerType: null,
    lifecycle: { clone: false, delete: false, bindAnchor: false },
    dropSpec: null,
    droppable: false,
    dropPlacement: null,
    morph: null,
    bodyClass: "sans",
    stackable: false,
    poppable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  error: {
    label: "Error",
    titleLabel: null,
    keyPrefix: "error",
    themeKey: "error",
    collabClaims: false,
    panel: "errors",
    origin: "system",
    anchored: false,
    markerType: "error",
    lifecycle: { clone: false, delete: false, bindAnchor: false },
    dropSpec: null,
    droppable: false,
    dropPlacement: null,
    morph: null,
    bodyClass: "sans",
    stackable: false,
    poppable: false, // RATIFIED not poppable (§3.5) — the sole non-poppable kind
    toFloatable: PLACEHOLDER_TO_FLOATABLE, // never registered → stays null
  },
};
