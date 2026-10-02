/**
 * Task 896 — "where is the library?" has ONE answer in the library silo:
 * `library/scripts/_library_root.py`, which delegates to the editor silo's
 * validated `library_path.resolve_library` (--library → cwd-if-library →
 * folder pointer → VIRGIL_LIBRARY_ROOT → config file → ~/Virgil-Library, every
 * candidate validated, a refusal rather than an unchecked fallback).
 *
 * ~31 scripts used to hand-roll it — env first or cwd first, the pointer and
 * config ignored, an UNVALIDATED `~/Virgil-Library` or bare-cwd default — so a
 * skill run from a paper folder could write into a phantom library, and two
 * scripts in one run could disagree about which library they served.
 *
 * This census fails on any re-grown copy: reading `VIRGIL_LIBRARY_ROOT` from
 * the environment, building a `~/Virgil-Library` default, or defaulting a
 * `--library` flag to the cwd — anywhere under `library/scripts/` outside the
 * door. (Exporting the RESOLVED root into a child's env — `"VIRGIL_LIBRARY_ROOT":
 * root` — is not a read and is allowed.)
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SCRIPTS = path.resolve(__dirname, "../../scripts");
const DOOR = "_library_root.py";

/** Pre-door one-off run scripts and the Python test suites are out of scope. */
const isScoped = (rel: string): boolean =>
  rel.endsWith(".py") &&
  rel !== DOOR &&
  !rel.startsWith("tests/") &&
  !rel.startsWith("dedup-run-") &&
  !/(^|\/)test_[^/]*\.py$/.test(rel);

const HAND_ROLLED: Array<[string, RegExp]> = [
  ["reads VIRGIL_LIBRARY_ROOT", /(environ(\.get)?\s*[([]\s*|getenv\(\s*)["']VIRGIL_LIBRARY_ROOT["']/],
  ["builds a ~/Virgil-Library default", /["']~\/Virgil-Library["']|\/\s*["']Virgil-Library["']/],
  ["defaults --library to the cwd", /["']--library["'][^\n]*default\s*=\s*str\(\s*Path\.cwd\(\)/],
];

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs, base));
    else out.push(path.relative(base, abs).split(path.sep).join("/"));
  }
  return out;
}

export function handRolledResolvers(files: Record<string, string>): string[] {
  const hits: string[] = [];
  for (const [rel, src] of Object.entries(files)) {
    if (!isScoped(rel)) continue;
    src.split("\n").forEach((line, i) => {
      for (const [what, re] of HAND_ROLLED) {
        if (re.test(line)) hits.push(`${rel}:${i + 1} ${what}`);
      }
    });
  }
  return hits;
}

describe("library-root door census (task 896)", () => {
  it("no library script hand-rolls 'where is the library?'", () => {
    const files: Record<string, string> = {};
    for (const rel of walk(SCRIPTS)) {
      if (rel.endsWith(".py")) files[rel] = fs.readFileSync(path.join(SCRIPTS, rel), "utf8");
    }
    expect(handRolledResolvers(files)).toEqual([]);
  });

  it("the door itself exists and delegates to the editor silo's SSOT", () => {
    const door = fs.readFileSync(path.join(SCRIPTS, DOOR), "utf8");
    expect(door).toContain("library_path.py");
    expect(door).toContain("mod.resolve_library(");
  });

  it("catches each pre-896 shape (the census is not vacuous)", () => {
    const hits = handRolledResolvers({
      "a.py": '    env = os.environ.get("VIRGIL_LIBRARY_ROOT")',
      "b.py": '    return Path("~/Virgil-Library").expanduser()',
      "c.py": '    return Path.home() / "Virgil-Library"',
      "d.py": '    p.add_argument("--library", default=str(Path.cwd()),',
      "e.py": '        "VIRGIL_LIBRARY_ROOT": result["library_root"],',
      [DOOR]: '_DEFAULT = Path.home() / "Virgil-Library"',
    });
    expect(hits.map((h) => h.split(":")[0])).toEqual(["a.py", "b.py", "c.py", "d.py"]);
  });
});
