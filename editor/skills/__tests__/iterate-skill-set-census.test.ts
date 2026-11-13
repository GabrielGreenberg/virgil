// @vitest-environment node
//
// `/editor/iterate-virgil-editor` names, by hand, the skills it may iterate and
// the request kinds it may inject. Both are PROJECTIONS of `/editor/review`'s
// step-3 dispatch table — itself pinned to `ai_request_routing.json` by
// `dispatch-coverage.test.ts` — and both went stale (task 1430):
// `answer-report-request` was routed but un-iterable, and the injection list
// carried `quotation` (routed to no skill) while omitting `report` and
// `highlight`. This census derives the population from the table (two hops
// from the manifest) so a newly routed skill or kind cannot fall out again.

import { describe, expect, it } from "vitest";
import { readRepo, reviewRoutes } from "./_review-routes";

const ITERATE = "editor/skills/iterate-virgil-editor.md";

/** The `<skill-name> ∈ {…}` set, newlines collapsed. */
function allowedSkills(md: string): Set<string> {
  const m = md.replace(/\n\s*/g, " ").match(/`<skill-name>` ∈ `\{([^}]*)\}`/);
  if (!m) throw new Error(`${ITERATE}: no \`<skill-name>\` ∈ {…} set found`);
  return new Set(m[1].split(",").map((s) => s.trim()).filter(Boolean));
}

/** The numbered "Skill-iteration order" list. */
function orderedSkills(md: string): string[] {
  const sec = md.split("## Skill-iteration order")[1]?.split("\n## ")[0] ?? "";
  return [...sec.matchAll(/^\d+\.\s+`([a-z-]+)`/gm)].map((m) => m[1]);
}

/** The `ai-requests.json`: kinds … injection line. */
function injectableKinds(md: string): Set<string> {
  const line = md.split("\n").find((l) => l.startsWith("- `ai-requests.json`: kinds"));
  if (!line) throw new Error(`${ITERATE}: no ai-requests.json injection line`);
  const head = line.split(" — ")[0];
  return new Set([...head.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]).filter((k) => k !== "ai-requests"));
}

describe("iterate-virgil-editor skill set CENSUS (task 1430)", () => {
  const md = readRepo(ITERATE);
  const routes = reviewRoutes();
  const routedSkills = new Set(routes.map((r) => r.file.replace(/^editor\/skills\/|\.md$/g, "")));
  const routedKinds = new Set(routes.map((r) => r.kind));

  it("the dispatch table parses (a vacuous census is a false pass)", () => {
    expect(routes.length).toBeGreaterThan(5);
  });

  it("every skill the umbrella routes to is iterable, plus `review` itself", () => {
    const allowed = allowedSkills(md);
    const missing = [...routedSkills, "review"].filter((s) => !allowed.has(s));
    expect(missing, "routed skills missing from iterate's <skill-name> set").toEqual([]);
  });

  it("the iteration order lists exactly the allowed set", () => {
    expect(new Set(orderedSkills(md))).toEqual(allowedSkills(md));
  });

  it("the injectable ai-requests kinds are exactly the routed kinds bar bib-review", () => {
    const want = new Set([...routedKinds].filter((k) => k !== "bib-review"));
    expect(injectableKinds(md)).toEqual(want);
  });
});

/** The text of one `#### <heading>` subsection. */
function subsection(md: string, heading: string): string {
  return md.split(`#### ${heading}`)[1]?.split(/\n#{2,4} /)[0] ?? "";
}

describe("iterate-virgil-editor tier → next-step CENSUS (task 1607)", () => {
  const md = readRepo(ITERATE);
  const mapper = readRepo("editor/scripts/dev_loop.py");
  const step2d = subsection(md, "2d.");
  const step2e = subsection(md, "2e.");

  it("both steps parse (a vacuous census is a false pass)", () => {
    expect(step2d.length).toBeGreaterThan(200);
    expect(step2e.length).toBeGreaterThan(200);
  });

  it("the tier rule is CITED from its owner, not restated", () => {
    expect(mapper).toMatch(/^def tier_for_iteration\(/m);
    expect(step2d).toContain("tier_for_iteration");
    expect(step2e).toContain("tier_for_iteration");
  });

  it("2e gives every result the mapper reads its own row — a failure and a partial are never 'clean'", () => {
    // The `result ==` values tier_for_iteration branches on.
    const body = mapper.split(/^def tier_for_iteration\(/m)[1]?.split(/^def /m)[0] ?? "";
    const results = [...new Set([...body.matchAll(/result == "([a-z]+)"/g)].map((m) => m[1]))];
    expect(results.sort()).toEqual(["failure", "partial"]);
    const rows = step2e.split("\n").filter((l) => l.startsWith("- **"));
    for (const r of results) {
      const row = rows.find((l) => l.startsWith(`- **\`result: ${r}\``));
      expect(row, `2e has no row for result: ${r}`).toBeDefined();
      expect(row).toMatch(/NOT clean|Not clean/);
    }
  });

  it("the memo path is never cwd-relative (iterations_root lives in the primary checkout)", () => {
    expect(md).not.toMatch(/`editor\/dev\/iterations\/<date>/);
  });
});
