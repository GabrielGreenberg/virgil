/**
 * Curated core TeX-asset manifest (P1 offline-assets).
 *
 * GENERATED FILE — do not edit by hand. Regenerate with either producer:
 *   node scripts/build-tex-bundle.mjs <captured-dump.json>   # the `core` family
 *   node scripts/vendor-tex-family.mjs <family>              # a declared family
 *
 * Both go through scripts/lib/tex-bundle-manifest.mjs, which merges BY FAMILY —
 * so each producer replaces only its own rows and the two tables it writes (this
 * file and public/swiftlatex/texbundle/manifest.json) can never disagree.
 *
 * The `cacheKey` of every entry is the worker's compiler-internal
 * `<numericFormatCode>/<reqname>` key. The bytes for each entry live
 * same-origin under BASE_PATH at the given `path` (the base .fmt at
 * /swiftlatex/swiftlatexpdftex.fmt; packages under
 * /swiftlatex/texbundle/<fileid>). `provisionEngine` fetches these and seeds
 * the worker's kpse cache before the first compile.
 *
 * BUILD-TIME NOTE: the .fmt bytes MUST be re-vendored in lockstep with any
 * SwiftLaTeX WASM bump; re-run the capture + this script after a WASM bump.
 */

/** One curated core asset: its compiler-internal cacheKey, its memfs fileid,
 *  and the same-origin public path (under BASE_PATH) its bytes are served at. */
export interface CoreManifestEntry {
  /** The worker's own `<numericFormatCode>/<reqname>` kpse cache key. */
  cacheKey: string;
  /** The memfs filename the worker writes the asset to (`TEXCACHEROOT/<fileid>`). */
  fileid: string;
  /** Same-origin path (relative to BASE_PATH) the bytes are fetched from. */
  path: string;
  /**
   * Which declared vendor family owns this row — `"core"` for the original
   * live capture, otherwise a family in scripts/tex-bundle-families.mjs.
   *
   * READ by the producers: re-running one replaces exactly its own rows, so a
   * family's closure can SHRINK without leaving orphan rows (and orphan bytes)
   * behind. Not read at runtime.
   */
  family: string;
}

/**
 * Sentinel cacheKey for the base `.fmt`. Retained for callers that reference
 * it; once the manifest is generated from a live capture the real
 * `<code>/swiftlatexpdftex.fmt` cacheKey is used in CORE_MANIFEST below.
 */
export const PLACEHOLDER_FMT_CACHEKEY = "__PLACEHOLDER_FMT_CACHEKEY__";

/** Public path (relative to BASE_PATH) of the vendored base format file. */
export const CORE_FMT_PATH = "/swiftlatex/swiftlatexpdftex.fmt";

