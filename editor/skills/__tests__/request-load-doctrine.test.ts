// @vitest-environment node
//
// Census for the REQUEST-LOAD rule (`editor/skills/_request-load.md`, task 980).
//
// A bridged AI-request row's stored `text` is a bridge-time SNAPSHOT; the live
// ask is the drain row's `text`, which `list_requests.py` reads from the linked
// card's CURRENT body (task 955). Task 955 fixed that doctrine inline in the two
// suggestion responders only — `answer-todo-request`, `answer-note-request`,
// `draft-suggestion`, `draft-footnote` and `style-merge` kept loading "the
// request from `ai-requests.json`". So the rule is now authored ONCE and linked,
// and this census holds three legs:
//
//   1. every `/editor/review` dispatch target that receives an ai-requests row
//      carries the pointer (population DISCOVERED from the step-3 table, never
//      hand-listed);
//   2. no skill says it loads its request from the raw `ai-requests.json`;
//   3. any skill stamping `<request.text>` carries the pointer that defines it.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { readRepo as read, repoRoot, reviewRoutes } from "./_review-routes";

// Hard-wrapped prose re-wraps freely; every phrase check runs on a flat copy.
const flat = (rel: string) => read(rel).replace(/\s+/g, " ");

const SSOT = "editor/skills/_request-load.md";
const POINTER = "[_request-load.md](_request-load.md)";

/** Dispatch targets whose rows do NOT come from `ai-requests.json`, and why.
 *  Exact set; each claim is checked below (still a target, still only for the
 *  stated kind). */
const EXCLUDED: Record<string, { kinds: string[]; why: string }> = {
  "editor/skills/answer-bib-review.md": {
    kinds: ["bib-review"],
    why:
      "its rows come from `bib-review-requests.json`, keyed on a bibKey — " +
      "there is no bridged ai-requests row to snapshot.",
  },
};

const routes = reviewRoutes();
const POPULATION = [...new Set(routes.map((r) => r.file))]
  .filter((f) => !(f in EXCLUDED))
  .sort();

const SKILLS = readdirSync(join(repoRoot, "editor/skills"))
  .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
  .map((f) => `editor/skills/${f}`);

/** The raw-row load sentence, in the spellings it has actually taken. */
const RAW_LOAD = [
  /request[^.`]{0,30}\bfrom\s+`(?:<docPath>\/virgil\/)?ai-requests\.json`/i,
  /\bRead\s+`(?:<docPath>\/virgil\/)?ai-requests\.json`/,
  /\bits row in\s+`(?:<docPath>\/virgil\/)?ai-requests\.json`/,
];

describe("request-load rule (SSOT + every responder)", () => {
  it("SSOT states the rule and why", () => {
    const doc = flat(SSOT);
    expect(doc).toMatch(/reads its request from the DRAIN ROW/);
    expect(doc).toMatch(/never from the raw `ai-requests\.json` row/);
    expect(doc).toMatch(/SNAPSHOT/);
    expect(doc).toMatch(/list_requests\.py/);
    expect(read(SSOT)).toMatch(/Not a slash command/i);
  });

  it("the population is non-trivial (the dispatch table parsed)", () => {
    // A parser regression yielding [] would pass every leg vacuously.
    expect(POPULATION.length).toBeGreaterThanOrEqual(8);
    expect(POPULATION).toContain("editor/skills/answer-todo-request.md");
    expect(POPULATION).toContain("editor/skills/style-merge.md");
  });

  it.each(POPULATION)("%s links the request-load rule", (file) => {
    expect(read(file)).toContain(POINTER);
  });

  it.each(Object.entries(EXCLUDED))(
    "exclusion %s is still a dispatch target for exactly its stated kinds",
    (file, { kinds }) => {
      const routed = routes.filter((r) => r.file === file).map((r) => r.kind);
      expect(routed.length).toBeGreaterThan(0);
      expect([...new Set(routed)].sort()).toEqual([...kinds].sort());
    },
  );

  it.each(SKILLS)("%s never loads its request from the raw ai-requests.json row", (file) => {
    const doc = flat(file);
    for (const re of RAW_LOAD) expect(doc).not.toMatch(re);
  });

  it.each(SKILLS)("%s: any `<request.text>` stamp is defined by the rule", (file) => {
    if (!read(file).includes("<request.text>")) return;
    expect(read(file)).toContain(POINTER);
  });
});
