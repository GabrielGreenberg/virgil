/**
 * `di-validate.md`'s suppression tables ↔ the vocabulary SSOT (task 447).
 *
 * `<category>-false-positive:` is a catalog line an operator types by hand,
 * and since task 413 the write door REFUSES a category no reader can match.
 * So the skill's enumerated vocabulary is the only place an operator learns
 * which categories exist — and it was a HAND LIST that had fallen three kinds
 * behind `suppression_vocabulary.py`, including two of the three cases its own
 * opening sentence names as paradigm suppressions (`pgmark-multi-section`,
 * `pgmark-low-confidence-flood`) and one absent from the file entirely
 * (`pgmark-range-suspiciously-wide`).
 *
 * The failure mode is not "the agent gets an error". It is that the agent
 * reaches for the nearest LISTED prefix, silences a kind it did not mean to,
 * and leaves the real one re-flagging every pass — the exact convergence-loop
 * churn the suppression convention exists to prevent.
 *
 * A hand list can only ever be missing a name, so the guard is the deliverable
 * and the added rows are the byproduct. Membership is DISCOVERED from the SSOT
 * (`suppression_vocabulary.py --json`), which itself DERIVES the two families
 * from the two emitters' own vocabularies — so a new finding kind declared at
 * `pgmark_validate.CONTINUITY_FINDING_KINDS` or
 * `audit_deepindex.AUDIT_FINDING_CATEGORIES` fails here until the skill
 * documents it.
 *
 * **Split by READER, not by prefix.** The two families genuinely overlap:
 * `pgmark-low-confidence-flood` is a VALIDATOR kind and `pgmark-low-confidence`
 * is an AUDIT category. A guard that assigned rows to tables by the `pgmark-`
 * prefix would put one of them in the wrong table and pass, which is why the
 * SSOT publishes the split rather than each consumer re-deriving it.
 *
 * Shells out to `python3` for the same reason `references-bib-upsert-python`
 * and `warning-recompute-merge-python` do: `npm test` is vitest-only, so a
 * Python-side vocabulary is advisory unless something runs it. If `python3` is
 * unavailable this FAILS rather than skips — a guard that quietly opts out of
 * the environment it protects is worthless.
 *
 * Prose: library/AGENTS.md "Skills"; library/skills/di-validate.md.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SSOT = "library/scripts/suppression_vocabulary.py";
const SKILL = "library/skills/di-validate.md";

/**
 * Categories the SSOT reports as consumable that the skill deliberately does
 * NOT advertise, each with the reason it is excluded.
 *
 * Stated rather than silent: without this the guard would have to be an
 * inequality, and an inequality cannot tell "deliberately withheld" from
 * "fell behind again". The set may only shrink — a new entry is a claim that
 * an operator should never reach for that category, and it belongs in the
 * skill's prose too (a reader of the table must be able to see the exclusion
 * without reading this file).
 */
const DECLARED_EXCLUSIONS: Record<string, string> = {
  error:
    "not a finding about the paper — it reports the audit's own broken input " +
    "(`main.tex not found`). Suppressing it hides a broken pass.",
};

/** Headings that own each family's table in the skill. */
const SECTIONS = {
  validator: "### Baseline acceptance via catalog warnings",
  audit: "### Audit-side suppression prefixes",
} as const;

type Family = keyof typeof SECTIONS;

interface Vocabulary {
  validator: string[];
  audit: string[];
  all: string[];
}

function ssotVocabulary(): Vocabulary {
  let out: string;
  try {
    out = execFileSync("python3", [SSOT, "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(
      `could not read the suppression vocabulary SSOT (${SSOT} --json):\n` +
        `${e.stdout ?? ""}\n${e.stderr ?? e.message}`,
    );
  }
  return JSON.parse(out) as Vocabulary;
}

/** The section of the skill owned by `heading`, up to the next `###`. */
function sectionText(md: string, heading: string): string {
  const start = md.indexOf(heading);
  expect(start, `di-validate.md no longer has the heading "${heading}"`).toBeGreaterThan(-1);
  const after = start + heading.length;
  const next = md.indexOf("\n### ", after);
  return md.slice(after, next === -1 ? md.length : next);
}

/**
 * The categories a section ENUMERATES, in either shape the file has used.
 *
 * The table form is `| \`kind\` | \`kind-false-positive:\` | when to use |`;
 * both columns come back so the leg below can check they AGREE — a prefix
 * mis-typed against its own kind is precisely the near-miss class task 413
 * exists to close, and it is invisible to a membership test that reads only
 * column 1.
 *
 * The BULLET form (`- \`kind-false-positive: <why>\``) is what the validator
 * half used before task 447, and it is read too — deliberately. A parser that
 * saw only tables would answer "no rows" on the pre-447 file, which reports
 * the shape rather than the DEFECT: the guard's job is to name the three
 * kinds that were missing, whichever way the vocabulary happens to be
 * rendered.
 */
const SUFFIX = "-false-positive:";

function vocabularyRows(section: string): { kind: string; prefix: string }[] {
  const rows: { kind: string; prefix: string }[] = [];
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    const table = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/.exec(line);
    if (table) {
      rows.push({ kind: table[1], prefix: table[2] });
      continue;
    }
    const bullet = /^[-*]\s+`([^`\s]+-false-positive:)/.exec(line);
    if (bullet) {
      rows.push({ kind: bullet[1].slice(0, -SUFFIX.length), prefix: bullet[1] });
    }
  }
  return rows;
}

