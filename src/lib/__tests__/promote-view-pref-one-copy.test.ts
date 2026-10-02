// @vitest-environment node
//
// Task 900 — a promoted change to a View pref lands as ONE edit, to the file
// the registry reads.
//
// The release promoter (`tools/promote-defaults.mjs`) rewrites only the
// `*.defaults.json` sidecars (+ the globals.css managed block). Every promoted
// View-menu key used to ALSO state its default as a literal in
// `src/lib/view-prefs/registry.ts`, which the promoter never touches — so the
// first promotion of a changed View pref fast-forwarded a commit whose two
// copies disagreed, red on `view-menu-registry-source.test.ts`. The registry
// now READS the JSON for those keys. This drives the REAL promoter against a
// temp root with a snapshot that flips View prefs, and checks the result is
// consistent by construction: the promoter wrote the JSON, wrote no TS, and
// every flipped key's registry row is a JSON read.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import devPrefsRegistry from "@/lib/dev-prefs-registry.json";
import { REGISTRY_PROMOTED_GLOBAL_KEYS, VIEW_PREF_REGISTRY } from "@/lib/view-prefs/registry";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const VIEW_JSON = "src/hooks/useViewPrefs.defaults.json";

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "virgil-promote-900-"));
  const files = new Set<string>([
    "src/lib/dev-prefs-registry.json",
    "src/app/globals.css",
    ...devPrefsRegistry.promotable.map((e) => e.defaultsFile),
  ]);
  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), path.join(root, rel));
  }
  return root;
}

describe("promoting a changed View pref (task 900)", () => {
  it("edits only the JSON, and the registry's row for the key reads that JSON", () => {
    const root = makeRoot();
    try {
      const shipped = JSON.parse(fs.readFileSync(path.join(root, VIEW_JSON), "utf8"));
      const flipped = {
        ...shipped,
        cardOutlineChrome: !shipped.cardOutlineChrome,
        dividerWidth: shipped.dividerWidth === "mid" ? "full" : "mid",
        dividerLevels: [1, 2],
      };
      const snapshot = path.join(root, "snapshot.json");
      fs.writeFileSync(snapshot, JSON.stringify({ "virgil-view-prefs/global": flipped }));
      const changedOut = path.join(root, "changed.txt");

      const run = spawnSync(
        process.execPath,
        [path.join(REPO, "tools/promote-defaults.mjs"), "--root", root, "--snapshot", snapshot, "--changed-out", changedOut],
        { encoding: "utf8" },
      );
      expect(run.status, run.stderr).toBe(0);

      const changed = fs.readFileSync(changedOut, "utf8").split("\n").filter(Boolean);
      expect(changed).toContain(VIEW_JSON);
      // The promoter writes JSON sidecars and the CSS block — never TS.
      for (const f of changed) expect(f).toMatch(/\.(json|css)$/);

      const promoted = JSON.parse(fs.readFileSync(path.join(root, VIEW_JSON), "utf8"));
      expect(promoted.cardOutlineChrome).toBe(flipped.cardOutlineChrome);
      expect(promoted.dividerWidth).toBe(flipped.dividerWidth);
      expect(promoted.dividerLevels).toEqual([1, 2]);

      // So the only copy that changed must be the copy the registry reads.
      const registrySrc = fs.readFileSync(path.join(REPO, "src/lib/view-prefs/registry.ts"), "utf8");
      for (const key of ["cardOutlineChrome", "dividerWidth", "dividerLevels"] as const) {
        expect(REGISTRY_PROMOTED_GLOBAL_KEYS).toContain(key);
        expect(registrySrc).toMatch(new RegExp(`^\\s*${key}:\\s*\\{[^\\n]*default:\\s*SHIPPED\\.${key}\\b`, "m"));
        // And the promoted values stay in the row's declared domain.
        const def = VIEW_PREF_REGISTRY[key] as { kind: string; values?: readonly unknown[]; members?: readonly unknown[] };
        if (def.kind === "enum") expect(def.values).toContain(promoted[key]);
        if (def.kind === "set") for (const m of promoted[key]) expect(def.members).toContain(m);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
