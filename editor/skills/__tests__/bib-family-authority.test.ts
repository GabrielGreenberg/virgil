// @vitest-environment node
//
// The editor silo's BIB-FAMILY authority (task 464).
//
// natbib and biblatex are mutually exclusive TeX packages whose cite
// vocabularies overlap but do not coincide: `\citet` is natbib-only and
// UNDEFINED under biblatex, `\textcite` is the mirror image. So a cite command
// composed for the wrong family is not a style mismatch — it is "Undefined
// control sequence", the paper stops compiling, and Virgil does not heal it
// (`reconcileBibFamily` deliberately injects nothing when the preamble
// hard-loads the other family, because co-loading both is itself fatal; it
// raises a save-time conflict warning instead).
//
// Task 344 settled "which family does this document use?" for the APP and
// reached none of this silo, where four sites then answered it privately and
// disagreed with each other and with the SSOT: an unqualified "prefer `\citet`"
// in the shared allowlist doctrine, a re-derived `\usepackage{biblatex}` needle
// in `find-citation` that missed 4 of 6 real biblatex spellings and failed
// toward `\citet` on every miss, no rule at all in `draft-footnote`, and a
// literal `"citet"` default in `create_card.py` that splices straight into the
// user's `.tex`. A fifth, found while implementing: `rename_citekey.py`'s
// hand-typed natbib-only rewrite vocabulary, which on a biblatex paper rewrote
// 1 of 4 cites while the same atomic op swapped the `.bib` entry out from
// under it.
//
// THE LEG WITH TEETH IS THE CENSUS. The door was never the part that could
// misbehave — a call site that never asks it is, and every one of those five
// sites was perfectly well-formed code that no behavioural test of any door
// could see. Every allowlist here is EMPTY; a hit is WIRE-it, never a listing.
//
// The BEHAVIOURAL half lives in `editor/scripts/tests/test_bib_family_slice.py`
// (the ladder, the six preamble spellings, the real `create_card.py` CLI into a
// real `.tex`, the rename vocabulary) and is run from here, because nothing
// else in CI runs Python — the same arrangement, and the same reason, as
// `preservation-measure-python.test.ts`.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import {
  BIBLATEX_ONLY_CITE_COMMANDS,
  KERNEL_NEUTRAL_CITE_COMMANDS,
  KNOWN_CITE_COMMANDS,
  MULTI_CITE_NAMES,
  NATBIB_ONLY_CITE_COMMANDS,
  SHARED_CITE_COMMANDS,
} from "@/lib/cite-commands";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

const SCRIPTS = "editor/scripts";
const SKILLS = "editor/skills";
/** The two door modules — the ONLY places the silo may state this vocabulary
 *  or this detection. */
const FAMILY_DOOR = "bib_family.py";
const VOCAB_DOOR = "cite_commands.py";

const pyFiles = () =>
  readdirSync(join(REPO, SCRIPTS))
    .filter((f) => f.endsWith(".py"))
    .sort();

const skillFiles = () =>
  readdirSync(join(REPO, SKILLS))
    .filter((f) => f.endsWith(".md"))
    .sort();

/**
 * Python source with `#` comments blanked. Deliberately crude — it keeps
 * STRING LITERALS (the census's needles ARE literals: a hand-typed command
 * name, a `\usepackage{biblatex}` pattern) and only has to stop a census from
 * indicting a file's own PROSE explanation of the defect it just retired.
 * That trap is real: every fix in this task explains itself by quoting the
 * pre-fix line verbatim.
 */
function pyCodeOnly(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      let inS: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inS) {
          if (c === "\\") i++;
          else if (c === inS) inS = null;
        } else if (c === '"' || c === "'") inS = c;
        else if (c === "#") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

/** Docstrings survive `pyCodeOnly` (they are string literals), and this task's
 *  three touched modules each quote the retired shape in theirs. Blank a
 *  MODULE/function docstring so the census asks about executable vocabulary. */
