/**
 * Task 1153 — the deploy publishes its own version, derived from package.json.
 *
 * The Virgil page on Gabriel's website reads `/virgil/version.json` rather than
 * a hand-edited string, so a release bumps exactly one thing: package.json.
 * These legs outlaw a second copy that can drift:
 *   1. THE STATEMENT — `version` is package.json's verbatim; `builtAt` is ISO;
 *      `commit` only when CI supplies it.
 *   2. THE WIRING — `npm run build`'s postbuild emits it as its LAST step
 *      (after the service-worker stamp), the deploy builds through it, and no
 *      second producer (a deploy-only step, a committed `public/version.json`)
 *      exists beside it.
 *   3. THE WORKER — emitted after the stamp, the file is outside the stamp's
 *      hash (so `builtAt` never announces a no-op rebuild as an update) and
 *      outside the precache (so the network-first runtime path reads the NEW
 *      version after a release).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  VERSION_FILE,
  emitVersionJson,
  versionStatement,
} from "../../../scripts/emit-version-json.mjs";
import { stampServiceWorker } from "../../../scripts/stamp-service-worker.mjs";

const REPO = path.resolve(__dirname, "../../..");
const PKG = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));

const tmpDirs: string[] = [];
function tmpOut(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "virgil-version-json-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("leg 1 — the statement", () => {
  it("is package.json's version, verbatim, with an ISO builtAt", () => {
    const now = new Date("2026-10-16T12:00:00.000Z");
    expect(versionStatement({ version: "1.2.3" }, { now, env: {} })).toEqual({
      version: "1.2.3",
      builtAt: "2026-10-16T12:00:00.000Z",
    });
  });

  it("carries the CI commit when GitHub Actions supplies one, and only then", () => {
    const s = versionStatement({ version: "1.2.3" }, { env: { GITHUB_SHA: "abc123" } });
    expect(s.commit).toBe("abc123");
    expect("commit" in versionStatement({ version: "1.2.3" }, { env: {} })).toBe(false);
  });

  it("refuses a package.json without a version rather than publishing a blank", () => {
    expect(() => versionStatement({} as { version: string })).toThrow(/no version/);
  });

  it("writes out/version.json from THIS repo's package.json", () => {
    const out = tmpOut();
    emitVersionJson(out, { env: {} });
    const written = JSON.parse(fs.readFileSync(path.join(out, VERSION_FILE), "utf8"));
    expect(written.version).toBe(PKG.version);
    expect(Number.isNaN(Date.parse(written.builtAt))).toBe(false);
  });
});

describe("leg 2 — the wiring (one producer)", () => {
  it("postbuild emits version.json as its LAST step, after the stamp", () => {
    const steps = PKG.scripts.postbuild.split(" && ");
    expect(steps[0]).toBe("node scripts/stamp-service-worker.mjs");
    expect(steps[steps.length - 1]).toBe("node scripts/emit-version-json.mjs");
  });

  it("the deploy builds through npm run build and writes no version.json of its own", () => {
    const deploy = fs.readFileSync(path.join(REPO, ".github/workflows/deploy.yml"), "utf8");
    expect(deploy).toMatch(/run: npm run build\b/);
    expect(deploy).not.toMatch(/>\s*out\/version\.json/);
    expect(deploy).not.toMatch(/require\(["']\.\/package\.json["']\)\.version/);
  });

  it("no hand-maintained copy is committed into public/", () => {
    expect(fs.existsSync(path.join(REPO, "public", VERSION_FILE))).toBe(false);
  });
});

describe("leg 3 — the worker never pins it", () => {
  it("is outside the stamp and the precache", () => {
    const out = tmpOut();
    fs.writeFileSync(path.join(out, "index.html"), "<html></html>");
    fs.writeFileSync(
      path.join(out, "sw.js"),
      'const BUILD_STAMP = "__VIRGIL_BUILD_STAMP__";\nconst BUILD_PRECACHE = /*__VIRGIL_BUILD_PRECACHE__*/ [];\n',
    );
    const { precache } = stampServiceWorker(out);
    const stampedSw = fs.readFileSync(path.join(out, "sw.js"), "utf8");
    emitVersionJson(out, { env: {} });

    expect(precache.map(([p]) => p)).not.toContain(`./${VERSION_FILE}`);
    // The emit touches nothing the stamp produced.
    expect(fs.readFileSync(path.join(out, "sw.js"), "utf8")).toBe(stampedSw);
  });
});
