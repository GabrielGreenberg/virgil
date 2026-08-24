/**
 * Fabricated-script-CLI guardrail — both silos (task 158).
 *
 * A skill markdown is a PROMPT: whatever invocation it prints, an agent runs
 * verbatim. So a documented flag the script never declared is not a typo, it
 * is a live defect — and the worst-behaved kind, because argv does not
 * complain. `bib_auth.py` had no argparse at all (positional
 * `<title> [<author>…]`), while two skills invoked it with
 * `--query`/`--citekey`/`--title`/`--author`/`--type`. Every one of those
 * landed as a positional: `title="--query"`, the real query and the remaining
 * flags becoming "authors". The lookup returned garbage rather than erroring,
 * and the skills' only fallback trigger was `ModuleNotFoundError`, so the
 * agent proceeded on the bad answer.
 *
 * Nothing could have caught that. Types don't reach across the
 * markdown↔Python boundary, and neither silo's build reads the invocations it
 * ships. This test is the boundary check: for every `python3 …/<script>.py`
 * line in a skill, every `--flag` on it must appear literally in that
 * script's source.
 *
 * **Deliberately permissive about HOW the flag is parsed.** Roughly a third
 * of the Python pipeline hand-rolls its argv walk (`repair_pgmarks.py`,
 * `audit_deepindex.py`, `format_references_section.py`) rather than using
 * argparse, and those flags are real. Requiring `add_argument("--flag")`
 * would flag ~4 healthy invocations and teach the next person to silence the
 * guard. The literal-presence rule has, empirically, zero false positives
 * across 190+ invocations and caught exactly the two fabricated call sites.
 *
 * Residual, stated rather than papered over: literal presence can be
 * IMMUNISED by the script's own text. `bib_auth.py`'s argparse epilog prints
 * example invocations, so deleting an `add_argument` there would leave the
 * flag string in the file and this guard green. The narrower check that would
 * close it (parse the argparse call graph) is the one that can't see the
 * hand-rolled parsers, so the trade is deliberate — and for `bib_auth.py`
 * specifically, `library/scripts/tests/test_bib_auth_cli.py` runs the real
 * parser over both skills' exact flag sets, which does catch it.
 *
 * Prose: library/AGENTS.md "Skills"; editor/AGENTS.md.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
// Bash's own line-continuation rule, stated once. This file used to re-derive
// it as `endsWith("\\")` — true for a line ending in ONE backslash and equally
// true for TWO, which bash reads oppositely. Eight shipped commands ended
// their first line with `\\`; bash dropped every flag on the continuation
// line while THIS guard, built to police those flags, folded the two lines
// together and saw a healthy invocation (task 445). See `_shell-fence.ts`.
import { continuesLine } from "./_shell-fence";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILL_DIRS = ["editor/skills", "library/skills"];
const SCRIPT_DIRS = ["editor/scripts", "library/scripts"];

/**
 * Flags a skill may document that its script does not declare.
 *
 * Deliberately EMPTY, and it should stay that way: an entry here is a skill
 * telling an agent to run something that won't work. The fix is to build the
 * flag or to correct the doc — never to list it.
 */
const PERMITTED_UNDECLARED_SKILL_FLAGS: string[] = [];

/**
 * Scripts a skill may invoke that don't exist on disk.
 *
 * Also empty. A commented-out line (`# python3 …`) is not an invocation and
 * is skipped by the scanner, which is how `di-clean-prose.md`'s explicit
 * "TODO: script doesn't exist yet" placeholder stays legal without an entry.
 */
const PERMITTED_MISSING_SCRIPTS: string[] = [];

interface Finding {
  file: string;
  line: number;
  script: string;
  kind: "missing-script" | "undeclared-flag";
  detail: string;
}

/**
 * `python3 <anything>/<name>.py` — any path prefix, quoted or not.
 *
 * An explicit interpreter is the strong form: it also licenses the
 * missing-script check, because "python3 foo.py" can only be an invocation.
 */
