// Task 365 — every URL that reaches a `public/` asset goes through ONE door.
//
// The reported bug was the Library PDF tab rendering GitHub's 404 page inside
// the pane: `PdfView`'s `VIEWER_SRC` was the root-absolute literal
// "/pdfjs/web/viewer.html?file=", while production deploys under
// `NEXT_PUBLIC_BASE_PATH=/virgil`, so the iframe requested `<origin>/pdfjs/…` —
// outside the app entirely. The convention EXISTED and had six adopters; this
// was the seventh consumer, and it forked. An eighth (`layout.tsx`'s
// `apple-touch-icon` <link>) had forked the same way and 404'd the iOS
// home-screen icon with no symptom anyone would report.
//
// Nothing about this is a type error, and NOTHING reproduces in dev: with an
// empty basePath a root-absolute string is accidentally correct, which is
// exactly why both shipped. So the guard is a CENSUS, not a unit test of the
// door: `publicAssetUrl` was never the part that could misbehave — a call site
// that never asks it is, and that call site type-checks perfectly.
//
// Legs:
//   1. CENSUS      — no production file in src/ or library/ writes a
//                    root-absolute literal naming a `public/` root OUTSIDE a
//                    `publicAssetUrl(...)` argument. Membership is DISCOVERED
//                    (the real `public/` tree ∪ the dirs the build scripts emit
//                    into it) — a hand list could only be missing a name, and
//                    two of the roots (`examples`, `skill-bundle`) do not even
//                    exist in a fresh checkout because they are build output.
//   1b. SHAPE-SCOPED EXEMPTION — an allowlisted DATA table must name no
//                    URL-consuming API, so the exemption cannot silently cover
//                    a `fetch` added there later.
//   2. POSITIVE TWIN — every consumer that still reaches a public asset imports
//                    the door, so its silence in leg 1 is "derived", not "no
//                    longer involved".
//   3. CANARY      — the needle demonstrably fires, on a synthetic source and
//                    on the pre-365 literal; plus a stripper swallow check.
//   4. DOOR        — `publicAssetUrl` under BOTH deploy regimes, including the
//                    scope form and the byte-identity of the root-deploy answer
//                    (which is what makes folding the six copies on a no-op).
//   5. DEFECT LEG  — the REAL `PdfView` module, imported under a `/virgil`
//                    basePath, resolves its viewer INSIDE the app. This is the
//                    leg that fails on the pre-365 tree.
//   7. BUILD SMOKE — an OPT-IN leg over a real `NEXT_PUBLIC_BASE_PATH=/virgil`
//                    export (`npm run preview:pages` leaves one in `out/`).
//                    It is the only leg that can see whether Next's define
//                    actually INLINED the prefix, which is the one thing a unit
//                    test structurally cannot: get that wrong and every leg
//                    above still passes while production serves `""`. Skips
//                    when no basePath build is present.
//   6. THE SW HALF — the same law across the runtime boundary. `public/sw.js`
//                    resolves its precache manifest against its OWN SCOPE, so a
//                    leading slash escapes to the origin root: under /virgil
//                    every TeX asset 404'd at install, swallowed by the SW's
//                    per-asset catch — no offline compile, no error, no symptom
//                    until the user went offline. The table is emitted relative
//                    at the generator AND normalized defensively in the SW; the
//                    leg drives the REAL `new URL` resolution both ways.
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly, commentsStripped } from "./_source-scan";
import { appBasePath, publicAssetUrl } from "@/lib/public-asset-url";

const REPO = path.resolve(__dirname, "../../..");
const SILOS = ["src", "library"] as const;
const DOOR = "src/lib/public-asset-url.ts";

/**
 * Files permitted to spell a root-absolute public-asset path, each with WHY.
 * A hit that is not on this list is WIRE-it (route the string through
 * `publicAssetUrl`) — never a new entry unless the file genuinely holds DATA
 * whose consumer prefixes elsewhere. Leg 1b scopes each exemption to that
 * shape rather than to the file, so a `fetch` added beside the table is
 * flagged even though the file is listed.
 */
const PERMITTED_ROOT_ABSOLUTE_ASSET_PATHS: Record<string, string> = {
  // DATA TABLE, not a consumer. `CORE_MANIFEST` records each curated TeX
  // asset's path WITHIN public/; the single consumer (`tex-assets.ts`'s
  // `fetchBundledBytes`) applies the deploy prefix through the door. Keeping
  // the table root-relative is what lets the same rows describe both deploys.
  "src/lib/tex-core-manifest.ts": "data table of public-relative paths; its one consumer prefixes",
};

