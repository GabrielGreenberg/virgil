import { diagnosticLocationLabel, type LatexError } from "@/lib/latex-errors";
import { ruleTitle } from "@/lib/latex-rules";

/** Short, stable title for the card header. A rule id titles from the ONE
 *  rule vocabulary (`@/lib/latex-rules`, task 983) so the header scans at a
 *  glance; an id outside it — or no id — titles from the message's first
 *  line, never from a mechanically de-hyphenated id. */
export function errorTitle(err: LatexError): string {
  const curated = err.ruleId ? ruleTitle(err.ruleId) : null;
  if (curated) return curated;
  const firstLine = err.message.split("\n")[0];
  return firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine;
}

/** The source WORD the card prints beside the severity. */
export function errorSourceLabel(err: Pick<LatexError, "source">): string {
  return err.source === "lint" ? "lint" : "compile";
}

/**
 * EVERY piece of text an error card can show, derived once (task 1377).
 *
 * `ErrorCard` renders from this object and the Errors panel's filter searches
 * `errorSearchText` — which is built from the SAME object — so the words a
 * user can see on a card and the words the filter can find are one list. Before
 * this, the filter hand-picked `message`/`detail`/`remedy`/`ruleId` while the
 * card grew a curated title (983) and a file label (1208): typing the card's own
 * headline ("Unbalanced braces") found nothing. A new card field goes HERE, and
 * is searchable by construction.
 */
export interface ErrorDisplayText {
  title: string;
  /** `line 42:7`, or `chapter2.tex · line 12` cross-file (task 1208). */
  location: string | null;
  severity: string;
  source: string;
  ruleId: string | null;
  message: string;
  remedy: string | null;
  detail: string | null;
  snippet: string | null;
}

export function errorDisplayText(
  err: LatexError,
  snippet?: string | null,
): ErrorDisplayText {
  return {
    title: errorTitle(err),
    location: diagnosticLocationLabel(err),
    severity: err.severity,
    source: errorSourceLabel(err),
    ruleId: err.ruleId ?? null,
    message: err.message,
    remedy: err.remedy ?? null,
    detail: err.detail ?? null,
    snippet: snippet || null,
  };
}

/** The lowercased haystack the panel filter matches against — every field of
 *  `errorDisplayText`, nothing hand-picked. */
export function errorSearchText(
  err: LatexError,
  snippet?: string | null,
): string {
  return Object.values(errorDisplayText(err, snippet))
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join("\n")
    .toLowerCase();
}
