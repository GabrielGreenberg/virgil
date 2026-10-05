/**
 * Task 865 — ONE door for "serialize the live doc for the code view".
 *
 * `assembleLiveSource` (pipeline.ts) is the only place allowed to spell the
 * `getDocProducts(editor)?.assembleSourceWith(…) ?? serializeToLatex(…)`
 * pattern. Three hand-built copies of it drifted: the code view's mount seed
 * omitted the doc's bib family, so the pane opened on a preamble the save
 * path would not write and the lint fed from it landed a line off. The pure
 * byte-parity leg lives in pipeline.test.ts; this census pins the routing
 * (CodeMirror has no render harness here).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { walkFiles } from "../../__tests__/_source-scan";

const ROOT = join(__dirname, "../../../..");
const SRC = join(ROOT, "src");
const DOOR = "src/lib/doc-products/pipeline.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const p of walkFiles(dir, { skipDirs: ["__tests__"] })) if (/\.(ts|tsx)$/.test(p)) out.push(p);
  return out;
}

describe("live-source door census (865)", () => {
  it("only the door calls DocProducts.assembleSourceWith", () => {
    const offenders = walk(SRC)
      .map((p) => relative(ROOT, p))
      .filter((rel) => rel !== DOOR)
      .filter((rel) =>
        /\.assembleSourceWith\(/.test(readFileSync(join(ROOT, rel), "utf8")),
      );
    expect(offenders).toEqual([]);
  });

  it("the code view seed routes through the door WITH the doc's bib family", () => {
    const src = readFileSync(join(SRC, "components/CodeEditor.tsx"), "utf8");
    expect(src).not.toMatch(/serializeToLatex\(/);
    expect(src).toMatch(/assembleLiveSource\(/);
    expect(src).toMatch(/bibFamily:\s*bibFamilyRef\.current/);
  });

  it("the bridge's live flush routes through the door", () => {
    const src = readFileSync(join(SRC, "lib/code-pane-bridge.ts"), "utf8");
    expect(src).toMatch(/assembleLiveSource\(editor,/);
    expect(src).not.toMatch(/serializeToLatex\(editor\.getJSON\(\)/);
  });
});
