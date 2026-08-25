// @vitest-environment node
//
// Drift guard for the ASK-SHAPE doctrine (`editor/skills/_ask-shape.md`).
//
// The rule — "the panel names the DEFAULT output shape, the request text names
// the REQUIRED one" — is authored ONCE in the SSOT include and referenced by
// link from every responder that resolves a free-text AI request. Unlike the
// dev-loop principle (which must be inlined verbatim because a run reads the
// compiled command with no transclusion), this doctrine is reached at a
// decision point the responder takes deliberately, so a link is enough — the
// bundle ships `_`-prefixed includes alongside the commands.
//
// What this test exists to catch is the DEAD-SSOT failure: a doctrine file
// nothing points at, or a responder that quietly re-derives its own answer to
// the same question. That is exactly how the rule fragmented before it was
// written down — `answer-todo-request` carried a 4-way classify,
// `answer-revision-request` and `answer-note-request` each carried a *2-way*
// one keyed on "does this need a .tex mutation?" (an axis that structurally
// cannot produce a report), `answer-report-request` carried a one-line aside
// for the reverse direction only, and `draft-suggestion` — the one that shipped
// the bug — asked nothing at all.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// editor/skills/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

// These files are hard-wrapped prose that future edits will re-wrap freely, so
// every PHRASE assertion runs against a whitespace-collapsed copy. A regex that
// is sensitive to where a line happens to break fails for a reason that has
// nothing to do with the rule it is guarding.
const flat = (rel: string) => read(rel).replace(/\s+/g, " ");

const SSOT = "editor/skills/_ask-shape.md";
const SSOT_FOS = "editor/skills/_find-or-surface.md";
const POINTER = "[_ask-shape.md](_ask-shape.md)";

// Every responder that resolves a free-text AI request — i.e. every skill whose
// input is a comment box the user can type anything into. The mirror image of
// the doctrine's own scope. A new prose-panel responder added here without a
// pointer fails; one added to the skill set and NOT listed here is the hole this
// list cannot see (same stated limit as the find-or-surface REFERENCING_SKILLS).
const REFERENCING_SKILLS = [
  "editor/skills/draft-suggestion.md",
  "editor/skills/answer-revision-request.md",
  "editor/skills/answer-cutter-comment.md",
  "editor/skills/answer-note-request.md",
  "editor/skills/answer-todo-request.md",
  "editor/skills/answer-report-request.md",
];

// The responders that can actually re-route INTO a carded kind. answer-report-
// request is excluded: its re-route target is a `suggestion`, which has no
// create_card.py builder and hands off to /editor/draft-suggestion instead.
const RE_ROUTING_SKILLS = REFERENCING_SKILLS.filter(
  (s) => !s.endsWith("answer-report-request.md"),
);

