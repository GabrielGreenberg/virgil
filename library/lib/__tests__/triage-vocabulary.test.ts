// @vitest-environment node
//
// The triage VOCABULARIES are declared once and held to the code (task 510).
//
// `/library/triage-pending` step 2 tells the agent to GROUP ROWS BY FLAG and
// to surface anything that looks wrong. So a flag the skill does not name
// reads to the reader as an ANOMALY rather than as a known state — which is
// the cost of a hand list presented as closed, and the shape 442/443/444
// treated three times in this same family.
//
// Measured on the pre-510 tree the skill's two lists were both short: its
// flag list omitted `year-ambiguous`, `long-title` and `bib-no-citekey`, and
// its notification list named five of the twelve kinds `triage_apply.py`
// emits.
//
// THE FIX IS A DOOR, NOT A LONGER LIST. Each script now DECLARES its
// vocabulary once and prints it on demand — `triage_batch.py --print-flags`,
// `triage_apply.py --print-notification-kinds` — and the skill points at the
// door instead of carrying a copy. That is the shape
// `fuse_alternate.py --print-recompute-flags` already has for the
// `pgmark-fusion-` heads, and the reason is the same: a hand list can only
// ever be missing a name.
//
// This suite is what keeps the DECLARATION honest, since a declaration
// nothing checks is just a longer hand list. Both legs DISCOVER the emitted
// set from the script's own source and require equality with the declared
// tuple — in BOTH directions, because a stale member is as bad as a missing
// one: a reader told a flag exists will look for it.
//
// `triage-bib-ignored-<state>` is a FAMILY, not a kind — its tail is a
// `_tools.TERMINAL_BIB_STATES` member — so it is derived rather than
// enumerated, and leg 3 pins that derivation against the shipped set.
//
// STATED LIMIT, measured rather than guessed. The legs read source text, so a
// flag or kind assembled at RUNTIME from pieces is invisible to them; both
// scripts spell every one as a literal today. The literal FORMS are covered
// exhaustively for flags (append / extend / `+=` / a row literal / the
// `setdefault("flags", []).append` shape) — the first cut matched two of the
// five and claimed the gap was runtime assembly, which named a narrower hole
// than it had. For notification kinds the form is the single `"kind": "…"`
// key an inbox item is built with, plus the one f-string family head leg 3
// derives. Leg 4 pins the two doors themselves — a declaration nothing prints
// is a declaration no skill can read.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// library/lib/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

/** Python source with PROSE removed — triple-quoted blocks and whole-line `#`
 *  comments. Load-bearing rather than tidy: this very file's declarations are
 *  introduced by comments that QUOTE the needles ("discovers the emitted set
 *  from this file's own `flags.append(…)` sites"), so a raw scan indicts the
 *  explanation of the guard. The `_source-scan` two-views rule, one silo over:
 *  strip prose, keep literals — the vocabulary lives in literals. */
function pyCode(src: string): string {
  const TRIPLE = /"""[\s\S]*?"""|'''[\s\S]*?'''/g;
  return src
    .replace(TRIPLE, '""')
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

const BATCH = "library/scripts/triage_batch.py";
const APPLY = "library/scripts/triage_apply.py";
const TOOLS = "library/scripts/_tools.py";

/** The members of a `NAME: tuple[str, ...] = ( "a", "b", … )` declaration. */
function declaredTuple(src: string, name: string): string[] {
  const start = src.indexOf(`${name}: tuple[str, ...] = (`);
  expect(start, `no ${name} declaration`).toBeGreaterThan(-1);
  const end = src.indexOf("\n)", start);
  expect(end, `unterminated ${name} declaration`).toBeGreaterThan(start);
  const body = src.slice(start, end);
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

/** Every string literal this file puts into a row's `flags` list.
 *
 *  FIVE forms, because the first cut matched two and its STATED LIMIT said the
 *  blind spot was "a flag assembled at runtime from pieces" — which was wider
 *  than the truth in the wrong direction: `flags.extend([…])`, `flags += […]`
 *  and `row.setdefault("flags", []).append(…)` are plain literals and were all
 *  invisible. A guard whose stated reach exceeds its actual reach is the
 *  disease this whole file is about. */
function emittedFlags(src: string): string[] {
  const out = new Set<string>();
  const add = (blob: string) => {
    for (const lit of blob.matchAll(/"([^"]+)"/g)) out.add(lit[1]);
  };
  // `<anything>flags.append("x")` — any receiver whose tail is `flags`.
  for (const m of src.matchAll(/\bflags\.append\(\s*"([^"]+)"/g)) out.add(m[1]);
  // `<anything>flags.extend([…])` / `flags += […]` / `flags = […]`
  for (const m of src.matchAll(/\bflags\s*(?:\.extend\(\s*|\+=\s*|=\s*)\[([^\]]*)\]/g)) add(m[1]);
  // `"flags": [ … ]` — a row literal.
  for (const m of src.matchAll(/"flags":\s*\[([^\]]*)\]/g)) add(m[1]);
  // `…("flags", []).append("x")` / `…("flags", []).extend([…])` — the
  // setdefault form, whose receiver does not end in the identifier.
  for (const m of src.matchAll(/"flags"\s*,\s*\[\s*\]\s*\)\s*\.append\(\s*"([^"]+)"/g)) out.add(m[1]);
  for (const m of src.matchAll(/"flags"\s*,\s*\[\s*\]\s*\)\s*\.extend\(\s*\[([^\]]*)\]/g)) add(m[1]);
  return [...out].sort();
}

/** Every `"kind": "<literal>"` an inbox item is built with. */
function emittedKinds(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/"kind":\s*"([^"{]+)"/g)) out.add(m[1]);
  return [...out].sort();
}

