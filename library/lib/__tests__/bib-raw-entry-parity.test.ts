/**
 * The master.bib entry locator is stated twice — `locateMasterEntryBlock`
 * (bib-raw-entry.ts, the Edit modal's `baseRaw`) and
 * `_tools.locate_master_entry` (every Python writer, incl. the apply shim's
 * base check) — because the two silos cannot import each other. A base block
 * that is not the copy the shim checks against produces false holds (task
 * 795, member 4), so this file holds the two equal over the hazard cases.
 *
 * If `python3` is unavailable the test FAILS rather than skips.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { locateMasterEntryBlock } from "../bib-raw-entry";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPTS = path.join(REPO_ROOT, "library/scripts");

const PY = `
import json, sys
sys.path.insert(0, ${JSON.stringify(SCRIPTS)})
from _tools import locate_master_entry, BibEntryUnbalanced
cases = json.load(sys.stdin)
out = []
for c in cases:
    try:
        s = locate_master_entry(c["text"], c["key"])
        out.append(None if s is None else c["text"][s.start:s.end])
    except BibEntryUnbalanced:
        out.append("UNBALANCED")
print(json.dumps(out))
`;

const CASES: Array<{ name: string; text: string; key: string }> = [
  {
    name: "duplicate key — last wins",
    key: "dup",
    text: `@article{dup,\n  title = {First}\n}\n\n@article{dup,\n  title = {Second}\n}\n`,
  },
  {
    name: "opener inside a value is skipped",
    key: "inner",
    text: `@misc{host,\n  note = {\n@article{inner,\n  title = {Fake}}\n}\n}\n\n@article{inner,\n  title = {Real}\n}\n`,
  },
  {
    name: "only copy is inside a value",
    key: "only",
    text: `@misc{host,\n  note = {\n@article{only,\n  t = {x}}\n}\n}\n`,
  },
  {
    name: "entry after an unbalanced one",
    key: "good",
    text: `@article{bad,\n  title = {Bad {x},\n}\n\n@book{good,\n  title = {G}\n}\n`,
  },
  {
    name: "state comment + nested braces",
    key: "k",
    text: `% bib.state = authenticated\n@incollection{k,\n  title = {The {GB} \\emph{X}},\n  booktitle = {B}\n}\n`,
  },
  {
    name: "absent key",
    key: "nope",
    text: `@article{a,\n  t = {x}\n}\n`,
  },
];

describe("master.bib entry locator — TS ↔ Python parity", () => {
  it("locateMasterEntryBlock returns the span locate_master_entry names", () => {
    const py = JSON.parse(
      execFileSync("python3", ["-c", PY], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        input: JSON.stringify(CASES.map(({ text, key }) => ({ text, key }))),
      }),
    ) as Array<string | null>;
    CASES.forEach((c, i) => {
      // Python refuses an unbalanced entry outright; TS returns it capped (the
      // modal may show it; the shim will refuse the write). No case here is
      // unbalanced at its target, so the two must agree exactly.
      expect({ case: c.name, block: locateMasterEntryBlock(c.text, c.key) }).toEqual({
        case: c.name,
        block: py[i],
      });
    });
  });
});
