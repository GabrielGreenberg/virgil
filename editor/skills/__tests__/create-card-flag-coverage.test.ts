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
// SCOPE. This pair is the strict leg (flags ⊆ the skill's own `## Args`
// section). It used to also CLAIM create_card.py was the only flag-bearing
// editor script, checked against a hand-listed `siblings` array — which went
// stale the first time a sibling grew a flag (card_by_id.py's `--panel`, task
// 1112), and was already false of scripts it never listed (apply_response.py,
// reflect.py, …). Task 1126 replaced that claim with the DERIVED census below:
// every flag of every editor script is documented in a skill that invokes it.

import { readFileSync, readdirSync } from "node:fs";
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
});

// ─── The census (task 1126) ─────────────────────────────────────────────────
//
// An agent learns a script's vocabulary from the skill prose that tells it to
// run the script — the script's `--help` is not in its context. So a flag no
// invoking skill mentions is a capability no agent can reach, and the cost is
// concrete: card_by_id.py's ambiguity REFUSAL says "re-run with --panel", and
// no skill had ever said the flag existed.
//
// Every axis is DERIVED, nothing hand-listed:
//   - the POPULATION is every `editor/scripts/*.py` declaring an
//     `add_argument("--…")` (one-line, multi-line, either quote);
//   - a script's INVOKERS are the `editor/skills/*.md` files naming it
//     (`_`-includes count: they ship beside the skills and are linked from
//     them, which is where shared doctrine like `_card-resolve.md` lives);
//   - each flag must appear in AT LEAST ONE invoker.
// A script NO skill names is a maintainer tool, not agent vocabulary, and is
// out of scope — reported, not failed (skill_catalog.py today). A flag that is
// deliberately not for agents still gets a sentence saying so, the way
// `--margin` does in create-card.md.
//
// Residual, stated: "appears in an invoker" is a substring test, so a flag
// spelled like a different script's flag in the same file (`--kind`) can be
// satisfied by the other script's docs. The strict per-section leg above is
// what pins create_card.py, the one script with a dedicated Args section.

const SCRIPTS_DIR = "editor/scripts";
const SKILLS_DIR = "editor/skills";

/** Every `--flag` an editor script declares, or [] for a flagless one. */
function scriptFlags(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/add_argument\(\s*["'](--[a-z0-9-]+)["']/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function census() {
  const skills = readdirSync(join(REPO, SKILLS_DIR))
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ name: f, text: read(`${SKILLS_DIR}/${f}`) }));
  return readdirSync(join(REPO, SCRIPTS_DIR))
    .filter((f) => f.endsWith(".py"))
    .sort()
    .map((script) => ({ script, flags: scriptFlags(read(`${SCRIPTS_DIR}/${script}`)) }))
    .filter((r) => r.flags.length > 0)
    .map((r) => {
      const invokers = skills.filter((s) => s.text.includes(r.script));
      const undocumented = r.flags.filter((f) => !invokers.some((s) => s.text.includes(f)));
      return { ...r, invokers: invokers.map((s) => s.name), undocumented };
    });
}

describe("every editor script's flags are documented by a skill that invokes it (DERIVED census)", () => {
  it("the census is non-vacuous — it discovers the flag-bearing scripts and their invokers", () => {
    const rows = census();
    expect(rows.length).toBeGreaterThanOrEqual(10);
    const byName = Object.fromEntries(rows.map((r) => [r.script, r]));
    // The row whose staleness birthed this census, and the strict pair's script.
    expect(byName["card_by_id.py"]?.flags).toEqual(["--panel"]);
    expect(byName["card_by_id.py"]?.invokers.length).toBeGreaterThanOrEqual(8);
    expect(byName["create_card.py"]?.flags.length).toBeGreaterThanOrEqual(15);
    // Single-quote and `group.add_argument` forms must not slip the needle.
    expect(scriptFlags(`group.add_argument('--x', action="store_true")`)).toEqual(["--x"]);
    expect(scriptFlags(`p.add_argument(\n    "--y",\n    default=1)`)).toEqual(["--y"]);
  });

  it("no invoked script declares a flag that none of its invoking skills mentions", () => {
    const gaps = census()
      .filter((r) => r.invokers.length > 0 && r.undocumented.length > 0)
      .map((r) => `${r.script}: ${r.undocumented.join(", ")} (invoked by ${r.invokers.join(", ")})`);
    expect(
      gaps,
      "a script flag no invoking skill documents — an agent composes its" +
        " invocation from the skill prose, so the flag is unreachable. Document" +
        " it in an invoking skill (or a `_`-include they link); if it is not" +
        " for agents, say that in a sentence.",
    ).toEqual([]);
  });

  it("every skill that resolves a card id links the shared resolution doctrine (`--panel`)", () => {
    // card_by_id.py REFUSES an id two panels share; the answer (`--panel` on
    // the script, `panel` / `panelA`/`panelB` on the op) is stated ONCE in
    // _card-resolve.md, and each resolving skill must point there.
    const include = read(`${SKILLS_DIR}/_card-resolve.md`);
    expect(include).toContain("--panel");
    expect(include).toMatch(/ambiguous/);
    const resolvers = readdirSync(join(REPO, SKILLS_DIR)).filter(
      (f) => f.endsWith(".md") && !f.startsWith("_") && read(`${SKILLS_DIR}/${f}`).includes("card_by_id.py <docPath>"),
    );
    expect(resolvers.length).toBeGreaterThanOrEqual(8);
    const unlinked = resolvers.filter((f) => !read(`${SKILLS_DIR}/${f}`).includes("](_card-resolve.md)"));
    expect(unlinked, "a skill runs card_by_id.py without linking _card-resolve.md").toEqual([]);
  });
});
