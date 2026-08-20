/**
 * The save-state TIER LADDER (task 392) — the pure half.
 *
 * `deriveSaveState` is what every save surface renders from, so the boundaries
 * are pinned here rather than re-derived per component: the badge, the update
 * banner's blocked list and any future consumer must agree about when a quiet
 * "Saving…" becomes an amber warning and when amber becomes red.
 */

import { describe, it, expect } from "vitest";

import {
  UNSAVED_ESCALATE_MS,
  UNSAVED_WARN_MS,
  deriveSaveState,
  describeAge,
  describeBlockReason,
  describeLandedAt,
  isSaveTierProtected,
} from "@/lib/save-state";
import type { UnsavedBlockReason, UnsavedWorkState } from "@/lib/unsaved-work";

const NOW = 1_700_000_000_000;

function state(over: Partial<UnsavedWorkState> = {}): UnsavedWorkState {
  return {
    docId: "doc-1",
    dirtySince: null,
    lastLandedAt: null,
    reason: null,
    lastAttemptAt: null,
    ...over,
  };
}

describe("deriveSaveState · the four tiers", () => {
  it("no state at all reads CLEAN with no landed clock", () => {
    const v = deriveSaveState(null, NOW);
    expect(v.tier).toBe("clean");
    expect(v.lastLandedAt).toBeNull();
    expect(v.ageMs).toBe(0);
    expect(v.escalated).toBe(false);
  });

  it("a landed write with nothing dirty reads CLEAN and carries the clock", () => {
    const v = deriveSaveState(state({ lastLandedAt: NOW - 5_000 }), NOW);
    expect(v.tier).toBe("clean");
    expect(v.lastLandedAt).toBe(NOW - 5_000);
  });

  it("young unblocked dirt is PENDING, not a warning", () => {
    const v = deriveSaveState(state({ dirtySince: NOW - 2_000 }), NOW);
    expect(v.tier).toBe("pending");
    expect(v.escalated).toBe(false);
  });

  it("dirt older than the warn threshold is UNSAVED", () => {
    const at = deriveSaveState(
      state({ dirtySince: NOW - UNSAVED_WARN_MS }),
      NOW,
    );
    expect(at.tier).toBe("unsaved");
    const justUnder = deriveSaveState(
      state({ dirtySince: NOW - (UNSAVED_WARN_MS - 1) }),
      NOW,
    );
    expect(justUnder.tier).toBe("pending");
  });

  it("a stated reason is BLOCKED immediately — no grace period for a refusal", () => {
    const v = deriveSaveState(
      state({ dirtySince: NOW - 100, reason: "conflict" }),
      NOW,
    );
    expect(v.tier).toBe("blocked");
    expect(v.reason).toBe("conflict");
    // …and it does not have to wait out the warn threshold to say so.
    expect(v.ageMs).toBe(100);
  });

  it("escalates past the escalate threshold, in the non-clean tiers only", () => {
    expect(
      deriveSaveState(state({ dirtySince: NOW - UNSAVED_ESCALATE_MS }), NOW)
        .escalated,
    ).toBe(true);
    expect(
      deriveSaveState(
        state({ dirtySince: NOW - UNSAVED_ESCALATE_MS, reason: "error" }),
        NOW,
      ).escalated,
    ).toBe(true);
    // A clean document has no age to escalate.
    expect(deriveSaveState(state({ lastLandedAt: NOW }), NOW).escalated).toBe(
      false,
    );
  });

  it("a clock that ran backwards floors the age at zero rather than reading negative", () => {
    expect(deriveSaveState(state({ dirtySince: NOW + 10_000 }), NOW).ageMs).toBe(0);
  });
});

describe("isSaveTierProtected · a reassurance may be collapsed, a notice may not", () => {
  it("protects exactly the two data-integrity tiers", () => {
    expect(isSaveTierProtected("clean")).toBe(false);
    expect(isSaveTierProtected("pending")).toBe(false);
    expect(isSaveTierProtected("unsaved")).toBe(true);
    expect(isSaveTierProtected("blocked")).toBe(true);
  });
});

describe("the reason VOCABULARY", () => {
  const REASONS: UnsavedBlockReason[] = ["conflict", "preservation", "error"];

  it("every reason has words, and they differ", () => {
    const shorts = new Set<string>();
    for (const r of REASONS) {
      const d = describeBlockReason(r);
      expect(d.short.length, r).toBeGreaterThan(0);
      expect(d.sentence.length, r).toBeGreaterThan(0);
      expect(d.action.length, r).toBeGreaterThan(0);
      shorts.add(d.short);
    }
    expect(shorts.size).toBe(REASONS.length);
  });

  it("names the FLOW for the two reasons a dialog can resolve, and none for the retryable one", () => {
    expect(describeBlockReason("conflict").flow).toBe("external-change");
    expect(describeBlockReason("preservation").flow).toBe("preservation");
    // An FSA/lock failure has a next attempt, not a dialog — so the button
    // says "Try again" rather than promising a flow that does not exist.
    expect(describeBlockReason("error").flow).toBeNull();
    expect(describeBlockReason("error").action).toMatch(/again/i);
  });
});

describe("the labels", () => {
  it("describeAge reads in the units a person uses", () => {
    expect(describeAge(3_000)).toBe("a few seconds");
    expect(describeAge(60_000)).toBe("1 minute");
    expect(describeAge(47 * 60_000)).toBe("47 minutes");
    expect(describeAge(60 * 60_000)).toBe("1 hour");
    expect(describeAge(90 * 60_000)).toBe("1h 30m");
  });

  it("describeLandedAt states the time, and says only 'Saved' with no clock", () => {
    expect(describeLandedAt(null)).toBe("Saved");
    const at = new Date(2026, 7, 19, 13, 28).getTime();
    expect(describeLandedAt(at)).toBe("Saved · 13:28");
  });
});