function withoutDocstrings(src: string): string {
  return src.replace(/("""|''')[\s\S]*?\1/g, '""""""');
}

const FAMILY_PINNED = [
  ...NATBIB_ONLY_CITE_COMMANDS,
  ...BIBLATEX_ONLY_CITE_COMMANDS,
].sort((a, b) => b.length - a.length);

describe("bib-family authority — the vocabulary is a PORT, not a restatement", () => {
  // The Python buckets cannot import the TS ones, so the premise is CHECKED
  // rather than restated (task 148's instrument): a registry addition on either
  // side fails here instead of drifting into a silent natbib-only vocabulary.
  it("cite_commands.py's buckets equal src/lib/cite-commands.ts's", () => {
    const dumped = execFileSync(
      "python3",
      [
        "-c",
        [
          `import sys, json; sys.path.insert(0, ${JSON.stringify(join(REPO, SCRIPTS))})`,
          "import cite_commands as C",
          "print(json.dumps({",
          " 'known': list(C.KNOWN_CITE_COMMANDS),",
          " 'natbib': sorted(C.NATBIB_ONLY),",
          " 'biblatex': sorted(C.BIBLATEX_ONLY),",
          " 'shared': sorted(C.SHARED),",
          " 'kernel': sorted(C.KERNEL_NEUTRAL),",
          " 'multi': sorted(C.MULTI_CITE_NAMES)}))",
        ].join("\n"),
      ],
      { cwd: REPO, encoding: "utf8" },
    );
    const py = JSON.parse(dumped) as Record<string, string[]>;
    const s = (x: Iterable<string>) => [...x].sort();
    expect(py.known).toEqual([...KNOWN_CITE_COMMANDS]);
    expect(py.natbib).toEqual(s(NATBIB_ONLY_CITE_COMMANDS));
    expect(py.biblatex).toEqual(s(BIBLATEX_ONLY_CITE_COMMANDS));
    expect(py.shared).toEqual(s(SHARED_CITE_COMMANDS));
    expect(py.kernel).toEqual(s(KERNEL_NEUTRAL_CITE_COMMANDS));
    expect(py.multi).toEqual(s(MULTI_CITE_NAMES));
  });
});

describe("bib-family authority — the CENSUS (allowlists EMPTY)", () => {
  it("no editor script outside the door probes for a package family", () => {
    // The shape `find-citation` carried in prose and `detectBibPackage` carries
    // in the app: a `\usepackage`/`\RequirePackage` pattern naming a family.
    const offenders: string[] = [];
    for (const f of pyFiles()) {
      if (f === FAMILY_DOOR) continue;
      const src = withoutDocstrings(pyCodeOnly(read(`${SCRIPTS}/${f}`)));
      src.split("\n").forEach((line, i) => {
        if (/usepackage|RequirePackage/.test(line) && /natbib|biblatex/.test(line)) {
          offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 90)}`);
        }
      });
    }
    expect(offenders, `re-derived family detection — call ${FAMILY_DOOR} instead`).toEqual([]);
  });

  it("no editor script outside the vocabulary door names a family-pinned cite command", () => {
    // This is the leg that would have caught `rename_citekey.py`: a hand-typed
    // command list is a second vocabulary, and the one it shipped named no
    // biblatex command at all.
    const offenders: string[] = [];
    for (const f of pyFiles()) {
      if (f === VOCAB_DOOR || f === FAMILY_DOOR) continue;
      const src = withoutDocstrings(pyCodeOnly(read(`${SCRIPTS}/${f}`)));
      for (const name of FAMILY_PINNED) {
        const re = new RegExp(`["'\\\\]${name}(?![A-Za-z])`);
        if (re.test(src)) offenders.push(`${f}: ${name}`);
      }
    }
    expect(
      offenders,
      `a family-pinned cite command spelled outside ${VOCAB_DOOR}/${FAMILY_DOOR}` +
        ` — import the vocabulary, and take a DEFAULT from ${FAMILY_DOOR}`,
    ).toEqual([]);
  });

  it("the census can see a violation (canary)", () => {
    // Synthetic, never a live line: a canary standing on the very site the
    // census drains evaporates the moment the census works.
    const fixture = pyCodeOnly(
      [
        '# a comment naming \\usepackage{biblatex} must NOT count',
        'CMDS = ["citet", "citep"]',
        'if re.search(r"\\\\usepackage\\{biblatex\\}", preamble):',
        '    cmd = "textcite"',
      ].join("\n"),
    );
    expect(fixture).not.toContain("must NOT count");
    expect(/usepackage|RequirePackage/.test(fixture) && /biblatex/.test(fixture)).toBe(true);
    expect(FAMILY_PINNED.some((n) => new RegExp(`["'\\\\]${n}(?![A-Za-z])`).test(fixture))).toBe(true);
  });

  it("every skill that names a family-pinned cite command names the door", () => {
    // POPULATION DISCOVERED. A hand list could only ever be missing the file
    // that drifted — and the realistic re-fork is not "two families listed
    // with no rule" (the pre-464 allowlist shape) but a SINGLE-family
    // recommendation, so the needle is any family-pinned command at all.
    const population: string[] = [];
    const silent: string[] = [];
    for (const f of skillFiles()) {
      const src = read(`${SKILLS}/${f}`);
      const named = FAMILY_PINNED.some((n) =>
        new RegExp(`\\\\\\\\?${n}(?![A-Za-z])`).test(src),
      );
      if (!named) continue;
      population.push(f);
      if (!src.includes(`${FAMILY_DOOR}`)) silent.push(f);
    }
    expect(population.length, "population is empty — the needle matches nothing").toBeGreaterThan(3);
    expect(population).toContain("_latex-allowlist.md");
    expect(population).toContain("draft-footnote.md");
    expect(population).toContain("find-citation.md");
    expect(
      silent,
      `names a family-pinned cite command and never names ${FAMILY_DOOR}` +
        " — point at the door, or spell the command family-neutrally (\\cite*{…})",
    ).toEqual([]);
  });
});

describe("bib-family authority — the allowlist include states the rule", () => {
  // Hard-wrapped prose: every PHRASE assertion runs against a whitespace-
  // collapsed copy, so a future re-wrap cannot fail a rule it did not change.
  const flat = read(`${SKILLS}/_latex-allowlist.md`).replace(/\s+/g, " ");

  it("names the AUTHORITY (the stored per-doc bibPackage) and the door", () => {
    expect(flat).toContain("bibPackage");
    expect(flat).toContain("bib_family.py");
  });

  it("no longer recommends a family-pinned command unconditionally", () => {
    // The retired sentence: "Prefer `\cite{…}` for a plain parenthetical and
    // `\citet{…}` for a textual … citation." `\citet` is natbib-only, so an
    // unqualified preference IS the root of the cluster.
    expect(flat).not.toMatch(/Prefer[^.]{0,80}\\citet/);
  });

  it("states that the FAMILY is the document's and the VOICE is the composer's", () => {
    expect(flat).toMatch(/family is not yours to choose/i);
    // Both voices, in both families — the table a composer actually reads off.
    for (const cmd of ["citet", "citep", "textcite", "parencite"]) {
      expect(flat).toContain(`\\${cmd}{`);
    }
  });
});

describe("bib-family authority — the behavioural half (Python)", () => {
  // If `python3` is genuinely unavailable this FAILS rather than skips: a guard
  // that quietly opts out of the environment it protects is the thing this file
  // exists to stop (`preservation-measure-python.test.ts`'s own rule).
  it(
    "passes editor/scripts/tests/test_bib_family_slice.py",
    { timeout: 120_000 },
    () => {
      let output: string;
      try {
        output = execFileSync(
          "python3",
          [join(REPO, "editor/scripts/tests/test_bib_family_slice.py")],
          { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message: string };
        throw new Error(
          `Python bib-family suite failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`,
        );
      }
      const m = output.match(/(\d+)\/(\d+) passed/);
      expect(m, `no pass tally in output:\n${output}`).not.toBeNull();
      const [, passed, total] = m!;
      expect(Number(total)).toBeGreaterThan(40);
      expect(passed).toBe(total);
    },
  );
});
