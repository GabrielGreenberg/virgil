// @vitest-environment node
//
// Task 1487 — the personal-prefs snapshot has ONE declared writer, and a
// partial write cannot shrink it. Drives the route's pure rule
// (`applySnapshotPost`) and the REAL promoter's missing-blob report.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySnapshotPost } from "@/lib/dev-prefs-snapshot";
import devPrefsRegistry from "@/lib/dev-prefs-registry.json";

const VIEW = "virgil-view-prefs/global";
const EDITOR = "virgil-editor-prefs";
const T1 = "2026-11-06T00:00:00.000Z";
const T2 = "2026-11-07T00:00:00.000Z";

function written(r: ReturnType<typeof applySnapshotPost>) {
  if (r.kind !== "written") throw new Error(`refused: ${r.error}`);
  return r.next;
}

describe("snapshot ownership (task 1487)", () => {
  it("the first source claims an absent file", () => {
    const r = applySnapshotPost(null, { source: "A", blobs: { [VIEW]: { x: 1 } } }, T1);
    expect(r.kind).toBe("written");
    expect(r.kind === "written" && r.claimed).toBe(true);
    expect(written(r)).toMatchObject({ source: "A", savedAt: T1, [VIEW]: { x: 1 }, blobSavedAt: { [VIEW]: T1 } });
  });

  it("a POST from a second source is refused and changes nothing", () => {
    const file = written(applySnapshotPost(null, { source: "A", blobs: { [VIEW]: { x: 1 } } }, T1));
    const before = JSON.stringify(file);
    const r = applySnapshotPost(file, { source: "B", blobs: { [VIEW]: { x: 2 } } }, T2);
    expect(r).toMatchObject({ kind: "refused", status: 409 });
    expect(JSON.stringify(file)).toBe(before);
  });

  it("a POST without a source id is refused (an un-opted-in or stale client)", () => {
    expect(applySnapshotPost(null, { [VIEW]: { x: 1 } }, T1)).toMatchObject({ kind: "refused", status: 400 });
    expect(applySnapshotPost(null, { source: "", blobs: {} }, T1)).toMatchObject({ kind: "refused", status: 400 });
  });

  it("a legacy source-less file is claimed fresh — none of its blobs survive", () => {
    const legacy = { savedAt: T1, [VIEW]: { agent: true }, [EDITOR]: { agent: true } };
    const next = written(applySnapshotPost(legacy, { source: "A", blobs: { [VIEW]: { x: 1 } } }, T2));
    expect(next[VIEW]).toEqual({ x: 1 });
    expect(next).not.toHaveProperty(EDITOR);
  });
});

describe("per-blob merge, never replace (task 1487)", () => {
  it("a POST holding only the view blob keeps the editor blob and its stamp", () => {
    const file = written(
      applySnapshotPost(null, { source: "A", blobs: { [VIEW]: { x: 1 }, [EDITOR]: { y: 1 } } }, T1),
    );
    const next = written(applySnapshotPost(file, { source: "A", blobs: { [VIEW]: { x: 2 } } }, T2));
    expect(next[VIEW]).toEqual({ x: 2 });
    expect(next[EDITOR]).toEqual({ y: 1 });
    expect(next.blobSavedAt).toEqual({ [VIEW]: T2, [EDITOR]: T1 });
    expect(next.savedAt).toBe(T2);
  });

  it("keys outside the promotion registry are not written", () => {
    const next = written(
      applySnapshotPost(null, { source: "A", blobs: { [VIEW]: {}, "some-other-key": 1, source: "Z" } }, T1),
    );
    expect(next).not.toHaveProperty("some-other-key");
    expect(next.source).toBe("A");
  });
});

describe("promoter reports a missing blob by name (task 1487)", () => {
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

  it("a snapshot without the editor blob logs which defaults file was not promoted", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "virgil-promote-1487-"));
    try {
      const files = new Set<string>([
        "src/lib/dev-prefs-registry.json",
        "src/app/globals.css",
        ...devPrefsRegistry.promotable.map((e) => e.defaultsFile),
      ]);
      for (const rel of files) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.copyFileSync(path.join(REPO, rel), path.join(root, rel));
      }
      const snap = path.join(root, "snapshot.json");
      fs.writeFileSync(
        snap,
        JSON.stringify({ source: "A", savedAt: new Date().toISOString(), [VIEW]: {} }),
      );
      const run = spawnSync(
        process.execPath,
        [path.join(REPO, "tools/promote-defaults.mjs"), "--root", root, "--snapshot", snap, "--dry-run"],
        { encoding: "utf8" },
      );
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toMatch(
        /WARNING: snapshot has no virgil-editor-prefs blob — src\/hooks\/usePreferences\.defaults\.json not promoted/,
      );
      expect(run.stdout).not.toMatch(/no source id/);

      // A long-unconfirmed blob is named.
      fs.writeFileSync(
        snap,
        JSON.stringify({ source: "A", blobSavedAt: { [VIEW]: "2020-01-01T00:00:00Z" }, [VIEW]: {} }),
      );
      const stale = spawnSync(
        process.execPath,
        [path.join(REPO, "tools/promote-defaults.mjs"), "--root", root, "--snapshot", snap, "--dry-run"],
        { encoding: "utf8" },
      );
      expect(stale.stdout).toMatch(/WARNING: snapshot blob virgil-view-prefs\/global is stale/);

      // A legacy, source-less snapshot promotes NOTHING — even a real drift.
      const view = JSON.parse(fs.readFileSync(path.join(root, "src/hooks/useViewPrefs.defaults.json"), "utf8"));
      fs.writeFileSync(snap, JSON.stringify({ [VIEW]: { showHighlights: !view.showHighlights } }));
      const legacy = spawnSync(
        process.execPath,
        [path.join(REPO, "tools/promote-defaults.mjs"), "--root", root, "--snapshot", snap],
        { encoding: "utf8" },
      );
      expect(legacy.status, legacy.stderr).toBe(0);
      expect(legacy.stdout).toMatch(/WARNING: snapshot has no source id — provenance unknown, nothing promoted/);
      expect(
        JSON.parse(fs.readFileSync(path.join(root, "src/hooks/useViewPrefs.defaults.json"), "utf8")),
      ).toEqual(view);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
