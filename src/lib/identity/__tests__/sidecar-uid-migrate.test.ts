// T1 Stage 1 — non-destructive citekey → uid sidecar migrations.
//
// The DATA-LOSS pin (BIB-A2-01 / BIB-A2-02): re-keying annotations + bib-review
// onto the durable uid must NEVER drop a row. A citekey that can't be resolved
// (renamed/removed before the upgrade) is bucketed, not deleted; the migration
// is additive + idempotent.
import { describe, it, expect } from "vitest";
import type { BibEntry, BibReviewState } from "@/lib/types";
import {
  buildKeyToUid,
  isAnnotationsV2,
  migrateAnnotationsToV2,
  migrateBibReviewToUid,
} from "../sidecar-uid-migrate";

function entry(uid: string, key: string): BibEntry {
  return { uid, key, type: "article", fields: {}, raw: "" };
}

describe("buildKeyToUid", () => {
  it("maps citekey → uid; first source-order entry wins a dup citekey", () => {
    const m = buildKeyToUid([entry("u1", "foo"), entry("u2", "foo"), entry("u3", "bar")]);
    expect(m.get("foo")).toBe("u1"); // first wins
    expect(m.get("bar")).toBe("u3");
    expect(m.size).toBe(2);
  });
});

describe("migrateAnnotationsToV2", () => {
  const entries = [entry("u-smith", "smith2020"), entry("u-jones", "jones2019")];
  const keyToUid = buildKeyToUid(entries);

  it("re-keys a legacy flat record onto byUid", () => {
    const v2 = migrateAnnotationsToV2(
      { smith2020: "<p>great</p>", jones2019: "<p>weak</p>" },
      keyToUid,
    );
    expect(isAnnotationsV2(v2)).toBe(true);
    expect(v2.byUid["u-smith"]).toBe("<p>great</p>");
    expect(v2.byUid["u-jones"]).toBe("<p>weak</p>");
    expect(v2.orphanByKey).toEqual({});
  });

  it("BUCKETS (never drops) an annotation whose citekey no longer resolves", () => {
    // `renamed_old` was the citekey BEFORE a rename; no entry carries it now.
    const v2 = migrateAnnotationsToV2(
      { smith2020: "<p>kept</p>", renamed_old: "<p>orphan but recoverable</p>" },
      keyToUid,
    );
    expect(v2.byUid["u-smith"]).toBe("<p>kept</p>");
    // The unresolved one is recoverable in the orphan bucket — NOT lost.
    expect(v2.orphanByKey["renamed_old"]).toBe("<p>orphan but recoverable</p>");
  });

  it("is idempotent: re-running over a v2 state is stable", () => {
    const once = migrateAnnotationsToV2({ smith2020: "<p>x</p>" }, keyToUid);
    const twice = migrateAnnotationsToV2(once, keyToUid);
    expect(twice).toEqual(once);
  });

  it("RE-HOMES an orphan once its entry re-appears under that citekey", () => {
    const orphaned = { v: 2 as const, byUid: {}, orphanByKey: { jones2019: "<p>back</p>" } };
    // Now jones2019 resolves (the entry is parsed) — the orphan re-homes.
    const rehomed = migrateAnnotationsToV2(orphaned, keyToUid);
    expect(rehomed.byUid["u-jones"]).toBe("<p>back</p>");
    expect(rehomed.orphanByKey).toEqual({});
  });

  it("returns the SAME reference on a v2 no-op (re-home effect loop guard)", () => {
    // A v2 state with an orphan that does NOT resolve against the current
    // resolver re-homes nothing → the migrator must hand the input straight
    // back, so the useAnnotations re-home effect's identity check bails (no
    // re-render, no spurious persist) on a keystroke-adjacent bib change.
    const stable = { v: 2 as const, byUid: { "u-smith": "<p>x</p>" }, orphanByKey: { unknownkey: "<p>orphan</p>" } };
    expect(migrateAnnotationsToV2(stable, keyToUid)).toBe(stable);
    // A fully-homed v2 state (no orphans) is likewise returned by reference.
    const homed = { v: 2 as const, byUid: { "u-smith": "<p>x</p>" }, orphanByKey: {} };
    expect(migrateAnnotationsToV2(homed, keyToUid)).toBe(homed);
  });

  it("tolerates a null/garbage input", () => {
    expect(migrateAnnotationsToV2(null, keyToUid)).toEqual({ v: 2, byUid: {}, orphanByKey: {} });
    expect(migrateAnnotationsToV2(42, keyToUid)).toEqual({ v: 2, byUid: {}, orphanByKey: {} });
  });
});

