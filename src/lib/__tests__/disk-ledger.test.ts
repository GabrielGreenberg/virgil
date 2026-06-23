// Pure-logic unit tests for the disk ledger (the external-change badge's
// false-positive killer). Node env — no DOM, no storage backend needed.

import { describe, it, expect, beforeEach } from "vitest";
import {
  stampDiskFingerprint,
  getDiskFingerprint,
  clearDiskLedger,
  hashContent,
  fingerprintOf,
  __resetDiskLedgerForTests,
  type DiskFingerprint,
} from "@/lib/disk-ledger";

beforeEach(() => {
  __resetDiskLedgerForTests();
});

describe("disk-ledger: stamp / get round-trip", () => {
  it("stores and retrieves a fingerprint by (docId, relPath)", () => {
    const fp: DiskFingerprint = { mtimeMs: 1000, size: 42, hash: "abc" };
    stampDiskFingerprint("doc1", "main.tex", fp);
    expect(getDiskFingerprint("doc1", "main.tex")).toEqual(fp);
  });

  it("returns undefined for an unknown doc or path", () => {
    expect(getDiskFingerprint("nope", "main.tex")).toBeUndefined();
    stampDiskFingerprint("doc1", "main.tex", { mtimeMs: 1, size: 1, hash: "h" });
    expect(getDiskFingerprint("doc1", "other.bib")).toBeUndefined();
    expect(getDiskFingerprint("doc2", "main.tex")).toBeUndefined();
  });

  it("keeps separate fingerprints per path within a doc", () => {
    stampDiskFingerprint("doc1", "main.tex", { mtimeMs: 1, size: 1, hash: "tex" });
    stampDiskFingerprint("doc1", "references.bib", { mtimeMs: 2, size: 2, hash: "bib" });
    expect(getDiskFingerprint("doc1", "main.tex")!.hash).toBe("tex");
    expect(getDiskFingerprint("doc1", "references.bib")!.hash).toBe("bib");
  });

  it("a later stamp overwrites an earlier one for the same path", () => {
    stampDiskFingerprint("doc1", "main.tex", { mtimeMs: 1, size: 1, hash: "old" });
    stampDiskFingerprint("doc1", "main.tex", { mtimeMs: 9, size: 9, hash: "new" });
    expect(getDiskFingerprint("doc1", "main.tex")).toEqual({
      mtimeMs: 9,
      size: 9,
      hash: "new",
    });
  });
});

describe("disk-ledger: clearDiskLedger", () => {
  it("wipes only the named doc, leaving others intact", () => {
    stampDiskFingerprint("doc1", "main.tex", { mtimeMs: 1, size: 1, hash: "a" });
    stampDiskFingerprint("doc2", "main.tex", { mtimeMs: 2, size: 2, hash: "b" });
    clearDiskLedger("doc1");
    expect(getDiskFingerprint("doc1", "main.tex")).toBeUndefined();
    expect(getDiskFingerprint("doc2", "main.tex")!.hash).toBe("b");
  });

  it("is a no-op for an unknown doc", () => {
    expect(() => clearDiskLedger("never-seen")).not.toThrow();
  });
});

describe("disk-ledger: hashContent", () => {
  it("is stable for the same input", () => {
    const a = hashContent("hello world");
    const b = hashContent("hello world");
    expect(a).toBe(b);
  });

  it("differs when content changes (even a single char)", () => {
    expect(hashContent("hello world")).not.toBe(hashContent("hello worlD"));
    expect(hashContent("")).not.toBe(hashContent(" "));
    expect(hashContent("abc")).not.toBe(hashContent("acb")); // order-sensitive
  });

  it("returns a non-empty fixed-width hex string", () => {
    const h = hashContent("some \\LaTeX content with %!v:1a2b markers");
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(h.length).toBe(14); // padded to 14 hex chars
  });

  it("handles unicode and large content without throwing", () => {
    const big = "λ∀∃ é\u{1F600}".repeat(10000);
    expect(() => hashContent(big)).not.toThrow();
    expect(hashContent(big)).toBe(hashContent(big));
  });
});

describe("disk-ledger: fingerprintOf", () => {
  it("composes a stat + content into a DiskFingerprint", () => {
    const fp = fingerprintOf({ mtimeMs: 12345, size: 678 }, "the bytes");
    expect(fp.mtimeMs).toBe(12345);
    expect(fp.size).toBe(678);
    expect(fp.hash).toBe(hashContent("the bytes"));
  });

  it("differs in hash when content differs even if stat is identical", () => {
    const stat = { mtimeMs: 100, size: 5 };
    const a = fingerprintOf(stat, "aaaaa");
    const b = fingerprintOf(stat, "bbbbb");
    expect(a.mtimeMs).toBe(b.mtimeMs);
    expect(a.size).toBe(b.size);
    expect(a.hash).not.toBe(b.hash); // same-size same-mtime edit still caught
  });
});
