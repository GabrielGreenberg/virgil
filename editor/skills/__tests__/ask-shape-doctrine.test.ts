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

import { readFileSync } from "node:fs";
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
    expect(doc).toMatch(/no `create_card\.py` builder for one/i);
    expect(doc).toMatch(/draft-suggestion/);
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
