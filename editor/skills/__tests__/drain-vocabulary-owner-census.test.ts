// @vitest-environment node
//
// CENSUS — the drain's two vocabularies are stated by their OWNERS, and a skill
// that needs one cites it rather than copying it (task 1597).
//
// 1. "Which ai-requests rows are open" is `list_requests.py`'s decision (its
//    one gate is `_common.is_request_open`). review.md's step 2 restated the
//    status set as "`pending` | `in-progress` … are open" and dropped the
//    answered-Level-3 exception (`in-progress` WITH a `resultId`), so an agent
//    reconciling against ai-requests.json saw those rows "missing". A paragraph
//    that spells an open-status set must name the owner.
// 2. The Task outcome vocabulary (`silent-applied` / `auto-applied` /
//    `direct-created`) is spelled once, in `_safety-levels.md` beside the level
//    mapping it follows. Its only copy lived inline in review.md. A paragraph
//    that re-lists all three must cite the include (a markdown TABLE that
//    classifies results — reflect.md's tiering — is a consumer, not a mapping).
// 3. review.md's kind-only `suggestion` fallback glossed draft-suggestion's
//    scope as "no `linkedTo` at all"; draft-suggestion's own ownership table
//    also takes a notes/todos/reports-bridged Task. The route cites the table.

import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { readRepo as read, repoRoot } from "./_review-routes";

const SKILLS = "editor/skills";
const INCLUDE = "_safety-levels.md";

/** An inline open-status set: two or more status tokens, then "are open". */
const OPEN_SET = /`(?:pending|in-progress|draft|submitted)`[\s\S]{0,120}?`(?:pending|in-progress|draft|submitted)`[\s\S]{0,160}?\bare open\b/i;
const OPEN_OWNER = /list_requests\.py|is_request_open/;
const OUTCOMES = ["silent-applied", "auto-applied", "direct-created"];

function blocks(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let start = 0;
  let buf: string[] = [];
  src.split("\n").forEach((l, i) => {
    if (l.trim() === "") {
      if (buf.length) out.push({ line: start + 1, text: buf.join("\n") });
      buf = [];
    } else {
      if (!buf.length) start = i;
      buf.push(l);
    }
  });
  if (buf.length) out.push({ line: start + 1, text: buf.join("\n") });
  return out;
}

const body = (src: string) => src.replace(/^---\n[\s\S]*?\n---\n/, "");
const isTable = (text: string) => text.split("\n").every((l) => l.trim().startsWith("|"));

function openSetViolations(src: string): number[] {
  return blocks(body(src))
    .filter(({ text }) => OPEN_SET.test(text) && !OPEN_OWNER.test(text))
    .map((b) => b.line);
}

function outcomeViolations(src: string): number[] {
  return blocks(body(src))
    .filter(({ text }) => !isTable(text) && OUTCOMES.every((o) => text.includes(o)) && !text.includes(INCLUDE))
    .map((b) => b.line);
}

const skillFiles = readdirSync(join(repoRoot, SKILLS))
  .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
  .sort();

describe("drain vocabulary owner census (task 1597)", () => {
  it("the owners still state what the skills cite", () => {
    const lr = read("editor/scripts/list_requests.py");
    expect(lr).toMatch(/is_request_open/);
    const common = read("editor/scripts/_common.py");
    expect(common).toMatch(/def is_request_open[\s\S]*?resultId/);
    const inc = read(`${SKILLS}/${INCLUDE}`);
    for (const o of OUTCOMES) expect(inc).toContain(o);
    const door = read("editor/scripts/apply_response.py");
    for (const o of OUTCOMES) expect(door).toContain(`"${o}"`);
  });

  it("detectors catch the pre-fix restatements (non-vacuous)", () => {
    expect(
      openSetViolations(
        '   "Open" is **not-terminal**: `pending` | `in-progress` (and the legacy\n' +
          "   `draft` | `submitted`, and a status-absent row) are open; `complete` |",
      ),
    ).toHaveLength(1);
    expect(
      outcomeViolations(
        "   stamps the two-field `status`/`result` (`complete` + `silent-applied` /\n" +
          "   `auto-applied` / `direct-created`, or `in-progress` for a level-3 proposal).",
      ),
    ).toHaveLength(1);
    expect(
      outcomeViolations("| `silent-applied` / `auto-applied` / `direct-created` / `accepted` | `unremarkable` |"),
    ).toHaveLength(0);
  });

  it.each(skillFiles)("%s spells no open-status set without citing list_requests.py", (f) => {
    expect(openSetViolations(read(`${SKILLS}/${f}`))).toEqual([]);
  });

  it.each(skillFiles)("%s re-lists no outcome vocabulary without citing _safety-levels.md", (f) => {
    expect(outcomeViolations(read(`${SKILLS}/${f}`))).toEqual([]);
  });

  it("review.md's kind-only suggestion fallback cites draft-suggestion's ownership table", () => {
    const review = read(`${SKILLS}/review.md`);
    const route = review.slice(review.indexOf("`kind: \"suggestion\"` → `/editor/draft-suggestion"));
    const gloss = route.slice(0, route.indexOf("\n\n"));
    expect(gloss).toContain("draft-suggestion.md");
    expect(gloss).not.toMatch(/no `linkedTo` at all/);
  });
});
