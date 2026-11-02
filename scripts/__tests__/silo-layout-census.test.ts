// @vitest-environment node
//
// Every helper script imports in a SYNCED folder exactly as it does in the repo
// (task 1428).
//
// A helper script runs from two layouts — the repo (`<repo>/<silo>/scripts/`)
// and a synced paper/library folder (`<folder>/.virgil/scripts/<silo>/`, the
// shape `scriptsDirFor` in library/lib/skill-bundle-layout.mjs writes) — and
// they disagree about where the OTHER silo sits. `bib_match_library.py`
// anchored its library import on the repo layout (`parents[2] / "library" /
// "scripts"`), so `/editor/sync-bib-to-library` died with ModuleNotFoundError
// in every paper folder and had only ever run from the dev repo. No test saw
// it: the bundle freshness guard skips every row in a worktree (built mirrors
// are gitignored), so nothing ever ran a synced copy.
//
// This census BUILDS that layout itself (so it runs in a worktree) and holds
// three legs:
//   1. layout parity — every non-test module that imports from the repo
//      imports from the synced copy too (a module that needs a third-party
//      package fails in BOTH and is not this census's business);
//   2. the one door — `_silo_path.py` is byte-identical in both silos (each
//      must import it from its own dir), and no other script spells the
//      sibling silo's location itself (`"<silo>" / "scripts"`, or a
//      `.parent / "<silo>"` hop). A hand-rolled path that DEGRADES rather
//      than raising (`_library_root._load_ssot`) passes leg 1 while broken,
//      which is why leg 2 is static;
//   3. the reported repro — `bib_match_library.py --help` exits 0 from the
//      synced copy.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const SILOS = ["editor", "library"] as const;
const repoDir = (silo: string) => join(ROOT, silo, "scripts");

const isModule = (name: string) => name.endsWith(".py") && !name.startsWith("test_");
const modulesOf = (silo: string) =>
  readdirSync(repoDir(silo))
    .filter(isModule)
    .filter((n) => statSync(join(repoDir(silo), n)).isFile())
    .sort();

// One interpreter per (silo, layout): import each module in turn, restoring
// sys.path / sys.modules between them so one module's import cannot lend
// another a path it would not have had as a script (sys.path[0] = its dir).
const PROBE = String.raw`
import importlib, json, sys
d, names = sys.argv[1], sys.argv[2:]
base_path, base_mods = list(sys.path), set(sys.modules)
out = {}
for n in names:
    sys.path[:] = [d] + base_path
    try:
        importlib.import_module(n)
        out[n] = None
    except BaseException as e:
        out[n] = f"{type(e).__name__}: {e}"
    for m in set(sys.modules) - base_mods:
        del sys.modules[m]
print(json.dumps(out))
`;

function probe(dir: string, names: string[]): Record<string, string | null> {
  const r = spawnSync("python3", ["-I", "-c", PROBE, dir, ...names], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (r.error) throw new Error(`could not run python3: ${r.error.message}`);
  const last = r.stdout.trim().split("\n").pop() ?? "";
  try {
    return JSON.parse(last);
  } catch {
    throw new Error(`probe in ${dir} printed no tally:\n${r.stdout}\n${r.stderr}`);
  }
}

let synced = "";
const syncedDir = (silo: string) => join(synced, ".virgil", "scripts", silo);

beforeAll(() => {
  synced = mkdtempSync(join(tmpdir(), "virgil-silo-layout-"));
  for (const silo of SILOS) {
    mkdirSync(syncedDir(silo), { recursive: true });
    for (const n of readdirSync(repoDir(silo))) {
      const src = join(repoDir(silo), n);
      if (statSync(src).isFile() && (n.endsWith(".py") || n.endsWith(".json"))) {
        copyFileSync(src, join(syncedDir(silo), n));
      }
    }
  }
});

afterAll(() => {
  if (synced) rmSync(synced, { recursive: true, force: true });
});

describe("silo layout CENSUS — the synced copy imports like the repo", () => {
  it.each(SILOS)("%s: every module that imports in the repo imports synced", (silo) => {
    const names = modulesOf(silo).map((n) => n.replace(/\.py$/, ""));
    // Canary: the census must be looking at a real population.
    expect(names.length).toBeGreaterThan(20);
    const inRepo = probe(repoDir(silo), names);
    const inSynced = probe(syncedDir(silo), names);
    const broken = names
      .filter((n) => inRepo[n] === null && inSynced[n] !== null)
      .map((n) => `${silo}/scripts/${n}.py: ${inSynced[n]}`);
    expect(broken, `breaks only in the synced layout:\n  ${broken.join("\n  ")}`).toEqual([]);
    // Canary: most of the population imports at all (else leg 1 is vacuous).
    expect(names.filter((n) => inRepo[n] === null).length).toBeGreaterThan(names.length / 2);
  }, 240_000);

  it("_silo_path.py is the ONE door, byte-identical in both silos", () => {
    const [a, b] = SILOS.map((s) => readFileSync(join(repoDir(s), "_silo_path.py"), "utf8"));
    expect(a, "editor/scripts/_silo_path.py and library/scripts/_silo_path.py differ").toBe(b);

    const SPELLED = [
      /["'](?:editor|library)["']\s*\/\s*["']scripts["']/, // repo layout: "<silo>" / "scripts"
      /\.parent\s*\/\s*["'](?:editor|library)["']\s*[),\n]/, // synced hop: .parent / "<silo>"
      /["'](?:\.\.\/)+(?:editor|library)\/scripts/, // a relative-path string
    ];
    const offenders: string[] = [];
    for (const silo of SILOS) {
      for (const n of modulesOf(silo)) {
        if (n === "_silo_path.py") continue;
        readFileSync(join(repoDir(silo), n), "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (/^\s*#/.test(line)) return;
            if (SPELLED.some((re) => re.test(line + "\n"))) {
              offenders.push(`${silo}/scripts/${n}:${i + 1}  ${line.trim()}`);
            }
          });
      }
    }
    expect(
      offenders,
      `spells the sibling silo's location instead of asking _silo_path:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("bib_match_library.py --help runs from a synced paper folder (the task-1428 repro)", () => {
    const r = spawnSync(
      "python3",
      ["-I", join(syncedDir("editor"), "bib_match_library.py"), "--help"],
      { cwd: synced, encoding: "utf8", timeout: 60_000 },
    );
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  });
});