describe("di-validate suppression vocabulary ↔ suppression_vocabulary.py", () => {
  const vocab = ssotVocabulary();
  const md = readFileSync(path.join(REPO_ROOT, SKILL), "utf8");

  it.each(Object.keys(SECTIONS) as Family[])(
    "the %s table enumerates exactly the consumable categories for that reader",
    (family) => {
      const rows = vocabularyRows(sectionText(md, SECTIONS[family]));
      // A heading rename would empty the scan and make the equality below
      // pass against nothing.
      expect(rows.length, `${SECTIONS[family]} enumerates no suppression categories`).toBeGreaterThan(3);

      const documented = rows.map((r) => r.kind).sort();
      const expected = vocab[family]
        .filter((c) => !(c in DECLARED_EXCLUSIONS))
        .sort();
      expect(
        documented,
        `di-validate.md's ${family} table has fallen out of step with ${SSOT}.\n` +
          `A hand list can only be missing a name; the SSOT derives this set from\n` +
          `the emitter's own vocabulary. Add a row (with a "when to use" note), or\n` +
          `declare the exclusion in DECLARED_EXCLUSIONS with its reason.\n` +
          `  missing from the skill: ${expected.filter((c) => !documented.includes(c)).join(", ") || "—"}\n` +
          `  in the skill, not consumable: ${documented.filter((c) => !expected.includes(c)).join(", ") || "—"}`,
      ).toEqual(expected);
    },
  );

  it("every row's suppression prefix is its own kind plus the suffix", () => {
    const bad: string[] = [];
    for (const family of Object.keys(SECTIONS) as Family[]) {
      for (const { kind, prefix } of vocabularyRows(sectionText(md, SECTIONS[family]))) {
        if (prefix !== `${kind}${SUFFIX}`) {
          bad.push(`  ${family}: \`${kind}\` → \`${prefix}\` (expected \`${kind}${SUFFIX}\`)`);
        }
      }
    }
    expect(
      bad,
      `A suppression prefix does not match the kind it sits beside. The write\n` +
        `door matches the category verbatim, so a near-miss stores fine and\n` +
        `silences nothing.\n${bad.join("\n")}`,
    ).toEqual([]);
  });

  it("every declared exclusion is real, and is stated in the skill", () => {
    for (const [category, reason] of Object.entries(DECLARED_EXCLUSIONS)) {
      // An exclusion that has stopped excusing anything is a standing licence
      // for the next omission under the same name.
      expect(
        vocab.all,
        `${category} is excluded here but is no longer consumable — drop the entry`,
      ).toContain(category);
      expect(reason.length, `${category} needs a stated reason`).toBeGreaterThan(20);
      // The operator reads the SKILL, not this file, so the exclusion has to
      // be visible there too.
      expect(
        md,
        `di-validate.md does not tell the reader that \`${category}\` is deliberately absent`,
      ).toContain(`\`${category}\` is a consumable audit category and`);
    }
  });

  it("the scan actually sees the vocabulary it polices", () => {
    // Floors, so a regex that silently matched nothing cannot make the
    // equalities above vacuous, and so the SSOT itself is proven non-empty.
    expect(vocab.validator.length).toBeGreaterThan(5);
    expect(vocab.audit.length).toBeGreaterThan(9);
    expect(new Set([...vocab.validator, ...vocab.audit])).toEqual(new Set(vocab.all));
    // The overlap this guard's split exists for: both spellings are live and
    // they belong to different readers.
    expect(vocab.validator).toContain("pgmark-low-confidence-flood");
    expect(vocab.audit).toContain("pgmark-low-confidence");
  });
});
