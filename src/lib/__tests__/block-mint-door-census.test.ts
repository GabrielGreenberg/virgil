// CENSUS (task 1587) — no block-insert verb seeds its uuid mint with a PER-TYPE
// collision set.
//
// Block uuids share ONE namespace across every anchorable type, so the ONE
// mint door is `mintDocUuid(doc)` / `collectDocUuids(doc)` in
// `src/lib/anchor-uuid.ts` (task 552). Before 1587, figure / graphics / tex /
// forest / example inserts each scanned only their own node type — five
// hand-copied scans, a fresh figure could take a paragraph's id, and
// `BlockUuidBackfill`'s re-mint stranded the caller (the insert popover never
// opened). This census walks the block-insert modules for the two shapes those
// scans took:
//
//   1. a per-type collector handed to the generator or a fresh-attrs builder:
//        generateShortId(collectXxx(doc, "forestBlock"))
//        freshFigureBlockAttrs(collectXxx(editor, "figureBlock"))
//   2. a hand-rolled per-type uuid harvest:
//        node.type.name === "texBlock" && node.attrs.uuid
//
// A new insert verb mints through `mintDocUuid`, or seeds a fresh-attrs builder
// with `collectDocUuids` — never through either shape below.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT as ROOT, walkFiles } from "./_source-scan";

/** The block-insert modules: the action registry tree + the insert primitives. */
const SCANNED = [
  ...walkFiles(join(ROOT, "src/lib/actions"), { skipDirs: ["__tests__"] }).filter(
    (f) => /\.tsx?$/.test(f),
  ),
  join(ROOT, "src/lib/tiptap/smart-insert.ts"),
  join(ROOT, "src/lib/tiptap/expex.ts"),
];

const PER_TYPE_COLLECTOR_SEED =
  /(?:generateShortId|fresh\w*Attrs)\(\s*\w*[Cc]ollect\w*\([^()]*,\s*["'`]\w+["'`]\s*\)/;
const PER_TYPE_UUID_HARVEST =
  /\.type\.name\s*===\s*["'`]\w+["'`]\s*&&\s*\w+\.attrs\??\.uuid\b(?!\s*===)/;

describe("block mint door census (task 1587)", () => {
  it("scans a non-empty population", () => {
    expect(SCANNED.length).toBeGreaterThan(2);
  });

  it("no block-insert module seeds a uuid mint with a per-type collision set", () => {
    const offenders: string[] = [];
    for (const file of SCANNED) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (PER_TYPE_COLLECTOR_SEED.test(line) || PER_TYPE_UUID_HARVEST.test(line)) {
          offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      "Mint block uuids through `mintDocUuid(doc)` (or seed with " +
        "`collectDocUuids(doc)`) from src/lib/anchor-uuid.ts — block uuids " +
        "share one namespace, so a per-type set lets a new block take another " +
        "block's id:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the shapes bite (self-test on the pre-1587 spellings)", () => {
    expect(
      PER_TYPE_COLLECTOR_SEED.test(
        'uuid: generateShortId(collectUuids(doc, "forestBlock")),',
      ),
    ).toBe(true);
    expect(
      PER_TYPE_COLLECTOR_SEED.test(
        'const attrs = freshFigureBlockAttrs(collectBlockUuids(editor, "figureBlock"));',
      ),
    ).toBe(true);
    expect(
      PER_TYPE_UUID_HARVEST.test(
        'if (node.type.name === "texBlock" && node.attrs.uuid) {',
      ),
    ).toBe(true);
    // A LOCATE by uuid is not a harvest.
    expect(
      PER_TYPE_UUID_HARVEST.test(
        'if (node.type.name === "figureBlock" && node.attrs.uuid === uuid) {',
      ),
    ).toBe(false);
  });
});
