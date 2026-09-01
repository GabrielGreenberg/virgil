/**
 * DECLARED vendor families for the offline TeX bundle (task 520).
 *
 * A family is the INTENT — seeds, plus the two things a regex over TeX source
 * cannot infer: what the FORMAT already carries, and which loads are gated
 * behind a package option Virgil never passes. `vendor-tex-family.mjs` resolves
 * the intent against the mirror; the RESULT is the checked-in bundle
 * (`public/swiftlatex/texbundle/*` + the two generated tables). Adding the next
 * family is an entry here, not an afternoon of hand-copying.
 *
 * WHY A DECLARATION AND NOT A PURE CRAWL. TeX is Turing-complete and its loads
 * are conditional, so no source scan is exact. Both errors fail open — a file
 * we miss streams from the mirror exactly as today, an extra file is wasted
 * bytes — which is what makes resolving from a declaration safe. What the
 * declaration buys is that the imprecision is REVIEWED (it lands as a diff in
 * the generated manifest) rather than re-decided by a regex on every run.
 */

/** kpse's numeric format code for a TeX SOURCE file (.sty/.tex/.def/.cfg/...). */
export const FORMAT_TEX = 26;

export const FAMILIES = {
  "pgf-tikz": {
    description: "PGF/TikZ core: the closure an ordinary \\begin{tikzpicture} loads.",
    seeds: [
      // \RequirePackage{tikz} -> pgf, pgfkeys, pgfmath, pgfsys, pgfcore, ...
      "tikz.sty",
      // pgfsys.code.tex inputs \pgfsysdriver, which pgfutil-latex.def resolves
      // to the ENGINE's driver at runtime. A macro is not a filename, so the
      // scan cannot follow it: pdfTeX's driver is named here instead.
      "pgfsys-pdftex.def",
    ],
  },

  forest: {
    description:
      "forest + the tikz libraries it loads unconditionally (shapes, fit, calc, intersections).",
    seeds: ["forest.sty"],
  },
};

/**
 * Never fetch these, whatever the scan says. Each entry states WHY, because the
 * two reasons are different claims and only one of them is about size.
 */
export const EXCLUDE = {
  // ---- already in the FORMAT -------------------------------------------
  // The vendored swiftlatexpdftex.fmt preloads expl3 (measured: `ExplSyntaxOn`
  // and 49 `__kernel_msg` markers are in the .fmt bytes), which is also why the
  // original live capture fetched `l3backend-pdfmode.def` — the backend an
  // ALREADY-LOADED expl3 pulls at begin-document — and never expl3 itself. So
  // \RequirePackage{expl3} is answered by \@ifpackageloaded and never reaches
  // kpse. Vendoring these would add 1.09 MB nothing asks for.
  "expl3.sty": "preloaded in swiftlatexpdftex.fmt",
  "expl3-code.tex": "preloaded in swiftlatexpdftex.fmt",
  "etex.sty": "preloaded in swiftlatexpdftex.fmt",
  "etex.src": "preloaded in swiftlatexpdftex.fmt",
  ltluatex: "luatex-only; unreachable under pdfTeX",

  // ---- gated behind an option Virgil never passes ----------------------
  // forest.sty loads tikz's `external` library only inside \ifforest@external@
  // (the `external` package option). Virgil emits a bare \usepackage{forest}.
  "tikzlibraryexternal.code.tex": "forest `external` option only",
  "tikzexternalshared.code.tex": "forest `external` option only",
};
