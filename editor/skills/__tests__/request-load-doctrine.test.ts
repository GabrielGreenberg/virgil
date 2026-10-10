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
//
// Task 1045 adds the IDEMPOTENCY legs: the "already answered?" check is stated
// once in the SSOT. Before, four responders each restated it in their own words
// — two as a bare `status: "complete"` test (which reads the raw row the rule
// forbids and misses the answered-L3 `in-progress`+`resultId` state), one skill
// had none, and two COMPLETING limit paths replied "Skipped", the word the rest
// use for "did nothing". So:
//
//   4. no skill makes its own `status: "complete"` skip test;
//   5. every `Skipped <requestId>` reply template is the SSOT's exact one;
//   6. a skill's `## Idempotency` section links the SSOT;
//   7. every per-request dispatch target carries that section — population
//      DERIVED from the dispatch table (task 1047: a hand list of the five
//      skills 1045 edited let draft-footnote / find-citation / draft-suggestion
//      keep their own "status is open" tests).

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

describe("idempotency rule (SSOT + every responder, task 1045)", () => {
  /** The SSOT's one reply for a closed request / writer noop. */
  const SKIP_REPLY = "Skipped <requestId> (already answered).";

  it("SSOT states the rule: drain decides, writers are the belt, Skipped means nothing happened", () => {
    const doc = flat(SSOT);
    expect(doc).toMatch(/## Idempotency/);
    expect(doc).toContain(SKIP_REPLY);
    expect(doc).toMatch(/Do \*\*not\*\* test the row's `status` yourself/);
    expect(doc).toMatch(/`in-progress` WITH a `resultId`/);
    expect(doc).toMatch(/"noop": true/);
    expect(doc).toMatch(/`Skipped` means nothing happened/);
    expect(doc).toMatch(/Done: <requestId> — could not act: <reason>\./);
  });

  it.each(SKILLS)("%s makes no `status: \"complete\"` skip test of its own", (file) => {
    const doc = flat(file);
    // The spellings the forked sections took: "If the request is already
    // `status: "complete"`, skip" and "… or the request is already `status: …`",
    // and the validate-step form "the status is open (not the terminal
    // `complete` / `failed` …)" (task 1047).
    expect(doc).not.toMatch(/already `status: "complete"`/);
    expect(doc).not.toMatch(/if the request is already (?:`status|complete)/i);
    expect(doc).not.toMatch(/\bstatus is open\b/i);
    expect(doc).not.toMatch(/not the terminal `complete`/);
  });

  it.each(SKILLS)("%s: every `Skipped <requestId>` reply is the SSOT's", (file) => {
    const replies = read(file).match(/Skipped <requestId>[^\n]*/g) ?? [];
    for (const r of replies) expect(r.trim()).toBe(SKIP_REPLY);
  });

  it.each(SKILLS)("%s: an Idempotency section links the SSOT", (file) => {
    const m = read(file).match(/^## Idempotency\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
    if (!m) return;
    expect(m[1]).toContain(POINTER);
  });

  /** Dispatch targets with no per-request reply, and why. Exact set; each
   *  claim is checked below. */
  const IDEMPOTENCY_EXCLUDED: Record<string, string> = {
    "editor/skills/style-merge.md":
      "a batch over the drain's open style-merge rows — its Args take no " +
      "`<requestId>`, so a closed request is never in its input and there is " +
      "no per-request reply to skip.",
  };
  const IDEMPOTENCY_POPULATION = POPULATION.filter((f) => !(f in IDEMPOTENCY_EXCLUDED));

  it("the idempotency population is the dispatch table minus a checked exclusion", () => {
    expect(IDEMPOTENCY_POPULATION.length).toBeGreaterThanOrEqual(8);
    expect(IDEMPOTENCY_POPULATION).toContain("editor/skills/draft-footnote.md");
    for (const file of Object.keys(IDEMPOTENCY_EXCLUDED)) {
      expect(POPULATION).toContain(file);
      // Its `## Args` take no request id (it reads ids off the drain rows).
      const args = read(file).match(/^## Args\n([\s\S]*?)(?=^## )/m);
      expect(args).not.toBeNull();
      expect(args![1]).not.toContain("<requestId>");
    }
  });

  it.each(IDEMPOTENCY_POPULATION)("%s carries the linked Idempotency section", (file) => {
    const m = read(file).match(/^## Idempotency\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
    expect(m).not.toBeNull();
    expect(m![1]).toContain(POINTER);
  });
});
