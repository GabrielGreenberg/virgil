// @vitest-environment node
//
// The local-mirror refresh (task 374) — the half of `npm run build:skill-bundles`
// that reaches the copies a run actually READS and EXECUTES.
//
// Before it, the freshness guard's own named remedy could not clear the guard's
// own failure: `build:skill-bundles` regenerated `public/skill-bundle/` and the
// repo's `.claude/commands/`, while the mirror inside a managed folder was
// writable only by the running app. A standing red guard whose remedy does
// nothing trains everyone to ignore it.
//
// Two families of leg:
//   • BEHAVIOUR — drive the REAL writer against a temp bundle + temp folder.
//   • CENSUS    — the writer was never the part that could misbehave; a second
//                 speller of the on-disk layout is. `diskPathFor` type-checks
//                 nothing at a build script, so only a grep can ask.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  localManagedRoots,
  syncLocalMirror,
} from "../sync-local-mirrors.mjs";
import { diskPathFor, VIRGIL_DIR } from "../../library/lib/skill-bundle-layout.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STAMP = `${VIRGIL_DIR}/.skill-bundle-version.json`;

let tmp: string;
const write = (root: string, rel: string, body: string) => {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
};

/** A minimal but REAL bundle: a meta-manifest plus the files it names. */
function makeBundle(root: string) {
  write(
    root,
    "bundle-manifest.json",
    JSON.stringify({
      version: "v1",
      generatedAt: "2026-08-19T00:00:00.000Z",
      sources: [
        { name: "editor", version: "e1", files: ["claude-commands/dream.md", "scripts/dream.py"] },
        { name: "library", version: "l1", files: ["CLAUDE.md", "claude-commands/index-paper.md"] },
        { name: "manifest", version: "m1", files: ["INDEX.md"] },
      ],
    }),
  );
  write(root, "editor/claude-commands/dream.md", "DREAM v2\n");
  write(root, "editor/scripts/dream.py", "print('v2')\n");
  write(root, "library/CLAUDE.md", "WORKSPACE v2\n");
  write(root, "library/claude-commands/index-paper.md", "INDEX-PAPER v2\n");
  write(root, "manifest/INDEX.md", "MANIFEST v2\n");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "virgil-local-mirrors-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("syncLocalMirror", () => {
  it("routes every bundle file to the layout SSOT's destination", async () => {
    const bundleRoot = join(tmp, "bundle");
    const folderRoot = join(tmp, "folder");
    makeBundle(bundleRoot);
    write(folderRoot, STAMP, JSON.stringify({ version: "v0", syncedAt: "", files: [] }));

    const { written } = await syncLocalMirror({ bundleRoot, folderRoot });

    // The destinations are ASKED of the SSOT, not restated here — a guard that
    // hand-writes the paths is a second speller of the thing under test.
    const expected = [
      diskPathFor("editor", "claude-commands/dream.md"),
      diskPathFor("editor", "scripts/dream.py"),
      diskPathFor("library", "CLAUDE.md"),
      diskPathFor("library", "claude-commands/index-paper.md"),
      diskPathFor("manifest", "INDEX.md"),
    ];
    expect(written.sort()).toEqual([...expected].sort());
    expect(readFileSync(join(folderRoot, expected[0]!), "utf8")).toBe("DREAM v2\n");
    expect(readFileSync(join(folderRoot, expected[1]!), "utf8")).toBe("print('v2')\n");
    expect(readFileSync(join(folderRoot, expected[4]!), "utf8")).toBe("MANIFEST v2\n");
  });

  it("overwrites a STALE copy — the reported defect (dream.md, and the 17 helper scripts beside it)", async () => {
    const bundleRoot = join(tmp, "bundle");
    const folderRoot = join(tmp, "folder");
    makeBundle(bundleRoot);
    write(folderRoot, STAMP, JSON.stringify({ version: "v0", syncedAt: "", files: [] }));
    write(folderRoot, diskPathFor("editor", "claude-commands/dream.md")!, "DREAM v1 (pre-guard)\n");
    write(folderRoot, diskPathFor("editor", "scripts/dream.py")!, "print('v1')\n");

    await syncLocalMirror({ bundleRoot, folderRoot });

    expect(readFileSync(join(folderRoot, diskPathFor("editor", "claude-commands/dream.md")!), "utf8")).toBe("DREAM v2\n");
    expect(readFileSync(join(folderRoot, diskPathFor("editor", "scripts/dream.py")!), "utf8")).toBe("print('v2')\n");
  });

  it("writes nothing when every copy already matches (no mtime churn on a no-op `npm run dev`)", async () => {
    const bundleRoot = join(tmp, "bundle");
    const folderRoot = join(tmp, "folder");
    makeBundle(bundleRoot);
    write(folderRoot, STAMP, JSON.stringify({ version: "v0", syncedAt: "", files: [] }));

    await syncLocalMirror({ bundleRoot, folderRoot });
    const second = await syncLocalMirror({ bundleRoot, folderRoot });

    expect(second.written).toEqual([]);
    expect(second.removed).toEqual([]);
  });

  it("prunes a copy that left the bundle, off the app's own stamp", async () => {
    const bundleRoot = join(tmp, "bundle");
    const folderRoot = join(tmp, "folder");
    makeBundle(bundleRoot);
    const goneRel = diskPathFor("editor", "claude-commands/retired.md")!;
    write(folderRoot, goneRel, "RETIRED\n");
    write(
      folderRoot,
      STAMP,
      JSON.stringify({
        version: "v0",
        syncedAt: "",
        files: ["editor/claude-commands/retired.md", "editor/claude-commands/dream.md"],
      }),
    );

    const { removed } = await syncLocalMirror({ bundleRoot, folderRoot });

    expect(removed).toEqual([goneRel]);
    expect(existsSync(join(folderRoot, goneRel))).toBe(false);
    // Still-shipped files survive the prune.
    expect(existsSync(join(folderRoot, diskPathFor("editor", "claude-commands/dream.md")!))).toBe(true);
  });

  it("does NOT write the app's version stamp — that record is the APP's, and the file is tracked", async () => {
    const bundleRoot = join(tmp, "bundle");
    const folderRoot = join(tmp, "folder");
    makeBundle(bundleRoot);
    const stampBytes = JSON.stringify({ version: "v0", syncedAt: "then", files: [] });
    write(folderRoot, STAMP, stampBytes);

    await syncLocalMirror({ bundleRoot, folderRoot });

    expect(readFileSync(join(folderRoot, STAMP), "utf8")).toBe(stampBytes);
  });

  it("ignores a stamp entry whose subsystem the routing table does not know", async () => {
    const bundleRoot = join(tmp, "bundle");
    const folderRoot = join(tmp, "folder");
    makeBundle(bundleRoot);
    write(folderRoot, "unrelated.txt", "keep me\n");
    write(
      folderRoot,
      STAMP,
      JSON.stringify({ version: "v0", syncedAt: "", files: ["bogus/unrelated.txt", "noslash"] }),
    );

    const { removed } = await syncLocalMirror({ bundleRoot, folderRoot });

    expect(removed).toEqual([]);
    expect(existsSync(join(folderRoot, "unrelated.txt"))).toBe(true);
  });
});

