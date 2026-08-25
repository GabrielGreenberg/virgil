// @vitest-environment node
//
// Drift guard for the cross-silo "find-or-surface, never fabricate"
// doctrine. The doctrine is authored ONCE but must ship in BOTH skill
// bundles (editor + library land in separate on-disk folders, so each
// silo carries a local `_find-or-surface.md` for its skills'
// `[_find-or-surface.md](_find-or-surface.md)` links to resolve). This
// test makes the two copies a single source of truth in practice: if
// they diverge, or if a sourcing skill drops its pointer back to the
// doctrine (re-paraphrasing the rule inline — the very drift this guard
// eliminates), the test fails.
//
// THE POPULATION IS DISCOVERED (task 462). Until then the coverage leg
// ran off a hand-written eight-entry `REFERENCING_SKILLS` array whose
// own comment declared it "the MIRROR IMAGE of the doctrine body's own
// enumeration" — i.e. two hand-typed lists kept in step by hand. Task
// 159 had already aligned those two lists with each other once; five
// weeks later they agreed with each other and no longer agreed with
// reality. It was missing at least two names, and they were the sharp
// ones: `library/skills/index-paper.md`, whose step 4 hands the AGENT a
// four-tier ladder for filling nine-plus BibTeX fields from the open web
// and then stamps `bib.state = "authenticated"` on the user's canonical
// `master.bib` row; and `library/skills/ai-requests.md`, the only
// instruction in either silo that says fill bib fields from a user's
// free-text note with NO acceptance bar at all ("If it asks you to fill
// missing fields, fill them"), while explicitly opting out of the one
// skill whose tier ladder would have carried the rule.
//
// A hand list can only ever be missing a name (task 448's statement of
// the same rule, one doctrine over; task 453 landed it for the third).
//
// The criterion, in two hops, BOTH read out of the doctrine's own
// OPERATIVE content — never a mirror list kept beside it:
//
//   1. the ```source-databases``` inventory in §3. A skill that spells an
//      authoritative database is reaching one directly, which is the
//      doctrine's whole subject. Self-hosting: a database added to §3
//      widens the census automatically.
//   2. the skills §4 names in its failure-path bullets. A skill whose
//      failure path the doctrine PRESCRIBES BY NAME is a skill the
//      doctrine governs — and that enumeration cannot go stale as
//      bookkeeping, because each entry has to be written as operative
//      prose to exist at all. This hop is what keeps `draft-footnote`,
//      `import-bib` and `sync-bib-to-library` in the population: each
//      delegates its sourcing rather than naming a database itself, so
//      hop 1 structurally cannot see them.
//
// STATED LIMIT, and the reason the doctrine's illustrative parenthesis
// survives as a human cross-check: a skill that sources without naming a
// database AND without a §4 bullet is the hole this criterion cannot
// see. That limit is written into the doctrine at the site, not just
// here.
//
// `_`-prefixed files are excluded by construction rather than by
// allowlist: an include is transcluded into a skill that carries its own
// link and cannot be invoked standalone, so it has no "the agent never
// sees the doctrine" failure mode. (Same rule as
// `latex-allowlist-doctrine.test.ts`.)

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// library/lib/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const LIBRARY_DOCTRINE = "library/skills/_find-or-surface.md";
const EDITOR_DOCTRINE = "editor/skills/_find-or-surface.md";
const POINTER = "_find-or-surface.md";

/** Skills the criterion catches that do NOT source a bibliographic fact.
 *  EXACT SET — a stale entry (one that has since gained its link, or
 *  stopped matching the criterion) fails, and a new entry needs a stated
 *  reason. A hit is LINK-it, never list-it. */
const PERMITTED_NON_SOURCING_SKILLS: Record<string, string> = {
  "library/skills/di-validate.md":
    "its single database name is prose: `arXiv` appears in a list of " +
    "brand-name CamelCase words (`bioRxiv`, `ImageNet`, `ChatGPT`) that a " +
    "heading-capitalization pass must not down-case. It sources nothing.",
  "library/skills/triage-pdf.md":
    "names Crossref/OpenLibrary only to say which seed fields (`isbn`, " +
    "`editor`) make the AUTH PIPELINE's fast paths available downstream; " +
    "the values it writes reach the row through a script's own output, " +
    "never hand-marshalled by the agent — the same claim the sibling " +
    "LaTeX guard already makes for `authenticate-bib`.",
  "library/skills/triage-pending.md":
    "the batch form of the same: its one Crossref reference is a " +
    "`triage_llm_rescue.py crossref-year-backfill` invocation, so the " +
    "values reach the row through the script, never through the agent. " +
    "(If either triage skill ever instructs the agent to fill a field " +
    "itself, this exact-set discipline forces the re-litigation.)",
};

type Skill = { rel: string; body: string; flat: string };

/** Every invocable skill in both silos (`_`-prefixed includes excluded —
 *  see the header). Discovered from disk, so a new skill is covered by
 *  shipping. `flat` is whitespace-collapsed: these files are hard-wrapped
 *  prose, so a two-word database name is routinely split across a line
 *  break and a raw-body match would miss it. */
