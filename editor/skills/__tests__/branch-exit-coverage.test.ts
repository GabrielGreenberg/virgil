// @vitest-environment node
//
// A classify branch that DRAINS the Task must say where to go next (task 787).
//
// Every free-text responder carries an ask-shape step (`_ask-shape.md`) whose
// re-route branch lands a card in ONE `create_card.py --accept-task-kind …`
// call — the report for a findings-shaped ask. That call completes the Task.
// The skill's LATER steps, though, were written for its default output (the
// cut, the suggestion, the note), and a branch inserted into a classify step
// is exactly the edit that forgets to tell them (task 452's class, one family
// over). `answer-cutter-comment` said "that call drains the Task" and stopped:
// an agent that read on through step 5 landed a stray cut proposal, and
// `apply_response.py` re-opened the completed Task as `in-progress`. The
// contract now refuses that write (the Python leg in
// `test_propose_accept_slice.py`); this file guards the TEXT that should have
// stopped the agent from attempting it.
//
// Two legs, both over a DISCOVERED population (every non-include skill file):
//
//   1. EXIT. A step holding a draining re-route fence, followed by a later
//      step that would land a SECOND ANSWER (a `create_card.py` call or a
//      Task-completing `apply_response.py` subcommand), must name its onward
//      route — "skip … go straight to step N" / "continue at step N" — and N
//      must be a real, LATER step. Not every
//      drain skips to the reply: `answer-todo-request`'s report still owes
//      step 4 (mark the source todo done), which is why the rule is "name the
//      route", not "skip to the end".
//   2. HEADING. A step heading that scopes itself to path letters —
//      `*(paths (c)/(d))*` — must name every path whose `**Path (x)`
//      instructions its body holds. `answer-note-request` step 4 was headed
//      `(paths (c)/(d))` while carrying path (a)'s only landing instructions;
//      an agent on path (a) reading the heading skipped them.
//
// STATED LIMIT: leg 1 reads the fence's own step only — a skill that routes
// the exit from a LATER step's preamble ("Path (b) … needs nothing from steps
// 4 and 5") satisfies the reader but not this leg. Say it at the branch; that
// is where the reader is when the call returns.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { readRepo as read, repoRoot } from "./_review-routes";

const SKILLS_DIR = "editor/skills";

const SKILL_FILES = readdirSync(join(repoRoot, SKILLS_DIR))
  .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
  .map((f) => `${SKILLS_DIR}/${f}`)
  .sort();

interface Step {
  n: number;
  heading: string; // the step's first line
  body: string; // every line of the step, heading included
}

/** Top-level numbered steps of the `## Procedure` section. */
function procedureSteps(md: string): Step[] {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^## Procedure\b/.test(l));
  if (start < 0) return [];
  const steps: Step[] = [];
  let cur: Step | null = null;
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    const m = /^(\d+)\. \*\*/.exec(line);
    if (m) {
      cur = { n: Number(m[1]), heading: line, body: line };
      steps.push(cur);
    } else if (cur) {
      cur.body += "\n" + line;
    }
  }
  return steps;
}

const fences = (body: string) => [...body.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);

/** A re-route that drains the Task in one call. */
const isDrainingReroute = (fence: string) =>
  /create_card\.py/.test(fence) && /--accept-task-kind/.test(fence);

/** A later step that would land a SECOND ANSWER to the same Task — a card
 *  build or a Task-completing contract call. A mutation op on the SOURCE card
 *  (`apply_response.py … update`, answer-todo-request's step 4 marking the
 *  todo done) is the drain's own follow-through, not a second answer. */
const landsAnAnswer = (s: Step) =>
  fences(s.body).some(
    (f) =>
      /create_card\.py/.test(f) ||
      /apply_response\.py\s+\S+\s+(?:complete-task|complete-only|write-silent|write-with-comment)\b/.test(f),
  );

const isReply = (s: Step) => /^\d+\. \*\*Reply\b/.test(s.heading);

const flat = (s: string) => s.replace(/\s+/g, " ");

/** Step numbers an onward-route phrase names ("go straight to … step 6"). */
function exitTargets(body: string): number[] {
  const re = /\b(?:go straight to|skip to|continue at|continue with|proceed to)\b[^.]{0,60}?\bstep (\d+)/gi;
  return [...flat(body).matchAll(re)].map((m) => Number(m[1]));
}

function drainSites(file: string) {
  const steps = procedureSteps(read(file));
  return steps
    .filter((s) => fences(s.body).some(isDrainingReroute))
    .filter((s) => steps.some((t) => t.n > s.n && !isReply(t) && landsAnAnswer(t)))
    .map((s) => ({ step: s, steps }));
}

describe("responder branch exits (task 787)", () => {
  it("the population is non-empty and reaches the known drain sites", () => {
    // A parser regression that finds no sites would pass every leg vacuously.
    const withSites = SKILL_FILES.filter((f) => drainSites(f).length > 0);
    for (const f of [
      "editor/skills/answer-cutter-comment.md",
      "editor/skills/answer-note-request.md",
      "editor/skills/answer-revision-request.md",
      "editor/skills/answer-todo-request.md",
      "editor/skills/draft-suggestion.md",
      "editor/skills/draft-footnote.md",
    ]) {
      expect(withSites, `${f} should carry a draining re-route site`).toContain(f);
    }
  });

  for (const file of SKILL_FILES) {
    for (const { step, steps } of drainSites(file)) {
      it(`${file} step ${step.n}: the draining re-route names its onward step`, () => {
        const targets = exitTargets(step.body);
        expect(
          targets.length,
          `step ${step.n} drains the Task via create_card.py --accept-task-kind but never ` +
            `says where to go next — a later step lands a card, and a fall-through ` +
            `writes a second answer. Add "skip … go straight to step N" (or "continue at step N").`,
        ).toBeGreaterThan(0);
        const numbers = new Set(steps.map((s) => s.n));
        for (const t of targets) {
          expect(numbers.has(t), `step ${step.n} routes to step ${t}, which does not exist`).toBe(true);
          expect(t, `step ${step.n} routes BACKWARD to step ${t}`).toBeGreaterThan(step.n);
        }
      });
    }
  }

  for (const file of SKILL_FILES) {
    for (const step of procedureSteps(read(file))) {
      const scope = /\*\(paths? ((?:\([a-z]\)\/?)+)(?: only)?\)\*/.exec(step.heading);
      if (!scope) continue;
      it(`${file} step ${step.n}: the heading's path scope covers every path it instructs`, () => {
        const named = new Set([...scope[1].matchAll(/\(([a-z])\)/g)].map((m) => m[1]));
        const held = new Set([...step.body.matchAll(/\*\*Path \(([a-z])\)/g)].map((m) => m[1]));
        for (const p of held) {
          expect(
            named.has(p),
            `step ${step.n} is headed for paths ${[...named].join("/")} but holds path (${p})'s ` +
              `instructions — an agent on (${p}) reading the heading skips them`,
          ).toBe(true);
        }
      });
    }
  }
});
