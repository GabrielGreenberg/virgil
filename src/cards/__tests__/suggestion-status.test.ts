// @vitest-environment node
//
// Task 1539 — the status vocabulary's load-time reader. Both families'
// sidecar migrators read `coerceSuggestionStatus`, so every member of
// SUGGESTION_STATUSES survives a load and nothing else does.

import { describe, it, expect } from "vitest";
import {
  SUGGESTION_STATUSES,
  coerceSuggestionStatus,
  isSuggestionStatus,
} from "@/cards/suggestion-status";

describe("coerceSuggestionStatus (task 1539)", () => {
  it("round-trips every member of the vocabulary", () => {
    for (const s of SUGGESTION_STATUSES) {
      expect(isSuggestionStatus(s)).toBe(true);
      expect(coerceSuggestionStatus(s)).toBe(s);
    }
  });

  it("reads anything else as the drafted `pending` stage", () => {
    for (const s of [undefined, null, "", "Accepted", "done", 3, {}]) {
      expect(isSuggestionStatus(s)).toBe(false);
      expect(coerceSuggestionStatus(s)).toBe("pending");
    }
  });
});
