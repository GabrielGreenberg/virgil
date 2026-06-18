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

  it("tolerates a null/garbage input", () => {
    expect(migrateAnnotationsToV2(null, keyToUid)).toEqual({ v: 2, byUid: {}, orphanByKey: {} });
    expect(migrateAnnotationsToV2(42, keyToUid)).toEqual({ v: 2, byUid: {}, orphanByKey: {} });
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
