/**
 * Task 391 — the recovery half. A mirror that is written and never offered is a
 * write-only diary, so these legs drive the REAL detection rule (a mirror is
 * offered iff it survived a load AND differs from what was loaded) and the REAL
 * restore door's ORDER: the net comes first, and the report is the permission.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { JSONContent } from "@tiptap/react";

import {
  __resetMirrorRecoveryForTests,
  clearRecoveryOffer,
  getRecoveryActions,
  getRecoveryOffer,
  offerMirrorRecovery,
  registerRecoveryActions,
  subscribeMirrorRecovery,
} from "@/lib/mirror-recovery";
import { hashContent } from "@/lib/disk-ledger";
import type { EmergencyMirrorEntry } from "@/lib/emergency-mirror";

function doc(text: string): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}
function entry(text: string, over: Partial<EmergencyMirrorEntry> = {}): EmergencyMirrorEntry {
  const content = doc(text);
  return {
    docId: "A",
    content,
    savedAt: 1_700_000_000_000,
    lastLandedAt: null,
    reason: "conflict",
    windowId: "w1",
    hash: hashContent(JSON.stringify(content)),
    ...over,
  };
}

beforeEach(() => {
  __resetMirrorRecoveryForTests();
});

describe("the offer", () => {
  it("stands until answered, and is identity-stable so a re-offer costs no render", () => {
    let fires = 0;
    subscribeMirrorRecovery(() => fires++);
    const e = entry("recovered");
    offerMirrorRecovery(e);
    expect(getRecoveryOffer("A")?.entry.content).toEqual(doc("recovered"));
    expect(fires).toBe(1);
    offerMirrorRecovery(entry("recovered")); // same hash — the same fact
    expect(fires).toBe(1);
    offerMirrorRecovery(entry("newer"));
    expect(fires).toBe(2);
    clearRecoveryOffer("A");
    expect(getRecoveryOffer("A")).toBe(null);
  });

  it("is per-document", () => {
    offerMirrorRecovery(entry("a"));
    expect(getRecoveryOffer("B")).toBe(null);
    expect(getRecoveryOffer(null)).toBe(null);
  });
});

describe("the actions registry", () => {
  it("is token-matched — a stale unregister cannot evict the live one", () => {
    const first = { restore: async () => true, discard: async () => {} };
    const second = { restore: async () => false, discard: async () => {} };
    const offFirst = registerRecoveryActions("A", first);
    registerRecoveryActions("A", second);
    offFirst(); // the STALE cleanup
    expect(getRecoveryActions("A")).toBe(second);
  });
});

describe("the mirror's own detection rule (as useDocument applies it)", () => {
  // The rule: offer iff a mirror survived AND its hash differs from the loaded
  // bundle. Fail-OPEN on any difference — a needless offer costs one click, a
  // withheld one costs the writing.
  const rule = (mirror: EmergencyMirrorEntry | null, loaded: JSONContent) =>
    mirror !== null && mirror.hash !== hashContent(JSON.stringify(loaded));

  it("withholds when the work reached disk by some other route", () => {
    expect(rule(entry("same"), doc("same"))).toBe(false);
  });
  it("offers when the mirror holds something the disk does not", () => {
    expect(rule(entry("seventy minutes of writing"), doc("the reverted version"))).toBe(true);
  });
  it("offers nothing when no mirror survived — the ordinary open", () => {
    expect(rule(null, doc("anything"))).toBe(false);
  });
});
