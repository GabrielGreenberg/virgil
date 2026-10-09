/**
 * `bulk_convert_numbered_examples.py --apply` ↔ `parseLatex` (task 1030).
 *
 * The converter MINTS a `\vexid{<uuid>}` per example so the editor's example
 * ids are stable across opens. The parser only honours a `\vexid` that
 * PRECEDES its `\ex` / `\pex`; the converter used to write it AFTER the
 * opener, so every minted id was silently discarded (a fresh random id on
 * every open) while the Python test — which only checked `"\\vexid{" in out` —
 * stayed green. This pins the WRITER to the READER: run the real converter,
 * parse its output, and require every example block to carry an id the
 * converter wrote.
 *
 * If `python3` is unavailable the test FAILS rather than skips.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { JSONContent } from "@tiptap/core";
import { parseLatex } from "@/lib/latex-parser";

const REPO_ROOT = path.resolve(__dirname, "../../..");

const PAPER =
  "\\documentclass{article}\n\\begin{document}\n\n" +
  "Some prose.\n\n" +
  "(1) John left.\n\n" +
  "(2) Pairs:\n(2a) Mary sang.\n(2b) Sue danced.\n\n" +
  "More prose.\n\n\\end{document}\n";

function convert(tex: string): string {
  return execFileSync(
    "python3",
    [
      "-c",
      "import sys; sys.path.insert(0, 'library/scripts'); " +
        "import bulk_convert_numbered_examples as bc; " +
        "t = sys.stdin.read(); sys.stdout.write(bc._apply(t, bc._gather_examples(t)))",
    ],
    { cwd: REPO_ROOT, input: tex, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
}

function exampleBlocks(node: JSONContent, out: JSONContent[] = []): JSONContent[] {
  if (node.type === "exampleBlock") out.push(node);
  for (const c of node.content ?? []) exampleBlocks(c, out);
  return out;
}

describe("bulk_convert_numbered_examples --apply ↔ parseLatex", () => {
  const converted = convert(PAPER);
  const minted = [...converted.matchAll(/\\vexid\{([^}]*)\}/g)].map((m) => m[1]);

  it("mints one \\vexid per example (one \\ex, one \\pex)", () => {
    expect(minted).toHaveLength(2);
    expect(converted).toMatch(/\\pex\[/);
  });

  it("every parsed exampleBlock carries an id the converter wrote", () => {
    const blocks = exampleBlocks(parseLatex(converted));
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.attrs?.uuid).sort()).toEqual([...minted].sort());
  });

  it("the parsed ids are stable — a second parse yields the same ids", () => {
    const a = exampleBlocks(parseLatex(converted)).map((b) => b.attrs?.uuid);
    const b = exampleBlocks(parseLatex(converted)).map((b) => b.attrs?.uuid);
    expect(a).toEqual(b);
  });
});
