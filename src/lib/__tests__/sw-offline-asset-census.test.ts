/**
 * Task 1284 — CENSUS: every runtime entry of `public/` is CLASSIFIED for the
 * service worker, and the TeX ENGINE is precached alongside the TeX DATA.
 *
 * The precache used to be a hand list (`ASSET_PRECACHE`: the base .fmt + the
 * dictionary) that nothing reconciled against what the app loads. It held the
 * .fmt and the texbundle but not the three files the engine itself runs —
 * `PdfTeXEngine.js` (a <script>), `swiftlatexpdftex.js` (the Worker) and
 * `swiftlatexpdftex.wasm` — so a fresh install that went offline before its
 * first compile, or a user who compiled under build N and then took two
 * deploys, had every data byte in hand and a dead compile.
 *
 * Legs:
 *   1. every top-level `public/` entry has a row in `PUBLIC_ASSET_CLASSES`, and
 *      no row names an entry that is gone (a `generated` row may be absent —
 *      the build writes it, gitignored);
 *   2. every file under `public/swiftlatex/` outside `texbundle/` (which its
 *      manifest owns) classifies precache — and the paths the engine loads
 *      (named in source) are among them;
 *   3. every `publicAssetUrl("/…")` literal in app source lands in a classified
 *      entry — a new runtime-loaded asset forces a decision;
 *   4. the stamper, given an export carrying the engine, lists each engine file
 *      once with its content sha; a runtime row lists nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PUBLIC_ASSET_CLASSES,
  classifyPublicPath,
  contentSha,
  precacheAssets,
  stampServiceWorker,
} from "../../../scripts/stamp-service-worker.mjs";

const REPO = path.resolve(__dirname, "../../..");
const PUBLIC = path.join(REPO, "public");

type Row = { entry: string; mode: string; why: string; generated?: boolean };
const ROWS = PUBLIC_ASSET_CLASSES as Row[];

/** Top-level `public/` names no row classifies exactly. */
function unclassified(names: string[]): string[] {
  const rows = new Set(ROWS.map((r) => r.entry));
  return names.filter((n) => !n.startsWith(".") && !rows.has(n));
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) out.push(path.relative(PUBLIC, abs).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

/** Same walk as the guard family's source scans: app code, no tests. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === "__tests__") continue;
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) out.push(abs);
    }
  };
  walk(dir);
  return out;
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("leg 1 — every top-level public/ entry is classified", () => {
  it("the table is well-formed", () => {
    for (const r of ROWS) {
      expect(["precache", "manifest", "runtime"]).toContain(r.mode);
      expect(r.why.length).toBeGreaterThan(10);
    }
    expect(new Set(ROWS.map((r) => r.entry)).size).toBe(ROWS.length);
  });

  it("no public/ entry is unclassified", () => {
    expect(unclassified(fs.readdirSync(PUBLIC))).toEqual([]);
  });

  it("no row names an entry that is gone (generated rows excepted)", () => {
    const stale = ROWS.filter(
      (r) => !r.generated && !fs.existsSync(path.join(PUBLIC, r.entry)),
    ).map((r) => r.entry);
    expect(stale).toEqual([]);
  });

  it("the census has teeth: an unclassified directory is named", () => {
    expect(unclassified(["swiftlatex", "fonts-new", ".DS_Store"])).toEqual(["fonts-new"]);
  });
});

describe("leg 2 — the TeX engine is precached with the TeX data", () => {
  it("every public/swiftlatex file outside texbundle/ classifies precache", () => {
    const loose = filesUnder(path.join(PUBLIC, "swiftlatex")).filter(
      (f) => !f.startsWith("swiftlatex/texbundle/"),
    );
    expect(loose.length).toBeGreaterThanOrEqual(4);
    const notPrecached = loose.filter((f) => classifyPublicPath(f)?.mode !== "precache");
    expect(notPrecached).toEqual([]);
  });

  it("the paths the engine loads exist and are precached", () => {
    const swiftlatex = fs.readFileSync(path.join(REPO, "src/lib/swiftlatex.ts"), "utf8");
    const engine = fs.readFileSync(path.join(PUBLIC, "swiftlatex/PdfTeXEngine.js"), "utf8");
    const worker = fs.readFileSync(path.join(PUBLIC, "swiftlatex/swiftlatexpdftex.js"), "utf8");
    const script = swiftlatex.match(/publicAssetUrl\("\/(swiftlatex\/[^"]+)"\)/)?.[1];
    const workerFile = engine.match(/'(swiftlatexpdftex\.js)'/)?.[1];
    const wasmFile = worker.match(/"(swiftlatexpdftex\.wasm)"/)?.[1];
    const loaded = [script ?? "", `swiftlatex/${workerFile}`, `swiftlatex/${wasmFile}`];
    expect(loaded).toEqual([
      "swiftlatex/PdfTeXEngine.js",
      "swiftlatex/swiftlatexpdftex.js",
      "swiftlatex/swiftlatexpdftex.wasm",
    ]);
    for (const f of loaded) {
      expect(fs.existsSync(path.join(PUBLIC, f))).toBe(true);
      expect(precacheAssets([f])).toEqual([f]);
    }
  });

  it("texbundle/ belongs to its manifest, not the prefix rule", () => {
    expect(classifyPublicPath("swiftlatex/texbundle/latex.ltx")?.mode).toBe("manifest");
    expect(precacheAssets(["swiftlatex/texbundle/latex.ltx"])).toEqual([]);
  });
});

describe("leg 3 — every publicAssetUrl literal lands in a classified entry", () => {
  it("app source names no unclassified public/ path", () => {
    // The scope root (`publicAssetUrl("/")`) is the shell, not a public/ asset.
    const literal = /publicAssetUrl\(\s*["'`]\/?([^"'`?$/][^"'`?$]*)/g;
    const named = new Set<string>();
    for (const file of [...sourceFiles(path.join(REPO, "src")), ...sourceFiles(path.join(REPO, "library"))]) {
      for (const m of fs.readFileSync(file, "utf8").matchAll(literal)) named.add(m[1]);
    }
    expect(named.size).toBeGreaterThan(3);
    const orphans = [...named].filter((p) => !classifyPublicPath(p));
    expect(orphans).toEqual([]);
  });
});

describe("leg 4 — the stamper precaches by the table", () => {
  it("lists each engine file once with its content sha; runtime rows list nothing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sw-census-"));
    tmpDirs.push(root);
    const files: Record<string, string> = {
      "index.html": "<html>shell</html>",
      "sw.js": fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8"),
      "swiftlatex/PdfTeXEngine.js": "engine",
      "swiftlatex/swiftlatexpdftex.js": "worker",
      "swiftlatex/swiftlatexpdftex.wasm": "wasm",
      "swiftlatex/swiftlatexpdftex.fmt": "fmt",
      "swiftlatex/texbundle/manifest.json": JSON.stringify(["swiftlatex/swiftlatexpdftex.fmt"]),
      "skill-bundle/bundle-manifest.json": "{}",
      "logo.png": "png",
    };
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), body);
    }
    const { precache } = stampServiceWorker(root);
    const paths = precache.map(([p]) => p);
    expect(new Set(paths).size).toBe(paths.length);
    for (const f of [
      "swiftlatex/PdfTeXEngine.js",
      "swiftlatex/swiftlatexpdftex.js",
      "swiftlatex/swiftlatexpdftex.wasm",
      "swiftlatex/swiftlatexpdftex.fmt",
    ]) {
      expect(precache).toContainEqual([`./${f}`, contentSha(Buffer.from(files[f]))]);
    }
    expect(paths).not.toContain("./skill-bundle/bundle-manifest.json");
    expect(paths).not.toContain("./logo.png");
  });
});
