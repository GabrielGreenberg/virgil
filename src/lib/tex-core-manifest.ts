/**
 * Curated core TeX-asset manifest (P1 offline-assets).
 *
 * GENERATED FILE — do not edit by hand. Regenerate with:
 *   node scripts/build-tex-bundle.mjs <captured-dump.json>
 *
 * The `cacheKey` of every entry is the worker's compiler-internal
 * `<numericFormatCode>/<reqname>` key, captured from a live compile. The bytes
 * for each entry live same-origin under BASE_PATH at the given `path` (the base
 * .fmt at /swiftlatex/swiftlatexpdftex.fmt; packages under
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
}

/**
 * Sentinel cacheKey for the base `.fmt`. Retained for callers that reference
 * it; once the manifest is generated from a live capture the real
 * `<code>/swiftlatexpdftex.fmt` cacheKey is used in CORE_MANIFEST below.
 */
export const PLACEHOLDER_FMT_CACHEKEY = "__PLACEHOLDER_FMT_CACHEKEY__";

/** Public path (relative to BASE_PATH) of the vendored base format file. */
export const CORE_FMT_PATH = "/swiftlatex/swiftlatexpdftex.fmt";

/** The curated core manifest (generated from a live capture). */
export const CORE_MANIFEST: readonly CoreManifestEntry[] = [
  { cacheKey: "10/swiftlatexpdftex.fmt", fileid: "swiftlatexpdftex.fmt", path: "/swiftlatex/swiftlatexpdftex.fmt" },
  { cacheKey: "11/pdftex.map", fileid: "pdftex.map", path: "/swiftlatex/texbundle/pdftex.map" },
  { cacheKey: "26/amsbsy.sty", fileid: "amsbsy.sty", path: "/swiftlatex/texbundle/amsbsy.sty" },
  { cacheKey: "26/amsfonts.sty", fileid: "amsfonts.sty", path: "/swiftlatex/texbundle/amsfonts.sty" },
  { cacheKey: "26/amsgen.sty", fileid: "amsgen.sty", path: "/swiftlatex/texbundle/amsgen.sty" },
  { cacheKey: "26/amsmath.sty", fileid: "amsmath.sty", path: "/swiftlatex/texbundle/amsmath.sty" },
  { cacheKey: "26/amsopn.sty", fileid: "amsopn.sty", path: "/swiftlatex/texbundle/amsopn.sty" },
  { cacheKey: "26/amssymb.sty", fileid: "amssymb.sty", path: "/swiftlatex/texbundle/amssymb.sty" },
  { cacheKey: "26/amstext.sty", fileid: "amstext.sty", path: "/swiftlatex/texbundle/amstext.sty" },
  { cacheKey: "26/article.cls", fileid: "article.cls", path: "/swiftlatex/texbundle/article.cls" },
  { cacheKey: "26/color.cfg", fileid: "color.cfg", path: "/swiftlatex/texbundle/color.cfg" },
  { cacheKey: "26/everyshi.sty", fileid: "everyshi.sty", path: "/swiftlatex/texbundle/everyshi.sty" },
  { cacheKey: "26/expex", fileid: "expex.tex", path: "/swiftlatex/texbundle/expex.tex" },
  { cacheKey: "26/expex.sty", fileid: "expex.sty", path: "/swiftlatex/texbundle/expex.sty" },
  { cacheKey: "26/graphics.cfg", fileid: "graphics.cfg", path: "/swiftlatex/texbundle/graphics.cfg" },
  { cacheKey: "26/graphics.sty", fileid: "graphics.sty", path: "/swiftlatex/texbundle/graphics.sty" },
  { cacheKey: "26/graphicx.sty", fileid: "graphicx.sty", path: "/swiftlatex/texbundle/graphicx.sty" },
  { cacheKey: "26/inputenc.sty", fileid: "inputenc.sty", path: "/swiftlatex/texbundle/inputenc.sty" },
  { cacheKey: "26/keyval.sty", fileid: "keyval.sty", path: "/swiftlatex/texbundle/keyval.sty" },
  { cacheKey: "26/l3backend-pdfmode.def", fileid: "l3backend-pdfmode.def", path: "/swiftlatex/texbundle/l3backend-pdfmode.def" },
  { cacheKey: "26/natbib.sty", fileid: "natbib.sty", path: "/swiftlatex/texbundle/natbib.sty" },
  { cacheKey: "26/pdftex.def", fileid: "pdftex.def", path: "/swiftlatex/texbundle/pdftex.def" },
  { cacheKey: "26/size10.clo", fileid: "size10.clo", path: "/swiftlatex/texbundle/size10.clo" },
  { cacheKey: "26/supp-pdf.mkii", fileid: "supp-pdf.mkii", path: "/swiftlatex/texbundle/supp-pdf.mkii" },
  { cacheKey: "26/trig.sty", fileid: "trig.sty", path: "/swiftlatex/texbundle/trig.sty" },
  { cacheKey: "26/umsa.fd", fileid: "umsa.fd", path: "/swiftlatex/texbundle/umsa.fd" },
  { cacheKey: "26/umsb.fd", fileid: "umsb.fd", path: "/swiftlatex/texbundle/umsb.fd" },
  { cacheKey: "26/xcolor.sty", fileid: "xcolor.sty", path: "/swiftlatex/texbundle/xcolor.sty" },
  { cacheKey: "26/xkeyval", fileid: "xkeyval.tex", path: "/swiftlatex/texbundle/xkeyval.tex" },
  { cacheKey: "26/xkeyval.sty", fileid: "xkeyval.sty", path: "/swiftlatex/texbundle/xkeyval.sty" },
  { cacheKey: "26/xkvutils", fileid: "xkvutils.tex", path: "/swiftlatex/texbundle/xkvutils.tex" },
  { cacheKey: "3/cmbx10", fileid: "cmbx10.tfm", path: "/swiftlatex/texbundle/cmbx10.tfm" },
  { cacheKey: "3/cmbx12", fileid: "cmbx12.tfm", path: "/swiftlatex/texbundle/cmbx12.tfm" },
  { cacheKey: "3/cmbx8", fileid: "cmbx8.tfm", path: "/swiftlatex/texbundle/cmbx8.tfm" },
  { cacheKey: "3/cmex10", fileid: "cmex10.tfm", path: "/swiftlatex/texbundle/cmex10.tfm" },
  { cacheKey: "3/cmex7", fileid: "cmex7.tfm", path: "/swiftlatex/texbundle/cmex7.tfm" },
  { cacheKey: "3/cmex8", fileid: "cmex8.tfm", path: "/swiftlatex/texbundle/cmex8.tfm" },
  { cacheKey: "3/cmmi12", fileid: "cmmi12.tfm", path: "/swiftlatex/texbundle/cmmi12.tfm" },
  { cacheKey: "3/cmmi6", fileid: "cmmi6.tfm", path: "/swiftlatex/texbundle/cmmi6.tfm" },
  { cacheKey: "3/cmmi8", fileid: "cmmi8.tfm", path: "/swiftlatex/texbundle/cmmi8.tfm" },
  { cacheKey: "3/cmr12", fileid: "cmr12.tfm", path: "/swiftlatex/texbundle/cmr12.tfm" },
  { cacheKey: "3/cmr17", fileid: "cmr17.tfm", path: "/swiftlatex/texbundle/cmr17.tfm" },
  { cacheKey: "3/cmr6", fileid: "cmr6.tfm", path: "/swiftlatex/texbundle/cmr6.tfm" },
  { cacheKey: "3/cmr8", fileid: "cmr8.tfm", path: "/swiftlatex/texbundle/cmr8.tfm" },
  { cacheKey: "3/cmr9", fileid: "cmr9.tfm", path: "/swiftlatex/texbundle/cmr9.tfm" },
  { cacheKey: "3/cmsy10", fileid: "cmsy10.tfm", path: "/swiftlatex/texbundle/cmsy10.tfm" },
  { cacheKey: "3/cmsy6", fileid: "cmsy6.tfm", path: "/swiftlatex/texbundle/cmsy6.tfm" },
  { cacheKey: "3/cmsy8", fileid: "cmsy8.tfm", path: "/swiftlatex/texbundle/cmsy8.tfm" },
  { cacheKey: "3/cmti10", fileid: "cmti10.tfm", path: "/swiftlatex/texbundle/cmti10.tfm" },
  { cacheKey: "3/cmti8", fileid: "cmti8.tfm", path: "/swiftlatex/texbundle/cmti8.tfm" },
  { cacheKey: "3/cmtt10", fileid: "cmtt10.tfm", path: "/swiftlatex/texbundle/cmtt10.tfm" },
  { cacheKey: "3/msam10", fileid: "msam10.tfm", path: "/swiftlatex/texbundle/msam10.tfm" },
  { cacheKey: "3/msam5", fileid: "msam5.tfm", path: "/swiftlatex/texbundle/msam5.tfm" },
  { cacheKey: "3/msam7", fileid: "msam7.tfm", path: "/swiftlatex/texbundle/msam7.tfm" },
  { cacheKey: "3/msbm10", fileid: "msbm10.tfm", path: "/swiftlatex/texbundle/msbm10.tfm" },
  { cacheKey: "3/msbm5", fileid: "msbm5.tfm", path: "/swiftlatex/texbundle/msbm5.tfm" },
  { cacheKey: "3/msbm7", fileid: "msbm7.tfm", path: "/swiftlatex/texbundle/msbm7.tfm" },
  { cacheKey: "3/tcrm0600", fileid: "tcrm0600.tfm", path: "/swiftlatex/texbundle/tcrm0600.tfm" },
  { cacheKey: "3/tcrm0800", fileid: "tcrm0800.tfm", path: "/swiftlatex/texbundle/tcrm0800.tfm" },
  { cacheKey: "3/tcrm1000", fileid: "tcrm1000.tfm", path: "/swiftlatex/texbundle/tcrm1000.tfm" },
  { cacheKey: "32/cmbx10.pfb", fileid: "cmbx10.pfb", path: "/swiftlatex/texbundle/cmbx10.pfb" },
  { cacheKey: "32/cmbx12.pfb", fileid: "cmbx12.pfb", path: "/swiftlatex/texbundle/cmbx12.pfb" },
  { cacheKey: "32/cmbx8.pfb", fileid: "cmbx8.pfb", path: "/swiftlatex/texbundle/cmbx8.pfb" },
  { cacheKey: "32/cmmi10.pfb", fileid: "cmmi10.pfb", path: "/swiftlatex/texbundle/cmmi10.pfb" },
  { cacheKey: "32/cmmi8.pfb", fileid: "cmmi8.pfb", path: "/swiftlatex/texbundle/cmmi8.pfb" },
  { cacheKey: "32/cmr10.pfb", fileid: "cmr10.pfb", path: "/swiftlatex/texbundle/cmr10.pfb" },
  { cacheKey: "32/cmr12.pfb", fileid: "cmr12.pfb", path: "/swiftlatex/texbundle/cmr12.pfb" },
  { cacheKey: "32/cmr17.pfb", fileid: "cmr17.pfb", path: "/swiftlatex/texbundle/cmr17.pfb" },
  { cacheKey: "32/cmr6.pfb", fileid: "cmr6.pfb", path: "/swiftlatex/texbundle/cmr6.pfb" },
  { cacheKey: "32/cmr7.pfb", fileid: "cmr7.pfb", path: "/swiftlatex/texbundle/cmr7.pfb" },
  { cacheKey: "32/cmr8.pfb", fileid: "cmr8.pfb", path: "/swiftlatex/texbundle/cmr8.pfb" },
  { cacheKey: "32/cmr9.pfb", fileid: "cmr9.pfb", path: "/swiftlatex/texbundle/cmr9.pfb" },
  { cacheKey: "32/cmsy10.pfb", fileid: "cmsy10.pfb", path: "/swiftlatex/texbundle/cmsy10.pfb" },
  { cacheKey: "32/cmti10.pfb", fileid: "cmti10.pfb", path: "/swiftlatex/texbundle/cmti10.pfb" },
  { cacheKey: "32/cmti8.pfb", fileid: "cmti8.pfb", path: "/swiftlatex/texbundle/cmti8.pfb" },
  { cacheKey: "32/cmtt10.pfb", fileid: "cmtt10.pfb", path: "/swiftlatex/texbundle/cmtt10.pfb" },
  { cacheKey: "32/msbm10.pfb", fileid: "msbm10.pfb", path: "/swiftlatex/texbundle/msbm10.pfb" },
  { cacheKey: "32/sfrm0600.pfb", fileid: "sfrm0600.pfb", path: "/swiftlatex/texbundle/sfrm0600.pfb" },
  { cacheKey: "32/sfrm0800.pfb", fileid: "sfrm0800.pfb", path: "/swiftlatex/texbundle/sfrm0800.pfb" },
  { cacheKey: "32/sfrm1000.pfb", fileid: "sfrm1000.pfb", path: "/swiftlatex/texbundle/sfrm1000.pfb" },
  { cacheKey: "44/cm-super-ts1.enc", fileid: "cm-super-ts1.enc", path: "/swiftlatex/texbundle/cm-super-ts1.enc" },
  { cacheKey: "7/plainnat", fileid: "plainnat.bst", path: "/swiftlatex/texbundle/plainnat.bst" },
];
