/**
 * Warning-kind ownership guardrail (task 323).
 *
 * `indexed.warnings` carries nine recomputed-per-pass kinds across THREE owners.
 * `/library/clean-bibliography` persists its three at source (because
 * `synthesize_canonical_entries.py`, later in that same subskill, gates entirely
 * on reading `missing-bib-entry:` back out of the catalog — a write deferred to
 * `deep-index.md` step 5, which runs after the whole §3 dispatch, made synthesis
 * a guaranteed no-op on every first pass); step 5 keeps the five whose kinds have
 * no same-run consumer; and `/library/authenticate-bib` owns `bib-coherence:`
 * (task 322), which is produced OUTSIDE the deep-index pass entirely — that skill
 * runs standalone, often from a paper session. The third owner is why the
 * double-declaration leg matters more than it did with two: deep-index §5 has no
 * way to know it must not declare a kind it never computes, other than this
 * census and the prose it holds in sync.
 *
 * A split ownership has exactly one new failure mode, and it is silent in both
 * directions: **a kind declared by two owners**. `--recompute-warning-kind`
 * drops the declared kind's lines against the row's live array, so the later
 * writer erases what the earlier one just persisted — the whole-array clobber
 * this mechanism exists to prevent, arriving one level in. And a kind declared
 * by NO owner stops converging: a finding resolved since the last pass stays
 * flagged forever.
 *
 * So the census reads the DISPATCH FORM, not the prose: the flags an agent
 * actually runs, inside a fence. That is the same rule task 163 earned — a
 * mention is not a dispatch, and a partial inline copy of an ownership list is
 * worse than no copy, because it looks like coverage. This suite's own first
 * draft read whole files and was holed in both directions (see `fencesOf`),
 * which is the sharpest available argument for the rule.
 *
 * Honest limits. (1) The agreement leg asks only that both prose SSOTs NAME all
 * nine kinds; only a reader can tell whether a sentence assigns them
 * correctly. It catches the realistic accident — a kind added to one list and
 * forgotten in the other — not a well-formed lie. (2) Ownership is pinned for
 * the nine; kinds outside them (`metadata-mismatch`, declared by
 * `di-preflight.md`) have one producer each, so only the SHAPE and
 * double-declaration legs govern them. That `metadata-mismatch` sits outside a
 * census whose producer IS a deep-index subskill is a pre-existing gap, recorded
 * rather than swept — closing it means deciding whether it is step-5-owned or
 * subskill-owned, which is a design call, not a test edit. (3) A fence is read as
 * text: this proves what an agent is told to run, never that the agent ran it.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS = path.join(REPO_ROOT, "library/skills");

/** Persisted at source by `/library/clean-bibliography`, end of its §3g. */
const SUBSKILL_OWNED = [
  "missing-bib-entry",
  "ambiguous-citation",
  "numeric-citation-style",
] as const;

/** Deferred to `deep-index.md` §5 — no same-run consumer. */
const STEP5_OWNED = [
  "footnote-recovery-needed",
  "examples-not-converted",
  "pgmark-duplicate",
  "pgmark-gap",
  "pgmark-out-of-order",
] as const;

/**
 * Persisted by `/library/authenticate-bib` step 7 — the verdict of the advisory
 * cross-field pre-flight its step 2 ran, re-checked after that run's own master.bib
 * repairs, because a finding the run itself resolved must not be filed (task 322).
 * NOT a deep-index subskill: it runs standalone, so no step in that pass may
 * declare this kind, and a line it wrote stands until the next authentication.
 */
const AUTH_OWNED = ["bib-coherence"] as const;

const RECOMPUTED: string[] = [...SUBSKILL_OWNED, ...STEP5_OWNED, ...AUTH_OWNED];

const DECLARATION = /--recompute-warning-kind\s+([A-Za-z][A-Za-z0-9-]*)/g;

