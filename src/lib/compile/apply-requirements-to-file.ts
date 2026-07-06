/**
 * Make an on-disk `.tex` SELF-SUFFICIENT for compilation (P2).
 *
 * The requirements-injection pillar (xlist → expex, graphicx, natbib/biblatex,
 * tikz, the `\v*id` shims) runs only at SAVE time, inside `serializeToLatex`.
 * So an UNEDITED on-disk doc — one the user opens and immediately Compiles
 * without a save cycle — can reach the engine with a preamble missing the
 * packages its body uses, and fail with "Environment xlist undefined" or an
 * undefined cite command.
 *
 * `applyRequirementsToFile` closes that gap by running the SAME injection the
 * serializer runs (`ensurePreambleRequirements(preamble, detectBodyRequirements
 * (body))`) over the `.tex` string the service feeds the engine — WITHOUT ever
 * writing it back to disk. So:
 *  - byte-stable round-trip is preserved (on-disk bytes untouched);
 *  - the requirements-injection ORDER is identical to save-time (same helper);
 *  - it is a no-op when the preamble already satisfies every requirement (the
 *    already-saved case), so a saved doc's in-memory copy is byte-identical.
 *
 * The split mirrors `latex-serializer.ts` / `ensurePreambleRequirements`: the
 * marker is `\begin{document}` and it stays on the PREAMBLE side (the injector
 * slices/inject right before it and needs it present). The BODY is everything
 * from `\begin{document}` onward — `detectBodyRequirements` only cares which
 * commands appear, so passing the marker + `\end{document}` along is harmless.
 */

import {
  detectBodyRequirements,
  ensurePreambleRequirements,
} from "@/lib/latex-requirements";

const BEGIN_MARKER = "\\begin{document}";

/**
 * Inject any missing package/shim requirements into `.tex` source so it can
 * compile stand-alone. Returns the source unchanged when there is no
 * `\begin{document}` (a fragment / bib-only file we shouldn't guess at) or when
 * the preamble already satisfies every requirement.
 */
export function applyRequirementsToFile(tex: string): string {
  const beginIdx = tex.indexOf(BEGIN_MARKER);
  // No document body to scan / no place to inject — leave it byte-exact.
  if (beginIdx === -1) return tex;

  // Preamble is everything UP TO AND INCLUDING the marker's start; keeping the
  // marker on the preamble side is what `ensurePreambleRequirements` expects
  // (it finds `\begin{document}` and injects right before it).
  const preamble = tex.slice(0, beginIdx + BEGIN_MARKER.length);
  const body = tex.slice(beginIdx + BEGIN_MARKER.length);

  const injected = ensurePreambleRequirements(
    preamble,
    detectBodyRequirements(body),
  );
  // No-op fast path: identical preamble → identical whole file.
  if (injected === preamble) return tex;
  return injected + body;
}
