// @vitest-environment node
/**
 * `_latex-output.md`'s "Compiling under stock pdflatex" block ↔ the app's
 * requirement table (task 1051). The doctrine used to end with a hand-written
 * "should also `\usepackage{expex}` themselves" — one requirement behind the
 * app: expex does not define the `xlist` environment the appendix documents
 * (gb4e did, and the appendix strips gb4e), so a nested-tier paper compiled
 * per that advice failed on "Environment xlist undefined" while the same
 * paper saved through Virgil compiled (the `xlistenv` shim).
 *
 * Now the fenced ```latex-stock-compile``` block must equal — as an exact
 * set, so it can neither lag nor over-claim — the inject lines the app's own
 * detector + registry produce for a body that spells every command in the
 * appendix's ```latex-appendix``` inventory and every `\begin{…}` environment
 * the appendix documents. The marker shims (`\vexid`, `\pgmark`, …) are out of
 * scope here: they are the "owned by whoever mints it" rule's, stated above
 * the block.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LATEX_REQUIREMENTS,
  SHIM_COMMAND_NAMES,
  detectBodyRequirements,
} from "../../../src/lib/latex-requirements";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DOCTRINE = path.join(REPO_ROOT, "library/skills/_latex-output.md");

function fenced(md: string, fence: string): string[] {
  const m = new RegExp("```" + fence + "\\n([\\s\\S]*?)```").exec(md);
  if (!m) throw new Error(`no \`\`\`${fence} fence in _latex-output.md`);
  return m[1].split("\n");
}

/** A body spelling the appendix's whole vocabulary: its command inventory
 *  plus every environment its prose documents. */
function appendixVocabularyBody(md: string): string {
  const cmds = fenced(md, "latex-appendix")
    .flatMap((line) => line.split("#")[0].split(/\s+/))
    .filter((tok) => tok.startsWith("\\"));
  const envs = new Set(
    [...md.matchAll(/\\begin\{[A-Za-z*]+\}/g)].map((m) => m[0]),
  );
  return [...cmds, ...envs].join("\n");
}

/** The lines the app injects for that body, marker shims excluded. */
function injectedLinesFor(body: string): string[] {
  const required = detectBodyRequirements(body);
  const markers = new Set(SHIM_COMMAND_NAMES);
  return LATEX_REQUIREMENTS.filter(
    (r) => required.has(r.id) && !markers.has(r.id),
  ).map((r) => r.injectLine);
}

function stockCompileLines(md: string): string[] {
  return fenced(md, "latex-stock-compile")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

describe("_latex-output.md stock-compile advice ↔ latex-requirements", () => {
  const md = readFileSync(DOCTRINE, "utf8");

  it("names exactly the lines the app injects for the appendix vocabulary", () => {
    const expected = injectedLinesFor(appendixVocabularyBody(md));
    expect(expected.length).toBeGreaterThan(0);
    expect(new Set(stockCompileLines(md))).toEqual(new Set(expected));
  });

  /** The `xlistenv` row's own emission — read from the table, never
   *  re-typed here, so a shim rewrite (task 1206's idempotent guard) moves
   *  this guard with it instead of reddening it (task 1212). */
  const xlistLine = LATEX_REQUIREMENTS.find((r) => r.id === "xlistenv")
    ?.injectLine;

  it("the derivation sees the xlist shim (the drift that motivated it)", () => {
    expect(xlistLine).toBeTruthy();
    expect(injectedLinesFor(appendixVocabularyBody(md))).toContain(xlistLine);
  });

  it("is red on a planted omission", () => {
    const planted = md.replace(`${xlistLine}\n`, "");
    expect(planted).not.toBe(md);
    expect(new Set(stockCompileLines(planted))).not.toEqual(
      new Set(injectedLinesFor(appendixVocabularyBody(planted))),
    );
  });
});
