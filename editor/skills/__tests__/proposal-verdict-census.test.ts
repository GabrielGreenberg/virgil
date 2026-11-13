// @vitest-environment node
//
// CENSUS — the suggestion state machine is stated ONCE (task 1594).
//
// accept-/reject-suggestion each used to restate "which statuses may I act on"
// by hand, and the copies drifted from the op: both said `status: pending`
// only, while the op lets a `stale` proposal through — so a skill-following
// agent stopped on the user's natural move (rejecting a stale proposal) with no
// reply to give. The verdict now lives in ONE table, `card_tables.json` →
// `proposalVerdicts` (verb → status → verdict), read by
// `apply_response._resolve_proposal` / `_proposal_door_refusal` and pinned to
// the app's `SUGGESTION_STATUSES` by card-tables-manifest.test.ts.
//
// This census holds the PROSE to the table: each skill's Applicability cites
// the table and gives every status the table's own verdict; its Reply carries a
// template for every non-proceed verdict and every refusal its op can raise;
// the todo asymmetry the op implements (accept closes the source todo, reject
// leaves it open) is stated in both; and no "step N" points past the
// Procedure's own steps.

import { describe, it, expect } from "vitest";
import { SUGGESTION_STATUSES } from "@/cards/suggestion-status";
import { readRepo as read } from "./_review-routes";

const flat = (s: string) => s.replace(/\s+/g, " ");
const section = (doc: string, heading: string) => {
  const at = doc.indexOf(`\n## ${heading}\n`);
  expect(at, `missing "## ${heading}"`).toBeGreaterThanOrEqual(0);
  const end = doc.indexOf("\n## ", at + 1);
  return doc.slice(at, end < 0 ? undefined : end);
};

const VERDICTS = (
  JSON.parse(read("editor/scripts/card_tables.json")) as {
    proposalVerdicts: Record<string, Record<string, string>>;
  }
).proposalVerdicts;
const DOOR = read("editor/scripts/apply_response.py");
const body = (fn: string) => {
  const from = DOOR.indexOf(`def ${fn}(`);
  return DOOR.slice(from, DOOR.indexOf("\ndef ", from + 1));
};

/** The word each verdict is spelled with in a status bullet. */
const SPOKEN: Record<string, RegExp> = {
  proceed: /\*\*proceed\*\*/,
  noop: /\*\*no-op\*\*/,
  "refuse-applied": /\*\*refused\*\* \(`refuse-applied`\)/,
  "refuse-terminal": /\*\*refused\*\* \(`refuse-terminal`\)/,
};

const SKILLS = [
  { verb: "accept", file: "editor/skills/accept-suggestion.md", fn: "cmd_accept" },
  { verb: "reject", file: "editor/skills/reject-suggestion.md", fn: "cmd_reject" },
] as const;

describe.each(SKILLS)("proposal verdict census — $file (task 1594)", ({ verb, file, fn }) => {
  const doc = read(file);
  const applicability = section(doc, "Applicability");
  const reply = section(doc, "Reply");

  it("Applicability cites the one table and the op that reads it", () => {
    expect(flat(applicability)).toContain(`\`card_tables.json\` → \`proposalVerdicts.${verb}\``);
    expect(applicability).toContain("_resolve_proposal");
    expect(applicability).toContain("SUGGESTION_STATUSES");
  });

  it.each([...SUGGESTION_STATUSES])("names `%s` with the table's verdict", (status) => {
    const verdict = VERDICTS[verb][status];
    const bullet = applicability.split("\n").find((l) => l.trim().startsWith(`- \`${status}\` →`));
    expect(bullet, `${file}: no "- \`${status}\` → …" bullet in Applicability`).toBeDefined();
    expect(bullet!, `${file}: \`${status}\` must read as ${verdict}`).toMatch(SPOKEN[verdict]);
  });

  it("Reply has a template for every non-proceed verdict the table gives this verb", () => {
    for (const v of new Set(Object.values(VERDICTS[verb]))) {
      if (v === "proceed") continue;
      expect(reply, `${file}: no Reply template "On a \`${v}\`…"`).toContain(`On a \`${v}\``);
    }
    expect(reply, `${file}: no catch-all refusal template`).toContain("On any other refusal");
  });

  it("Reply has a template for each refusal the op itself raises past the table", () => {
    const op = body(fn);
    if (op.includes("_refuse_unconserved_markers(")) expect(reply).toContain("marker-conservation refusal");
    if (op.includes("noReplacementText")) expect(reply).toContain("empty-revision refusal");
    if (op.includes('"replace-span"')) expect(reply).toContain("stale refusal");
  });

  it("states the source-todo effect the op actually has", () => {
    const closes = /close_source_todo=True/.test(body(fn));
    expect(doc).toContain("close_source_todo");
    if (closes) expect(doc).toContain("todos.json");
    else expect(flat(doc)).toMatch(/todo[^.]*stays \*\*open\*\*/);
  });

  it('no "step N" points past the Procedure\'s own steps', () => {
    const steps = (section(doc, "Procedure").match(/^\d+\. /gm) ?? []).length;
    for (const m of doc.matchAll(/\bstep (\d+)\b/gi)) {
      expect(Number(m[1]), `${file}: "${m[0]}" but the Procedure has ${steps} steps`).toBeLessThanOrEqual(steps);
    }
  });
});

describe("the two suggestion doors stay asymmetric on the todo (task 1043)", () => {
  it("accept closes the source todo; reject does not", () => {
    expect(body("cmd_accept")).toMatch(/close_source_todo=True/);
    expect(body("cmd_reject")).not.toMatch(/close_source_todo=True/);
  });
});
