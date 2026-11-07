// Task 1515 — **an `onFontReady` registration is disposed, by construction.**
//
// `onFontReady` (src/lib/text-metrics.ts) arms ONE persistent `loadingdone`
// listener that is never disarmed and keeps its callbacks in a Set that is
// never cleared. Each callback is a closure that transitively pins its editor
// graph, so leak-safety rests ENTIRELY on every registrant calling the
// disposer `onFontReady` returns. That contract used to be held by a sentence
// counting the callers ("both current callers invoke theirs") — a hand count
// that was already wrong (there were four) when this census replaced it.
//
// The census source-walks every production module under `src/` and requires
// each `onFontReady(` call to take one of the two shapes that dispose:
//
//   1. RETURNED as a `useEffect` cleanup — `useEffect(() => onFontReady(…), …)`;
//   2. BOUND to a `const` whose name is then CALLED (`name();`) in the same
//      module — the effect/start closure's cleanup invoking it.
//
// Anything else — a discarded return value, a `let` rebound later, an aliased
// import that hides the name from this walk — fails, naming the site.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { codeOnly, codeOnlyLines, walkFiles } from "./_source-scan";

const SRC = join(process.cwd(), "src");
const DEFINER = join(SRC, "lib", "text-metrics.ts");

function productionFiles(): string[] {
  return walkFiles(SRC, { skipDirs: ["__tests__"] }).filter(
    (p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && p !== DEFINER,
  );
}

interface Site {
  file: string;
  line: number;
  shape: "effect-return" | "bound-and-called" | "UNDISPOSED";
  detail: string;
}

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split("\n").length;
}

/** Classify every `onFontReady(` call in one module's code (comments and
 *  strings already blanked, line-aligned). */
function classifyFontReadySites(code: string, file: string): Site[] {
  const sites: Site[] = [];
  const re = /\bonFontReady\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const before = code.slice(Math.max(0, m.index - 200), m.index);
    const line = lineOf(code, m.index);
    if (/\buseEffect\s*\(\s*\(\s*\)\s*=>\s*$/.test(before)) {
      sites.push({ file, line, shape: "effect-return", detail: "useEffect(() => onFontReady(…))" });
      continue;
    }
    const bound = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before);
    if (bound) {
      const name = bound[1];
      const rest = code.slice(m.index);
      const called = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}\\s*\\(\\s*\\)\\s*;`).test(rest);
      sites.push({
        file,
        line,
        shape: called ? "bound-and-called" : "UNDISPOSED",
        detail: called ? `const ${name} … ${name}();` : `const ${name} is never called`,
      });
      continue;
    }
    sites.push({ file, line, shape: "UNDISPOSED", detail: "return value is not a useEffect cleanup or a called const" });
  }
  return sites;
}

describe("onFontReady — the disposal CENSUS", () => {
  const files = productionFiles();
  const sites = files.flatMap((f) =>
    classifyFontReadySites(codeOnlyLines(readFileSync(f, "utf8")), relative(process.cwd(), f)),
  );

  it("finds a non-empty population (the walk is not vacuous)", () => {
    expect(sites.length).toBeGreaterThan(0);
  });

  it("every production registration disposes (effect-return or bound-and-called)", () => {
    const bad = sites
      .filter((s) => s.shape === "UNDISPOSED")
      .map((s) => `${s.file}:${s.line} — ${s.detail}`);
    expect(bad, "an onFontReady registration whose disposer is dropped leaks its editor graph forever").toEqual([]);
  });

  it("no module imports onFontReady under an alias (which would hide it from this walk)", () => {
    const aliased = files
      .filter((f) => /\bonFontReady\s+as\s+\w/.test(codeOnly(readFileSync(f, "utf8"))))
      .map((f) => relative(process.cwd(), f));
    expect(aliased).toEqual([]);
  });

  it("the classifier has teeth", () => {
    const shapes = (src: string) => classifyFontReadySites(src, "x.ts").map((s) => s.shape);
    expect(shapes("useEffect(() => onFontReady(() => tick()), []);")).toEqual(["effect-return"]);
    expect(shapes("const d = onFontReady(cb);\nreturn () => { d(); };")).toEqual(["bound-and-called"]);
    expect(shapes("onFontReady(cb);")).toEqual(["UNDISPOSED"]);
    expect(shapes("const d = onFontReady(cb);\nreturn () => {};")).toEqual(["UNDISPOSED"]);
    expect(shapes("let d = onFontReady(cb);\nd();")).toEqual(["UNDISPOSED"]);
    expect(shapes("useEffect(() => { onFontReady(cb); }, []);")).toEqual(["UNDISPOSED"]);
  });
});
