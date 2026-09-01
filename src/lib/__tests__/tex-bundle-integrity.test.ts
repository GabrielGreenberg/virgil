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
 *
 * DELIBERATELY HARD-FAILS ON A MISSING BUNDLE, where the task-365 leg 20 lines
 * away in public-asset-url-ssot deliberately SKIPS ("build output; a lighter
 * checkout has none"). That leg predates the bundle being git-tracked; all 174
 * files here are tracked and nothing under public/swiftlatex is gitignored, so
 * an absent file means a forgotten `git add` of a new family's bytes — which
 * should fail loudly in CI, not skip.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { CORE_MANIFEST, CORE_FMT_PATH } from "@/lib/tex-core-manifest";
// The producers are build scripts; the scan exports its extractor, and the
// declaration its tables, so this suite drives the REAL ones.
import { referencesIn } from "../../../scripts/vendor-tex-family.mjs";
import { FAMILIES, EXCLUDE, FORMAT_TEX } from "../../../scripts/tex-bundle-families.mjs";
import {
  parseManifestRows,
  renderManifestTs,
  mergeFamilyRows,
} from "../../../scripts/lib/tex-bundle-manifest.mjs";

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

  it("FORMAT_TEX is the code a REAL capture produced, not its own definition", () => {
    // Every closure leg below builds its expected key as `${FORMAT_TEX}/<name>`
    // — from the same constant the vendorer wrote the manifest with. So a drift
    // in FORMAT_TEX is invisible to all of them: re-vendor at 27 and every leg
    // still passes while the whole 2.25 MB bundle is dead weight, because the
    // worker asks 26/tikz.sty and the seed sits at 27/tikz.sty. The `core`
    // family came from a LIVE capture of the running worker, so it is the one
    // ground truth in this file, and anchoring to it is what gives the rest
    // their teeth.
    expect(keysOf("core")).toContain(`${FORMAT_TEX}/article.cls`);
    expect(keysOf("core")).toContain(`${FORMAT_TEX}/graphics.cfg`);
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

  it("the vendorer fetches from the SAME mirror the runtime asks", () => {
    // A vendored byte and a streamed byte for one package must come from one
    // TeX Live snapshot, or a paper compiles against two versions of pgf
    // depending on which half of its closure happened to be cached. A build
    // script cannot import the TS module, so the two spellings are pinned here.
    const spelling = (rel: string, re: RegExp) => {
      const m = fs.readFileSync(path.join(REPO, rel), "utf8").match(re);
      expect(m, `${rel}: the endpoint declaration moved — re-read this leg`).toBeTruthy();
      return m![1];
    };
    expect(spelling("scripts/vendor-tex-family.mjs", /^const ENDPOINT = "([^"]+)";/m)).toBe(
      spelling("src/lib/swiftlatex.ts", /^const TEXLIVE_ENDPOINT = "([^"]+)";/m),
    );
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

describe("the shared writer — merge BY FAMILY is the whole architectural claim", () => {
  // WHY THESE EXIST. `writeBundle`'s paths are module constants, so its DECISION
  // was untestable until it was extracted. Untested, the claim "two producers,
  // one writer, each replaces only its OWN rows" could be neutered with the
  // whole repo suite green — and the damage lands on the NEXT run of the other
  // producer, which would delete every vendored family's rows and, through the
  // prune, their bytes.
  // The producers are untyped .mjs, so the writer's rows come back as `any`;
  // this is the shape they carry.
  type Row = { cacheKey: string; fileid: string; path: string; family: string };
  const row = (cacheKey: string, family: string, fileid = cacheKey.split("/")[1]): Row => ({
    cacheKey,
    fileid,
    path: `/swiftlatex/texbundle/${fileid}`,
    family,
  });
  const rowsOf = (v: unknown): Row[] => v as Row[];

  it("render -> parse round-trips exactly, escaping included", () => {
    // readManifestTs regexes generated TypeScript, so a row shape it cannot
    // read comes back as [] and the very next write wipes every other family.
    const rows = [
      row("26/plain.sty", "core"),
      { cacheKey: `26/q"uote.sty`, fileid: `q"uote.sty`, path: `/x/q"uote.sty`, family: "a" },
      { cacheKey: "26/back\\slash.sty", fileid: "back\\slash.sty", path: "/x/b", family: "b" },
    ];
    expect(parseManifestRows(renderManifestTs(rows))).toEqual(rows);
  });

  it("a row written before the `family` column existed reads as `core`", () => {
    const legacy = `  { cacheKey: "26/old.sty", fileid: "old.sty", path: "/p/old.sty" },`;
    expect(parseManifestRows(legacy)).toEqual([
      { cacheKey: "26/old.sty", fileid: "old.sty", path: "/p/old.sty", family: "core" },
    ]);
  });

  it("a producer replaces its OWN rows and carries every other family's through", () => {
    const existing = [row("26/a.sty", "A"), row("26/b.sty", "B"), row("26/b2.sty", "B")];
    const merged = rowsOf(mergeFamilyRows(existing, "A", [row("26/a2.sty", "A")]).merged);
    expect(merged.map((r) => r.cacheKey).sort()).toEqual(["26/a2.sty", "26/b.sty", "26/b2.sty"]);
    // A's old row is gone (its closure shrank); B is untouched.
    expect(merged.filter((r) => r.family === "B")).toHaveLength(2);
  });

  it("one cacheKey has one owner — a later producer cannot steal a claimed key", () => {
    const existing = [row("26/shared.sty", "A")];
    const res = mergeFamilyRows(existing, "B", [row("26/shared.sty", "B"), row("26/mine.sty", "B")]);
    expect(res.rejected).toBe(1);
    expect(rowsOf(res.kept).map((r) => r.cacheKey)).toEqual(["26/mine.sty"]);
    expect(rowsOf(res.merged).find((r) => r.cacheKey === "26/shared.sty")!.family).toBe("A");
  });

  it("the prune set is the MERGED fileids, never this family's alone", () => {
    // The thing that stops one producer deleting another family's BYTES. Two
    // cacheKeys legitimately share one file, so the survivor set is keyed on
    // fileid across the whole merge.
    const existing = [row("26/keep.sty", "A"), row("26/dual", "A", "dual.tex")];
    const { liveFileids } = mergeFamilyRows(existing, "B", [row("26/dual.tex", "B", "dual.tex")]);
    expect(liveFileids.has("keep.sty"), "A's byte would have been pruned").toBe(true);
    expect(liveFileids.has("dual.tex")).toBe(true);
  });

  it("clearing a family (rows: []) removes exactly its rows", () => {
    // What `--all`'s rebuild pass depends on.
    const existing = [row("26/a.sty", "A"), row("26/b.sty", "B")];
    const { merged, liveFileids } = mergeFamilyRows(existing, "A", []);
    expect(rowsOf(merged).map((r) => r.cacheKey)).toEqual(["26/b.sty"]);
    expect(liveFileids.has("a.sty"), "the cleared family's byte is prunable").toBe(false);
  });

  it("the SW path list is deduped and scope-relative", () => {
    const { paths } = mergeFamilyRows([], "A", [
      row("26/dual", "A", "dual.tex"),
      row("26/dual.tex", "A", "dual.tex"),
    ]);
    expect(paths).toEqual(["swiftlatex/texbundle/dual.tex"]);
  });
});
