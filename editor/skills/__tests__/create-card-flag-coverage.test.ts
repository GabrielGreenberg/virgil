// @vitest-environment node
//
// `create-card.md`'s `## Args` section is the routing copy an agent reads to
// learn what the create primitive can be TOLD — it reads Args before it reads
// the script, so a flag that exists in `create_card.py` and not in the skill is
// a capability the agent cannot use and a claim the doc is quietly not making.
// This family's own recurring lesson (tasks 156, 467): the routing copy is part
// of the contract.
//
// Measured at HEAD `08e74efc` (task 469), two of the sixteen flags were absent:
// `--synthesize` appeared NOWHERE in the skill, and `--task-text` appeared only
// inside the Workflow-B example, never as an Args bullet.
//
// Nothing was broken by either, and that is worth stating rather than
// inflating: `_resolve_context` INFERS synthesis when no requestId is given
// (`create_card.py` — the `else` branch), so the documented Workflow-B command
// works exactly as written. `--synthesize` only matters for the narrow case of
// forcing synthesis WHILE a requestId is present. So this guard exists for the
// completeness of the vocabulary an agent is handed, not for a live failure.
//
// THE POPULATION IS DERIVED from the script's own `add_argument` calls, so a
// SEVENTEENTH flag is covered by shipping rather than by remembering. Allowlist
// EMPTY: a flag whose right answer is "deliberately undocumented" would still
// need to say so in the skill, which is what the coverage leg asks for.
//
// STATED SCOPE, so this is not over-built. Measured across `editor/scripts/`,
// `create_card.py` is the ONLY script with a meaningful flag set —
// `rename_citekey.py` and `list_requests.py` declare none, and
// `get_para_context.py` has one (`--neighbors`) with no single owning skill. So
// this is deliberately ONE pair, not a generalized script↔skill census; a
// census over a population of one is a table pretending to be a rule. If a
// second flag-bearing script ever gains an owning skill, widen the pair into a
// table THEN.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// editor/skills/__tests__/ → repo root is three levels up.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

const SCRIPT = "editor/scripts/create_card.py";
const SKILL = "editor/skills/create-card.md";

/** Every `--flag` the script declares, in declaration order. */
function declaredFlags(): string[] {
  const src = read(SCRIPT);
  const out: string[] = [];
  // `add_argument` spans lines in this file, so match the flag literal itself
  // inside any add_argument call rather than requiring a one-line form.
  for (const m of src.matchAll(/add_argument\(\s*\n?\s*"(--[a-z0-9-]+)"/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

describe("create-card.md Args ⊇ create_card.py flags (population DERIVED)", () => {
  it("the extraction is non-vacuous and sees the whole flag set", () => {
    // A guard whose needle silently stops matching passes for the wrong reason.
    const flags = declaredFlags();
    expect(flags.length).toBeGreaterThanOrEqual(15);
    // Three spellings the extraction has to survive: a plain one-line call, a
    // `dest=`-carrying one, and the multi-line form `--margin` is written in.
    expect(flags).toContain("--kind");
    expect(flags).toContain("--task-text");
    expect(flags).toContain("--margin");
  });

  it("every declared flag appears in the skill's Args section", () => {
    const args = read(SKILL).split(/^## Args$/m)[1] ?? "";
    expect(args.length, "the `## Args` section was not found in " + SKILL).toBeGreaterThan(200);
    const argsOnly = args.split(/^## /m)[0];
    const missing = declaredFlags().filter((f) => !argsOnly.includes(f));
    expect(
      missing,
      "a flag `create_card.py` declares that `create-card.md`'s Args section" +
        " does not mention. An agent reads Args to learn the vocabulary and" +
        " then composes its own invocation, so an undocumented flag is a" +
        " capability it cannot use. Add a bullet — or, if the flag is" +
        " deliberately not for agents, say so in the bullet (the way `--margin`" +
        " states that it is accepted and ignored).",
    ).toEqual([]);
  });

  it("the two flags task 469 added are documented as Args, not only in an example", () => {
    // The pre-469 shape, pinned by its own words so a revert is loud:
    // `--task-text` was present in the file (inside the Workflow-B code block)
    // and absent from Args, which the section-scoped leg above is what catches.
    const argsOnly = (read(SKILL).split(/^## Args$/m)[1] ?? "").split(/^## /m)[0];
    expect(argsOnly).toContain("--synthesize");
    expect(argsOnly).toContain("--task-text");
  });

  it("the `--synthesize` bullet documents the INFERENCE, which is why it reads as missing", () => {
    // Its absence looked like a gap precisely because the flag is unnecessary
    // on the documented path. Saying so is the useful half; without it the next
    // reader adds `--synthesize` to the Workflow-B example, where it is noise.
    const flat = read(SKILL).replace(/\s+/g, " ");
    expect(flat).toMatch(/with no requestId the chat path\s*synthesizes automatically/i);
  });

  it("the scope claim is CHECKED — create_card.py is the only flag-bearing editor script", () => {
    // The stated reason this is one pair and not a census. If a sibling grows a
    // real flag set, this fails and the pair should become a table.
    const siblings = ["rename_citekey.py", "list_requests.py", "card_by_id.py"];
    for (const f of siblings) {
      const n = [...read(`editor/scripts/${f}`).matchAll(/add_argument\(\s*\n?\s*"--/g)].length;
      expect(n, `${f} has grown optional flags — widen this pair into a table`).toBe(0);
    }
  });
});
