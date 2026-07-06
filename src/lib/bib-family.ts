/**
 * Single source of truth for the bibliography-package FAMILY model.
 *
 * natbib and biblatex are mutually exclusive TeX packages with overlapping
 * but non-identical cite-command vocabularies. Historically three layers each
 * re-derived "which family does this command / preamble belong to?"
 * independently (latex-requirements.ts `familyRe` + the three RE constants,
 * storage-fsa.ts `detectBibPackage`, and the serializer's after-the-fact
 * regex). That is exactly the emit↔require drift class P4 dissolves. This
 * module consolidates the family logic so every layer answers the same
 * question the same way.
 *
 * The bucket vocabulary is owned by cite-commands.ts (the SSOT for the
 * command names themselves); this module classifies against those buckets and
 * exposes the family-reconciliation policy.
 *
 * USER DECISION (locked): a body↔preamble family conflict is WARNED, never
 * silently rewritten. `reconcileBibFamily` injects the family the body
 * actually needs and surfaces a `BibFamilyConflict` when the preamble hard-
 * loads the OTHER family — it never drops a family the body depends on (the
 * former silent-delete produced a `.tex` with undefined `\autocite`, a fatal
 * compile).
 */

import {
  BIBLATEX_ONLY_CITE_COMMANDS,
  KERNEL_NEUTRAL_CITE_COMMANDS,
  NATBIB_ONLY_CITE_COMMANDS,
  SHARED_CITE_COMMANDS,
} from "@/lib/cite-commands";

export type BibFamily = "natbib" | "biblatex";

/** Narrow an arbitrary stored value (the citations sidecar types `bibPackage`
 *  as a free-form string) to a `BibFamily`, or `null` when it is neither. Used
 *  by the headless save paths to read the authoritative per-doc family off the
 *  citations sidecar without importing the React hook. */
export function asBibFamily(value: unknown): BibFamily | null {
  return value === "natbib" || value === "biblatex" ? value : null;
}

/**
 * Classify a single cite command name or full command string into the family
 * it PINS, or `null` when it pins neither (a shared or kernel-neutral cite).
 *
 * Accepts either a bare name (`"citep"`, `"Autocite"`) or a full command
 * string (`"\\citep{k}"`, `"\\Autocite[see][]{k}"`) — the leading backslash,
 * a capitalized sentence-start form, an optional trailing `*`, and any
 * arguments are all tolerated.
 *
 * Buckets (from cite-commands.ts):
 *  - NATBIB_ONLY  → "natbib"
 *  - BIBLATEX_ONLY→ "biblatex"
 *  - SHARED / KERNEL_NEUTRAL → null (pins neither on its own)
 */
export function classifyCiteFamily(command: string): BibFamily | null {
  const name = normalizeCiteName(command);
  if (!name) return null;
  if (NATBIB_ONLY_CITE_COMMANDS.has(name)) return "natbib";
  if (BIBLATEX_ONLY_CITE_COMMANDS.has(name)) return "biblatex";
  // SHARED (incl. KERNEL_NEUTRAL) pin neither family on their own.
  return null;
}

/** True if the (bare) command name is a shared, non-kernel cite
 *  (`\citeauthor` / `\citeyear`) — defined by BOTH families, so it needs SOME
 *  bib package but does not choose between them. Bare `\cite`/`\nocite` are
 *  kernel-neutral and return false. */
export function isSharedNonKernelCite(command: string): boolean {
  const name = normalizeCiteName(command);
  if (!name) return false;
  return SHARED_CITE_COMMANDS.has(name) && !KERNEL_NEUTRAL_CITE_COMMANDS.has(name);
}

/** Strip `\`, arguments, a trailing `*`, and lowercase a leading capital so a
 *  full command string reduces to its canonical lowercase base name. Returns
 *  `null` when the input has no leading command token. */
function normalizeCiteName(command: string): string | null {
  const m = command.match(/\\?([A-Za-z]+)/);
  if (!m) return null;
  let name = m[1];
  // Sentence-start capitalized forms (`\Citep`, `\Autocite`) map to the
  // lowercase base only when the lowercased form is a known command — a real
  // command that happens to start with a capital letter would not exist in the
  // buckets, so lowercasing is safe.
  const lower = name[0].toLowerCase() + name.slice(1);
  name = lower;
  return name;
}

// ---------------------------------------------------------------------------
// Preamble family detection
// ---------------------------------------------------------------------------

/** Matches a preamble that loads a given package family via `\usepackage`,
 *  `\RequirePackage`, comma-lists, options, and wrapper packages (`-` is a
 *  word boundary, so `biblatex-chicago` satisfies `biblatex`). Kept in sync
 *  with `packageReq().satisfiedRe` in latex-requirements.ts — this is the one
 *  place that answers "does the preamble hard-load family X?". */
