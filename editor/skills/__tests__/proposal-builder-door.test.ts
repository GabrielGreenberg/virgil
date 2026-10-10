// @vitest-environment node
//
// The proposal family has ONE builder door (task 1044).
//
// Five responder skills used to make the model hand-assemble a suggestion (or
// a Revisions sibling-comment) card — ids, timestamps, the self-link, the
// anchor copy, `original_text` — and pass it to
// `apply_response.py complete-task --propose`. The schema was stated at five
// callers (task 783 had to re-stamp the self-link kind four of them wrote
// wrong), and `original_text` was first checked at ACCEPT, so a paraphrase
// landed as a proposal the user could only watch go stale. Now
// `create_card.py --kind=suggestion|comment` builds the card and the write door
// refuses a non-verbatim span before any byte lands
// (`editor/scripts/tests/test_proposal_builder.py`).
//
// THIS census keeps the schema from drifting back into the markdown: no skill
// carries a hand-built proposal JSON block or calls the propose subcommand
// itself, and every responder that can answer with a suggestion names the door.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillFiles = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"));
const read = (f: string) => readFileSync(join(SKILLS_DIR, f), "utf8");

/** The responders that answer some Task with a suggestion proposal. */
const PROPOSING_RESPONDERS = [
  "draft-suggestion.md",
  "answer-cutter-comment.md",
  "answer-revision-request.md",
  "answer-note-request.md",
  "answer-todo-request.md",
  "answer-report-request.md",
];

describe("proposal family — one builder door (task 1044)", () => {
  it("the population is real (every listed responder exists)", () => {
    for (const f of PROPOSING_RESPONDERS) expect(skillFiles, f).toContain(f);
  });

  it("no skill hand-builds a suggestion / revision-comment card JSON", () => {
    const bad = skillFiles.filter((f) =>
      /"kind"\s*:\s*"(suggestion|comment)"/.test(read(f)),
    );
    expect(bad).toEqual([]);
  });

  it("no skill invokes the propose subcommand itself", () => {
    const bad = skillFiles.filter((f) =>
      /apply_response\.py\s+<docPath>\s+complete-task\s+--propose/.test(read(f)),
    );
    expect(bad).toEqual([]);
  });

  it.each(PROPOSING_RESPONDERS)("%s lands its proposal through --kind=suggestion", (f) => {
    expect(read(f)).toMatch(/create_card\.py <docPath> <requestId> --kind=suggestion/);
  });
});
