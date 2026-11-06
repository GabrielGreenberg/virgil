// @vitest-environment node
//
// The unattended prefs promote (task 623). `tools/sync-defaults.sh` fires from
// launchd in Gabriel's LIVE, SHARED checkout. It used to gate on `git diff` of
// that tree (so foreign WIP in globals.css read as "drift" and got committed),
// commit the whole index, commit onto whatever branch was checked out, push
// local main (deploying every unreleased merge), and have `--check` write the
// files it claimed only to check.
//
// Every leg drives the REAL script against a throwaway git repo carrying the
// real promoter, registry and six targets, with a bare "origin".

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const COPIED = [
  "tools/sync-defaults.sh",
  "tools/promote-defaults.mjs",
  "tools/check-prefs-coverage.mjs",
  "library/lib/list-columns.ts",
  "src/lib/pref-css-table.mjs",
  "src/lib/color-transform-math.mjs",
  "src/lib/retired-pref-defaults.mjs",
  "src/lib/dev-prefs-registry.json",
  "src/hooks/useViewPrefs.defaults.json",
  "src/hooks/usePreferences.defaults.json",
  "src/lib/panel-theme.defaults.json",
  "src/lib/print.defaults.json",
  "library/lib/list-columns.defaults.json",
  "src/app/globals.css",
];
const EDITOR_JSON = "src/hooks/usePreferences.defaults.json";
const PANEL_JSON = "src/lib/panel-theme.defaults.json";
const LIST_COL_JSON = "library/lib/list-columns.defaults.json";
const REGISTRY_JSON = "src/lib/dev-prefs-registry.json";
const CSS = "src/app/globals.css";
const WIP_MARK = "/* live WIP — not the promoter's */";

let tmp: string;
let repo: string;
let origin: string;

