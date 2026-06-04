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
  if (kind === "error") return; // ratified not-poppable; ignore stray registration
  CARD_REGISTRY[kind].toFloatable = build;
}

export const CARD_REGISTRY: Record<CardKind, CardMeta> = {
  note: {
    label: "Note",
    titleLabel: "Note",
    keyPrefix: "note",
    themeKey: "note",
    panel: "notes",
    origin: "user",
    anchored: true,
    markerType: "note",
    lifecycle: { clone: true, delete: true, bindAnchor: true },
    dropSpec: null,
    stackable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  highlight: {
    label: "Highlight",
    titleLabel: null,
    keyPrefix: "highlight",
    themeKey: "highlight",
    panel: "notes",
    origin: "user",
    anchored: true,
    markerType: null, // tint, no gutter icon
    lifecycle: { clone: true, delete: true, bindAnchor: true },
    dropSpec: null,
    stackable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  footnote: {
    label: "Footnote",
    titleLabel: "Footnote",
    keyPrefix: "footnote",
    themeKey: "footnote",
    panel: "footnotes",
    origin: "user",
    anchored: true,
    markerType: null, // in-text atom
    lifecycle: { clone: true, delete: true, bindAnchor: false },
    dropSpec: null,
    stackable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  archive: {
    label: "Archive",
    titleLabel: "Archive Text",
    keyPrefix: "archive",
    themeKey: "archive",
    panel: "archive",
    origin: "user",
    anchored: true,
    markerType: "archive",
    lifecycle: { clone: false, delete: false, bindAnchor: false }, // gap → A3
    dropSpec: null,
    stackable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  todo: {
    label: "Task",
    titleLabel: "Task",
    keyPrefix: "todo",
    themeKey: "todo",
    panel: "todo",
    origin: "user",
    anchored: true,
    markerType: "todo",
    lifecycle: { clone: false, delete: false, bindAnchor: false }, // gap → A3
    dropSpec: null,
    stackable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  bib: {
    label: "Bibliography",
    titleLabel: null,
    keyPrefix: "bib",
    themeKey: "bib",
    panel: "bibliography",
    origin: "system",
    anchored: false,
    markerType: null,
    lifecycle: { clone: false, delete: false, bindAnchor: false },
    dropSpec: null, // intentional: bib entries don't anchor to text
    stackable: true, // StackCardKind: "bibliography"
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  citation: {
    label: "Citation",
    titleLabel: null,
    keyPrefix: "citation",
    themeKey: "citation",
    panel: "citations",
    origin: "user",
    anchored: true,
    markerType: null, // in-text atom
    lifecycle: { clone: true, delete: true, bindAnchor: false },
    dropSpec: null,
    stackable: true,
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
    themeKey: "comment",
    panel: "revisions",
    origin: "user",
    anchored: true,
    markerType: "revision",
    lifecycle: { clone: true, delete: true, bindAnchor: true },
    dropSpec: null,
    stackable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  "cutter-comment": {
    label: "Comment",
    titleLabel: null,
    keyPrefix: "cutter-comment",
    themeKey: "cut",
    panel: "cutter",
    origin: "user",
    anchored: true,
    markerType: "cut",
    lifecycle: { clone: true, delete: true, bindAnchor: true },
    dropSpec: null,
    stackable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  "cutter-suggestion": {
    label: "Suggestion",
    titleLabel: null,
    keyPrefix: "cutter-suggestion",
    themeKey: "cut",
    panel: "cutter",
    origin: "user",
    anchored: true,
    markerType: "cut",
    lifecycle: { clone: true, delete: true, bindAnchor: true },
    dropSpec: null,
    stackable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  "revision-suggestion": {
    label: "Revision",
    titleLabel: null,
    keyPrefix: "revision-suggestion", // legacy value preserved (live key is revision:s:<id>)
    themeKey: "comment",
    panel: "revisions",
    origin: "user",
    anchored: true,
    markerType: "revision",
    lifecycle: { clone: true, delete: true, bindAnchor: true }, // provider re-keyed suggestion→here at the flip
    dropSpec: null,
    stackable: true,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  report: {
    label: "Report",
    titleLabel: "Report",
    keyPrefix: "report",
    themeKey: "report",
    panel: "reports",
    origin: "user",
    anchored: true,
    markerType: "report",
    lifecycle: { clone: false, delete: false, bindAnchor: false }, // gap → A3
    dropSpec: null,
    stackable: false, // not in StackCardKind
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  "report-request": {
    label: "Report Request",
    titleLabel: null,
    keyPrefix: "report-request",
    themeKey: "report",
    panel: "reports",
    origin: "user",
    anchored: true,
    markerType: "report",
    lifecycle: { clone: false, delete: false, bindAnchor: false }, // gap → A3
    dropSpec: null,
    stackable: false,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  example: {
    label: "Example",
    titleLabel: "Example",
    keyPrefix: "example",
    themeKey: "example",
    panel: "examples",
    origin: "derived", // mirrors the doc exampleBlock harvested by useExamples
    anchored: true,
    markerType: null,
    lifecycle: { clone: false, delete: false, bindAnchor: false }, // gap → A3
    dropSpec: null,
    stackable: true, // declared in StackCardKind (resolveCardData returns null today)
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  ai: {
    label: "AI Request",
    titleLabel: null,
    keyPrefix: "ai",
    themeKey: "aiRequest",
    panel: null, // cross-panel: renders in Footnotes/Notes/Reports/Citations/Todo
    origin: "system",
    anchored: false,
    markerType: null,
    lifecycle: { clone: false, delete: false, bindAnchor: false },
    dropSpec: null,
    stackable: false,
    toFloatable: PLACEHOLDER_TO_FLOATABLE,
  },
  error: {
    label: "Error",
    titleLabel: null,
    keyPrefix: "error",
    themeKey: "error",
    panel: "errors",
    origin: "system",
    anchored: false,
    markerType: "error",
    lifecycle: { clone: false, delete: false, bindAnchor: false },
    dropSpec: null,
    stackable: false,
    toFloatable: PLACEHOLDER_TO_FLOATABLE, // RATIFIED not poppable (§3.5): never registered → stays null
  },
};
