// @vitest-environment node
/**
 * `_latex-output.md`'s "Minimal preamble" block ↔ `tex_emit.preamble_lines()`
 * (task 801). The doctrine used to hand-copy the extractor's preamble and
 * drifted: it showed `\providecommand{\pgmark}[1]{}` (which makes stock LaTeX
 * print "low]" for every `\pgmark[low]{N}`) and a `\vexid` provide the
 * extractor never writes — and it told agents to make their preamble MATCH it.
 * Now the fenced block must equal the builder's non-comment, non-blank lines,
 * read by running the builder itself.
 *
 * If `python3` is unavailable the test FAILS rather than skips.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DOCTRINE = path.join(REPO_ROOT, "library/skills/_latex-output.md");

function builderLines(): string[] {
  const out = execFileSync(
    "python3",
    [
      "-c",
      "import json, sys; sys.path.insert(0, 'library/scripts'); " +
        "import tex_emit; print(json.dumps(tex_emit.preamble_lines()))",
    ],
    { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return (JSON.parse(out) as string[]).filter(
    (l) => l.trim() !== "" && !l.trimStart().startsWith("%"),
  );
}

/** The ```latex fence under the "### Minimal preamble" heading. */
function doctrineBlock(md: string): string[] {
  const at = md.indexOf("### Minimal preamble");
  if (at < 0) throw new Error("no '### Minimal preamble' heading in _latex-output.md");
  const m = /```latex\n([\s\S]*?)```/.exec(md.slice(at));
  if (!m) throw new Error("no ```latex fence under '### Minimal preamble'");
  return m[1].split("\n").filter((l) => l.trim() !== "");
}

describe("_latex-output.md minimal preamble ↔ tex_emit.preamble_lines()", () => {
  it("the doctrine block equals the builder's non-comment lines", () => {
    expect(doctrineBlock(readFileSync(DOCTRINE, "utf8"))).toEqual(builderLines());
  });

  it("declares \\pgmark in the optional-argument form `\\pgmark[low]{N}` needs", () => {
    expect(builderLines()).toContain("\\providecommand{\\pgmark}[2][high]{}");
  });

  it("the parser catches a drifted doctrine (the pre-task-801 block)", () => {
    const stale =
      "### Minimal preamble\n\n```latex\n\\documentclass{article}\n" +
      "\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath, amssymb}\n" +
      "\\providecommand{\\pgmark}[1]{}\n\\providecommand{\\vexid}[1]{}\n```\n";
    expect(doctrineBlock(stale)).not.toEqual(builderLines());
  });
});
