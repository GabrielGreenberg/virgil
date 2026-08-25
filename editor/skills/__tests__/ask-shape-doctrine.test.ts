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
