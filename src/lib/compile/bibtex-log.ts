/**
 * Bibtex-stage failure detection from the pdfTeX log (P2).
 *
 * The vendored worker runs `_compileBibtex()` internally but DISCARDS its
 * status — so a broken bibliography (missing `.bib`, no `\bibdata`, no
 * `\citation`, an entry that isn't in the database) compiles GREEN today, with
 * `[?]` citations in the PDF and no warning. The bibtex tool's stdout does,
 * however, land in `self.memlog` (the returned log), so we can recover the
 * outcome by scanning for its failure signatures.
 *
 * Treated as a WARNING, never a hard block: the PDF is real (just with
 * unresolved citations), so the caller surfaces `bibtexStatus: 'failed'` as a
 * `degraded` result rather than discarding the PDF.
 */

import type { BibtexStatus } from "@/lib/compile/compile-types";

/**
 * Signatures emitted by bibtex/biber to stderr/stdout on a stage failure.
 * These are stable, tool-emitted strings (not user prose), so matching them is
 * low-false-positive. Kept as substrings (case-sensitive, as the tools emit
 * them) rather than a broad regex.
 */
const BIBTEX_FAILURE_SIGNATURES: readonly string[] = [
  // bibtex: named .bib not found
  "I couldn't open database file",
  // bibtex: named .bst not found
  "I couldn't open style file",
  // bibtex: the .aux has no \bibdata (usually a missing \bibliography{})
  "I found no \\bibdata command",
  // bibtex: the .aux has no \citation commands
  "I found no \\citation commands",
  // bibtex: the .aux has no \bibstyle
  "I found no \\bibstyle command",
  // bibtex: a cited key is absent from every database
  "Warning--I didn't find a database entry",
  // biber (biblatex backend=biber): data source not found
  "Cannot find 'biber'",
  "Could not open file",
];

/**
 * Signatures proving the bibtex stage RAN and (barring a failure signature)
 * succeeded — so we can distinguish `absent` (no bib in the doc) from `ok`
 * (bib ran clean). Bibtex prints its banner on every run.
 */
const BIBTEX_RAN_SIGNATURES: readonly string[] = [
  "This is BibTeX",
  "The style file:",
  "Database file #",
];

/**
 * Classify the bibtex stage from a pdfTeX-run log:
 *  - `failed`  — any known bibtex/biber failure signature is present;
 *  - `ok`      — the bibtex stage clearly ran and no failure signature fired;
 *  - `absent`  — no evidence bibtex ran at all (a doc with no bibliography).
 */
export function detectBibtexFailure(log: string): BibtexStatus {
  if (!log) return "absent";
  for (const sig of BIBTEX_FAILURE_SIGNATURES) {
    if (log.includes(sig)) return "failed";
  }
  for (const sig of BIBTEX_RAN_SIGNATURES) {
    if (log.includes(sig)) return "ok";
  }
  return "absent";
}