describe("localManagedRoots", () => {
  it("gates on the app's stamp — the build refreshes a mirror, it never creates one", async () => {
    mkdirSync(join(tmp, "library-data"), { recursive: true });
    mkdirSync(join(tmp, "virgil-data", "doc_a"), { recursive: true });
    mkdirSync(join(tmp, "virgil-data", "doc_b"), { recursive: true });
    // Only doc_a and library-data have been synced by the app.
    write(tmp, join("library-data", STAMP), "{}");
    write(tmp, join("virgil-data", "doc_a", STAMP), "{}");

    const roots = await localManagedRoots(tmp);

    expect(roots.sort()).toEqual(
      [join(tmp, "library-data"), join(tmp, "virgil-data", "doc_a")].sort(),
    );
  });

  it("is empty on a fresh clone — absent is fine, never a build failure", async () => {
    expect(await localManagedRoots(tmp)).toEqual([]);
  });
});

// ── Census ──────────────────────────────────────────────────────────────────
// The writer was never the part that could misbehave. A build script that
// hand-spells `.claude/commands/<silo>` is — and it type-checks perfectly,
// which is exactly how three sub-builders came to hold three copies of a fact
// `diskPathFor` already owned, one directory over.
describe("layout SSOT census", () => {
  const BUILD_SCRIPTS = [
    "editor/build/build-editor-bundle.mjs",
    "library/build/build-skill-bundle.mjs",
    "virgil/build/build-virgil-bundle.mjs",
    "scripts/build-meta-bundle.mjs",
    "scripts/sync-local-mirrors.mjs",
  ];

  // A hand-spelled mirror path, in either the string-literal or the
  // path-segment form (`join(root, ".claude", "commands", …)`).
  const HAND_SPELLED = /"\.claude\/commands|"\.virgil\/scripts|"\.claude"\s*,\s*"commands"|"\.virgil"\s*,\s*"scripts"/;

  it("no build script spells the managed-folder layout itself", () => {
    const offenders = BUILD_SCRIPTS.filter((rel) => {
      const src = readFileSync(join(repoRoot, rel), "utf8");
      // Strip line comments: the header prose legitimately DESCRIBES the layout.
      const code = src.replace(/^\s*\/\/.*$/gm, "");
      return HAND_SPELLED.test(code);
    });
    expect(
      offenders,
      "These build scripts restate the on-disk mirror layout instead of asking " +
        "library/lib/skill-bundle-layout.mjs. A hit is ROUTE-it, never an allowlist entry.",
    ).toEqual([]);
  });

  it("the needle can see a real offender (canary)", () => {
    const code = 'const dir = join(repoRoot, ".claude", "commands", "editor");';
    expect(HAND_SPELLED.test(code)).toBe(true);
    expect(HAND_SPELLED.test('const p = `${CLAUDE_DIR}/commands/${silo}`;')).toBe(false);
  });

  it("every build script that mirrors a managed folder reads the SSOT", () => {
    const missing = BUILD_SCRIPTS.filter((rel) => {
      const src = readFileSync(join(repoRoot, rel), "utf8");
      const code = src.replace(/^\s*\/\/.*$/gm, "");
      const mirrors = /commandsDirFor|scriptsDirFor|diskPathFor/.test(code);
      const imports = /from\s+"[^"]*skill-bundle-layout\.mjs"/.test(code);
      return mirrors && !imports;
    });
    expect(missing).toEqual([]);
  });

  it("the SSOT leaf stays import-free — the build scripts cannot take a heavier dependency", () => {
    const src = readFileSync(join(repoRoot, "library/lib/skill-bundle-layout.mjs"), "utf8");
    const imports = src.match(/^\s*import\s.+$/gm) ?? [];
    expect(imports).toEqual([]);
  });

  it("`build:skill-bundles` actually runs the local-mirror refresh — the guard's named remedy", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    for (const name of ["build:skill-bundles", "predev", "prebuild"]) {
      expect(pkg.scripts[name], `${name} must chain the local-mirror refresh`).toContain(
        "scripts/sync-local-mirrors.mjs",
      );
    }
  });

  it("the freshness guard names that same remedy", () => {
    const guard = readFileSync(
      join(repoRoot, "editor/skills/__tests__/skill-bundle-freshness.test.ts"),
      "utf8",
    );
    expect(guard).toContain('const REBUILD = "npm run build:skill-bundles"');
  });
});

// Keep the temp-dir helper honest: a leg that silently wrote nowhere would
// pass every existence assertion above by accident if `write` were a no-op.
describe("harness", () => {
  it("write() really writes", () => {
    write(tmp, "a/b.txt", "x");
    expect(readdirSync(join(tmp, "a"))).toEqual(["b.txt"]);
  });
});
