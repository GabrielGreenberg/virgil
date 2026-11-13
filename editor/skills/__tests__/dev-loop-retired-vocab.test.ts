// @vitest-environment node
//
// The dev loop's prose kept restating executor facts that had since been
// retired: task 522 made the dream a DETECTOR that files tasks and lands
// nothing, and task 521 moved the memo sink off `editor/dev/memos/`, yet lines
// describing the old worktree-staging / landing machinery and the old sink
// survived two sweeps (1430, then 1608) because each sweep fixed the lines it
// was shown, not the vocabulary. This census pins the vocabulary, so the class
// cannot come back one line at a time.
//
// Historical notes inside `<!-- RETIRED … -->` HTML comments are exempt: they
// say what USED to be true, on purpose.

import { describe, expect, it } from "vitest";
import { readRepo } from "./_review-routes";

const SURFACES = [
  "editor/skills/dream.md",
  "editor/skills/reflect.md",
  "editor/skills/iterate-virgil-editor.md",
] as const;
const DREAM_PY = "editor/scripts/dream.py";

/** Retired phrasings — each names machinery that no longer exists. */
const RETIRED: ReadonlyArray<[RegExp, string]> = [
  [/dream\/<date>`?\s+worktree/i, "the dream stages nothing in a worktree (task 522)"],
  [/landing-mode helper/i, "dream_land classifies + guards; it lands nothing (task 522)"],
  [/edit-skill spine/i, "the dream files tasks; it never edits a skill (task 522)"],
  [/propose-via-worktree/i, "no dev-loop skill opens a worktree (task 522)"],
  [/acts-on-branch/i, "no dev-loop skill acts on a branch (task 522)"],
  [/Worktree-staging/i, "no dev-loop skill stages edits in a worktree (task 522)"],
  // The sink: `editor/dev/memos` is the LOCAL fallback rung of
  // `_common.memos_root`, never THE sink. A ladder mention ("else …") is fine.
  [/\binto\s+`?(<checkout>\/)?editor\/dev\/memos\/?`?/i, "memos go to the sink ladder (_common.memos_root), not into editor/dev/memos (task 521)"],
  [/sibling of\s+`?memos\/?`?/i, "digests are LOCAL; the memo sink is synced — not siblings (task 521)"],
];

function stripRetiredComments(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, "");
}

function moduleDocstring(py: string): string {
  const m = py.match(/^(?:#![^\n]*\n)?r?"""([\s\S]*?)"""/);
  if (!m) throw new Error(`${DREAM_PY}: no module docstring found`);
  return m[1];
}

function hits(text: string): string[] {
  const flat = text.replace(/\s*\n\s*/g, " ");
  return RETIRED.filter(([re]) => re.test(flat)).map(([re, why]) => `${re} — ${why}`);
}

describe("dev-loop retired vocabulary CENSUS (task 1608)", () => {
  for (const path of SURFACES) {
    it(`${path} states no retired executor fact`, () => {
      expect(hits(stripRetiredComments(readRepo(path)))).toEqual([]);
    });
  }

  it(`${DREAM_PY}'s module docstring states no retired executor fact`, () => {
    expect(hits(moduleDocstring(readRepo(DREAM_PY)))).toEqual([]);
  });

  it("the census bites: each retired phrase is caught", () => {
    for (const probe of [
      "stage it in a `dream/<date>` worktree for review",
      "the shared landing-mode helper",
      "same read-a-critique → edit-skill spine",
      "acts-on-branch / propose-via-worktree machinery",
      "drops a tiered memo into `editor/dev/memos/` after",
      "(gitignored, the sibling of\n`memos/`)",
    ]) {
      expect(hits(probe), probe).not.toEqual([]);
    }
    // …and the sink LADDER is not a hit.
    expect(hits("the synced `Virgil-Inbox/dev-loop/memos`, else `editor/dev/memos/`")).toEqual([]);
  });

  it("dream.md's flow diagram numbers FILE with the step that files", () => {
    const md = readRepo("editor/skills/dream.md");
    const fileStep = md.match(/^### (\d+)\. FILE\b/m)?.[1];
    expect(fileStep, "dream.md has a `### N. FILE` step").toBeTruthy();
    const flow = md.split("## The flow")[1]?.match(/```\n([\s\S]*?)```/)?.[1] ?? "";
    const [names, nums] = flow.trim().split("\n");
    const labels = names.split("─►").map((s) => s.trim());
    const steps = nums.trim().split(/\s{2,}/);
    expect(steps.length, "one step label per flow stage").toBe(labels.length);
    const at = labels.findIndex((l) => l.startsWith("FILE"));
    expect(steps[at]).toBe(`§${fileStep}`);
  });
});
