import { describe, it, expect } from "vitest";
import { CARD_REGISTRY } from "../card-registry";
// Importing the morphs barrel registers every converter onto CARD_REGISTRY (+
// runs the boot assertions) — so `applyCardMorph` below dispatches to a real
// transform for each morphable kind.
import { applyCardMorph } from "../morphs";
import type { RevisionSuggestionCard, CutterSuggestionCard } from "@/lib/types";

/**
 * Task 199 — the inbound twin of 074. A human-authored revision/cutter
 * suggestion carries an editable `explanation` field ("Why this change…" /
 * "Comment / explanation of the cut") that the registry lists in
 * `content.textFields`, so it counts as user content. The suggestion → comment
 * morph declares itself lossless (`lossy: false`, `drops: []`) but the old
 * converter built the comment body from `user_text || suggested_text` only,
 * silently dropping the explanation.
 *
 * These tests pin the non-lossy salvage: the explanation now rides into the
 * free-form comment body (its own paragraph), so the `lossy: false` declaration
 * stays honest. Enumerated from the registry (the two suggestion kinds whose
 * `textFields` include `explanation`), not a hardcoded pair, so a future twin
 * can't regress silently.
 */

const suggestionKinds = ["revision-suggestion", "cutter-suggestion"] as const;

/** Collapse a rich doc's text nodes into a newline-joined string. */
function bodyText(content: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.type === "text" && typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(content);
  return parts.join("\n");
}

function suggestionCard(
  over: Partial<RevisionSuggestionCard>,
): RevisionSuggestionCard & CutterSuggestionCard {
  return {
    kind: "suggestion",
    id: "card-1",
    createdAt: "2026-07-21T00:00:00Z",
    author: "human",
    original_text: "the original passage",
    suggested_text: "",
    explanation: "",
    user_text: "",
    instructions: "",
    status: "pending",
    links: [],
    ...over,
  } as RevisionSuggestionCard & CutterSuggestionCard;
}

describe("morph explanation preservation — suggestion → comment keeps the explanation (task 199)", () => {
  it("sanity: both suggestion kinds still declare `explanation` as user content and a lossless morph", () => {
    for (const kind of suggestionKinds) {
      const entry = CARD_REGISTRY[kind];
      expect(entry.content?.textFields).toContain("explanation");
      // The salvage keeps the declaration honest: no drops, not lossy.
      expect(entry.morph).not.toBeNull();
      expect(entry.morph!.lossy).toBe(false);
      expect(entry.morph!.drops).toHaveLength(0);
    }
  });

  for (const kind of suggestionKinds) {
    it(`${kind} → comment: a non-empty explanation survives even with empty user_text`, () => {
      const card = suggestionCard({ explanation: "because it reads better this way" });
      const out = applyCardMorph(kind, card) as unknown as {
        kind: string;
        text: string;
        content: unknown;
      };
      expect(out.kind).toBe("comment");
      // Salvaged into BOTH the plain-text mirror and the rich body.
      expect(out.text).toContain("because it reads better this way");
      expect(bodyText(out.content)).toContain("because it reads better this way");
    });

    it(`${kind} → comment: user_text AND explanation both ride into the body`, () => {
      const card = suggestionCard({
        user_text: "my requested change",
        explanation: "my rationale",
      });
      const out = applyCardMorph(kind, card) as unknown as { text: string; content: unknown };
      const body = bodyText(out.content);
      expect(out.text).toContain("my requested change");
      expect(out.text).toContain("my rationale");
      expect(body).toContain("my requested change");
      expect(body).toContain("my rationale");
    });
  }
});
