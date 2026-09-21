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
 *     exactly that list (`test_rename_citekey_cascade.py`, driven by the
 *     python-suites census, `scripts/__tests__/python-suites.test.ts`).
 */
import { describe, it, expect } from "vitest";
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

/**
 * The APP half of the same census (task 689).
 *
 * The manifest above says which sidecars a rename must re-key, and
 * `test_rename_citekey_cascade.py` holds the SKILL side to it. Nothing held
 * the APP side to it — and the app side had re-keyers for exactly one of the
 * three. `annotations.json` and `bib-review-requests.json` were declared here
 * as rename surfaces while a rename in the Bibliography panel left both
 * untouched, because the uid-keyed sidecar SHAPES that would have made the
 * rename a no-op for them live behind `virgil:identity-cascade`, which is
 * `default: false` on every shipping build. A registry earns its name by being
 * READ: the same manifest now forces an app-side re-keyer too.
 *
 * The map is deliberately small and CHECKED to be total — adding a file to
 * `rekey` fails here until its app-side re-keyer is named, which is the whole
 * forcing function. The needle for each is the door's own name plus the fact
 * that a `bibEntry` migrator reaches it, so deleting the wiring in EditorPane
 * (the failure a behavioural test that registers its OWN migrators cannot see)
 * fails this leg.
 */
const APP_REKEYERS: Record<string, { door: RegExp; wiredIn: string }> = {
  // The citation refs are rewritten inline by the rename door itself.
  "citations.json": { door: /rewriteCitationRefs\(oldKey, newKey\)/, wiredIn: "src/hooks/useCitations.ts" },
  "annotations.json": { door: /renameAnnotationKey\(oldKey, newKey\)/, wiredIn: "src/components/EditorPane.tsx" },
  "bib-review-requests.json": { door: /renameBibReviewKey\(oldKey, newKey\)/, wiredIn: "src/components/EditorPane.tsx" },
};

describe("citekey_keyed_sidecars.json ↔ the APP's re-keyers", () => {
  it("names an app-side re-keyer for every sidecar the manifest says to re-key", () => {
    expect(Object.keys(APP_REKEYERS).sort()).toEqual([...rekeyed].sort());
  });

  it("wires each one where it says (a declared re-key with no call site is not one)", () => {
    for (const [file, { door, wiredIn }] of Object.entries(APP_REKEYERS)) {
      const src = readFileSync(path.join(REPO_ROOT, wiredIn), "utf8");
      expect(door.test(src), `${file}: no re-keyer matching ${door} in ${wiredIn}`).toBe(true);
    }
  });

  it("registers the sidecar re-keys as a bibEntry cascade migrator", () => {
    // Not merely "the function is called somewhere": it must be reached from
    // the cascade fan-out, which is what a rename actually runs.
    const pane = readFileSync(path.join(REPO_ROOT, "src/components/EditorPane.tsx"), "utf8");
    const migrators = pane.split(/registerMigrator\(\s*"bibEntry"/).slice(1);
    expect(migrators.length).toBeGreaterThan(0);
    const sidecarMigrator = migrators.find(
      (body) => /renameAnnotationKey\(/.test(body) && /renameBibReviewKey\(/.test(body),
    );
    expect(sidecarMigrator, "no bibEntry migrator re-keys BOTH bib sidecars").toBeDefined();
  });

  it("the rename door is not gated on the identity-cascade flag", () => {
    // The defect this whole task is about: the fan-out lived inside
    // `if (isIdentityCascadeOn())`, so on every shipping build a rename
    // rewrote `references.bib` and nothing else. The flag gates the uid
    // sidecar FORMAT; it must not gate the rename's behaviour.
    const hook = readFileSync(path.join(REPO_ROOT, "src/hooks/useCitations.ts"), "utf8");
    expect(hook).not.toMatch(/isIdentityCascadeOn/);
  });
});