function familyLoadRe(name: BibFamily): RegExp {
  return new RegExp(
    `\\\\(?:usepackage|RequirePackage)(?:\\[[^\\]]*\\])?\\{[^}]*\\b${name}\\b[^}]*\\}`,
  );
}

const NATBIB_LOAD_RE = familyLoadRe("natbib");
const BIBLATEX_LOAD_RE = familyLoadRe("biblatex");

/** Alternation over a command bucket + capitalized sentence-start variants,
 *  longest-first, boundary-guarded (same convention as cite-commands.ts). */
function bucketRe(names: Iterable<string>): RegExp {
  const all: string[] = [];
  for (const n of names) {
    all.push(n);
    all.push(n[0].toUpperCase() + n.slice(1));
  }
  all.sort((a, b) => b.length - a.length);
  return new RegExp(`\\\\(?:${all.join("|")})(?![a-zA-Z])`);
}

const NATBIB_ONLY_CMD_RE = bucketRe(NATBIB_ONLY_CITE_COMMANDS);
const BIBLATEX_ONLY_CMD_RE = bucketRe(BIBLATEX_ONLY_CITE_COMMANDS);

/**
 * Which family does the CITE-COMMAND USAGE in a source string pin, if any?
 * natbib-only usage wins (baseline precedence, matching the requirements
 * detector); else biblatex-only usage; else null (only shared/kernel cites).
 * Used as the command-usage fallback for `detectBibPackage`.
 */
export function detectCommandBibFamily(source: string): BibFamily | null {
  if (NATBIB_ONLY_CMD_RE.test(source)) return "natbib";
  if (BIBLATEX_ONLY_CMD_RE.test(source)) return "biblatex";
  return null;
}

/**
 * Which bib family (if any) does this preamble ALREADY hard-load? Returns the
 * loaded family or `null` if neither. If (pathologically) both are present,
 * biblatex wins the report — the caller only uses this to detect a conflict,
 * and a doc loading both is already broken.
 *
 * Callers should pass the INERT-STRIPPED preamble (comments/verbatim removed)
 * so a commented `% \usepackage{biblatex}` does not read as loaded — mirroring
 * the requirements side.
 */
export function detectPreambleBibFamily(preamble: string): BibFamily | null {
  if (BIBLATEX_LOAD_RE.test(preamble)) return "biblatex";
  if (NATBIB_LOAD_RE.test(preamble)) return "natbib";
  return null;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface BibFamilyConflict {
  /** The family the body actually needs (declared by cite emit-sites, or the
   *  authoritative per-doc choice). */
  declared: BibFamily;
  /** The DIFFERENT family the preamble hard-loads. */
  preambleHas: BibFamily;
}

export interface BibFamilyReconcileResult {
  /** The family to ENSURE in the preamble (inject if missing). `null` when the
   *  body needs no specific family. Never the wrong family: when the preamble
   *  already loads a family, we keep it (never delete) and only warn. */
  effectiveFamily: BibFamily | null;
  /** Present when the declared family and the preamble's loaded family differ
   *  — the save-time warning surface renders this; the family is NOT rewritten
   *  (user decision: warn, never rewrite). */
  conflict?: BibFamilyConflict;
}

/**
 * Reconcile the family the body NEEDS against the family the preamble already
 * loads.
 *
 *  - No declared need → nothing to ensure, no conflict.
 *  - Preamble loads no family → ensure the declared family (inject it).
 *  - Preamble already loads the SAME family → satisfied, nothing to inject.
 *  - Preamble loads the OTHER family → KEEP the user's cite commands and the
 *    user's preamble family verbatim, ensure NOTHING (injecting the needed
 *    family alongside the incompatible one would break the compile just as
 *    badly), and surface a `BibFamilyConflict`. This is the "warn, never
 *    rewrite" decision: we never silently drop the needed family (the old
 *    fatal bug) and never silently rewrite the user's commands.
 *
 * `declared` should already fold in the authoritative per-doc `bibPackage`
 * where available (the caller prefers the authoritative family over a
 * body-derived guess); this function is pure over its inputs.
 *
 * `preamble` may be raw; pass the inert-stripped form when comment-safety
 * matters (the requirements caller does).
 */
export function reconcileBibFamily(
  declared: BibFamily | null,
  preamble: string,
): BibFamilyReconcileResult {
  if (!declared) return { effectiveFamily: null };
  const loaded = detectPreambleBibFamily(preamble);
  if (loaded === null) {
    // Nothing loaded yet — ensure the declared family.
    return { effectiveFamily: declared };
  }
  if (loaded === declared) {
    // Already correct — satisfied (the injector will no-op via satisfiedRe).
    return { effectiveFamily: declared };
  }
  // Preamble hard-loads the OTHER family. Do NOT inject (co-loading is fatal)
  // and do NOT rewrite the user's commands — surface a conflict so the save
  // path can warn. effectiveFamily stays null so nothing is injected.
  return {
    effectiveFamily: null,
    conflict: { declared, preambleHas: loaded },
  };
}