// ── The COLLISION branch: a resolved uid that is already occupied (task 647) ──
//
// The header promised orphaned annotations are "NEVER dropped" and the re-home
// loop implemented insert-if-absent: an orphan whose citekey resolved onto an
// occupied uid was neither written nor carried forward, and `rehomed` was set
// regardless, so the caller PERSISTED the object the annotation had vanished
// from. One state transition, silent, irreversible.
//
// These pin the corrected policy — shadowed means KEPT — and they are written
// so each fails on the pre-fix code: the first on the orphan being gone, the
// second on the same-reference contract, which the pre-fix loop broke by
// reporting a re-home it had not performed.
describe("migrateAnnotationsToV2 — uid collision", () => {
  const keyToUid = buildKeyToUid([entry("u-smith", "smith2020"), entry("u-alias", "alias")]);

  it("CARRIES FORWARD an orphan whose resolved uid is already occupied", () => {
    // `old_key` resolves to nothing; `smith2020` resolves to u-smith, which the
    // byUid side already holds. The occupant wins the slot — and the loser stays
    // readable in the bucket instead of being discarded.
    const v2 = migrateAnnotationsToV2(
      {
        v: 2,
        byUid: { "u-smith": "<p>the occupant</p>" },
        orphanByKey: { smith2020: "<p>the shadowed orphan</p>", old_key: "<p>unresolvable</p>" },
      },
      keyToUid,
    );
    expect(v2.byUid["u-smith"]).toBe("<p>the occupant</p>"); // not overwritten
    expect(v2.orphanByKey.smith2020).toBe("<p>the shadowed orphan</p>"); // NOT dropped
    expect(v2.orphanByKey.old_key).toBe("<p>unresolvable</p>");
  });

  it("a shadowed-only pass is a NO-OP: same reference, nothing persisted", () => {
    // Nothing MOVED, so there is nothing to write. The pre-fix loop set
    // `rehomed = true` here and handed back a fresh object missing the orphan —
    // which is precisely how the drop reached disk.
    const input = {
      v: 2 as const,
      byUid: { "u-smith": "<p>occupant</p>" },
      orphanByKey: { smith2020: "<p>shadowed</p>" },
    };
    expect(migrateAnnotationsToV2(input, keyToUid)).toBe(input);
  });

  it("re-homes the shadowed orphan once the occupant is cleared (recoverable)", () => {
    // The whole reason keeping beats dropping: the bucket is not a graveyard.
    const v2 = migrateAnnotationsToV2(
      { v: 2, byUid: {}, orphanByKey: { smith2020: "<p>shadowed</p>" } },
      keyToUid,
    );
    expect(v2.byUid["u-smith"]).toBe("<p>shadowed</p>");
    expect(v2.orphanByKey.smith2020).toBeUndefined();
  });

  it("applies the SAME policy to a legacy flat record (one statement, both branches)", () => {
    // Two citekeys resolving to one uid is reachable on the legacy path the
    // moment a `.bib` carries a duplicated uid. The second must be bucketed,
    // not silently overwrite the first.
    const dupUid = buildKeyToUid([entry("u-dup", "a"), entry("u-dup", "b")]);
    const v2 = migrateAnnotationsToV2({ a: "<p>first</p>", b: "<p>second</p>" }, dupUid);
    expect(v2.byUid["u-dup"]).toBe("<p>first</p>");
    expect(v2.orphanByKey.b).toBe("<p>second</p>"); // kept, not clobbered away
  });
});

describe("migrateBibReviewToUid", () => {
  const keyToUid = buildKeyToUid([entry("u-smith", "smith2020")]);

  it("stamps entryUid onto a row whose citekey resolves", () => {
    const state: BibReviewState = {
      requests: [
        { bibKey: "smith2020", type: "fields", requestedAt: "t", status: "pending" },
      ],
    };
    const out = migrateBibReviewToUid(state, keyToUid);
    expect(out.requests[0].entryUid).toBe("u-smith");
    expect(out.requests[0].bibKey).toBe("smith2020"); // human-readable mirror kept
  });

  it("leaves an unresolvable row with NO entryUid (survives rename-before-upgrade)", () => {
    const state: BibReviewState = {
      requests: [
        { bibKey: "renamed_old", type: "notes", requestedAt: "t", status: "pending" },
      ],
    };
    const out = migrateBibReviewToUid(state, keyToUid);
    expect(out.requests[0].entryUid).toBeUndefined();
    expect(out.requests).toHaveLength(1); // not dropped
  });

  it("is idempotent + returns the SAME reference when nothing changed", () => {
    const state: BibReviewState = {
      requests: [
        { bibKey: "smith2020", type: "fields", requestedAt: "t", status: "pending", entryUid: "u-smith" },
      ],
    };
    expect(migrateBibReviewToUid(state, keyToUid)).toBe(state);
  });
});
