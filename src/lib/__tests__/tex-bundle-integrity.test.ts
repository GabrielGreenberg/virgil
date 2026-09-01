/**
 * The vendored TeX bundle's two generated tables, and the scan that fills them
 * (task 520 — vendoring the pgf/tikz + forest families).
 *
 * WHY THIS SUITE EXISTS. The bundle is read by two consumers that apply
 * DIFFERENT bases and fail in OPPOSITE, SILENT ways:
 *
 *   - `tex-assets.ts` reads `CORE_MANIFEST` and seeds the worker's kpse cache.
 *     A row whose bytes are not on disk fetches a 404 — caught, logged, and the
 *     package then streams from the mirror, i.e. exactly the wait this task
 *     removes, with nothing visibly wrong.
 *   - `public/sw.js` reads `texbundle/manifest.json` and precaches each path
 *     inside a per-asset try/catch. A path the SW precaches that the engine
 *     never seeds is dead weight; one the engine seeds that the SW never
 *     precaches is not there when the user goes offline. Neither throws.
 *
 * So the leg with teeth is AGREEMENT: the two tables and the bytes on disk are
 * three views of one set, and any two of them drifting is invisible at runtime.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { CORE_MANIFEST, CORE_FMT_PATH } from "@/lib/tex-core-manifest";
// The producers are build scripts; the scan exports its extractor, and the
// declaration its tables, so this suite drives the REAL ones.
import { referencesIn } from "../../../scripts/vendor-tex-family.mjs";
import { FAMILIES, EXCLUDE, FORMAT_TEX } from "../../../scripts/tex-bundle-families.mjs";

const REPO = path.resolve(__dirname, "../../..");
const BUNDLE_DIR = path.join(REPO, "public/swiftlatex/texbundle");
const SW_MANIFEST = path.join(BUNDLE_DIR, "manifest.json");

const readSwPaths = (): string[] =>
  (JSON.parse(fs.readFileSync(SW_MANIFEST, "utf8")) as { paths: string[] }).paths;

const keysOf = (family: string) =>
  CORE_MANIFEST.filter((e) => e.family === family).map((e) => e.cacheKey);

describe("vendored TeX bundle — the three views agree", () => {
  it("every manifest row's bytes are on disk", () => {
    const missing = CORE_MANIFEST.filter((e) => {
      const rel = e.path === CORE_FMT_PATH ? "public/swiftlatex/swiftlatexpdftex.fmt" : `public${e.path}`;
      return !fs.existsSync(path.join(REPO, rel));
    }).map((e) => e.cacheKey);
    expect(missing, "a seeded row with no bytes 404s and silently streams instead").toEqual([]);
  });

  it("no byte in texbundle/ is orphaned — nothing ships unreferenced", () => {
    const referenced = new Set(
      CORE_MANIFEST.filter((e) => e.path !== CORE_FMT_PATH).map((e) => e.fileid),
    );
    const orphans = fs
      .readdirSync(BUNDLE_DIR)
      .filter((f) => f !== "manifest.json" && !referenced.has(f));
    expect(orphans, "a shrunk closure must prune, not accumulate").toEqual([]);
  });

  it("the SW precache list is exactly the manifest's paths, scope-relative", () => {
    const fromManifest = [...new Set(CORE_MANIFEST.map((e) => e.path.replace(/^\/+/, "")))].sort();
    expect(readSwPaths()).toEqual(fromManifest);
    // Task 365: a leading slash escapes the deploy's scope and 404s under /virgil.
    expect(readSwPaths().filter((p) => p.startsWith("/"))).toEqual([]);
  });

  it("one cacheKey has one owner", () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const e of CORE_MANIFEST) {
      if (seen.has(e.cacheKey)) dupes.push(`${e.cacheKey} (${seen.get(e.cacheKey)} + ${e.family})`);
      seen.set(e.cacheKey, e.family);
    }
    expect(dupes).toEqual([]);
  });

  it("every row declares a family, and every family is `core` or declared", () => {
    const known = new Set(["core", ...Object.keys(FAMILIES)]);
    const unknown = [...new Set(CORE_MANIFEST.map((e) => e.family))].filter((f) => !known.has(f));
    expect(unknown, "a family removed from the declaration must prune its rows").toEqual([]);
    expect(CORE_MANIFEST.every((e) => typeof e.family === "string" && e.family.length > 0)).toBe(true);
  });
});

describe("vendored TeX bundle — the declared families are actually vendored", () => {
  it("the `core` family the live capture produced is untouched", () => {
    // The pre-520 capture: nothing this task added may displace it.
    expect(keysOf("core").length).toBeGreaterThanOrEqual(82);
    for (const key of ["10/swiftlatexpdftex.fmt", "26/article.cls", "26/expex.sty", "11/pdftex.map"])
      expect(keysOf("core")).toContain(key);
  });

  it("pgf/tikz ships the closure an ordinary tikzpicture loads", () => {
    const pgf = new Set(keysOf("pgf-tikz"));
    // Each of these is a distinct limb of the graph the scan had to walk, and
    // each has its own way of being missed: a seed, the macro-named driver, a
    // \usepgfmodule, a \usepgflibrary, and tikz's one auto-loaded library.
    for (const req of [
      "tikz.sty",
      "tikz.code.tex",
      "pgf.sty",
      "pgfcore.code.tex",
      "pgfkeys.code.tex",
      "pgfmathparser.code.tex",
      "pgfsys.code.tex",
      "pgfsys-pdftex.def", // seed: \input\pgfsysdriver is a macro, not a name
      "pgfsys-common-pdf.def",
      "pgfutil-latex.def",
      "pgfmodulematrix.code.tex", // \usepgfmodule{matrix}
      "pgfmoduleshapes.code.tex",
      "pgflibraryplothandlers.code.tex", // \usepgflibrary{plothandlers}
      "tikzlibrarytopaths.code.tex", // \usetikzlibrary{topaths}
    ])
      expect(pgf, `pgf-tikz is missing ${req}`).toContain(`${FORMAT_TEX}/${req}`);
  });

  it("forest ships forest plus the libraries it loads unconditionally", () => {
    const forest = new Set(keysOf("forest"));
    for (const req of [
      "forest.sty",
      "forest-compat.sty",
      "pgfopts.sty",
      "etoolbox.sty",
      "environ.sty",
      "elocalloc.sty",
      "inlinedef.sty",
      "xparse.sty",
      "tikzlibraryshapes.code.tex", // \usetikzlibrary{shapes}
      "tikzlibraryfit.code.tex",
      "tikzlibrarycalc.code.tex",
      "pgflibraryintersections.code.tex", // \usepgflibrary{intersections}
    ])
      expect(forest, `forest is missing ${req}`).toContain(`${FORMAT_TEX}/${req}`);
  });

  it("nothing EXCLUDEd was vendored anyway", () => {
    const vendored = new Set(CORE_MANIFEST.map((e) => e.cacheKey));
    for (const name of Object.keys(EXCLUDE))
      expect(vendored, `${name} is excluded but present`).not.toContain(`${FORMAT_TEX}/${name}`);
  });
});

describe("the closure scan — talking about a load is not a load", () => {
  const refs = (src: string) => [...referencesIn(src)].sort();

  it("follows the loaders it exists to follow", () => {
    expect(refs(String.raw`\RequirePackage{pgf,pgffor}`)).toEqual(["pgf.sty", "pgffor.sty"]);
    expect(refs(String.raw`\input{tikz.code.tex}`)).toEqual(["tikz.code.tex"]);
    expect(refs(String.raw`\input pgfutil-common.tex`)).toEqual(["pgfutil-common.tex"]);
    expect(refs(String.raw`\usepgfmodule{matrix}`)).toEqual(["pgfmodulematrix.code.tex"]);
    expect(refs(String.raw`\usepgflibrary{plothandlers}`)).toEqual([
      "pgflibraryplothandlers.code.tex",
    ]);
    // tikz tries BOTH prefixes; a 404 on either is ordinary.
    expect(refs(String.raw`\usetikzlibrary{fit}`)).toEqual([
      "pgflibraryfit.code.tex",
      "tikzlibraryfit.code.tex",
    ]);
  });

  it("a commented-out load is not a load", () => {
    // pgf.sty carries three of these; following them fetched packages whose
    // own author had switched them off.
    expect(refs(String.raw`%\RequirePackage{pgfbasesnakes}`)).toEqual([]);
    expect(refs(String.raw`\RequirePackage{a}% \RequirePackage{b}`)).toEqual(["a.sty"]);
  });

  it("an ESCAPED percent is a character, so the line keeps going", () => {
    // Without this the comment scan cuts at `\%` and the real load after it is
    // silently never followed — a MISSING file, which is the error direction
    // that costs a compile a mirror round trip.
    expect(refs(String.raw`\def\pct{100\%}\RequirePackage{keyval}`)).toEqual(["keyval.sty"]);
  });

  it("`\\string\\usepackage{fp}` prints the call; it does not perform it", () => {
    // This ONE rule is what answers pgf's diagnostics — tikz.code.tex names a
    // dozen libraries it never loads, and every such message spells the call
    // with \string, because that is how TeX prints a control sequence.
    // Following them was 0.8 MB of the pre-fix over-fetch (measured).
    expect(
      refs(String.raw`\tikzerror{You need to say \string\usetikzlibrary{calc} for that}`),
    ).toEqual([]);
    expect(
      refs(String.raw`\pgfmath@PackageError{requires \string\usepackage{fp} to work}`),
    ).toEqual([]);
    // …and it is about TeX, not about error macros: it holds on a line with none.
    expect(refs(String.raw`\def\hint{\string\usepackage{fp}}`)).toEqual([]);
    // The complement, which is why an error-MACRO filter was written and then
    // deleted (it changed the closure by zero files, and being line-granular
    // was the only rule that could lose a real load): an ordinary line is not
    // silenced by carrying a diagnostic beside a genuine input.
    expect(refs(String.raw`\typeout{loading}\input{tikz.code.tex}`)).toEqual(["tikz.code.tex"]);
  });

  it("a \\DeclareOption body runs only if the caller passes that option", () => {
    // xcolor's `table` option is where colortbl -> array, color came from.
    expect(
      refs(String.raw`\DeclareOption{table}{\XC@append\XC@@pkg{\RequirePackage{colortbl}}}`),
    ).toEqual([]);
    // A real load AFTER the option block still resolves — the blanker must not
    // swallow the rest of the file.
    expect(
      refs(
        String.raw`\DeclareOption{table}{\RequirePackage{colortbl}}` +
          "\n" +
          String.raw`\RequirePackage{keyval}`,
      ),
    ).toEqual(["keyval.sty"]);
  });

  it("a reference carrying TeX syntax is a macro, not a filename", () => {
    // \input\pgfsysdriver — which is why the driver is a declared SEED.
    expect(refs(String.raw`\pgfutil@InputIfFileExists{\pgfsysdriver}{}{}`)).toEqual([]);
  });
});