const INVOCATION = /python3?\s+(?:"?[^\s"`]*\/)?"?([A-Za-z0-9_]+\.py)"?/;
/**
 * `<name>.py …` with no interpreter token in front.
 *
 * Three real shapes need this and none of them says `python3`: the
 * `_find-or-surface.md` doctrine include writes its three `bib_auth.py …`
 * forms bare (and, before this leg existed, asserted right below them that CI
 * checked their flags — the very over-claim this task exists to kill);
 * `create-card.md`'s per-kind examples elide the interpreter; and
 * `library/skills/setup.md` runs `"$PY" .virgil/scripts/library/setup.py`,
 * where the interpreter is a shell variable. `--limit` was declared, printed
 * in the SSOT include, and reachable by no other call site — invisible.
 *
 * Weaker form, so it is scoped harder: it only fires when the basename
 * resolves to a script we know AND at least one `--flag` follows. A prose
 * mention of an unknown `.py` file is not an invocation.
 */
const BARE_INVOCATION =
  /(?:^|[\s`("'])(?:"?[^\s"`]*\/)?"?([A-Za-z0-9_]+\.py)"?(?=\s)/;
/** A long flag, not a mid-word `--` and not an em-dash run. */
const FLAG = /(?<![\w-])--[A-Za-z][A-Za-z0-9-]*/g;

function listFiles(dir: string, ext: string): string[] {
  const abs = path.join(REPO_ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((n) => n.endsWith(ext))
    .sort()
    .map((n) => path.join(dir, n));
}

function indexScripts(): Map<string, string> {
  const idx = new Map<string, string>();
  for (const dir of SCRIPT_DIRS) {
    for (const rel of listFiles(dir, ".py")) {
      const name = path.basename(rel);
      // A basename in both silos would make "which script?" ambiguous. There
      // are none today; assert rather than silently pick one.
      expect(idx.has(name), `script basename collides across silos: ${name}`).toBe(false);
      idx.set(name, rel);
    }
  }
  return idx;
}

interface Invocation {
  script: string;
  /** Everything after the script name, continuation lines folded in. */
  rest: string;
  /** True when an explicit `python3` token introduced it. */
  strong: boolean;
}

/** The invocation on `lines[i]`, or null. Strong form wins over bare. */
function invocationAt(lines: string[], i: number): Invocation | null {
  const raw = lines[i];
  // A commented line is documentation, not an invocation.
  if (raw.trimStart().startsWith("#")) return null;
  const strongMatch = INVOCATION.exec(raw);
  const m = strongMatch ?? BARE_INVOCATION.exec(raw);
  if (!m) return null;
  // Follow shell line continuations so a multi-line invocation is read whole —
  // `answer-bib-review.md` writes its flags exactly that way.
  let rest = raw.slice(m.index + m[0].length);
  let j = i + 1;
  while (continuesLine(rest) && j < lines.length) {
    rest = `${rest.slice(0, -1)} ${lines[j]}`;
    j += 1;
  }
  return { script: m[1], rest, strong: strongMatch !== null };
}

function scan(): Finding[] {
  const scripts = indexScripts();
  const sourceCache = new Map<string, string>();
  const findings: Finding[] = [];

  for (const dir of SKILL_DIRS) {
    for (const rel of listFiles(dir, ".md")) {
      const lines = readFileSync(path.join(REPO_ROOT, rel), "utf8").split("\n");
      lines.forEach((_raw, i) => {
        const inv = invocationAt(lines, i);
        if (!inv) return;
        const { script, rest, strong } = inv;
        const used = [...new Set(rest.match(FLAG) ?? [])].sort();
        if (used.length === 0) return;

        const scriptRel = scripts.get(script);
        if (!scriptRel) {
          // Only an explicit interpreter proves this was meant to run.
          if (strong && !PERMITTED_MISSING_SCRIPTS.includes(script)) {
            findings.push({
              file: rel, line: i + 1, script, kind: "missing-script",
              detail: `no such script under ${SCRIPT_DIRS.join(" or ")}`,
            });
          }
          return;
        }
        let src = sourceCache.get(scriptRel);
        if (src === undefined) {
          src = readFileSync(path.join(REPO_ROOT, scriptRel), "utf8");
          sourceCache.set(scriptRel, src);
        }
        const undeclared = used.filter(
          (f) => !src!.includes(f) && !PERMITTED_UNDECLARED_SKILL_FLAGS.includes(f),
        );
        if (undeclared.length > 0) {
          findings.push({
            file: rel, line: i + 1, script, kind: "undeclared-flag",
            detail: `${scriptRel} declares none of: ${undeclared.join(", ")}`,
          });
        }
      });
    }
  }
  return findings;
}

describe("skill markdown ↔ Python CLI contract", () => {
  it("every flag a skill documents exists in the script it invokes", () => {
    const findings = scan();
    const report = findings
      .map((f) => `  ${f.file}:${f.line} — ${f.script}: ${f.detail}`)
      .join("\n");
    expect(
      findings,
      `Skill markdown documents a CLI the script doesn't have.\n` +
        `A skill is a prompt: an agent will run this verbatim, and argv will\n` +
        `mis-parse it silently. Build the flag or correct the doc.\n${report}`,
    ).toEqual([]);
  });

  it("the scanner actually sees the invocations it is meant to police", () => {
    // A regex that silently matched nothing would make the check above pass
    // forever. Pin a floor, and pin the specific flags whose coverage this
    // guard has already been caught lacking.
    const scripts = indexScripts();
    expect(scripts.size).toBeGreaterThan(100);

    let invocationsWithFlags = 0;
    const flagsByScript = new Map<string, Set<string>>();
    for (const dir of SKILL_DIRS) {
      for (const rel of listFiles(dir, ".md")) {
        const lines = readFileSync(path.join(REPO_ROOT, rel), "utf8").split("\n");
        lines.forEach((_raw, i) => {
          const inv = invocationAt(lines, i);
          if (!inv) return;
          const used = inv.rest.match(FLAG) ?? [];
          if (used.length === 0) return;
          invocationsWithFlags += 1;
          const set = flagsByScript.get(inv.script) ?? new Set<string>();
          used.forEach((f) => set.add(f));
          flagsByScript.set(inv.script, set);
        });
      }
    }
    expect(invocationsWithFlags).toBeGreaterThan(45);

    // `--limit` is declared by bib_auth.py and printed ONLY in the bare-form
    // `_find-or-surface.md` doctrine include — the exact flag the earlier,
    // interpreter-anchored scanner could not see while that same include
    // asserted CI checked it. If the bare leg regresses, this goes red.
    const bibAuthFlags = flagsByScript.get("bib_auth.py") ?? new Set<string>();
    for (const f of ["--query", "--citekey", "--title", "--author", "--type",
                     "--limit", "--fields-file", "--library"]) {
      expect(bibAuthFlags.has(f), `bib_auth.py ${f} is unscanned`).toBe(true);
    }
    // The two other bare shapes: an elided interpreter, and one held in a
    // shell variable.
    expect((flagsByScript.get("create_card.py") ?? new Set()).size).toBeGreaterThan(5);
    expect((flagsByScript.get("setup.py") ?? new Set()).has("--force")).toBe(true);
  });
});
