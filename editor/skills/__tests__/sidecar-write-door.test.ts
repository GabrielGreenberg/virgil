// @vitest-environment node
//
// A skill finalizes a card through the contract, never by a file edit (task 785).
//
// `answer-todo-request` step 4 told the agent to flip the source todo's `done`
// with "a small post-step Edit" of `<docPath>/virgil/todos.json`, on the claim
// that the contract had no op for it. It does — `apply_response.py update`
// (`/editor/edit-card --field done=true`) is atomic, pen-protected and
// version-bumped — and a raw Edit outside the pen races the app's autosave of
// the same sidecar. The same step also claimed `/editor/review` "re-lists" an L3
// proposal's Task until the user accepts; `is_request_open` treats an
// `in-progress` Task WITH a `resultId` as ANSWERED, so it never does.
//
// This census holds both: no skill instructs an Edit/Write of a `.json` sidecar
// (a negated line — "never", "don't", "do not" — is the doctrine, not an
// instruction), and answer-todo-request's step 4 names the `update` door.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillFiles = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"));

/** The dev meta-skill seeds requests into a SANDBOX copy of the sample paper
 *  by hand — it is the harness that exercises the doors, not a caller of them. */
const SANDBOX_HARNESS = new Set(["iterate-virgil-editor.md"]);

const FILE_TOOL = /\b(Edit|Write)\b/;
const SIDECAR = /\b[\w-]+\.json\b/;
const NEGATED = /\b(never|not|don't|do not|no)\b/i;

function read(file: string): string {
  return readFileSync(join(SKILLS_DIR, file), "utf8");
}

describe("skills write sidecars only through the contract (task 785)", () => {
  it("no skill instructs a file-tool Edit/Write of a .json sidecar", () => {
    const offenders: string[] = [];
    for (const file of skillFiles) {
      if (SANDBOX_HARNESS.has(file)) continue;
      read(file)
        .split("\n")
        .forEach((line, i) => {
          if (FILE_TOOL.test(line) && SIDECAR.test(line) && !NEGATED.test(line)) {
            offenders.push(`${file}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("no skill claims a missing flipDone op or a post-step sidecar Edit", () => {
    for (const file of skillFiles) {
      const src = read(file);
      expect(src, file).not.toMatch(/flipDone/);
      expect(src, file).not.toMatch(/post-step Edit/);
    }
  });

  it("answer-todo-request step 4 marks the todo done through the update op", () => {
    const src = read("answer-todo-request.md");
    const step4 = src.slice(
      src.indexOf("4. **Finalize the source todo"),
      src.indexOf("5. **Reply.**"),
    );
    expect(step4).toMatch(/apply_response\.py <docPath> update '\{"cardId":"<cardId>","set":\{"done":true\}\}'/);
    // The L3 sentence matches is_request_open: an answered proposal is NOT re-listed.
    expect(step4).not.toMatch(/re-lists the Task/);
    expect(step4).toMatch(/does \*\*not\*\* re-list/);
  });
});