/** Every consumer that still builds a URL to a `public/` asset. Leg 2. */
const DOOR_CONSUMERS = [
  "src/app/layout.tsx",
  "src/app/manifest.ts",
  "src/components/ServiceWorkerRegistration.tsx",
  "src/lib/swiftlatex.ts",
  "src/lib/tex-assets.ts",
  "src/lib/example-doc/example-seeder.ts",
  "library/lib/skill-sync.ts",
  "library/components/PdfView.tsx",
];

/** APIs that turn a string into a request. Leg 1b's shape scope. */
const URL_CONSUMING = /\bfetch\s*\(|new\s+URL\s*\(|\.src\s*=|importScripts\s*\(|XMLHttpRequest|\bimport\s*\(/;

// ---------------------------------------------------------------------------
// Membership — DISCOVERED, never hand-listed.
// ---------------------------------------------------------------------------

/**
 * The top-level names served out of `public/`. Two sources, unioned, because
 * neither alone is complete: the directory itself misses `examples/` and
 * `skill-bundle/`, which are BUILD OUTPUT (`scripts/build-example-bundle.mjs`,
 * `scripts/build-meta-bundle.mjs`) and absent from a fresh checkout — the very
 * two whose consumers a hand list would therefore have been most likely to
 * leave uncensused.
 */
function publicRoots(): string[] {
  const roots = new Set<string>();
  const dir = path.join(REPO, "public");
  if (fs.existsSync(dir)) for (const e of fs.readdirSync(dir)) roots.add(e);
  for (const scriptsDir of ["scripts", "tools"]) {
    const full = path.join(REPO, scriptsDir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      if (!/\.m?js$/.test(f)) continue;
      const src = fs.readFileSync(path.join(full, f), "utf8");
      for (const m of src.matchAll(/public\/([A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)?)/g)) {
        roots.add(m[1]);
      }
    }
  }
  return [...roots].sort((a, b) => b.length - a.length);
}

/** `"/pdfjs…` / `'/sw.js'` / `` `/skill-bundle/…` `` — a root-absolute literal
 *  whose first segment is a public root. */
function assetNeedle(): RegExp {
  const alt = publicRoots().map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`["'\`]/(?:${alt})(?=[/"'\`?])`);
}

/**
 * Blank out every `publicAssetUrl(...)` ARGUMENT, so the census asks the one
 * question that matters: is this literal reaching the door? The literal itself
 * is the asset's NAME and belongs at the call site — what must never happen is
 * one travelling anywhere else.
 */
function withoutDoorArguments(code: string): string {
  const CALL = "publicAssetUrl(";
  let out = "";
  let i = 0;
  for (;;) {
    const at = code.indexOf(CALL, i);
    if (at === -1) {
      out += code.slice(i);
      return out;
    }
    out += code.slice(i, at + CALL.length);
    let depth = 1;
    let j = at + CALL.length;
    while (j < code.length && depth > 0) {
      if (code[j] === "(") depth++;
      else if (code[j] === ")") depth--;
      if (depth === 0) break;
      j++;
    }
    out += "ASSET";
    i = j;
  }
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function censusFiles(): string[] {
  const files: string[] = [];
  for (const silo of SILOS) walk(path.join(REPO, silo), files);
  return files
    .map((f) => path.relative(REPO, f))
    .filter((rel) => rel !== DOOR)
    .sort();
}

/** Code view: comments gone, string literals KEPT (the drift lives in the
 *  literals), door arguments blanked. */
function censusView(rel: string): string {
  return withoutDoorArguments(
    commentsStripped(fs.readFileSync(path.join(REPO, rel), "utf8")),
  );
}

// ---------------------------------------------------------------------------

describe("public-asset URLs — census (leg 1)", () => {
  const needle = assetNeedle();
  const hits = censusFiles().filter((rel) => needle.test(censusView(rel)));

  it("nothing outside the door writes a root-absolute public-asset URL", () => {
    const unlisted = hits.filter((h) => !(h in PERMITTED_ROOT_ABSOLUTE_ASSET_PATHS));
    expect(unlisted).toEqual([]);
  });

  it("the allowlist can only shrink — every entry is still a real hit", () => {
    for (const listed of Object.keys(PERMITTED_ROOT_ABSOLUTE_ASSET_PATHS)) {
      expect(hits, `${listed} no longer spells one — drop its entry`).toContain(listed);
    }
  });

  it("an exemption is scoped to the DATA shape it justifies (leg 1b)", () => {
    // A file-scoped exemption would excuse a `fetch` added beside the table.
    for (const listed of Object.keys(PERMITTED_ROOT_ABSOLUTE_ASSET_PATHS)) {
      const code = codeOnly(fs.readFileSync(path.join(REPO, listed), "utf8"));
      expect(
        URL_CONSUMING.test(code),
        `${listed} is exempt as DATA but now consumes a URL — it is a call site`,
      ).toBe(false);
    }
  });

  it("membership is discovered, and covers the build-generated roots", () => {
    const roots = publicRoots();
    // `pdfjs` ships in the tree; `examples` / `skill-bundle` exist only after a
    // build — all three must be censused whichever state the checkout is in.
    for (const r of ["pdfjs", "swiftlatex", "sw.js", "examples", "skill-bundle"]) {
      expect(roots, `public root "${r}" is not discovered`).toContain(r);
    }
  });
});

describe("public-asset URLs — positive twin (leg 2)", () => {
  it("every consumer reads the door rather than its own copy", () => {
    for (const rel of DOOR_CONSUMERS) {
      const src = fs.readFileSync(path.join(REPO, rel), "utf8");
      expect(src, rel).toContain("public-asset-url");
    }
  });

  it("only the door reads NEXT_PUBLIC_BASE_PATH", () => {
    // The prefix is spelled ONCE. A second reader is a second copy of the three
    // lines this task deleted six of.
    const readers = censusFiles().filter((rel) =>
      codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8")).includes(
        "NEXT_PUBLIC_BASE_PATH",
      ),
    );
    expect(readers).toEqual([]);
  });
});

describe("public-asset URLs — canary (leg 3)", () => {
  const needle = assetNeedle();

  it("the needle fires on the pre-365 literal and on a synthetic fork", () => {
    expect(needle.test(withoutDoorArguments(`const V = "/pdfjs/web/viewer.html?file=";`))).toBe(true);
    expect(needle.test(withoutDoorArguments(`fetch("/skill-bundle/manifest.json")`))).toBe(true);
    expect(needle.test(withoutDoorArguments("const u = `/examples/${id}/main.tex`;"))).toBe(true);
  });

  it("the needle does NOT fire on a literal that reaches the door", () => {
    expect(
      needle.test(withoutDoorArguments(`const V = publicAssetUrl("/pdfjs/web/viewer.html?file=");`)),
    ).toBe(false);
    expect(
      needle.test(withoutDoorArguments("const u = publicAssetUrl(`/examples/${id}/main.tex`);")),
    ).toBe(false);
  });

  it("the needle ignores an unrelated root-absolute path", () => {
    expect(needle.test(withoutDoorArguments(`const p = "/virgil/notes.json";`))).toBe(false);
  });

  it("the stripper does not swallow the file (self-check)", () => {
    const raw = fs.readFileSync(path.join(REPO, "src/lib/tex-core-manifest.ts"), "utf8");
    const decls = (s: string) => (s.match(/\bexport\s+(const|function|interface|type)\b/g) ?? []).length;
    expect(decls(commentsStripped(raw))).toBe(decls(raw));
  });
});

describe("publicAssetUrl — the door (leg 4)", () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_BASE_PATH;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = ORIGINAL;
    vi.resetModules();
  });

  it("at the origin root it is byte-identical to the pre-365 literals", () => {
    // This is what makes folding the six hand-rolled copies onto it a no-op in
    // dev and in every non-basePath deploy.
    expect(appBasePath()).toBe("");
    expect(publicAssetUrl("/pdfjs/web/viewer.html?file=")).toBe("/pdfjs/web/viewer.html?file=");
    expect(publicAssetUrl("/swiftlatex/PdfTeXEngine.js")).toBe("/swiftlatex/PdfTeXEngine.js");
    expect(publicAssetUrl("/icon-192x192.png?v=7")).toBe("/icon-192x192.png?v=7");
    expect(publicAssetUrl("/skill-bundle/manifest.json")).toBe("/skill-bundle/manifest.json");
  });

  it("answers the app ROOT for the scope form", () => {
    expect(publicAssetUrl("/")).toBe("/");
    expect(publicAssetUrl("")).toBe("/");
  });

  it("normalizes a missing leading slash", () => {
    expect(publicAssetUrl("pdfjs/web/viewer.html")).toBe("/pdfjs/web/viewer.html");
  });

  /** The door reads the env var ONCE at module scope (that is the point — one
   *  read, not one per call site), so a deploy regime is exercised by resetting
   *  the module registry and re-importing. */
  async function underBasePath(value: string) {
    process.env.NEXT_PUBLIC_BASE_PATH = value;
    vi.resetModules();
    return (await import("@/lib/public-asset-url")) as typeof import("@/lib/public-asset-url");
  }

  it("prefixes every asset under a subdirectory deploy", async () => {
    const { publicAssetUrl: url, appBasePath: base } = await underBasePath("/virgil");
    expect(base()).toBe("/virgil");
    expect(url("/pdfjs/web/viewer.html?file=")).toBe("/virgil/pdfjs/web/viewer.html?file=");
    expect(url("/sw.js")).toBe("/virgil/sw.js");
    expect(url("/")).toBe("/virgil/");
    expect(url("")).toBe("/virgil/");
  });

  it("tolerates a hand-set trailing slash rather than doubling it", async () => {
    // Next requires basePath to carry none, but six hand-rolled copies would
    // each have produced `/virgil//pdfjs/…`. The door normalizes once.
    const { publicAssetUrl: url } = await underBasePath("/virgil/");
    expect(url("/pdfjs/web/viewer.html")).toBe("/virgil/pdfjs/web/viewer.html");
    expect(url("/")).toBe("/virgil/");
  });
});

