/**
 * CENSUS — intake skills defer to the executor they call (task 1433).
 *
 * Same stale-restatement class as tasks 1430/1432: a skill restated what its
 * script does, the script moved on, and following the prose did the work
 * twice or named a door that does not exist. Pinned here:
 *
 *   1. fuse-alternate: the script's normal path already appends the `fused`
 *      notification (`_append_fusion_notification`), so the skill's own
 *      `append_inbox_item.py` fence lives ONLY under its `--no-catalog`
 *      step, and uses the script's kind (`LOG_TAG_FUSED`), not a stand-in.
 *   2. fuse-alternate: every `FuseResult.aborted_reason` the script can
 *      return has a row in the skill's failure table — a new refusal cannot
 *      reach the user as an unexplained code.
 *   3. ai-requests: `import-bib` has ONE owner (/library/import-bib, routed
 *      there by index-pending's dispatch table), so ai-requests does not
 *      list it as an AI request; and its bib-scope write goes through the
 *      locked master.bib writer, never a `bib-edit` queue entry no CLI can
 *      produce.
 *   4. (task 1602) fuse-alternate keeps no hand-written "Output format"
 *      block (the script's `main()` owns the report) and no `master.bib`
 *      precondition the script never checks; import-bib names only its real
 *      dispatch caller and finds its own work through `queue_slot.py
 *      claimable`, never by hand-parsing queue files; iterate-skill records
 *      the working-tree blob (`git hash-object`), not `HEAD:`, and waits on
 *      `outstanding --native --count`, never an empty queue.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const FUSE_SKILL = read("library/skills/fuse-alternate.md");
const FUSE_SCRIPT = read("library/scripts/fuse_alternate.py");
const AI_REQUESTS = read("library/skills/ai-requests.md");
const INDEX_PENDING = read("library/skills/index-pending.md");
const IMPORT_BIB = read("library/skills/import-bib.md");
const ITERATE_SKILL = read("library/skills/iterate-skill.md");

/** The `### N. …` section of a skill whose heading contains `marker`. */
function section(text: string, marker: string): string {
  const parts = text.split(/^(?=#{2,3} )/m);
  return parts.filter((p) => p.split("\n")[0].includes(marker)).join("\n");
}
const fences = (text: string) => text.match(/```[\s\S]*?```/g) ?? [];

describe("CENSUS: intake skills defer to their executors (task 1433)", () => {
  it("fuse-alternate notifies only under --no-catalog, with the script's kind", () => {
    const kind = FUSE_SCRIPT.match(/^LOG_TAG_FUSED = "([a-z-]+)"/m)?.[1];
    expect(kind, "LOG_TAG_FUSED not found in fuse_alternate.py").toBeTruthy();
    // The script appends on its normal path — the duplicate's precondition.
    expect(FUSE_SCRIPT).toMatch(/if not args\.no_catalog[\s\S]{0,200}_append_fusion_notification/);

    const noCatalog = section(FUSE_SKILL, "--no-catalog");
    expect(noCatalog, "fuse-alternate.md has no `--no-catalog` step").not.toBe("");
    const notifyAll = fences(FUSE_SKILL).filter((f) => f.includes("append_inbox_item.py"));
    const notifyGated = fences(noCatalog).filter((f) => f.includes("append_inbox_item.py"));
    expect(notifyAll.length, "fuse-alternate.md lost its --no-catalog notify fence").toBe(1);
    expect(notifyGated, "a notify fence outside the --no-catalog step toasts twice").toEqual(notifyAll);
    expect(notifyGated[0]).toContain(`"kind": "${kind}"`);
  });

  it("every FuseResult.aborted_reason has a failure-table row", () => {
    const reasons = new Set(
      [...FUSE_SCRIPT.matchAll(/aborted_reason=f?"([a-z-]+)/g)].map((m) => m[1].replace(/-$/, "")),
    );
    reasons.delete("already-fused"); // the idempotent no-op, exit 0 — step 2's table
    expect(reasons.size, "found no aborted_reason literals — census is blind").toBeGreaterThan(4);
    const table = section(FUSE_SKILL, "Failure modes");
    const missing = [...reasons].filter((r) => !table.includes("`" + r));
    expect(missing).toEqual([]);
  });

  it("import-bib has one owner: ai-requests does not claim it", () => {
    const counts = section(AI_REQUESTS, "What counts as an AI request");
    expect(counts).not.toBe("");
    expect(counts).not.toMatch(/kind == "import-bib"/);
    expect(INDEX_PENDING).toMatch(/\| `import-bib` \| → `\/library\/import-bib <citekey>` \|/);
  });

  it("ai-requests writes bib fields through the locked writer, not a bib-edit entry", () => {
    expect(AI_REQUESTS).not.toMatch(/write a `bib-edit` queue entry/);
    const writer = fences(AI_REQUESTS).filter((f) => f.includes("update_master_bib_entry.py"));
    expect(writer.length).toBe(1);
    expect(writer[0]).toContain("--merge-existing");
    expect(writer[0]).not.toContain("--allow-field-drop");
  });

  it("prose restates no executor's output or precondition (task 1602)", () => {
    expect(FUSE_SKILL).not.toMatch(/^## Output format/m);
    expect(FUSE_SKILL).not.toMatch(/master\.bib` must contain/);
    expect(FUSE_SCRIPT).not.toMatch(/master\.bib/);

    expect(IMPORT_BIB).not.toMatch(/both dispatch callers/);
    expect(IMPORT_BIB).not.toMatch(/for q in \.virgil\/queue\//);
    expect(fences(IMPORT_BIB).some((f) => f.includes("queue_slot.py claimable"))).toBe(true);

    expect(ITERATE_SKILL).not.toMatch(/git rev-parse HEAD:/);
    expect(ITERATE_SKILL).toContain("git hash-object library/skills/<skill>.md");
    expect(ITERATE_SKILL).not.toMatch(/empty-queue condition/);
    expect(ITERATE_SKILL).toContain("outstanding --native --count");
  });
});
