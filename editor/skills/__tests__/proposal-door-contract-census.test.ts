// @vitest-environment node
//
// CENSUS — the suggestion door's refusal contract is stated ONCE (task 1577).
//
// `create_card.py --kind=suggestion` (→ `apply_response._guard_proposal_landing`)
// refuses a proposal for several reasons, and the list grows: task 1426 added
// marker conservation. Every skill that lands a proposal used to RESTATE the
// list in its own prose, and 1426 updated four of the restatements — the
// note / todo / report answer paths and `create-card.md` itself kept the two
// old refusals, so an agent rewriting a cited sentence was never told to carry
// the `\vcid` / `\vfid` markers through. The class is the restatement itself.
//
// So: `create-card.md` holds the ONE block ("What the proposal door refuses"),
// and every other skill doc that teaches `--kind=suggestion` CITES that block by
// its anchor instead of listing refusals. A proposing skill (one that documents
// a `create_card.py … --kind=suggestion` call) also keeps the authoring rule at
// its composition step — "carry every marker … add none" — because that is the
// one sentence that changes what the agent writes.
//
// The population is DERIVED (every editor/library skill markdown mentioning
// `--kind=suggestion`), so a new proposing skill is enrolled by writing it.

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { readRepo as read, repoRoot } from "./_review-routes";

const DOOR_DOC = "editor/skills/create-card.md";
const HEADING = "### What the proposal door refuses";
const ANCHOR = "create-card.md#what-the-proposal-door-refuses";

const flat = (s: string) => s.replace(/\s+/g, " ");

function skillDocs(): string[] {
  const out: string[] = [];
  for (const dir of ["editor/skills", "library/skills"]) {
    const abs = join(repoRoot, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) if (f.endsWith(".md")) out.push(`${dir}/${f}`);
  }
  out.push("editor/AGENTS.md");
  return out;
}

const citers = skillDocs().filter((f) => f !== DOOR_DOC && read(f).includes("--kind=suggestion"));
const proposers = citers.filter((f) => /create_card\.py <docPath>[^\n]*--kind=suggestion/.test(read(f)));

describe("proposal-door contract census (task 1577)", () => {
  it("create-card.md states the contract once, with every refusal the door has", () => {
    const doc = read(DOOR_DOC);
    expect(doc.split(HEADING).length - 1, `${DOOR_DOC} must carry exactly one "${HEADING}"`).toBe(1);
    const block = flat(doc.slice(doc.indexOf(HEADING), doc.indexOf("\n## ", doc.indexOf(HEADING))));
    for (const needle of ["original_text", "verbatim", "Empty replacement", "Markers not conserved", "--range"]) {
      expect(block, `the door block must name the "${needle}" refusal`).toContain(needle);
    }
    // The door the block documents still asks the marker question.
    const door = read("editor/scripts/apply_response.py");
    const guard = door.slice(door.indexOf("def _guard_proposal_landing"));
    expect(guard.slice(0, guard.indexOf("\ndef ", 1))).toContain("_refuse_unconserved_markers(");
  });

  it("the population is non-empty (the derivation still finds the proposing skills)", () => {
    expect(proposers.length).toBeGreaterThanOrEqual(5);
  });

  it.each(citers)("%s cites the door's contract instead of restating it", (f) => {
    const s = flat(read(f));
    expect(s, `${f} teaches --kind=suggestion but does not cite ${ANCHOR}`).toContain(ANCHOR);
    // A restated refusal is exactly the drift this census retires.
    for (const restated of [/refuses before any write if `original_text` is not verbatim/, /or the replacement is empty/]) {
      expect(s, `${f} restates the door's refusal list — cite ${ANCHOR} instead`).not.toMatch(restated);
    }
  });

  it.each(proposers)("%s keeps the marker-conservation authoring rule at composition", (f) => {
    expect(flat(read(f)), `${f} must tell the agent to carry every marker through and add none`).toMatch(
      /carry every (`\\vcid\{…\}`, `\\vfid\{…\}` and `\\vlid\{…\}`\/`\\vlidend\{…\}` in `original_text`|marker of the original) through verbatim/,
    );
  });
});
