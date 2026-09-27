import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Task 791 — a field on `Floatable` is a promise to the float subsystem, and a
 * promise is kept only if something READS it.
 *
 * `canRedock?: boolean` sat on the contract ("whether the window participates
 * in the panel dock flow") with no builder setting it and no reader consulting
 * it — panels redock through their own chrome, cards and text objects never
 * dock. A reader of the type would conclude a dock flow existed for floats.
 * Same law as `card-float-ctx-honesty.test.ts` (task 436), on the OTHER side of
 * the seam: that census asks whether the ctx bag a builder receives is read;
 * this one asks whether the description a builder RETURNS is.
 *
 * The keys are parsed off the interface itself, and the readers are the float
 * subsystem's own runtime modules (every non-test file in `src/floats/` except
 * the declaring `types.ts`) — so a new field joins the census the moment it is
 * declared, and a new reader module is seen without editing a list.
 */

const FLOATS = join(__dirname, "..");

function floatableKeys(): string[] {
  const src = readFileSync(join(FLOATS, "types.ts"), "utf8");
  const start = src.indexOf("export interface Floatable {");
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  let end = start;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const body = src
    .slice(src.indexOf("{", start) + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  // Top-level members only: a line at the interface's own indentation.
  return [...body.matchAll(/^ {2}([A-Za-z_$][\w$]*)\??\s*[:(]/gm)].map((m) => m[1]);
}

function readerSources(): Array<{ file: string; text: string }> {
  return readdirSync(FLOATS)
    .filter((n) => /\.tsx?$/.test(n) && n !== "types.ts")
    .map((n) => ({ file: n, text: readFileSync(join(FLOATS, n), "utf8") }));
}

describe("Floatable field honesty (task 791)", () => {
  it("parses the real contract (non-vacuous)", () => {
    const keys = floatableKeys();
    expect(keys.length).toBeGreaterThanOrEqual(14);
    expect(keys).toEqual(expect.arrayContaining(["key", "renderBody", "jumpToSource", "canDrop"]));
  });

  it("every Floatable field is read by the float subsystem", () => {
    const readers = readerSources();
    expect(readers.map((r) => r.file)).toEqual(
      expect.arrayContaining(["FloatWindow.tsx", "resolve-floatable.ts"]),
    );
    const unread = floatableKeys().filter(
      (k) => !readers.some((r) => new RegExp(`\\.${k}\\b`).test(r.text)),
    );
    expect(unread).toEqual([]);
  });

  it("the retired dock field stays retired", () => {
    expect(floatableKeys()).not.toContain("canRedock");
  });
});