/** Members of the `TERMINAL_BIB_STATES: frozenset[str] = frozenset({…})`. */
function terminalBibStates(src: string): string[] {
  const start = src.indexOf("TERMINAL_BIB_STATES: frozenset[str] = frozenset({");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("})", start);
  return [...src.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

const printed = (script: string, flag: string): string[] =>
  execFileSync("python3", [join(repoRoot, script), flag], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .sort();

describe("triage vocabularies", () => {
  it("declares exactly the flags triage_batch.py emits", () => {
    const src = pyCode(read(BATCH));
    const emitted = emittedFlags(src);
    // A grep that matched nothing would report green for the wrong reason.
    expect(emitted.length).toBeGreaterThan(10);
    expect(declaredTuple(src, "TRIAGE_FLAGS")).toEqual(emitted);
  });

  it("declares exactly the notification kinds triage_apply.py emits", () => {
    const src = pyCode(read(APPLY));
    // The family head carries an f-string tail, so it is not a literal kind;
    // leg 3 owns it.
    const emitted = emittedKinds(src);
    expect(emitted.length).toBeGreaterThan(8);
    expect(declaredTuple(src, "NOTIFICATION_KINDS")).toEqual(emitted);
  });

  it("derives the `triage-bib-ignored-<state>` family from TERMINAL_BIB_STATES", () => {
    const states = terminalBibStates(pyCode(read(TOOLS)));
    expect(states.length).toBeGreaterThan(1);
    const kinds = printed(APPLY, "--print-notification-kinds");
    for (const state of states) {
      expect(kinds).toContain(`triage-bib-ignored-${state}`);
    }
    // Exactly the family — no hand-typed extra head.
    const family = kinds.filter((k) => k.startsWith("triage-bib-ignored-"));
    expect(family.sort()).toEqual(states.map((s) => `triage-bib-ignored-${s}`).sort());
  });

  it("prints each vocabulary through its own door", () => {
    // The door is what the skill reads. A declaration nothing prints is a
    // declaration no agent can reach, which is the hand list again.
    expect(printed(BATCH, "--print-flags")).toEqual(
      declaredTuple(pyCode(read(BATCH)), "TRIAGE_FLAGS"),
    );
    const kinds = printed(APPLY, "--print-notification-kinds");
    for (const k of declaredTuple(pyCode(read(APPLY)), "NOTIFICATION_KINDS")) {
      expect(kinds).toContain(k);
    }
  });

  it("lets `/library/triage-pending` carry no hand copy of either set", () => {
    // The skill names a few common members as orientation, which is fine —
    // what it may not do is present a CLOSED list. It must reach both doors,
    // and say the vocabularies are open.
    const skill = read("library/skills/triage-pending.md");
    expect(skill).toContain("triage_batch.py --print-flags");
    expect(skill).toContain("triage_apply.py --print-notification-kinds");
    expect(skill).toMatch(/\*\*OPEN\*\*/);
    // The pre-510 closed-list spellings must not come back.
    expect(skill).not.toContain('`flags`: subset of `[');
    expect(skill).not.toMatch(/emits a `triaged` \/ /);
  });
});