/**
 * A fence may declare its kinds by SUBSTITUTION instead of by name, when the
 * family is derived rather than fixed.
 *
 * `fuse-alternate.md` §5 is the one such site: the `pgmark-fusion-` family's
 * heads are one per `pgmark_validate.CONTINUITY_FINDING_KINDS` plus two fixed
 * members, so a literal list in markdown silently under-drops the day a
 * continuity kind is added (task 373). The fence therefore runs
 * `fuse_alternate.py --print-recompute-flags` and passes the result through.
 *
 * Stated limit, because accepting this form costs the census something real:
 * a substituted declaration contributes NO kind names, so the
 * double-declaration leg below cannot see the heads it declares. What covers
 * that half is on the Python side, where the vocabulary lives —
 * `library/scripts/tests/test_warning_recompute_merge.py` asserts (a) the
 * emitted flag list equals the derived head set exactly, and (b) no skill
 * markdown free-types a `pgmark-fusion-` head. And the risk is bounded by
 * construction anyway: no other skill writes that family, and every head it
 * declares carries the `pgmark-fusion-` prefix, which nothing else claims.
 */
const DERIVED_DECLARATION = "--print-recompute-flags";

/**
 * Catalog-patch fences that may carry `warnings` without declaring kinds.
 *
 * **EMPTY since task 373**, and it stays that way. Its one entry was
 * `fuse-alternate.md` §5's `--no-catalog` fallback, which instructed a HAND
 * merge (read the array with `jq`, drop `pgmark-fusion-*`, re-supply the
 * whole thing) — the same clobber class, parked because its family is a
 * PREFIX and this mechanism's merge is deliberately exact-head, so migrating
 * it meant enumerating eight heads by hand or deriving them. Task 373 derived
 * them: `pgmark_validate.CONTINUITY_FINDING_KINDS` is the vocabulary,
 * `fuse_alternate.fusion_warning_heads()` the derived family, and the fence
 * substitutes `fuse_alternate.py --print-recompute-flags` (see
 * `DERIVED_DECLARATION` below). A hit here is MIGRATE-it, never an entry.
 */
const PERMITTED_UNMERGED_WARNING_PATCHES: string[] = [];

function read(name: string): string {
  return readFileSync(path.join(SKILLS, name), "utf8");
}

interface Fence {
  /** 0-based line index of the opening ``` line. */
  start: number;
  /** 0-based line index of the closing ``` line. */
  end: number;
  text: string;
}

/**
 * The fenced code blocks of a skill file.
 *
 * Everything below reads ONLY these. A skill is a prompt and a fence is what an
 * agent runs; prose that *mentions* a flag is documentation. Reading the whole
 * file conflated the two in both directions, and each direction was a live hole
 * in this suite's first draft: the ordering leg's `indexOf` landed on a
 * sentence ~600 lines above the persist step, so moving that step BELOW
 * synthesis — verbatim the defect this task fixed — still passed; and
 * deep-index's "pass `--recompute-warning-kind` per kind" sentence contributed
 * a phantom kind `per` to the census.
 */
function fencesOf(name: string): Fence[] {
  const lines = read(name).split("\n");
  const out: Fence[] = [];
  let start = -1;
  let body: string[] = [];
  lines.forEach((line, i) => {
    if (!line.trimStart().startsWith("```")) {
      if (start >= 0) body.push(line);
      return;
    }
    if (start < 0) {
      start = i;
      body = [];
    } else {
      out.push({ start, end: i, text: body.join("\n") });
      start = -1;
    }
  });
  return out;
}

/** Kinds this skill file DECLARES in a runnable invocation. */
function declaredBy(name: string): Set<string> {
  const out = new Set<string>();
  for (const fence of fencesOf(name)) {
    for (const m of fence.text.matchAll(DECLARATION)) out.add(m[1]);
  }
  return out;
}

/** Fences that patch the catalog — the sites this whole law governs. */
function catalogPatchFences(name: string): Fence[] {
  return fencesOf(name).filter((f) => f.text.includes("update_catalog_entry.py"));
}

function skillFiles(): string[] {
  return readdirSync(SKILLS).filter((n) => n.endsWith(".md")).sort();
}

