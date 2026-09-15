import type { CompileResult } from "./compile-types";

/**
 * THE ONE OUTCOME VOCABULARY (task 575).
 *
 * A compile's result reaches the user on two surfaces: the PDF pane (via the
 * progress record `finishCompile` writes) and the system dialog the compile
 * hook raises. Until 575 each surface worded the result itself — the service's
 * `outcomeMessage` and the hook's `failureMessage` + an inline `degraded`
 * ternary — and the two tables had already come apart about one compile:
 *
 *   - a mirror that answered 5xx/429 while the user was ONLINE was told, in the
 *     dialog, that its packages were "unavailable offline" (the hook summed
 *     download failures and offline misses into one count and worded the sum);
 *   - a compile that hung AFTER productive attempts was told, on both surfaces,
 *     that it was "still downloading — press Compile again to carry on", because
 *     both re-derived the stop reason from the total `assetsFetched`. Pressing
 *     Compile again re-hangs.
 *
 * So the words live here, and they read FACTS the service recorded — the stop
 * reason (`result.stop`, set by the continuation loop that knows it) and the
 * two package lists, kept separate — never a re-inference from a total.
 * Pure: no React, no DOM, no engine.
 */

export type CompileOutcomeTone = "default" | "danger";

export interface CompileOutcomeView {
  /** Short heading (the dialog's title). */
  title: string;
  /** The one-line account — rendered verbatim by the pane AND the dialog. */
  message: string;
  /** A PDF exists (`degraded`) → default; no PDF → danger. */
  tone: CompileOutcomeTone;
}

/** A package's display name: the kpse filename minus its TeX extension. */
export function compilePackageName(raw: string): string {
  return raw.replace(/\.(sty|def|cls|tex|tfm|cfg|ltx)$/i, "");
}

/** How many DISTINCT packages a list names (the Errors panel dedupes the same way). */
function distinctPackages(names: readonly string[] | undefined): number {
  if (!names || names.length === 0) return 0;
  return new Set(names.map(compilePackageName)).size;
}

/**
 * "A package could not be downloaded" / "3 packages were unavailable offline"
 * / both, joined. `null` when neither list names anything. Download failures
 * and offline misses are DIFFERENT facts (the network answered badly vs. the
 * package was never attempted), so each keeps its own words.
 */
function packageClause(result: CompileResult): string | null {
  const failed = distinctPackages(result.downloadFailures?.map((f) => f.name));
  const missed = distinctPackages(result.offlineMisses);
  const failedPart =
    failed === 0
      ? null
      : failed === 1
        ? "a package could not be downloaded"
        : `${failed} packages could not be downloaded`;
  const missedPart =
    missed === 0
      ? null
      : failedPart
        ? `${missed} ${missed === 1 ? "was" : "were"} unavailable offline`
        : missed === 1
          ? "a package was unavailable offline"
          : `${missed} packages were unavailable offline`;
  const clause = [failedPart, missedPart].filter(Boolean).join(" and ");
  return clause ? clause.charAt(0).toUpperCase() + clause.slice(1) : null;
}

/**
 * The user-facing account of a compile. `null` for a clean `ok` (there is
 * nothing to say). Every reader of a `CompileResult` that puts words in front
 * of the user reads THIS — the census in `compile-outcome.test.ts` holds it.
 */
export function describeCompileOutcome(result: CompileResult): CompileOutcomeView | null {
  const packages = packageClause(result);
  switch (result.status) {
    case "ok":
      return null;

    case "degraded": {
      const reason = packages
        ? `${packages} — some content may be missing.`
        : result.bibtexStatus === "failed"
          ? "The bibliography step failed — citations may show as [?]."
          : "A later compile pass failed — cross-references or the ToC may be stale.";
      return {
        title: "Compiled with warnings",
        message: `${reason} See the Errors panel for details.`,
        tone: "default",
      };
    }

    case "timeout": {
      const fetched = result.assetsFetched ?? 0;
      // Only the loop knows whether its LAST attempt made progress. A result
      // with no recorded stop reason fails toward NOT promising progress.
      if (result.stop === "productive-timeout" && fetched > 0) {
        return {
          title: "Still downloading LaTeX packages",
          message: `This paper needs packages that aren't cached yet — ${fetched} downloaded so far, and they're saved. Press Compile again to carry on from here.`,
          tone: "danger",
        };
      }
      return {
        title: "Compile timed out",
        message:
          fetched > 0
            ? `The compile stopped making progress and was stopped, and the engine has been reset. The ${fetched} ${fetched === 1 ? "package" : "packages"} it downloaded ${fetched === 1 ? "is" : "are"} cached.`
            : "The compile took too long and was stopped. The engine has been reset — try compiling again.",
        tone: "danger",
      };
    }

    case "boot-failed":
      return {
        title: "Compile engine failed to start",
        message:
          "The LaTeX engine could not start. Check your network connection and try again.",
        tone: "danger",
      };

    default:
      return {
        title: "Compile failed",
        message: packages
          ? `${packages}, and the compile failed. See the Errors panel for details.`
          : "The compile failed. See the Errors panel for details.",
        tone: "danger",
      };
  }
}
