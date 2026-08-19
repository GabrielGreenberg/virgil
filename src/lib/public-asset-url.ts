/**
 * THE ONE DOOR from a `public/` asset path to a URL that resolves under the
 * deploy's basePath.
 *
 * Virgil ships as a static export that may be served from the origin root
 * (`localhost:3000`) OR from a subdirectory (`NEXT_PUBLIC_BASE_PATH=/virgil`,
 * which is what `deploy.yml` sets for production). Next prefixes the URLs it
 * generates itself — page routes, `next/font`, chunk `<script>`s — but it does
 * NOT touch a string you build by hand, and every asset under `public/` is
 * reached by a hand-built string: an iframe `src`, a `fetch`, a bare `<link>`,
 * a dynamically-appended `<script>`, a service-worker registration.
 *
 * That convention was HALF-ADOPTED (task 365). Six consumers each hand-rolled
 * their own copy of the same three lines; the seventh — the Library PDF tab's
 * vendored pdf.js viewer — did not, so in production it requested
 * `<origin>/pdfjs/web/viewer.html`, landed outside the app, and rendered the
 * host's 404 page inside the pane. An eighth (the `apple-touch-icon` link)
 * silently 404'd the iOS home-screen icon. Neither is a type error and neither
 * reproduces in dev, where `basePath` is `""` and every root-absolute string is
 * accidentally correct — which is exactly why they shipped.
 *
 * So the prefix is spelled ONCE, here, and every consumer reads it. This module
 * is an import-free leaf (the placement rule `latex-markers.ts` earned in task
 * 255: a facet the layer that needs it cannot import will be re-copied, every
 * time) so both silos — `src/` and `library/` — and the `app/` server
 * components can take it.
 *
 * CI: [public-asset-url-ssot.test.ts](__tests__/public-asset-url-ssot.test.ts).
 * The leg with teeth is the CENSUS: this function was never the part that could
 * misbehave — a call site that never asks it is, and that call site type-checks
 * perfectly.
 */

/**
 * Read ONCE, at module scope, in the BARE member-expression form — and the
 * spelling is load-bearing rather than stylistic, because it decides whether
 * the prefix survives the build at all.
 *
 * Measured against a real `NEXT_PUBLIC_BASE_PATH=/virgil` build (task 365), the
 * two candidate spellings compile very differently:
 *
 *   process.env.NEXT_PUBLIC_BASE_PATH ?? ""            →  "/virgil"
 *   (typeof process !== "undefined" && process.env…)   →  void 0 !== shim.default && "/virgil" || ""
 *
 * The bare form is replaced outright by Next's define and reaches the browser
 * as a plain literal. The `typeof`-guarded form — the shape three of the six
 * folded-in copies used — survives as a CONDITIONAL on Next's `process` shim,
 * and its false branch is `""`: i.e. exactly the bug this module exists to fix,
 * reachable silently in any runtime where the shim is absent. A guard whose
 * failure mode is the defect is worse than no guard, so this takes the literal.
 *
 * The cost is that importing this module in a context with no `process` at all
 * would throw. Nothing can: every importer is Next-compiled (where the read is
 * erased at build time) or runs under vitest/node (where `process` is real).
 * An optional-chained `process.env?.NEXT_PUBLIC_BASE_PATH` is a third shape and
 * the worst of the three — the define does not reliably match it, so it can
 * silently read `undefined` — and is deliberately not used, though two of the
 * folded-in copies spelled it that way.
 *
 * Trailing slashes are stripped: Next itself requires `basePath` to have none,
 * but a hand-set `/virgil/` would otherwise produce `/virgil//pdfjs/…` at every
 * one of the call sites this door exists to make uniform.
 */
const BASE_PATH: string = ((): string => {
  const raw = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return raw.replace(/\/+$/, "");
})();

/**
 * The deploy prefix on its own — `""` at the origin root, `"/virgil"` under a
 * subdirectory deploy. For the two consumers whose value is a SCOPE rather than
 * an asset (the service-worker registration scope, the manifest's
 * `id`/`start_url`/`scope`), reach for `publicAssetUrl("/")` instead: it
 * answers `"/"` and `"/virgil/"`, which is what both of those want. This
 * accessor exists for the case where the bare prefix really is the value.
 */
export function appBasePath(): string {
  return BASE_PATH;
}

/**
 * Build a same-origin URL for a file served out of `public/`.
 *
 * `path` is the asset's path WITHIN `public/`, with or without a leading slash
 * (`"/pdfjs/web/viewer.html"` and `"pdfjs/web/viewer.html"` are the same asset,
 * and normalizing an omitted slash is a repair rather than a guess — a
 * public-asset path is root-relative by definition). A query string rides along
 * untouched. `""` and `"/"` both answer the app ROOT, with its trailing slash —
 * the scope form.
 *
 * At the origin root this returns exactly the root-absolute string the six
 * pre-365 copies produced, so folding them onto this door is byte-neutral in
 * dev and in every non-basePath deploy.
 */
export function publicAssetUrl(path: string): string {
  const rel = path.replace(/^\/+/, "");
  return rel ? `${BASE_PATH}/${rel}` : `${BASE_PATH}/`;
}
