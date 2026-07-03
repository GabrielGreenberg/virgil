/**
 * Style definitions and seeds for the Virgil-bar Style dropdown.
 *
 * Runtime style state lives in `style-library.ts` (localStorage). On
 * first load the library is seeded from `SEED_STYLES` below; after
 * that the user owns the list — seed entries are editable, renameable,
 * and deletable like any other entry.
 *
 * The Virgil entity-id marker shims and any missing baseline packages
 * are injected at serialize time by `ensurePreambleRequirements` in
 * latex-requirements.ts, so user preambles don't need to declare them.
 *
 * `EMERGENCY_PREAMBLE` is the last-resort fallback returned by
 * `resolveStyle` when nothing else works (e.g. user opens a doc whose
 * styleId no longer exists and the library is empty). Not surfaced.
 *
 * `CLASSIC_PREAMBLE` is also imported by latex-serializer.ts as the
 * default for serialize calls that don't pass an explicit preamble.
 */

import { buildPreamble } from "@/lib/latex-requirements";

// Baseline packages + all `\v*id` shims + article class — see
// VIRGIL_BASELINE_PACKAGES in latex-requirements.ts for the package set.
export const CLASSIC_PREAMBLE = buildPreamble("\\documentclass{article}");

// Placeholder until the user supplies the Greenberg preamble. Equal to
// CLASSIC_PREAMBLE for now so the seed entry round-trips through the
// library and renders in the dropdown.
const GREENBERG_PREAMBLE_TODO = CLASSIC_PREAMBLE;

/** Last-resort fallback used by `resolveStyle` when every library
 *  lookup fails. Equal to the Classic preamble — guaranteed valid. */
export const EMERGENCY_PREAMBLE = CLASSIC_PREAMBLE;

/**
 * A single style entry in the user's library. The shape stored on disk
 * (localStorage) and rendered in the dropdown / Manage Styles modal.
 */
export interface StyleEntry {
  /** Stable id. Seeds use friendly slugs (`classic`, `greenberg`); user
   *  styles use `style_<short-uuid>`. */
  id: string;
  /** Display label. Trimmed; non-empty after trim. */
  name: string;
  /** Verbatim LaTeX bytes ending with `\begin{document}\n\n`. */
  preamble: string;
  /** Informational only. UI may show a "seeded" pill but does NOT gate
   *  edit / rename / delete on this — seed entries are mutable. */
  origin: "seed" | "user";
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp; bumped on every edit. */
  updatedAt: string;
}

/** Sentinel id for the Classic seed — also the initial defaultStyleId. */
export const DEFAULT_STYLE_ID = "classic";

/**
 * Initial library contents. Written to localStorage on first load.
 * After seeding, the user owns these — they're indistinguishable from
 * any other library entry in behavior (editable, renameable, deletable).
 */
export const SEED_STYLES: StyleEntry[] = [
  {
    id: "classic",
    name: "Classic",
    preamble: CLASSIC_PREAMBLE,
    origin: "seed",
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    id: "greenberg",
    name: "Greenberg",
    preamble: GREENBERG_PREAMBLE_TODO,
    origin: "seed",
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
];

/** Back-compat type alias. Style ids are now plain strings — closed
 *  unions are no longer practical with user-defined ids. */
export type DocumentStyleId = string;
