// @vitest-environment node
//
// Drift guard for the `--library <path>` override contract.
//
// `editor/scripts/library_path.py` accepts `--library` as resolution
// step 1 — it is what lets a LIBRARY skill be driven from a PAPER
// session against an explicitly-named library. Several skills advertise
// that capability in their frontmatter ("safe to invoke from a paper
// session with --library"), and that sentence is precisely what invites
// the cross-session use. If the body then resolves the root bare, the
// flag is silently ignored and the skill writes master.bib /
// catalog.json / papers/<citekey>/ into the WRONG library — a silent
// data-landing bug with no error to notice (task 2026-07-18-166).
//
// So: advertising the flag and honoring it must not be able to drift
// apart. Any skill whose frontmatter mentions `--library` must also
// (a) document it in an `## Args` block and (b) actually thread it into
// its `library_path.py --get` call.
//
// The threading form is load-bearing and is asserted separately below.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// library/lib/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

// Skills that advertise the `--library` override and must honor it.
// A skill joins this list by putting `--library` in its frontmatter;
// the first test below proves the list is complete, so adding the claim
// to a new skill without threading the flag fails CI rather than
// shipping a silent wrong-library write.
const LIBRARY_FLAG_SKILLS = [
  "library/skills/authenticate-bib.md",
  "library/skills/apply-bib-edit.md",
  "library/skills/index-paper.md",
  "library/skills/triage-pdf.md",
  "editor/skills/sync-bib-to-library.md",
];

// Every skill that resolves a library root, so the completeness check
// can spot a NEW skill that starts advertising the flag.
const ALL_RESOLVER_SKILLS = [
  ...LIBRARY_FLAG_SKILLS,
  "library/skills/ai-requests.md",
  "library/skills/clean-bibliography.md",
  "library/skills/deep-index.md",
  "library/skills/di-clean-prose.md",
  "library/skills/di-examples.md",
  "library/skills/di-preflight.md",
  "library/skills/di-validate.md",
  "library/skills/fuse-alternate.md",
  "library/skills/import-bib.md",
  "library/skills/index-pending.md",
  "library/skills/merge-bibs.md",
  "library/skills/recover-footnotes.md",
  "library/skills/setup.md",
  "library/skills/triage-pending.md",
];

const frontmatterOf = (src: string): string => {
  const m = /^---\n([\s\S]*?)\n---/.exec(src);
  return m ? m[1] : "";
};

describe("--library override contract", () => {
  it("every skill advertising --library is on the threading list", () => {
    const advertising = ALL_RESOLVER_SKILLS.filter((rel) =>
      frontmatterOf(read(rel)).includes("--library"),
    );
    // Set-equal, so a new claim can't be added without threading it.
    expect(advertising.sort()).toEqual([...LIBRARY_FLAG_SKILLS].sort());
  });

  it.each(LIBRARY_FLAG_SKILLS)("%s documents --library in an ## Args block", (rel) => {
    const src = read(rel);
    const argsIdx = src.indexOf("## Args");
    expect(argsIdx, `${rel} has no "## Args" section`).toBeGreaterThan(-1);
    // The Args block runs to the next heading.
    const rest = src.slice(argsIdx + "## Args".length);
    const end = rest.search(/\n## /);
    const argsBlock = end === -1 ? rest : rest.slice(0, end);
    expect(argsBlock).toContain("--library");
  });

  it.each(LIBRARY_FLAG_SKILLS)("%s threads the flag into --get", (rel) => {
    const src = read(rel);

    // The resolver call must pass the flag array, not resolve bare.
    expect(src).toMatch(/library_path_py"\s+--get\s+"\$\{lib_args\[@\]\}"/);

    // ...and the array must actually be built from LIBRARY.
    expect(src).toMatch(/lib_args=\(\)/);
    expect(src).toMatch(/\[\s*-n\s+"\$LIBRARY"\s*\]\s*&&\s*lib_args=\(--library\s+"\$LIBRARY"\)/);
  });

  it.each(LIBRARY_FLAG_SKILLS)("%s does not use the zsh-broken :+ form", (rel) => {
    // `python3 … --get ${LIBRARY:+--library "$LIBRARY"}` looks correct and
    // works under bash/sh, but zsh does NOT word-split an unquoted
    // parameter expansion — it passes ONE argument (`--library /path`),
    // which argparse rejects. Since these skills run under the user's
    // shell (zsh on macOS), the array form is the only portable one.
    // Prose may still NAME the anti-pattern; only a live call is a bug.
    const liveUse = /--get\s+\$\{LIBRARY:\+/.test(read(rel));
    expect(liveUse, `${rel} resolves via the zsh-broken \${LIBRARY:+…} form`).toBe(false);
  });
});
