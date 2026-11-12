/**
 * ATOM-DISPLAY DOOR CENSUS (task 2026-11-12-1584).
 *
 * "What does this citation / `\ref` display in a card body?" had three
 * answers — T1 static adopted "??", the T2 read-only twin never refreshed
 * `\ref`, T3 RichTextField refused "??" — because each tier carried its own
 * JSON walk rewriting `displayText`. Now ONE door owns it,
 * `refreshAtomDisplay` in `src/lib/borrowed-render.ts`, read by all three.
 *
 * This census keeps a fourth copy from appearing: no shipped source file but
 * the door may rewrite an atom's `displayText` in JSON (`...attrs,
 * displayText:` — the walker's signature shape). Route it through the door.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { codeOnly, trackedFiles, REPO_ROOT } from "./_source-scan";

const DOOR = "src/lib/borrowed-render.ts";

/** The MAIN document's `\ref` numberer — a different question (the main doc
 *  owns its headings/examples, and both read `resolveRefDisplay`, the ONE
 *  label resolver in `@/lib/ref-display`). Not card-body display refresh. */
const MAIN_DOC_NUMBERER: ReadonlySet<string> = new Set([
  "src/lib/latex-parser.ts", // parse-time ref numbering
  "src/lib/editor-extensions.ts", // the doc-level ref-display pass
]);

/** A JSON-content rewrite of an atom's display text. */
const REWRITE = /\.\.\.\s*[\w.]*attrs\s*,\s*displayText\s*:/;

describe("atom-display door CENSUS", () => {
  it("the detector flags the retired walker shape", () => {
    expect(REWRITE.test(`return { ...node, attrs: { ...node.attrs, displayText: desired } };`)).toBe(true);
    expect(REWRITE.test(`attrs: { command, displayText: "" }`)).toBe(false);
  });

  it("only the door rewrites an atom's displayText", () => {
    const offenders = trackedFiles("src", /\.(ts|tsx)$/)
      .map((abs) => path.relative(REPO_ROOT, abs))
      .filter((rel) => !rel.includes("__tests__") && rel !== DOOR && !MAIN_DOC_NUMBERER.has(rel))
      .filter((rel) => REWRITE.test(codeOnly(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"))));
    expect(offenders, "route displayText refresh through refreshAtomDisplay").toEqual([]);
    // The door and every exemption still carry the shape (a stale entry fails).
    for (const rel of [DOOR, ...MAIN_DOC_NUMBERER]) {
      expect(REWRITE.test(codeOnly(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"))), rel).toBe(true);
    }
  });
});