const OWNERS: Record<string, readonly string[]> = {
  "clean-bibliography.md": SUBSKILL_OWNED,
  "deep-index.md": STEP5_OWNED,
  "authenticate-bib.md": AUTH_OWNED,
};

describe("recomputed warning-kind ownership", () => {
  it("each owner declares exactly its own kinds", () => {
    for (const [file, expected] of Object.entries(OWNERS)) {
      const declared = [...declaredBy(file)].filter((k) => RECOMPUTED.includes(k));
      expect(declared.sort(), `${file} declares the wrong kinds`).toEqual(
        [...expected].sort(),
      );
    }
  });

  it("clean-bibliography's main branch declares all three in ONE fence", () => {
    // The file-level union above structurally CANNOT see this, and the gap it
    // hides is a regression rather than a residual: before the ownership split,
    // deep-index §5 dropped every one of those prefixes on every pass, so
    // an author-year pass cleared a `numeric-citation-style:` line left by an
    // earlier pass that mis-detected the source. Post-split §5 is forbidden
    // from declaring it, so if no clean-bibliography fence declares it
    // alongside the other two, nothing ever clears it — and deep-index reads
    // `indexed.warnings` on resume as the outstanding-work agenda, so the paper
    // reports "inline rewrite skipped" forever on a pass where it ran.
    //
    // The numeric branch declaring only its own kind is correct and stays that
    // way: it genuinely did not compute the other two.
    const branches = catalogPatchFences("clean-bibliography.md")
      .map((f) => ({ f, kinds: new Set([...f.text.matchAll(DECLARATION)].map((m) => m[1])) }));
    const full = branches.filter((b) => SUBSKILL_OWNED.every((k) => b.kinds.has(k)));
    expect(
      full.length,
      "no single persist fence declares all three subskill-owned kinds — a kind " +
        "no fence declares is one nothing can ever clear",
    ).toBeGreaterThan(0);
  });

  it("no recomputed kind is declared by two skills", () => {
    // Sweep EVERY skill, not a hand-kept list: the point of a census is that
    // the next skill to grow a warnings write is covered without anyone
    // remembering to extend it.
    const seen = new Map<string, string[]>();
    for (const file of skillFiles()) {
      for (const kind of declaredBy(file)) {
        seen.set(kind, [...(seen.get(kind) ?? []), file]);
      }
    }
    const doubled = [...seen.entries()].filter(([, files]) => files.length > 1);
    expect(
      doubled,
      "a kind declared twice means the later writer erases the earlier one",
    ).toEqual([]);
  });

  it("both prose SSOTs name all nine recomputed kinds", () => {
    // A partial inline copy is the task-163 disease: it reads as coverage.
    for (const file of ["deep-index.md", "_doctrine.md"]) {
      const src = read(file);
      const missing = RECOMPUTED.filter((k) => !src.includes(`${k}:`));
      expect(missing, `${file} omits recomputed kinds`).toEqual([]);
    }
  });

  it("clean-bibliography persists BEFORE synthesis reads the warnings", () => {
    // The ordering IS the fix: `synthesize_canonical_entries.py` gates on the
    // `missing-bib-entry:` lines it reads back out of the catalog, so a persist
    // step below that heading restores the very no-op this task removed.
    // Measured in LINES over the fences an agent would run.
    const lines = read("clean-bibliography.md").split("\n");
    const synthesis = lines.findIndex((l) => l.startsWith("## Bibliography synthesis"));
    expect(synthesis, "synthesis heading moved or renamed").toBeGreaterThan(-1);

    const persistFences = catalogPatchFences("clean-bibliography.md")
      .filter((f) => f.text.includes("--recompute-warning-kind"));
    expect(
      persistFences.length,
      "no runnable persist invocation in clean-bibliography.md",
    ).toBeGreaterThan(0);
    // EVERY one, not just the first: the author-year and Vancouver branches are
    // separate fences, and either landing after synthesis is the defect for
    // that branch.
    for (const f of persistFences) {
      expect(
        f.end,
        `a persist fence at line ${f.start + 1} runs AFTER "## Bibliography synthesis"`,
      ).toBeLessThan(synthesis);
    }
  });

  it("no skill patches indexed.warnings without declaring its kinds", () => {
    // The SHAPE axis, where the ownership legs cover only the ownership axis.
    // A catalog patch carrying `warnings` must (a) nest it under `indexed` —
    // every reader looks only there, so a top-level key is invisible to all of
    // them, which was di-preflight's live bug fixed in this task — and (b)
    // declare the kinds it recomputed, since a bare array REPLACES the row's
    // and silently deletes every other producer's lines.
    const offenders: string[] = [];
    for (const file of skillFiles()) {
      for (const fence of catalogPatchFences(file)) {
        if (!fence.text.includes('"warnings"')) continue;
        const site = `${file}:${fence.start + 1}`;
        if (PERMITTED_UNMERGED_WARNING_PATCHES.includes(site)) continue;
        if (!fence.text.includes('"indexed"')) {
          offenders.push(`${site} — "warnings" not nested under "indexed"`);
        }
        if (
          !fence.text.includes("--recompute-warning-kind") &&
          !fence.text.includes(DERIVED_DECLARATION)
        ) {
          offenders.push(`${site} — whole-array replace, no kind declared`);
        }
      }
    }
    expect(offenders, "each is a silent clobber of another producer's warnings").toEqual([]);
  });

  it("the census can see the sites it governs (self-check)", () => {
    // A census that silently matched nothing would pass every leg above.
    const patchSites = skillFiles().flatMap((f) =>
      catalogPatchFences(f).map((x) => `${f}:${x.start + 1}`),
    );
    expect(patchSites.length, "no catalog-patch fences found at all").toBeGreaterThan(3);
    // The allowlist is drained (task 373), so there is no entry left to
    // prove still-live. What replaces that proof is the same question asked
    // of the site the exemption used to cover: fuse-alternate.md must still
    // hold a catalog-patch fence, and that fence must declare its kinds by
    // the derived form. Dropping this leg with the allowlist would have left
    // the migration itself unpinned — a fence that quietly reverted to a
    // hand merge is exactly what the exemption used to mark.
    expect(
      patchSites.some((s) => s.startsWith("fuse-alternate.md:")),
      "fuse-alternate.md's catalog-patch fence vanished — the migrated site",
    ).toBe(true);
    const derived = catalogPatchFences("fuse-alternate.md").filter((f) =>
      f.text.includes(DERIVED_DECLARATION),
    );
    expect(
      derived.length,
      "fuse-alternate.md's catalog patch no longer substitutes the derived " +
        "flag list — a hand-typed head list under-drops when a continuity " +
        "kind is added, and a hand merge clobbers every other producer",
    ).toBe(1);
  });

  it("no skill free-types a pgmark-fusion head", () => {
    // The other half of accepting a substituted declaration. A head typed
    // into markdown is a hand list wearing the derived form's clothes: it
    // would be dropped by whatever the author remembered, and the census
    // above reads only the SHAPE. The vocabulary is Python's, so the
    // authoritative membership check lives in
    // `library/scripts/tests/test_warning_recompute_merge.py`; this leg is
    // the cheap one that fires in the JS suite where the markdown is read.
    //
    // Placeholders (`pgmark-fusion-<kind>`, `pgmark-fusion-…`) and the bare
    // prefix do not match: a head needs a lowercase letter after the prefix.
    const HEAD = /--recompute-warning-kind\s+pgmark-fusion-[a-z]/;
    const offenders = skillFiles().filter((f) => HEAD.test(read(f)));
    expect(
      offenders,
      "declare the pgmark-fusion family via `fuse_alternate.py " +
        "--print-recompute-flags`, never by naming its heads",
    ).toEqual([]);
  });

  it("the retired task-167 caveat is gone, not merely appended to", () => {
    const src = read("clean-bibliography.md");
    expect(src).not.toContain("This skill performs no\ncatalog write of its own");
    expect(src).not.toContain("performs no catalog write of its own");
    expect(src).not.toContain("not persisted to the catalog");
  });
});
