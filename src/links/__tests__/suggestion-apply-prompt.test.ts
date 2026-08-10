// Pins the flag-OFF Accept prompt contract shared by the Cutter and Revisions
// suggestion hosts (src/links/suggestion-apply-prompt.ts).
//
// The regression this guards (task 2026-07-12-109): the cutter host used to
// carry its own `buildSuggestionPrompt` copy that emitted `REPLACEMENT:
// ${suggested_text}` and never read `user_text`, so a human who typed their cut
// into the editable "your version" (`user_text`) field and clicked Accept
// queued a request with the stale/blank `suggested_text`. The shared builder
// makes `user_text` win over `suggested_text` for BOTH families, so the two
// paths can't diverge again.

import { describe, it, expect } from "vitest";
import {
  buildSuggestionApplyPrompt,
  type SuggestionPromptSource,
} from "@/links/suggestion-apply-prompt";

function src(
  over: Partial<SuggestionPromptSource> = {},
): SuggestionPromptSource {
  return {
    original_text: "the original span",
    suggested_text: "",
    explanation: "",
    user_text: "",
    instructions: "",
    links: [],
    ...over,
  };
}

/** Pull the single `REPLACEMENT: …` line out of the built prompt. */
function replacementLine(prompt: string): string {
  const line = prompt.split("\n").find((l) => l.startsWith("REPLACEMENT:"));
  return line ?? "";
}

describe("buildSuggestionApplyPrompt — REPLACEMENT precedence", () => {
  it("uses user_text when set and suggested_text is blank (the cutter bug)", () => {
    const prompt = buildSuggestionApplyPrompt(
      "cutter-suggestion",
      src({ user_text: "my own cut", suggested_text: "" }),
    );
    expect(replacementLine(prompt)).toBe("REPLACEMENT: my own cut");
  });

  it("prefers user_text over suggested_text when both are set", () => {
    const prompt = buildSuggestionApplyPrompt(
      "cutter-suggestion",
      src({ user_text: "human refinement", suggested_text: "ai draft" }),
    );
    expect(replacementLine(prompt)).toBe("REPLACEMENT: human refinement");
  });

  it("falls back to suggested_text when user_text is empty", () => {
    const prompt = buildSuggestionApplyPrompt(
      "cutter-suggestion",
      src({ user_text: "", suggested_text: "ai draft" }),
    );
    expect(replacementLine(prompt)).toBe("REPLACEMENT: ai draft");
  });

  it("applies the same precedence for the revision family", () => {
    const prompt = buildSuggestionApplyPrompt(
      "revision-suggestion",
      src({ user_text: "human refinement", suggested_text: "ai draft" }),
    );
    expect(replacementLine(prompt)).toBe("REPLACEMENT: human refinement");
  });
});

describe("buildSuggestionApplyPrompt — family lead-in + shape", () => {
  it("uses the cutter lead-in verb for the cutter family", () => {
    const prompt = buildSuggestionApplyPrompt("cutter-suggestion", src());
    expect(prompt.split("\n")[0]).toBe("Apply this suggestion in the document:");
  });

  it("uses the revision lead-in verb for the revision family", () => {
    const prompt = buildSuggestionApplyPrompt("revision-suggestion", src());
    expect(prompt.split("\n")[0]).toBe(
      "Apply this revision suggestion in the document:",
    );
  });

  it("emits INSTRUCTIONS only when present", () => {
    expect(
      buildSuggestionApplyPrompt("cutter-suggestion", src()).includes(
        "INSTRUCTIONS:",
      ),
    ).toBe(false);
    expect(
      buildSuggestionApplyPrompt(
        "cutter-suggestion",
        src({ instructions: "make it punchier" }),
      ),
    ).toContain("INSTRUCTIONS: make it punchier");
  });

  it("falls back to (none) for a blank explanation and empty anchor", () => {
    const prompt = buildSuggestionApplyPrompt("cutter-suggestion", src());
    expect(prompt).toContain("EXPLANATION: (none)");
    expect(prompt).toContain("ANCHOR: (none)");
  });

  it("summarizes selectedText + textObject paragraph anchors", () => {
    const prompt = buildSuggestionApplyPrompt(
      "revision-suggestion",
      src({
        selectedText: "grabbed",
        links: [
          {
            id: "l1",
            kind: "anchor",
            anchor: {
              type: "textObject",
              targetKind: "paragraph",
              textObjectIds: ["u1", "u2"],
            },
            target: {
              type: "card",
              ref: { kind: "revision-suggestion", id: "c1" },
            },
            createdAt: "2026-07-12T00:00:00.000Z",
          },
        ],
      }),
    );
    expect(prompt).toContain('ANCHOR: captured text: "grabbed"; paragraphs: u1, u2');
  });
});