describe("PdfView viewer src — the defect leg (leg 5)", () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_BASE_PATH;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = ORIGINAL;
    vi.resetModules();
  });

  it("resolves INSIDE the app under a subdirectory deploy", async () => {
    // The reported bug, driven through the REAL module: pre-365 this answered
    // "/pdfjs/web/viewer.html?file=", which under /virgil is a URL outside the
    // app and rendered the host's 404 page inside the pane.
    process.env.NEXT_PUBLIC_BASE_PATH = "/virgil";
    vi.resetModules();
    const { VIEWER_SRC } = await import("@library/components/PdfView");
    expect(VIEWER_SRC).toBe("/virgil/pdfjs/web/viewer.html?file=");
  });

  it("keeps the trailing empty ?file= that suppresses pdf.js's sample-PDF open", async () => {
    // Non-regression: the query string is load-bearing (see PdfView's header).
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    vi.resetModules();
    const { VIEWER_SRC } = await import("@library/components/PdfView");
    expect(VIEWER_SRC).toBe("/pdfjs/web/viewer.html?file=");
  });
});

describe("the service-worker half (leg 6)", () => {
  const SCOPE = "https://site.example/virgil/sw.js";

  /** The SW's own resolution, verbatim from `public/sw.js`'s precache loop —
   *  including the defensive strip this task added. Driven here rather than
   *  restated: the two must not be able to disagree. */
  function swResolve(p: string): string {
    const source = fs.readFileSync(path.join(REPO, "public/sw.js"), "utf8");
    const m = source.match(/const url = new URL\((.+?), self\.location\.href\)\.href;/);
    expect(m, "the SW precache resolution moved — re-read this leg").toBeTruthy();
    const expr = m![1].replace(/\bp\b/g, "ARG");
    return new Function("ARG", "URL", `return new URL(${expr}, ${JSON.stringify(SCOPE)}).href;`)(
      p,
      URL,
    ) as string;
  }

  it("a scope-relative manifest entry precaches INSIDE the deploy", () => {
    expect(swResolve("swiftlatex/texbundle/amsmath.sty")).toBe(
      "https://site.example/virgil/swiftlatex/texbundle/amsmath.sty",
    );
  });

  it("a leading slash is normalized rather than escaping to the origin root", () => {
    // Pre-365 this answered https://site.example/swiftlatex/… — outside the
    // app, 404, swallowed by the SW's per-asset catch.
    expect(swResolve("/swiftlatex/texbundle/amsmath.sty")).toBe(
      "https://site.example/virgil/swiftlatex/texbundle/amsmath.sty",
    );
  });

  it("the shipped precache manifest is scope-relative", () => {
    const rel = "public/swiftlatex/texbundle/manifest.json";
    const full = path.join(REPO, rel);
    if (!fs.existsSync(full)) return; // build output; a lighter checkout has none
    const { paths } = JSON.parse(fs.readFileSync(full, "utf8")) as { paths: string[] };
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => p.startsWith("/"))).toEqual([]);
  });

  it("the SW list is emitted through its own spelling, by ONE writer", () => {
    // The two tables have consumers with DIFFERENT bases, so one spelling for
    // both is the defect. `swPath` is where that is stated.
    //
    // RENEGOTIATED (task 520): this leg used to read build-tex-bundle.mjs,
    // which was then the only producer AND its own writer. There are two
    // producers now (the live capture, and the declared-family vendorer), so
    // the claim moved UP to the shared writer they both go through rather than
    // being deleted — a wrapper relocates an obligation to its callers, it
    // never absorbs one, and a census that keeps grepping the old file simply
    // drains to nothing while the rule it guards goes unenforced.
    const WRITER = "scripts/lib/tex-bundle-manifest.mjs";
    const writer = codeOnly(fs.readFileSync(path.join(REPO, WRITER), "utf8"));
    expect(writer).toContain("export const swPath =");
    // Every path that reaches the SW manifest is stripped by it.
    for (const m of writer.matchAll(/paths\s*=\s*\[[^\]]*\]/g))
      expect(m[0], "a SW path assembled without swPath()").toContain("swPath(");
    expect(writer).toMatch(/writeFile\(\s*bundleManifestJsonPath/);

    // …and the producers do not write either table themselves.
    for (const producer of ["scripts/build-tex-bundle.mjs", "scripts/vendor-tex-family.mjs"]) {
      const src = codeOnly(fs.readFileSync(path.join(REPO, producer), "utf8"));
      expect(src, `${producer} must go through the shared writer`).toContain("writeBundle(");
      expect(src, `${producer} spells its own SW strip`).not.toContain("swPath =");
      expect(src, `${producer} writes the SW manifest itself`).not.toMatch(
        /writeFile\(\s*bundleManifestJsonPath/,
      );
    }
  });
});