const git = (...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf-8" }).trim();
const gitIn = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf-8" }).trim();

function runSync(...args: string[]) {
  const r = spawnSync("bash", [join(repo, "tools/sync-defaults.sh"), ...args], {
    cwd: repo,
    encoding: "utf-8",
    env: { ...process.env, HOME: tmp, TMPDIR: tmp },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function snapshot(value: unknown) {
  writeFileSync(join(repo, "tools/personal-snapshot.json"), JSON.stringify({ source: "test", ...(value as object) }));
}

/** A drift only the defaults JSON sees (panel colours feed no CSS var). */
const panelDrift = () => {
  const cur = JSON.parse(readFileSync(join(repo, PANEL_JSON), "utf-8"));
  return { "virgil-panel-colors": { citation: cur.citation === "#010203" ? "#040506" : "#010203" } };
};
/** A drift that also rewrites the globals.css managed block. */
const cssDrift = () => ({ "virgil-editor-prefs": { backgroundColor: "#0a0b0c" } });

const committedFiles = (rev: string) =>
  git("show", "--pretty=format:", "--name-only", rev).split("\n").filter(Boolean).sort();
const refs = () => git("for-each-ref", "--format=%(refname) %(objectname)");

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "sync-defaults-"));
  repo = join(tmp, "repo");
  origin = join(tmp, "origin.git");
  mkdirSync(repo);
  for (const rel of COPIED) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    cpSync(join(repoRoot, rel), join(repo, rel));
  }
  writeFileSync(join(repo, ".gitignore"), "/tools/personal-snapshot.json\n");
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  git("remote", "add", "origin", origin);
  git("push", "-q", "origin", "main");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("sync-defaults.sh — promotes in isolation", () => {
  it("commits exactly the promoter's files onto main, and never pushes", () => {
    const originBefore = gitIn(origin, "rev-parse", "main");
    const mainBefore = git("rev-parse", "main");
    snapshot(cssDrift());

    const r = runSync();
    expect(r.code, r.out).toBe(0);

    expect(git("rev-parse", "main^")).toBe(mainBefore);
    expect(committedFiles("main")).toEqual([EDITOR_JSON, CSS].sort());
    expect(git("log", "-1", "--format=%s", "main")).toMatch(/^Promote personal prefs/);
    // The primary's tree followed the fast-forward and is clean.
    expect(git("status", "--porcelain")).toBe("");
    expect(readFileSync(join(repo, CSS), "utf-8")).toContain("--background: #0a0b0c;");
    // No push: origin never moves.
    expect(gitIn(origin, "rev-parse", "main")).toBe(originBefore);
    // The throwaway worktree is gone.
    expect(git("worktree", "list").split("\n")).toHaveLength(1);

    // Idempotent: a second run finds nothing to do.
    const again = runSync();
    expect(again.code, again.out).toBe(0);
    expect(again.out).toMatch(/no diff/);
    expect(git("rev-parse", "main^")).toBe(mainBefore);
  });

  it("leaves live WIP in globals.css and foreign STAGED files out of the commit", () => {
    writeFileSync(join(repo, CSS), `${readFileSync(join(repo, CSS), "utf-8")}\n${WIP_MARK}\n`);
    writeFileSync(join(repo, "foreign.txt"), "someone else's staged work\n");
    git("add", "foreign.txt");
    const statusBefore = git("status", "--porcelain");
    const mainBefore = git("rev-parse", "main");

    // No real drift: the old gate called the WIP "drift" and committed it.
    snapshot({});
    let r = runSync();
    expect(r.code, r.out).toBe(0);
    expect(git("rev-parse", "main")).toBe(mainBefore);
    expect(git("status", "--porcelain")).toBe(statusBefore);

    // Real drift in a file the WIP does not touch: main advances by exactly it.
    snapshot(panelDrift());
    r = runSync();
    expect(r.code, r.out).toBe(0);
    expect(git("rev-parse", "main^")).toBe(mainBefore);
    expect(committedFiles("main")).toEqual([PANEL_JSON]);
    expect(git("status", "--porcelain")).toBe(statusBefore);
    expect(readFileSync(join(repo, CSS), "utf-8")).toContain(WIP_MARK);
  });

  it("parks, rather than fast-forwards, when a promoted file is dirty in the primary", () => {
    writeFileSync(join(repo, CSS), `${readFileSync(join(repo, CSS), "utf-8")}\n${WIP_MARK}\n`);
    const statusBefore = git("status", "--porcelain");
    const mainBefore = git("rev-parse", "main");
    snapshot(cssDrift());

    const r = runSync();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/parked/);
    expect(git("rev-parse", "main")).toBe(mainBefore);
    expect(git("status", "--porcelain")).toBe(statusBefore);

    const parked = git("for-each-ref", "--format=%(refname:short)", "refs/heads/prefs-promote-*");
    expect(parked).toMatch(/^prefs-promote-\d{4}-\d{2}-\d{2}$/);
    expect(git("rev-parse", `${parked}^`)).toBe(mainBefore);
    expect(committedFiles(parked)).toEqual([EDITOR_JSON, CSS].sort());
    // The parked globals.css is main's plus the managed block — never the WIP.
    expect(git("show", `${parked}:${CSS}`)).not.toContain(WIP_MARK);
    expect(git("show", `${parked}:${CSS}`)).toContain("--background: #0a0b0c;");
  });

  it("never commits onto a non-main branch", () => {
    git("checkout", "-q", "-b", "feature");
    const featureBefore = git("rev-parse", "feature");
    const mainBefore = git("rev-parse", "main");
    snapshot(panelDrift());

    const r = runSync();
    expect(r.code, r.out).toBe(0);
    expect(git("rev-parse", "feature")).toBe(featureBefore);
    expect(git("rev-parse", "main")).toBe(mainBefore);
    expect(git("branch", "--show-current")).toBe("feature");
    expect(git("status", "--porcelain")).toBe("");
    const parked = git("for-each-ref", "--format=%(refname:short)", "refs/heads/prefs-promote-*");
    expect(committedFiles(parked)).toEqual([PANEL_JSON]);
  });

  it.each(["--check", "--dry-run"])("%s writes nothing and reports drift by exit code", (flag) => {
    writeFileSync(join(repo, CSS), `${readFileSync(join(repo, CSS), "utf-8")}\n${WIP_MARK}\n`);
    const statusBefore = git("status", "--porcelain");
    const cssBefore = readFileSync(join(repo, CSS), "utf-8");
    const refsBefore = refs();

    snapshot({});
    let r = runSync(flag);
    expect(r.code, r.out).toBe(0);

    snapshot(cssDrift());
    r = runSync(flag);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toMatch(/drift detected in 2 file/);

    expect(git("status", "--porcelain")).toBe(statusBefore);
    expect(readFileSync(join(repo, CSS), "utf-8")).toBe(cssBefore);
    expect(refs()).toBe(refsBefore);
    expect(git("worktree", "list").split("\n")).toHaveLength(1);
  });

  it("parks a promotion the coverage check rejects — a partial Library colOrder never reaches main (task 1488)", () => {
    const mainBefore = git("rev-parse", "main");
    const full: string[] = JSON.parse(readFileSync(join(repo, LIST_COL_JSON), "utf-8")).colOrder;
    snapshot({ "virgil-library-view-session": { layout: { colOrder: full.slice(1) } } });

    const r = runSync();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/prefs coverage check failed/);
    expect(r.out).toMatch(new RegExp(`missing column "${full[0]}"`));
    expect(r.out).toMatch(/parked/);
    expect(git("rev-parse", "main")).toBe(mainBefore);
    const parked = git("for-each-ref", "--format=%(refname:short)", "refs/heads/prefs-promote-*");
    expect(committedFiles(parked)).toEqual([LIST_COL_JSON]);
  });

  it("runs the coverage check on every promotion, not only the View defaults", () => {
    // A clean promotion of a file with no contract suite still passes the
    // (unconditional) coverage check and fast-forwards main.
    const mainBefore = git("rev-parse", "main");
    snapshot(panelDrift());
    const r = runSync();
    expect(r.code, r.out).toBe(0);
    expect(git("rev-parse", "main^")).toBe(mainBefore);
    const src = readFileSync(join(repoRoot, "tools/sync-defaults.sh"), "utf-8");
    // The file→suite pairing is the registry's table, never a path test here.
    expect(src).not.toMatch(/\[ "\$f" = "src\//);
    expect(src).toMatch(/contractSuites/);
  });

  it("every contractSuites row names a promoted defaults file and a suite that exists", () => {
    const registry = JSON.parse(readFileSync(join(repoRoot, REGISTRY_JSON), "utf-8"));
    const targets = new Set(registry.promotable.map((e: { defaultsFile: string }) => e.defaultsFile));
    const rows = Object.entries(registry.contractSuites).filter(([k]) => k !== "_comment");
    expect(rows.length).toBeGreaterThan(0);
    for (const [file, suites] of rows) {
      expect(targets.has(file), file).toBe(true);
      for (const suite of suites as string[]) expect(existsSync(join(repoRoot, suite)), suite).toBe(true);
    }
  });

  it("the promoter writes NOTHING when a later step throws (globals.css without its markers)", () => {
    const css = readFileSync(join(repo, CSS), "utf-8").replace("PROMOTE-DEFAULTS-START", "PROMOTE-DEFAULTS-GONE");
    writeFileSync(join(repo, CSS), css);
    git("commit", "-qam", "drop markers");
    snapshot({ ...cssDrift(), ...panelDrift() });

    const r = spawnSync(
      "node",
      [join(repo, "tools/promote-defaults.mjs"), "--root", repo, "--snapshot", join(repo, "tools/personal-snapshot.json")],
      { encoding: "utf-8" },
    );
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/marker pair/);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("carries no push at all (release/deploy belongs to /cleanup-virgil)", () => {
    const src = readFileSync(join(repoRoot, "tools/sync-defaults.sh"), "utf-8");
    const code = src.split("\n").filter((l) => !l.trimStart().startsWith("#"));
    expect(code.join("\n")).not.toMatch(/\bgit\b[^\n]*\bpush\b/);
  });
});