function allSkills(): Skill[] {
  const out: Skill[] = [];
  for (const silo of ["editor", "library"]) {
    const dir = join(repoRoot, silo, "skills");
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".md") || name.startsWith("_")) continue;
      const rel = `${silo}/skills/${name}`;
      const body = read(rel);
      out.push({ rel, body, flat: body.replace(/\s+/g, " ") });
    }
  }
  return out;
}

/** HOP 1 — the ```source-databases``` inventory, one name per line,
 *  `#` starts a comment. Never a hand list in this file: a hand list
 *  inside the guard that outlaws hand lists is the same defect one level
 *  up. */
function sourceDatabases(): string[] {
  const m = /```source-databases\n([\s\S]*?)```/.exec(read(LIBRARY_DOCTRINE));
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((line) => line.split("#")[0].trim())
    .filter((name) => name.length > 0);
}

/** HOP 2 — the skills §4 prescribes a failure path for, BY NAME. */
function failurePathSkillNames(): string[] {
  const doc = read(LIBRARY_DOCTRINE);
  const start = doc.indexOf("**4. If still not found");
  if (start < 0) return [];
  const rest = doc.slice(start);
  // §4 runs to the end of the numbered rules (the closing paragraph that
  // hands the op vocabulary back to the skill).
  const end = rest.indexOf("The specific op / status vocabulary");
  const section = end < 0 ? rest : rest.slice(0, end);
  return [...new Set([...section.matchAll(/\*\*`([a-z0-9-]+)`\*\*/g)].map((m) => m[1]))].sort();
}

/** A §4 name → the skill file(s) it denotes, in either silo. A name that
 *  denotes nothing is a doctrine typo and fails its own leg below. */
function filesForSkillName(name: string, skills: Skill[]): string[] {
  return skills.filter((s) => s.rel.endsWith(`/${name}.md`)).map((s) => s.rel);
}

/** Which databases a skill spells (case-insensitive; matched against the
 *  whitespace-collapsed body so a wrapped two-word name still counts). */
function spellsDatabases(flat: string, dbs: string[]): string[] {
  return dbs.filter((db) => flat.toLowerCase().includes(db.toLowerCase()));
}

/** The DISCOVERED population: hop 1 ∪ hop 2. */
function referencingSkills(): { rel: string; why: string }[] {
  const skills = allSkills();
  const dbs = sourceDatabases();
  const byName = failurePathSkillNames();
  const named = new Set(byName.flatMap((n) => filesForSkillName(n, skills)));

  const out: { rel: string; why: string }[] = [];
  for (const s of skills) {
    const hit = spellsDatabases(s.flat, dbs);
    const reasons: string[] = [];
    if (hit.length > 0) reasons.push(`spells ${hit.slice(0, 4).join(", ")}`);
    if (named.has(s.rel)) reasons.push("§4 prescribes its failure path");
    if (reasons.length > 0) out.push({ rel: s.rel, why: reasons.join(" + ") });
  }
  return out;
}

const linksDoctrine = (body: string) => body.includes(POINTER);