describe("basePath build smoke (leg 7)", () => {
  // OPT-IN: needs `NEXT_PUBLIC_BASE_PATH=/virgil npx next build` (or
  // `npm run preview:pages`) to have left an export in `out/`. Everything above
  // proves the SOURCE is right; only this proves the BUILD carries it — the
  // define matches a bare `process.env.X` member expression and NOT every
  // spelling of it, so a "safer-looking" refactor of the door's env read can
  // silently ship `""` to production with the whole suite green. That is the
  // failure mode of the bug itself, one layer down.
  const OUT = path.join(REPO, "out");
  const built = fs.existsSync(path.join(OUT, "manifest.webmanifest"));

  function chunkText(): string {
    const dir = path.join(OUT, "_next/static/chunks");
    if (!fs.existsSync(dir)) return "";
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
  }

  it.skipIf(!built)("the manifest and the icon link carry the prefix", () => {
    const manifest = fs.readFileSync(path.join(OUT, "manifest.webmanifest"), "utf8");
    const m = JSON.parse(manifest) as { scope: string; start_url: string; icons: { src: string }[] };
    const prefix = m.scope.replace(/\/$/, "");
    if (!prefix) return; // built at the origin root — nothing to assert
    expect(m.start_url).toBe(`${prefix}/`);
    for (const i of m.icons) expect(i.src.startsWith(`${prefix}/`)).toBe(true);
    expect(fs.readFileSync(path.join(OUT, "index.html"), "utf8")).toContain(
      `href="${prefix}/apple-touch-icon.png`,
    );
  });

  it.skipIf(!built)("the door's env read was INLINED, not left as a runtime branch", () => {
    const manifest = fs.readFileSync(path.join(OUT, "manifest.webmanifest"), "utf8");
    const prefix = (JSON.parse(manifest) as { scope: string }).scope.replace(/\/$/, "");
    if (!prefix) return;
    const js = chunkText();
    expect(js, "no client chunk mentions publicAssetUrl").toContain("publicAssetUrl");
    // The compiled door must hold the prefix as a LITERAL. A guarded read
    // compiles to `void 0 !== shim.default && "/virgil" || ""` — whose false
    // branch is the bug — so the bare literal is what we pin.
    expect(js).toContain(`"${prefix}".replace(`);
    expect(js, "the env name survived into the bundle — the define did not match").not.toMatch(
      /process\.env\s*[.?[]\s*"?NEXT_PUBLIC_BASE_PATH/,
    );
  });
});
