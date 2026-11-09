// Source-pod write door — CENSUS (task 1533).
//
// The undo fix in `src/lib/tiptap/source-pod-write.ts` holds only if EVERY
// writer to a source pod's attrs goes through `writeSourcePodAttrs`: a stray
// recorded whole-node `setNodeMarkup` brings back the snapshot inverse that
// reverted float-typed code, and an unrecorded float write that forgot
// `addToHistory:false` (the float title write, pre-1533) is the same bug by
// the other door.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commentsStripped, REPO_ROOT, trackedFiles } from "@/lib/__tests__/_source-scan";

const read = (rel: string) => commentsStripped(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const POD_WRITERS = [
  "src/components/SourcePodNodeView.tsx",
  "src/text-objects/floats/source-pod-body.tsx",
];

describe("source-pod write door CENSUS", () => {
  it.each(POD_WRITERS)("%s writes pod attrs only through writeSourcePodAttrs", (rel) => {
    const src = read(rel);
    expect(src).toMatch(/writeSourcePodAttrs\(/);
    expect(src).not.toMatch(/\.setNodeMarkup\(/);
    expect(src).not.toMatch(/\.setNodeAttribute\(/);
  });

  it("the in-place pod calls updateAttributes only as the editor-less fallback", () => {
    const src = read("src/components/SourcePodNodeView.tsx");
    expect(src.match(/\bupdateAttributes\(/g) ?? []).toHaveLength(1);
  });

  it("every FLOAT_WRITE_META dispatch is also addToHistory:false", () => {
    const offenders = trackedFiles("src", /\.(ts|tsx)$/)
      .filter((abs) => !abs.includes(`${path.sep}__tests__${path.sep}`))
      .filter((abs) => {
        const src = commentsStripped(readFileSync(abs, "utf8"));
        const tags = (src.match(/\.setMeta\(\s*FLOAT_WRITE_META\b/g) ?? []).length;
        const unrecorded = (src.match(/\.setMeta\(\s*["']addToHistory["']\s*,\s*false\s*\)/g) ?? []).length;
        return tags > unrecorded;
      })
      .map((abs) => path.relative(REPO_ROOT, abs));
    expect(offenders).toEqual([]);
  });
});
