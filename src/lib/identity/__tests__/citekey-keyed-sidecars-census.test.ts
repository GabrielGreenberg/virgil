/**
 * Census: which sidecars hold a CITEKEY, so a rename must re-key them (task 615).
 *
 * The app's rename owner is `IdentityCascade`; the skill side's is
 * `apply_response.py`'s `renameCitekey` op. The skill side used to keep a
 * private list (`.tex` + `citations.json`) and stranded the entry's annotation
 * and its pending reviews — BIB-A2-01, the exact class the cascade's header
 * names. The list now lives in ONE data file both halves are checked against,
 * `editor/scripts/citekey_keyed_sidecars.json`:
 *
 *   - here: `rekey` ∪ `notCitekeyKeyed` must equal the app's sidecar SSOT
 *     (`SIDECAR_VALUE`), so adding a sidecar forces a decision about renames;
 *   - in Python: every `rekey` rule has a re-keyer and the rename fans out over
 *     exactly that list (`test_rename_citekey_cascade.py`, run below — `npm test`
 *     is vitest, so a Python guard is advisory until a vitest file runs it).
 *
 * If `python3` is unavailable the Python leg FAILS rather than skips.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ALL_VIRGIL_SIDECAR_FILENAMES } from "@/lib/sidecar-value";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const MANIFEST = path.join(REPO_ROOT, "editor/scripts/citekey_keyed_sidecars.json");

interface Manifest {
  rekey: Array<{ file: string; rule: string }>;
  notCitekeyKeyed: Record<string, string>;
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
const rekeyed = manifest.rekey.map((r) => r.file);
const exempt = Object.keys(manifest.notCitekeyKeyed);

describe("citekey_keyed_sidecars.json ↔ SIDECAR_VALUE", () => {
  it("classifies every sidecar the app declares, and nothing else", () => {
    expect([...rekeyed, ...exempt].sort()).toEqual([...ALL_VIRGIL_SIDECAR_FILENAMES].sort());
  });

  it("puts no sidecar in both lists, and none twice", () => {
    expect(rekeyed.filter((f) => exempt.includes(f))).toEqual([]);
    expect(new Set(rekeyed).size).toBe(rekeyed.length);
  });

  it("re-keys the surfaces IdentityCascade names (citation refs, annotations, bib reviews)", () => {
    // identity-cascade.ts's header: a rename that forgets annotations or
    // bib-review requests is BIB-A2-01. Those, plus the citation refs
    // useCitations rewrites, are the floor.
    expect(rekeyed).toEqual(
      expect.arrayContaining(["citations.json", "annotations.json", "bib-review-requests.json"]),
    );
  });

  it("says WHY each exempt sidecar holds no citekey", () => {
    for (const [file, why] of Object.entries(manifest.notCitekeyKeyed)) {
      expect(why.trim().length, file).toBeGreaterThan(0);
    }
  });
});

describe("the Python rename fans out over the manifest", () => {
  const rel = "editor/scripts/tests/test_rename_citekey_cascade.py";
  it(`passes ${rel}`, { timeout: 120_000 }, () => {
    let output: string;
    try {
      output = execFileSync("python3", [path.join(REPO_ROOT, rel)], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      throw new Error(`${rel} failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`);
    }
    const m = output.match(/(\d+) passed, (\d+) failed/);
    expect(m, `no pass tally in output:\n${output}`).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(Number(m![2])).toBe(0);
  });
});