describe("find-or-surface doctrine (cross-silo SSOT)", () => {
  it("ships a byte-identical copy in each silo", () => {
    expect(read(EDITOR_DOCTRINE)).toBe(read(LIBRARY_DOCTRINE));
  });

  it("declares itself an include, not a slash command", () => {
    const doc = read(LIBRARY_DOCTRINE);
    // Leading-underscore filename + the header note both gate command
    // registration; assert the load-bearing header marker is present.
    expect(doc).toMatch(/Not a slash command/i);
  });

  it("carries the Library-first + never-fabricate steps", () => {
    const doc = read(LIBRARY_DOCTRINE);
    expect(doc).toMatch(/Never fabricate/i);
    expect(doc).toMatch(/Search the Library first/i);
    expect(doc).toMatch(/surface the gap/i);
  });

  // The doctrinal tension task 462 resolved at the SSOT rather than by
  // weakening a member: §1 forbade filling a field "from a landing-page
  // URL" while `index-paper`'s Tier 1 instructs `WebFetch
  // https://doi.org/<doi>` and reading the publisher's record off that
  // page. The two are compatible — the rule means a URL's SHAPE, not the
  // record it resolves to — but they read as contradictory to an agent
  // holding both. Pinned so a re-wording cannot silently reopen it.
  it("forbids a URL as evidence without forbidding reading the record at it", () => {
    const doc = read(LIBRARY_DOCTRINE).replace(/\s+/g, " ");
    expect(doc).toContain("from a URL alone");
    expect(doc).not.toContain("from a landing-page URL");
    expect(doc).toMatch(/own record.*is sourcing and is fine/i);
  });

  // The doctrine no longer claims its parenthesis mirrors the guard's
  // array — that claim was the defect (two hand lists kept in step by
  // hand). It must say what it is instead, and state the criterion's
  // limit, or the next reader re-derives a mirror list.
  it("declares its own enumeration illustrative, and states the limit", () => {
    const doc = read(LIBRARY_DOCTRINE).replace(/\s+/g, " ");
    expect(doc).not.toMatch(/mirror image of the drift-guard/i);
    expect(doc).toMatch(/illustrative, not a census/i);
    expect(doc).toMatch(/hole this criterion cannot see/i);
  });

  // The CAN-SEE canary. Both hops must be non-trivial, and each is
  // anchored on members it cannot lose — never on a name task 462 added,
  // or the coverage leg below could pass vacuously on a broken parse.
  it("derives both hops from the doctrine's own operative content", () => {
    const dbs = sourceDatabases();
    expect(dbs.length).toBeGreaterThanOrEqual(6);
    expect(dbs).toContain("Crossref");
    expect(dbs).toContain("Semantic Scholar"); // the two-word / wrapped case
    expect(dbs).toContain("OpenLibrary");

    const names = failurePathSkillNames();
    expect(names.length).toBeGreaterThanOrEqual(4);
    expect(names).toContain("find-citation");
    expect(names).toContain("authenticate-bib");
    expect(names).toContain("answer-bib-review");
    expect(names).toContain("draft-footnote");

    const pop = referencingSkills().map((p) => p.rel);
    expect(pop.length).toBeGreaterThanOrEqual(10);
    // Anchors: hop 1 (a database-naming skill) and hop 2 (a delegating
    // skill hop 1 structurally cannot see).
    expect(pop).toContain("library/skills/authenticate-bib.md");
    expect(pop).toContain("editor/skills/find-citation.md");
    expect(pop).toContain("editor/skills/draft-footnote.md");
    expect(pop).toContain("editor/skills/sync-bib-to-library.md");
  });

  // Hop 2 is only as good as its names resolving: a typo in a §4 bullet
  // would silently shrink the population instead of failing.
  it("every skill §4 names by failure path exists in a silo", () => {
    const skills = allSkills();
    const unresolved = failurePathSkillNames().filter(
      (n) => filesForSkillName(n, skills).length === 0,
    );
    expect(
      unresolved,
      "§4 of the doctrine prescribes a failure path for these names, but no " +
        "skill file matches. Fix the name (or the skill was renamed).",
    ).toEqual([]);
  });

  // The leg with teeth. The doctrine was never the part that could
  // misbehave — a sourcing skill that never points at it is.
  it("every sourcing skill links the doctrine (population discovered)", () => {
    const offenders = referencingSkills()
      .filter(({ rel }) => !(rel in PERMITTED_NON_SOURCING_SKILLS))
      .filter(({ rel }) => !linksDoctrine(read(rel)))
      .map(({ rel, why }) => `${rel} — ${why}`);

    expect(
      offenders,
      "these skills source bibliographic facts but never link " +
        "`[_find-or-surface.md](_find-or-surface.md)`. Add the doctrine link " +
        "block (never a paraphrase); if the skill genuinely sources nothing, " +
        "add it to PERMITTED_NON_SOURCING_SKILLS with the reason.",
    ).toEqual([]);
  });

  // The exemption list is an EXACT SET, so an exemption that has stopped
  // excusing anything (the skill gained its link, or stopped matching the
  // criterion) fails rather than standing as a licence for the next
  // sourcing skill under that name.
  it("carries no stale non-sourcing exemption", () => {
    const pop = new Map(referencingSkills().map((p) => [p.rel, p.why]));
    const stale = Object.keys(PERMITTED_NON_SOURCING_SKILLS).filter(
      (rel) => !pop.has(rel) || linksDoctrine(read(rel)),
    );
    expect(stale, "these exemptions no longer excuse anything — delete them").toEqual([]);
  });

  it("every non-sourcing exemption states a reason", () => {
    for (const [rel, why] of Object.entries(PERMITTED_NON_SOURCING_SKILLS)) {
      expect(why.length, `${rel} needs a stated reason`).toBeGreaterThan(30);
    }
  });

  // The two names task 462 was filed about, pinned individually so a
  // regression names itself rather than surfacing as a bare list.
  it.each([
    "library/skills/index-paper.md",
    "library/skills/ai-requests.md",
  ])("%s links the doctrine (task 462)", (rel) => {
    expect(read(rel)).toContain(POINTER);
  });

  // `ai-requests`' `bib` scope opts OUT of `/authenticate-bib`'s tier
  // ladder, so the bar it would have inherited has to be stated here.
  // Pre-462 it read "If it asks you to fill missing fields, fill them."
  it("the ai-requests bib scope carries an acceptance bar", () => {
    const flat = read("library/skills/ai-requests.md").replace(/\s+/g, " ");
    expect(flat).toMatch(/never the EVIDENCE/i);
    expect(flat).toMatch(/from a real source you actually located/i);
    expect(flat).not.toMatch(/asks you to fill missing fields, fill them\./i);
  });
});
