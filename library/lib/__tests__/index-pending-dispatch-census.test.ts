/**
 * Task 794 — `/library/index-pending` step 2 is THE dispatch table for the
 * Library queue: every `QueueKind` the app can write must have a row there,
 * or a request of that kind sits in `.virgil/queue/` forever with nobody
 * routing it (as `paper-review` did). The note override is stated once, in
 * `ai-requests.md` "What counts as an AI request"; index-pending points to it.
 *
 * Also pins the detached-drain poll: it must ask the queue door for the
 * NATIVE pending count, never count `*.json` files — the drain leaves every
 * deferred request (and the review manifest) in the folder, so a file count
 * can never reach zero.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { QUEUE_KINDS } from "../queue";

const SKILLS = path.resolve(__dirname, "../../skills");
const indexPending = fs.readFileSync(path.join(SKILLS, "index-pending.md"), "utf8");
const aiRequests = fs.readFileSync(path.join(SKILLS, "ai-requests.md"), "utf8");

function step2(): string {
  const start = indexPending.indexOf("2. **Dispatch deferred kinds.**");
  const end = indexPending.indexOf("3. **", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return indexPending.slice(start, end);
}

/** kind → route text, from the step-2 table rows `| \`kind\` | route |`. */
function routes(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of step2().matchAll(/^\s*\|\s*`([A-Za-z-]+)`\s*\|\s*(.+?)\s*\|\s*$/gm)) {
    out.set(m[1], m[2]);
  }
  return out;
}

describe("index-pending dispatch census", () => {
  it("routes every QueueKind, and nothing that is not one", () => {
    const table = routes();
    expect([...table.keys()].sort()).toEqual([...QUEUE_KINDS].sort());
    for (const [kind, route] of table) {
      expect(route, `${kind} has an empty route`).toMatch(/→/);
    }
  });

  it("sends paper-review and noted authenticate/deepIndex to /library/ai-requests", () => {
    const table = routes();
    expect(table.get("paper-review")).toContain("/library/ai-requests");
    expect(table.get("authenticate")).toMatch(/\[note\].*\/library\/ai-requests/);
    expect(table.get("deepIndex")).toMatch(/\[note\].*\/library\/ai-requests/);
  });

  it("defers the note rule to ai-requests.md's one statement of it", () => {
    const heading = "What counts as an AI request";
    expect(aiRequests).toContain(`## ${heading}`);
    expect(step2()).toContain(heading);
  });

  it("polls the native pending count, never a *.json file count", () => {
    expect(indexPending).not.toMatch(/ls[^\n`]*queue\/\*\.json/);
    expect(indexPending).toContain("queue_slot.py");
    expect(indexPending).toMatch(/pending --native --count/);
  });
});
