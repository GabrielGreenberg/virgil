/**
 * Task 850 — the update/reload confirm's closing line must follow the mirror's
 * RECEIPTS. Pre-850 `mirrored` was always true (the mirror never throws), so
 * the "could NOT keep an emergency copy" line was unreachable and the confirm
 * promised a copy after a quota error, an oversized model, or no model.
 */

import { describe, it, expect, vi } from "vitest";

// The banner's module graph reaches `@/lib/storage`, whose backend is chosen
// by a runtime require the test environment cannot resolve.
vi.mock("@/lib/storage", () => ({}));

import { describeMirrorVerdict } from "@/components/SoftwareUpdateBanner";
import type { AppReloadReadiness } from "@/lib/reload-door";

const A = { docId: "A", reason: "conflict" as const, ageMs: 60_000, windowId: null };

function readiness(over: Partial<AppReloadReadiness>): AppReloadReadiness {
  return { unlanded: [A], mirrored: true, unresponsive: [], ...over };
}

describe("describeMirrorVerdict", () => {
  it("mirrored:false renders the \"could NOT\" line — and never the promise", () => {
    const line = describeMirrorVerdict(readiness({ mirrored: false }));
    expect(line).toMatch(/could NOT keep an emergency copy/);
    expect(line).not.toMatch(/has kept an emergency copy/);
  });

  it("mirrored:true keeps the promise", () => {
    expect(describeMirrorVerdict(readiness({ mirrored: true }))).toMatch(
      /has kept an emergency copy/,
    );
  });

  it("nothing unlanded (only an unknown window) makes no mirror claim either way", () => {
    const line = describeMirrorVerdict(
      readiness({ unlanded: [], mirrored: false, unresponsive: ["w2"] }),
    );
    expect(line).not.toMatch(/emergency copy/);
  });
});
