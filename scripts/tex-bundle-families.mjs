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
  // ---- the FORMAT already carries the CODE ------------------------------
  // The vendored swiftlatexpdftex.fmt preloads expl3 — but by `\input
  // expl3-code.tex`, NOT through the package wrapper. Measured in the .fmt
  // bytes: `ver@expl3-code.tex` occurs, `ver@expl3.sty` does NOT, and sibling
  // `\ver@<pkg>.sty` markers (e.g. `ver@mweights.sty`) DO — so the pool
  // demonstrably records a package as loaded when it is one, and expl3 is not.
  //
  // The consequence is the whole reason this row is a comment and not a
  // one-liner: `\RequirePackage{expl3}` in xparse.sty:22 — reached
  // unconditionally from forest.sty:59 — is NOT short-circuited and DOES reach
  // kpse. So `expl3.sty` is VENDORED (4.4 KB) rather than excluded; excluding
  // it cost one serial blocking mirror fetch on the first compile of every
  // forest paper, which is precisely the cost this family exists to remove.
  //
  // Only its 1.05 MB payload is excluded, and it is excluded for a reason that
  // is in the loader's own source: expl3.sty gates `{\input{expl3-code.tex}}`
  // behind `\ifx\csname tex\string _let:D\endcsname\relax`, so with the code
  // already in the format `\@gobble` swallows the input and nothing is read.
  "expl3-code.tex": "already in the format; expl3.sty's own \@gobble skips the \input",

  // ---- guarded on a macro the kernel already defines ---------------------
  // NOT the same claim as above, and the distinction is load-bearing:
  // `ver@etex.sty` is as absent from the format as `ver@expl3.sty` is, so if
  // either \RequirePackage{etex} ever executed it WOULD reach kpse. What stops
  // it is that both call sites are gobbled on a 2015+ kernel (the format is
  // LaTeX 2019-04-04): elocalloc.sty:17 guards on `\ifx\e@alloc\@undefined`
  // and etoolbox.sty:29 on `\ifdefined\extrafloats`.
  //
  // The generalization worth stating, since one wrong sentence in this table
  // already produced one wrong exclusion: "the format has it" is not a reason
  // on its own — what matters is whether the LOAD SITE executes.
  "etex.sty": "both call sites are gobbled on a 2015+ kernel",
  "etex.src": "only reachable through etex.sty",

  // ---- gated behind an option Virgil never passes ----------------------
  // forest.sty loads tikz's `external` library only inside \ifforest@external@
  // (the `external` package option). Virgil emits a bare \usepackage{forest}.
  "tikzlibraryexternal.code.tex": "forest `external` option only",
  "tikzexternalshared.code.tex": "only reachable through tikzlibraryexternal",
};