describe("ask-shape doctrine (SSOT + referencing responders)", () => {
  it("SSOT states the rule in its load-bearing form", () => {
    const doc = flat(SSOT);
    // Match the words, not the emphasis markup around them — the whole rule
    // is bolded as one sentence, so DEFAULT/REQUIRED carry no inner `**`.
    expect(doc).toMatch(/panel names the DEFAULT output shape/i);
    expect(doc).toMatch(/request text names the REQUIRED one/i);
    // The operative test, not just the slogan.
    expect(doc).toMatch(/what the ANSWER is, not what the question is about/i);
    // The tell, which is what makes the rule checkable in the moment.
    expect(doc).toMatch(/findings compressed into a rationale field/i);
  });

  it("declares itself an include, not a slash command", () => {
    expect(read(SSOT)).toMatch(/Not a slash command/i);
  });

  it("SSOT keeps the conservative tiebreak — a coin-flip does NOT re-route", () => {
    // Without this, the rule reads as "re-route whenever in doubt", which makes
    // every panel's own affordance unreliable. Deliberate, so pin it.
    expect(flat(SSOT)).toMatch(/genuinely ambiguous, the panel wins/i);
  });

  it("SSOT keeps the mechanism ASYMMETRIC — `suggestion` has no create_card builder", () => {
    // create_card.py's CARDED_BUILDERS covers footnote/citation/note/todo/
    // report/report-request — NOT suggestion. A future edit that flattens this
    // into one uniform "--accept-task-kind" rule would document a call that
    // dies. Pin both halves.
    const doc = flat(SSOT);
    expect(doc).toContain("--accept-task-kind");
    expect(doc).toMatch(/no builder|no `create_card\.py` builder for one/i);
    expect(doc).toMatch(/draft-suggestion/);
  });

  it("states the axis as what the builder NEEDS, not whether one exists", () => {
    // The pre-451 rule was two-valued (has a builder / has none), which is why
    // `citation` — a builder with a PREREQUISITE — was filed under the wrong
    // half. Three tiers, and the axis named.
    const doc = flat(SSOT);
    expect(doc).toMatch(/function of what the target kind's builder NEEDS/i);
    expect(doc).toMatch(/Tier 1 — a SELF-SUFFICIENT builder/i);
    expect(doc).toMatch(/Tier 2 — a builder with a PREREQUISITE YOU DO NOT HOLD/i);
    expect(doc).toMatch(/Tier 3 — NO builder/i);
  });

  it("SSOT does NOT name `citation` as a one-hop create_card re-route (tier 2)", () => {
    // `create_card.py --kind=citation` requires --citekey and hard-refuses a
    // key absent from references.bib (`_require_bib_keys`). A responder
    // re-routing "find me a source" holds no citekey, so the documented call
    // DIES. This leg fails on the pre-451 SSOT, whose tier-1 list read
    // "(`note`, `report`, `todo`, `footnote`, `citation`, `report-request`)".
    const doc = flat(SSOT);
    const tier1 = /Tier 1 — a SELF-SUFFICIENT builder\*\*\s*\(([^)]*)\)/.exec(doc);
    expect(tier1, "tier-1 kind list not found in the SSOT").toBeTruthy();
    expect(tier1![1]).not.toMatch(/citation/);
    // …and it must send the ask to the sourcing specialist instead, with the
    // REASON stated (a destination with no reason goes stale silently).
    expect(doc).toMatch(/find-citation/);
    expect(doc).toMatch(/references\.bib/);
  });

  it("SSOT names the todo-card door for a follow-up, and forbids the hand-edit", () => {
    // There is no door that appends a PENDING ai-requests.json row:
    // apply_response.py's subcommand set has none, and --synthesize-task
    // stamps the running write's own status. Skills used to be told to edit
    // the file. Pin the replacement AND the prohibition.
    const doc = flat(SSOT);
    expect(doc).toMatch(/is a `todo` CARD, never a hand-written Task row/i);
    expect(doc).toMatch(/--kind=todo/);
    expect(doc).toMatch(/--anchor/);
    expect(doc).toMatch(/Never edit `ai-requests\.json` with a file-editing tool/i);
  });

  it.each(REFERENCING_SKILLS)("%s points at the doctrine", (skill) => {
    expect(read(skill)).toContain(POINTER);
  });

  it.each(RE_ROUTING_SKILLS)("%s names the re-route mechanism, not just the rule", (skill) => {
    // A responder told "re-route" with no operable door compresses anyway.
    expect(read(skill)).toContain("--accept-task-kind");
  });

  it.each(REFERENCING_SKILLS)(
    "%s does not re-derive the retired .tex-mutation binary as THE shape axis",
    (skill) => {
      // The pre-doctrine fork: answer-revision-request and answer-note-request
      // both declared "The determining axis is whether resolving the request
      // requires a `.tex` mutation" — a two-valued question with no report arm.
      // This leg fails on the pre-fix tree, which is the point.
      const doc = flat(skill);
      expect(doc).not.toMatch(/determining axis is.{0,80}`?\.tex`? mutation/i);
    },
  );

  it("no skill instructs a bare write to `ai-requests.json` — the census", () => {
    // The leg with teeth. The doctrine was never the part that could
    // misbehave; a skill telling an agent to append a row by hand is — and it
    // reads perfectly. `draft-footnote` said so in as many words ("no helper
    // script for this — edit the file") and `_find-or-surface` + the todo
    // responder each deferred to the same non-existent door.
    //
    // Population DISCOVERED from the skills directory, so a new skill is
    // covered by shipping. Allowlist EMPTY — a hit is ROUTE-it-through-the-
    // contract, never an entry here.
    const dir = join(repoRoot, "editor/skills");
    const skills = readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(skills.length).toBeGreaterThan(15); // canary: the sweep found files
    const offenders: string[] = [];
    for (const f of skills) {
      const doc = flat(`editor/skills/${f}`);
      // The shape: an instruction to APPEND/EDIT/WRITE the file directly.
      if (
        /(append(ing)?|edit(ing)?|writ(e|ing)|add(ing)?)[^.]{0,60}`?ai-requests\.json`?/i.test(doc) &&
        // …unless the sentence is the PROHIBITION itself, or names the door.
        !/never (edit|append)|no such door|no door|apply_response\.py owns/i.test(doc)
      ) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no skill defers to a non-existent follow-up-request door — the M1 census", () => {
    // The pre-451 shape: `answer-todo-request` told an agent to "file a
    // follow-up AI request … via the storage layer, then mark the todo request
    // complete", and `_find-or-surface` §4 named the same door for
    // `draft-footnote`. NO such door exists: `apply_response.py`'s subcommand
    // set creates no request, and `--synthesize-task` stamps the running
    // write's own status, so it can only synthesize the Task a write is
    // DRAINING. A skill that names a door with no mechanism sends the agent to
    // improvise — which for this sidecar means a raw write outside the pen.
    //
    // Population DISCOVERED; allowlist EMPTY. The needle is the deferral SHAPE
    // ("file/create a follow-up … request"), not the word "follow-up" — the
    // replacement text legitimately says "missing-bibkey follow-up" about a
    // TODO CARD, and indicting that would make the honest fix unwritable.
    const dir = join(repoRoot, "editor/skills");
    const skills = readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(skills.length).toBeGreaterThan(15); // canary
    const offenders = skills.filter((f) =>
      /(fil(e|ing)|creat(e|ing)|append(ing)?)[^.]{0,80}follow-up[^.]{0,40}(AI )?request/i.test(
        flat(`editor/skills/${f}`),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("the todo responder routes footnote/citation to real mechanisms", () => {
    // Tier 1 for footnote (self-sufficient builder, one hop) and tier 2 for
    // citation (a handoff — `--kind=citation` requires a --citekey already in
    // references.bib and hard-refuses a missing one). Both must be NAMED, or
    // the branch is back to deferring to nothing.
    const doc = flat("editor/skills/answer-todo-request.md");
    expect(doc).toMatch(/--kind=footnote/);
    expect(doc).toMatch(/find-citation/);
    // …and it must say WHY the citation half is a handoff rather than a hop.
    expect(doc).toMatch(/references\.bib/);
  });

  it("`_find-or-surface` §4 names the todo-card door for draft-footnote", () => {
    const doc = flat(SSOT_FOS);
    expect(doc).toMatch(/--kind=todo/);
    expect(doc).not.toMatch(/fil(e|ing) a `?citation`? follow-up request/i);
  });

  // ---------------------------------------------------------------------------
  // Branch-letter consistency — the leg that catches a HALF-renumbered file.
  //
  // The ask-shape doctrine invites new branches into these classify steps, and
  // inserting one means RE-LETTERING every reference to the branches below it.
  // `6e9c3ecf` inserted the report branch into `answer-revision-request.md`
  // step 2 as (b), pushed the sibling-card branch from (b) to (c), and
  // renumbered NOTHING ELSE — so steps 4/5/6 kept saying "path (b)" about the
  // sibling, and the file used one letter for two different branches. A reader
  // that classifies as (b) report and follows the file in order is then handed
  // the sibling card's schema and landing, and the likely outcome is a DOUBLED
  // answer — report AND sibling card — which `_ask-shape.md` §4 forbids in as
  // many words ("never emit both"). Meanwhile (c) had no landing, no schema and
  // no reply template anywhere in the file.
  //
  // This is a RENDERED-PROSE defect: the responder is dispatched as a fresh
  // subagent whose whole world is this one file (`review.md`: "Run each subskill
  // as a subagent"), so no behavioural test anywhere can see it. Hence a leg.
  //
  // The invariant is EQUALITY, and both directions have teeth:
  //   · a letter referenced but never introduced = the reader is sent to a
  //     branch that does not exist;
  //   · a letter introduced but never referenced = a branch the reader can
  //     CHOOSE and then find no landing for. That is the direction the pre-fix
  //     file failed on ({a,b,c} introduced, {a,b} referenced), and the direction
  //     `answer-note-request.md` failed on too — its report branch had no reply
  //     template — so the fix closed the same hole in both.
  //
  // Population DISCOVERED from the files' own source: any skill whose prose
  // introduces branches as bold `- **(x)**` list leads. A new responder that
  // adopts the shape is covered by shipping. Deliberately NOT every file that
  // contains a letter in parens: `find-citation.md`'s `(a)/(b)/(c)` is an
  // inline enumeration inside one sentence, and `sync-bib-to-library.md`'s
  // `a./b./c.` are procedure STEPS, not classify branches. Both would be false
  // accusations, and a guard that indicts correct files is a guard that gets
  // allowlisted away.
  const BRANCH_INTRO = /^[ \t]*[-*][ \t]+\*\*\(([a-z])\)\*\*/gm;

  // A downstream reference, in the two forms the family actually writes:
  //   `path (b)` · `Path (c)/(d)` · `paths (c)/(d)` · `path a` (Idempotency).
  // The bare-letter form REQUIRES the letter to be a standalone token — without
  // the lookahead, "this path needs nothing" reads as a reference to branch (n).
  // Measured: that exact sentence appeared in this task's own first draft.
  const LETTER = String.raw`(?:\([a-z]\)|[a-z](?![A-Za-z]))`;
  const PATH_REF = new RegExp(
    String.raw`\bpaths?\b[ \t]*(${LETTER}(?:[ \t]*\/[ \t]*${LETTER})*)`,
    "gi",
  );
  // …plus a bare `(x)` parenthetical anywhere in the tail, for a downstream
  // cross-reference that omits the word "path". Counted ONLY for a letter the
  // classify step actually introduced, which makes this needle one-directional
  // by construction: it can soften the ORPHANED verdict and can never invent a
  // DANGLING one. That is the right asymmetry — a false FAIL on a correct file
  // is what gets a guard allowlisted away — and it is also what keeps English
  // out of the census: `paragraph(s)` is not a reference to a branch (s), and
  // without the filter it is a dangling letter in both files. Measured on the
  // pre-fix tree this softens nothing: the bare-paren set and the path-context
  // set are identical in both files.
  const BARE_REF = /\(([a-z])\)/g;

  const lettersIn = (chunk: string) =>
    (chunk.match(/[a-z]/gi) ?? []).map((c) => c.toLowerCase());

  const branchSkills = readdirSync(join(repoRoot, "editor/skills"))
    .filter((f) => f.endsWith(".md"))
    .filter((f) => BRANCH_INTRO.test(read(`editor/skills/${f}`)));

  it("the branch-letter census finds the responders that letter their branches", () => {
    // Canary: a needle that matched nothing would make every leg below vacuous.
    expect(branchSkills.length).toBeGreaterThan(0);
    expect(branchSkills).toContain("answer-revision-request.md");
    expect(branchSkills).toContain("answer-note-request.md");
  });

  it.each(branchSkills)(
    "%s references exactly the branch letters its classify step introduces",
    (file) => {
      const src = read(`editor/skills/${file}`);
      const intros = [...src.matchAll(new RegExp(BRANCH_INTRO.source, "gm"))];
      const introduced = new Set(intros.map((m) => m[1]));

      // Everything after the LAST branch marker is "downstream" — the landing,
      // the schemas, the reply templates, the idempotency guard. A letter
      // cross-referenced from inside the classify step itself ("route to (c)")
      // is not a landing and deliberately does not count.
      const last = intros[intros.length - 1];
      const tail = src.slice(last.index! + last[0].length);

      const referenced = new Set<string>();
      for (const m of tail.matchAll(PATH_REF)) {
        for (const L of lettersIn(m[1])) referenced.add(L);
      }
      for (const m of tail.matchAll(BARE_REF)) {
        if (introduced.has(m[1])) referenced.add(m[1]);
      }

      const sorted = (s: Set<string>) => [...s].sort();
      const orphaned = sorted(introduced).filter((L) => !referenced.has(L));
      const dangling = sorted(referenced).filter((L) => !introduced.has(L));

      expect(
        { orphaned, dangling },
        `${file}: introduced ${sorted(introduced).join(",")} / referenced ` +
          `${sorted(referenced).join(",")}. An ORPHANED letter is a branch the ` +
          `reader can choose and then find no landing for; a DANGLING one sends ` +
          `the reader to a branch that does not exist. Re-lettering a classify ` +
          `step means re-lettering every reference below it.`,
      ).toEqual({ orphaned: [], dangling: [] });
    },
  );

  it("the two responders that ask a shape question can reach a report", () => {
    // The specific capability the binary axis foreclosed. Named skills rather
    // than swept, because these two are where the fork actually lived.
    for (const s of [
      "editor/skills/answer-revision-request.md",
      "editor/skills/answer-note-request.md",
    ]) {
      expect(read(s)).toMatch(/--kind=report/);
    }
  });
});