/** The curated core manifest (generated — see the header). */
export const CORE_MANIFEST: readonly CoreManifestEntry[] = [
  { cacheKey: "10/swiftlatexpdftex.fmt", fileid: "swiftlatexpdftex.fmt", path: "/swiftlatex/swiftlatexpdftex.fmt", family: "core" },
  { cacheKey: "11/pdftex.map", fileid: "pdftex.map", path: "/swiftlatex/texbundle/pdftex.map", family: "core" },
  { cacheKey: "26/amsbsy.sty", fileid: "amsbsy.sty", path: "/swiftlatex/texbundle/amsbsy.sty", family: "core" },
  { cacheKey: "26/amsfonts.sty", fileid: "amsfonts.sty", path: "/swiftlatex/texbundle/amsfonts.sty", family: "core" },
  { cacheKey: "26/amsgen.sty", fileid: "amsgen.sty", path: "/swiftlatex/texbundle/amsgen.sty", family: "core" },
  { cacheKey: "26/amsmath.sty", fileid: "amsmath.sty", path: "/swiftlatex/texbundle/amsmath.sty", family: "core" },
  { cacheKey: "26/amsopn.sty", fileid: "amsopn.sty", path: "/swiftlatex/texbundle/amsopn.sty", family: "core" },
  { cacheKey: "26/amssymb.sty", fileid: "amssymb.sty", path: "/swiftlatex/texbundle/amssymb.sty", family: "core" },
  { cacheKey: "26/amstext.sty", fileid: "amstext.sty", path: "/swiftlatex/texbundle/amstext.sty", family: "core" },
  { cacheKey: "26/article.cls", fileid: "article.cls", path: "/swiftlatex/texbundle/article.cls", family: "core" },
  { cacheKey: "26/color.cfg", fileid: "color.cfg", path: "/swiftlatex/texbundle/color.cfg", family: "core" },
  { cacheKey: "26/everyshi.sty", fileid: "everyshi.sty", path: "/swiftlatex/texbundle/everyshi.sty", family: "core" },
  { cacheKey: "26/expex", fileid: "expex.tex", path: "/swiftlatex/texbundle/expex.tex", family: "core" },
  { cacheKey: "26/expex.sty", fileid: "expex.sty", path: "/swiftlatex/texbundle/expex.sty", family: "core" },
  { cacheKey: "26/graphics.cfg", fileid: "graphics.cfg", path: "/swiftlatex/texbundle/graphics.cfg", family: "core" },
  { cacheKey: "26/graphics.sty", fileid: "graphics.sty", path: "/swiftlatex/texbundle/graphics.sty", family: "core" },
  { cacheKey: "26/graphicx.sty", fileid: "graphicx.sty", path: "/swiftlatex/texbundle/graphicx.sty", family: "core" },
  { cacheKey: "26/inputenc.sty", fileid: "inputenc.sty", path: "/swiftlatex/texbundle/inputenc.sty", family: "core" },
  { cacheKey: "26/keyval.sty", fileid: "keyval.sty", path: "/swiftlatex/texbundle/keyval.sty", family: "core" },
  { cacheKey: "26/l3backend-pdfmode.def", fileid: "l3backend-pdfmode.def", path: "/swiftlatex/texbundle/l3backend-pdfmode.def", family: "core" },
  { cacheKey: "26/natbib.sty", fileid: "natbib.sty", path: "/swiftlatex/texbundle/natbib.sty", family: "core" },
  { cacheKey: "26/pdftex.def", fileid: "pdftex.def", path: "/swiftlatex/texbundle/pdftex.def", family: "core" },
  { cacheKey: "26/size10.clo", fileid: "size10.clo", path: "/swiftlatex/texbundle/size10.clo", family: "core" },
  { cacheKey: "26/supp-pdf.mkii", fileid: "supp-pdf.mkii", path: "/swiftlatex/texbundle/supp-pdf.mkii", family: "core" },
  { cacheKey: "26/trig.sty", fileid: "trig.sty", path: "/swiftlatex/texbundle/trig.sty", family: "core" },
  { cacheKey: "26/umsa.fd", fileid: "umsa.fd", path: "/swiftlatex/texbundle/umsa.fd", family: "core" },
  { cacheKey: "26/umsb.fd", fileid: "umsb.fd", path: "/swiftlatex/texbundle/umsb.fd", family: "core" },
  { cacheKey: "26/xcolor.sty", fileid: "xcolor.sty", path: "/swiftlatex/texbundle/xcolor.sty", family: "core" },
  { cacheKey: "26/xkeyval", fileid: "xkeyval.tex", path: "/swiftlatex/texbundle/xkeyval.tex", family: "core" },
  { cacheKey: "26/xkeyval.sty", fileid: "xkeyval.sty", path: "/swiftlatex/texbundle/xkeyval.sty", family: "core" },
  { cacheKey: "26/xkvutils", fileid: "xkvutils.tex", path: "/swiftlatex/texbundle/xkvutils.tex", family: "core" },
  { cacheKey: "3/cmbx10", fileid: "cmbx10.tfm", path: "/swiftlatex/texbundle/cmbx10.tfm", family: "core" },
  { cacheKey: "3/cmbx12", fileid: "cmbx12.tfm", path: "/swiftlatex/texbundle/cmbx12.tfm", family: "core" },
  { cacheKey: "3/cmbx8", fileid: "cmbx8.tfm", path: "/swiftlatex/texbundle/cmbx8.tfm", family: "core" },
  { cacheKey: "3/cmex10", fileid: "cmex10.tfm", path: "/swiftlatex/texbundle/cmex10.tfm", family: "core" },
  { cacheKey: "3/cmex7", fileid: "cmex7.tfm", path: "/swiftlatex/texbundle/cmex7.tfm", family: "core" },
  { cacheKey: "3/cmex8", fileid: "cmex8.tfm", path: "/swiftlatex/texbundle/cmex8.tfm", family: "core" },
  { cacheKey: "3/cmmi12", fileid: "cmmi12.tfm", path: "/swiftlatex/texbundle/cmmi12.tfm", family: "core" },
  { cacheKey: "3/cmmi6", fileid: "cmmi6.tfm", path: "/swiftlatex/texbundle/cmmi6.tfm", family: "core" },
  { cacheKey: "3/cmmi8", fileid: "cmmi8.tfm", path: "/swiftlatex/texbundle/cmmi8.tfm", family: "core" },
  { cacheKey: "3/cmr12", fileid: "cmr12.tfm", path: "/swiftlatex/texbundle/cmr12.tfm", family: "core" },
  { cacheKey: "3/cmr17", fileid: "cmr17.tfm", path: "/swiftlatex/texbundle/cmr17.tfm", family: "core" },
  { cacheKey: "3/cmr6", fileid: "cmr6.tfm", path: "/swiftlatex/texbundle/cmr6.tfm", family: "core" },
  { cacheKey: "3/cmr8", fileid: "cmr8.tfm", path: "/swiftlatex/texbundle/cmr8.tfm", family: "core" },
  { cacheKey: "3/cmr9", fileid: "cmr9.tfm", path: "/swiftlatex/texbundle/cmr9.tfm", family: "core" },
  { cacheKey: "3/cmsy10", fileid: "cmsy10.tfm", path: "/swiftlatex/texbundle/cmsy10.tfm", family: "core" },
  { cacheKey: "3/cmsy6", fileid: "cmsy6.tfm", path: "/swiftlatex/texbundle/cmsy6.tfm", family: "core" },
  { cacheKey: "3/cmsy8", fileid: "cmsy8.tfm", path: "/swiftlatex/texbundle/cmsy8.tfm", family: "core" },
  { cacheKey: "3/cmti10", fileid: "cmti10.tfm", path: "/swiftlatex/texbundle/cmti10.tfm", family: "core" },
  { cacheKey: "3/cmti8", fileid: "cmti8.tfm", path: "/swiftlatex/texbundle/cmti8.tfm", family: "core" },
  { cacheKey: "3/cmtt10", fileid: "cmtt10.tfm", path: "/swiftlatex/texbundle/cmtt10.tfm", family: "core" },
  { cacheKey: "3/msam10", fileid: "msam10.tfm", path: "/swiftlatex/texbundle/msam10.tfm", family: "core" },
  { cacheKey: "3/msam5", fileid: "msam5.tfm", path: "/swiftlatex/texbundle/msam5.tfm", family: "core" },
  { cacheKey: "3/msam7", fileid: "msam7.tfm", path: "/swiftlatex/texbundle/msam7.tfm", family: "core" },
  { cacheKey: "3/msbm10", fileid: "msbm10.tfm", path: "/swiftlatex/texbundle/msbm10.tfm", family: "core" },
  { cacheKey: "3/msbm5", fileid: "msbm5.tfm", path: "/swiftlatex/texbundle/msbm5.tfm", family: "core" },
  { cacheKey: "3/msbm7", fileid: "msbm7.tfm", path: "/swiftlatex/texbundle/msbm7.tfm", family: "core" },
  { cacheKey: "3/tcrm0600", fileid: "tcrm0600.tfm", path: "/swiftlatex/texbundle/tcrm0600.tfm", family: "core" },
  { cacheKey: "3/tcrm0800", fileid: "tcrm0800.tfm", path: "/swiftlatex/texbundle/tcrm0800.tfm", family: "core" },
  { cacheKey: "3/tcrm1000", fileid: "tcrm1000.tfm", path: "/swiftlatex/texbundle/tcrm1000.tfm", family: "core" },
  { cacheKey: "32/cmbx10.pfb", fileid: "cmbx10.pfb", path: "/swiftlatex/texbundle/cmbx10.pfb", family: "core" },
  { cacheKey: "32/cmbx12.pfb", fileid: "cmbx12.pfb", path: "/swiftlatex/texbundle/cmbx12.pfb", family: "core" },
  { cacheKey: "32/cmbx8.pfb", fileid: "cmbx8.pfb", path: "/swiftlatex/texbundle/cmbx8.pfb", family: "core" },
  { cacheKey: "32/cmmi10.pfb", fileid: "cmmi10.pfb", path: "/swiftlatex/texbundle/cmmi10.pfb", family: "core" },
  { cacheKey: "32/cmmi8.pfb", fileid: "cmmi8.pfb", path: "/swiftlatex/texbundle/cmmi8.pfb", family: "core" },
  { cacheKey: "32/cmr10.pfb", fileid: "cmr10.pfb", path: "/swiftlatex/texbundle/cmr10.pfb", family: "core" },
  { cacheKey: "32/cmr12.pfb", fileid: "cmr12.pfb", path: "/swiftlatex/texbundle/cmr12.pfb", family: "core" },
  { cacheKey: "32/cmr17.pfb", fileid: "cmr17.pfb", path: "/swiftlatex/texbundle/cmr17.pfb", family: "core" },
  { cacheKey: "32/cmr6.pfb", fileid: "cmr6.pfb", path: "/swiftlatex/texbundle/cmr6.pfb", family: "core" },
  { cacheKey: "32/cmr7.pfb", fileid: "cmr7.pfb", path: "/swiftlatex/texbundle/cmr7.pfb", family: "core" },
  { cacheKey: "32/cmr8.pfb", fileid: "cmr8.pfb", path: "/swiftlatex/texbundle/cmr8.pfb", family: "core" },
  { cacheKey: "32/cmr9.pfb", fileid: "cmr9.pfb", path: "/swiftlatex/texbundle/cmr9.pfb", family: "core" },
  { cacheKey: "32/cmsy10.pfb", fileid: "cmsy10.pfb", path: "/swiftlatex/texbundle/cmsy10.pfb", family: "core" },
  { cacheKey: "32/cmti10.pfb", fileid: "cmti10.pfb", path: "/swiftlatex/texbundle/cmti10.pfb", family: "core" },
  { cacheKey: "32/cmti8.pfb", fileid: "cmti8.pfb", path: "/swiftlatex/texbundle/cmti8.pfb", family: "core" },
  { cacheKey: "32/cmtt10.pfb", fileid: "cmtt10.pfb", path: "/swiftlatex/texbundle/cmtt10.pfb", family: "core" },
  { cacheKey: "32/msbm10.pfb", fileid: "msbm10.pfb", path: "/swiftlatex/texbundle/msbm10.pfb", family: "core" },
  { cacheKey: "32/sfrm0600.pfb", fileid: "sfrm0600.pfb", path: "/swiftlatex/texbundle/sfrm0600.pfb", family: "core" },
  { cacheKey: "32/sfrm0800.pfb", fileid: "sfrm0800.pfb", path: "/swiftlatex/texbundle/sfrm0800.pfb", family: "core" },
  { cacheKey: "32/sfrm1000.pfb", fileid: "sfrm1000.pfb", path: "/swiftlatex/texbundle/sfrm1000.pfb", family: "core" },
  { cacheKey: "44/cm-super-ts1.enc", fileid: "cm-super-ts1.enc", path: "/swiftlatex/texbundle/cm-super-ts1.enc", family: "core" },
  { cacheKey: "7/plainnat", fileid: "plainnat.bst", path: "/swiftlatex/texbundle/plainnat.bst", family: "core" },
  { cacheKey: "26/elocalloc.sty", fileid: "elocalloc.sty", path: "/swiftlatex/texbundle/elocalloc.sty", family: "forest" },
  { cacheKey: "26/environ.sty", fileid: "environ.sty", path: "/swiftlatex/texbundle/environ.sty", family: "forest" },
  { cacheKey: "26/etoolbox.def", fileid: "etoolbox.def", path: "/swiftlatex/texbundle/etoolbox.def", family: "forest" },
  { cacheKey: "26/etoolbox.sty", fileid: "etoolbox.sty", path: "/swiftlatex/texbundle/etoolbox.sty", family: "forest" },
  { cacheKey: "26/forest-compat.sty", fileid: "forest-compat.sty", path: "/swiftlatex/texbundle/forest-compat.sty", family: "forest" },
  { cacheKey: "26/forest.sty", fileid: "forest.sty", path: "/swiftlatex/texbundle/forest.sty", family: "forest" },
  { cacheKey: "26/inlinedef.sty", fileid: "inlinedef.sty", path: "/swiftlatex/texbundle/inlinedef.sty", family: "forest" },
  { cacheKey: "26/pgflibraryfpu.code.tex", fileid: "pgflibraryfpu.code.tex", path: "/swiftlatex/texbundle/pgflibraryfpu.code.tex", family: "forest" },
  { cacheKey: "26/pgflibraryintersections.code.tex", fileid: "pgflibraryintersections.code.tex", path: "/swiftlatex/texbundle/pgflibraryintersections.code.tex", family: "forest" },
  { cacheKey: "26/pgflibraryshapes.arrows.code.tex", fileid: "pgflibraryshapes.arrows.code.tex", path: "/swiftlatex/texbundle/pgflibraryshapes.arrows.code.tex", family: "forest" },
  { cacheKey: "26/pgflibraryshapes.callouts.code.tex", fileid: "pgflibraryshapes.callouts.code.tex", path: "/swiftlatex/texbundle/pgflibraryshapes.callouts.code.tex", family: "forest" },
  { cacheKey: "26/pgflibraryshapes.code.tex", fileid: "pgflibraryshapes.code.tex", path: "/swiftlatex/texbundle/pgflibraryshapes.code.tex", family: "forest" },
  { cacheKey: "26/pgflibraryshapes.geometric.code.tex", fileid: "pgflibraryshapes.geometric.code.tex", path: "/swiftlatex/texbundle/pgflibraryshapes.geometric.code.tex", family: "forest" },
  { cacheKey: "26/pgflibraryshapes.misc.code.tex", fileid: "pgflibraryshapes.misc.code.tex", path: "/swiftlatex/texbundle/pgflibraryshapes.misc.code.tex", family: "forest" },
  { cacheKey: "26/pgflibraryshapes.multipart.code.tex", fileid: "pgflibraryshapes.multipart.code.tex", path: "/swiftlatex/texbundle/pgflibraryshapes.multipart.code.tex", family: "forest" },
  { cacheKey: "26/pgflibraryshapes.symbols.code.tex", fileid: "pgflibraryshapes.symbols.code.tex", path: "/swiftlatex/texbundle/pgflibraryshapes.symbols.code.tex", family: "forest" },
  { cacheKey: "26/pgfopts.sty", fileid: "pgfopts.sty", path: "/swiftlatex/texbundle/pgfopts.sty", family: "forest" },
  { cacheKey: "26/tikzlibrarycalc.code.tex", fileid: "tikzlibrarycalc.code.tex", path: "/swiftlatex/texbundle/tikzlibrarycalc.code.tex", family: "forest" },
  { cacheKey: "26/tikzlibraryfit.code.tex", fileid: "tikzlibraryfit.code.tex", path: "/swiftlatex/texbundle/tikzlibraryfit.code.tex", family: "forest" },
  { cacheKey: "26/tikzlibraryshapes.arrows.code.tex", fileid: "tikzlibraryshapes.arrows.code.tex", path: "/swiftlatex/texbundle/tikzlibraryshapes.arrows.code.tex", family: "forest" },
  { cacheKey: "26/tikzlibraryshapes.callouts.code.tex", fileid: "tikzlibraryshapes.callouts.code.tex", path: "/swiftlatex/texbundle/tikzlibraryshapes.callouts.code.tex", family: "forest" },
  { cacheKey: "26/tikzlibraryshapes.code.tex", fileid: "tikzlibraryshapes.code.tex", path: "/swiftlatex/texbundle/tikzlibraryshapes.code.tex", family: "forest" },
  { cacheKey: "26/tikzlibraryshapes.geometric.code.tex", fileid: "tikzlibraryshapes.geometric.code.tex", path: "/swiftlatex/texbundle/tikzlibraryshapes.geometric.code.tex", family: "forest" },
  { cacheKey: "26/tikzlibraryshapes.misc.code.tex", fileid: "tikzlibraryshapes.misc.code.tex", path: "/swiftlatex/texbundle/tikzlibraryshapes.misc.code.tex", family: "forest" },
  { cacheKey: "26/tikzlibraryshapes.multipart.code.tex", fileid: "tikzlibraryshapes.multipart.code.tex", path: "/swiftlatex/texbundle/tikzlibraryshapes.multipart.code.tex", family: "forest" },
  { cacheKey: "26/tikzlibraryshapes.symbols.code.tex", fileid: "tikzlibraryshapes.symbols.code.tex", path: "/swiftlatex/texbundle/tikzlibraryshapes.symbols.code.tex", family: "forest" },
  { cacheKey: "26/trimspaces.sty", fileid: "trimspaces.sty", path: "/swiftlatex/texbundle/trimspaces.sty", family: "forest" },
  { cacheKey: "26/xparse.sty", fileid: "xparse.sty", path: "/swiftlatex/texbundle/xparse.sty", family: "forest" },
  { cacheKey: "26/pgf.cfg", fileid: "pgf.cfg", path: "/swiftlatex/texbundle/pgf.cfg", family: "pgf-tikz" },
  { cacheKey: "26/pgf.revision.tex", fileid: "pgf.revision.tex", path: "/swiftlatex/texbundle/pgf.revision.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgf.sty", fileid: "pgf.sty", path: "/swiftlatex/texbundle/pgf.sty", family: "pgf-tikz" },
  { cacheKey: "26/pgfcomp-version-0-65.sty", fileid: "pgfcomp-version-0-65.sty", path: "/swiftlatex/texbundle/pgfcomp-version-0-65.sty", family: "pgf-tikz" },
  { cacheKey: "26/pgfcomp-version-1-18.sty", fileid: "pgfcomp-version-1-18.sty", path: "/swiftlatex/texbundle/pgfcomp-version-1-18.sty", family: "pgf-tikz" },
  { cacheKey: "26/pgfcore.code.tex", fileid: "pgfcore.code.tex", path: "/swiftlatex/texbundle/pgfcore.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcore.sty", fileid: "pgfcore.sty", path: "/swiftlatex/texbundle/pgfcore.sty", family: "pgf-tikz" },
  { cacheKey: "26/pgfcorearrows.code.tex", fileid: "pgfcorearrows.code.tex", path: "/swiftlatex/texbundle/pgfcorearrows.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcoreexternal.code.tex", fileid: "pgfcoreexternal.code.tex", path: "/swiftlatex/texbundle/pgfcoreexternal.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcoregraphicstate.code.tex", fileid: "pgfcoregraphicstate.code.tex", path: "/swiftlatex/texbundle/pgfcoregraphicstate.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcoreimage.code.tex", fileid: "pgfcoreimage.code.tex", path: "/swiftlatex/texbundle/pgfcoreimage.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcorelayers.code.tex", fileid: "pgfcorelayers.code.tex", path: "/swiftlatex/texbundle/pgfcorelayers.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcoreobjects.code.tex", fileid: "pgfcoreobjects.code.tex", path: "/swiftlatex/texbundle/pgfcoreobjects.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcorepathconstruct.code.tex", fileid: "pgfcorepathconstruct.code.tex", path: "/swiftlatex/texbundle/pgfcorepathconstruct.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcorepathprocessing.code.tex", fileid: "pgfcorepathprocessing.code.tex", path: "/swiftlatex/texbundle/pgfcorepathprocessing.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcorepathusage.code.tex", fileid: "pgfcorepathusage.code.tex", path: "/swiftlatex/texbundle/pgfcorepathusage.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcorepatterns.code.tex", fileid: "pgfcorepatterns.code.tex", path: "/swiftlatex/texbundle/pgfcorepatterns.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcorepoints.code.tex", fileid: "pgfcorepoints.code.tex", path: "/swiftlatex/texbundle/pgfcorepoints.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcorequick.code.tex", fileid: "pgfcorequick.code.tex", path: "/swiftlatex/texbundle/pgfcorequick.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcorerdf.code.tex", fileid: "pgfcorerdf.code.tex", path: "/swiftlatex/texbundle/pgfcorerdf.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcorescopes.code.tex", fileid: "pgfcorescopes.code.tex", path: "/swiftlatex/texbundle/pgfcorescopes.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcoreshade.code.tex", fileid: "pgfcoreshade.code.tex", path: "/swiftlatex/texbundle/pgfcoreshade.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcoretransformations.code.tex", fileid: "pgfcoretransformations.code.tex", path: "/swiftlatex/texbundle/pgfcoretransformations.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfcoretransparency.code.tex", fileid: "pgfcoretransparency.code.tex", path: "/swiftlatex/texbundle/pgfcoretransparency.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgffor.code.tex", fileid: "pgffor.code.tex", path: "/swiftlatex/texbundle/pgffor.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgffor.sty", fileid: "pgffor.sty", path: "/swiftlatex/texbundle/pgffor.sty", family: "pgf-tikz" },
  { cacheKey: "26/pgfint.code.tex", fileid: "pgfint.code.tex", path: "/swiftlatex/texbundle/pgfint.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfkeys.code.tex", fileid: "pgfkeys.code.tex", path: "/swiftlatex/texbundle/pgfkeys.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfkeys.sty", fileid: "pgfkeys.sty", path: "/swiftlatex/texbundle/pgfkeys.sty", family: "pgf-tikz" },
  { cacheKey: "26/pgfkeysfiltered.code.tex", fileid: "pgfkeysfiltered.code.tex", path: "/swiftlatex/texbundle/pgfkeysfiltered.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgflibraryplothandlers.code.tex", fileid: "pgflibraryplothandlers.code.tex", path: "/swiftlatex/texbundle/pgflibraryplothandlers.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmath.code.tex", fileid: "pgfmath.code.tex", path: "/swiftlatex/texbundle/pgfmath.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmath.sty", fileid: "pgfmath.sty", path: "/swiftlatex/texbundle/pgfmath.sty", family: "pgf-tikz" },
  { cacheKey: "26/pgfmathcalc.code.tex", fileid: "pgfmathcalc.code.tex", path: "/swiftlatex/texbundle/pgfmathcalc.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmathfloat.code.tex", fileid: "pgfmathfloat.code.tex", path: "/swiftlatex/texbundle/pgfmathfloat.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmathfunctions.base.code.tex", fileid: "pgfmathfunctions.base.code.tex", path: "/swiftlatex/texbundle/pgfmathfunctions.base.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmathfunctions.basic.code.tex", fileid: "pgfmathfunctions.basic.code.tex", path: "/swiftlatex/texbundle/pgfmathfunctions.basic.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmathfunctions.code.tex", fileid: "pgfmathfunctions.code.tex", path: "/swiftlatex/texbundle/pgfmathfunctions.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmathfunctions.comparison.code.tex", fileid: "pgfmathfunctions.comparison.code.tex", path: "/swiftlatex/texbundle/pgfmathfunctions.comparison.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmathfunctions.integerarithmetics.code.tex", fileid: "pgfmathfunctions.integerarithmetics.code.tex", path: "/swiftlatex/texbundle/pgfmathfunctions.integerarithmetics.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmathfunctions.misc.code.tex", fileid: "pgfmathfunctions.misc.code.tex", path: "/swiftlatex/texbundle/pgfmathfunctions.misc.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmathfunctions.random.code.tex", fileid: "pgfmathfunctions.random.code.tex", path: "/swiftlatex/texbundle/pgfmathfunctions.random.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmathfunctions.round.code.tex", fileid: "pgfmathfunctions.round.code.tex", path: "/swiftlatex/texbundle/pgfmathfunctions.round.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmathfunctions.trigonometric.code.tex", fileid: "pgfmathfunctions.trigonometric.code.tex", path: "/swiftlatex/texbundle/pgfmathfunctions.trigonometric.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmathparser.code.tex", fileid: "pgfmathparser.code.tex", path: "/swiftlatex/texbundle/pgfmathparser.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmathutil.code.tex", fileid: "pgfmathutil.code.tex", path: "/swiftlatex/texbundle/pgfmathutil.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmodulematrix.code.tex", fileid: "pgfmodulematrix.code.tex", path: "/swiftlatex/texbundle/pgfmodulematrix.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmoduleplot.code.tex", fileid: "pgfmoduleplot.code.tex", path: "/swiftlatex/texbundle/pgfmoduleplot.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfmoduleshapes.code.tex", fileid: "pgfmoduleshapes.code.tex", path: "/swiftlatex/texbundle/pgfmoduleshapes.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfrcs.code.tex", fileid: "pgfrcs.code.tex", path: "/swiftlatex/texbundle/pgfrcs.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfrcs.sty", fileid: "pgfrcs.sty", path: "/swiftlatex/texbundle/pgfrcs.sty", family: "pgf-tikz" },
  { cacheKey: "26/pgfsys-common-pdf.def", fileid: "pgfsys-common-pdf.def", path: "/swiftlatex/texbundle/pgfsys-common-pdf.def", family: "pgf-tikz" },
  { cacheKey: "26/pgfsys-pdftex.def", fileid: "pgfsys-pdftex.def", path: "/swiftlatex/texbundle/pgfsys-pdftex.def", family: "pgf-tikz" },
  { cacheKey: "26/pgfsys.code.tex", fileid: "pgfsys.code.tex", path: "/swiftlatex/texbundle/pgfsys.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfsys.sty", fileid: "pgfsys.sty", path: "/swiftlatex/texbundle/pgfsys.sty", family: "pgf-tikz" },
  { cacheKey: "26/pgfsysprotocol.code.tex", fileid: "pgfsysprotocol.code.tex", path: "/swiftlatex/texbundle/pgfsysprotocol.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfsyssoftpath.code.tex", fileid: "pgfsyssoftpath.code.tex", path: "/swiftlatex/texbundle/pgfsyssoftpath.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfutil-common-lists.tex", fileid: "pgfutil-common-lists.tex", path: "/swiftlatex/texbundle/pgfutil-common-lists.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfutil-common.tex", fileid: "pgfutil-common.tex", path: "/swiftlatex/texbundle/pgfutil-common.tex", family: "pgf-tikz" },
  { cacheKey: "26/pgfutil-latex.def", fileid: "pgfutil-latex.def", path: "/swiftlatex/texbundle/pgfutil-latex.def", family: "pgf-tikz" },
  { cacheKey: "26/tikz.code.tex", fileid: "tikz.code.tex", path: "/swiftlatex/texbundle/tikz.code.tex", family: "pgf-tikz" },
  { cacheKey: "26/tikz.sty", fileid: "tikz.sty", path: "/swiftlatex/texbundle/tikz.sty", family: "pgf-tikz" },
  { cacheKey: "26/tikzlibrarytopaths.code.tex", fileid: "tikzlibrarytopaths.code.tex", path: "/swiftlatex/texbundle/tikzlibrarytopaths.code.tex", family: "pgf-tikz" },
];
