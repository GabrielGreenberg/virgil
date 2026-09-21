/**
 * The `ai-requests.json` KIND vocabulary is ONE list (task 682).
 *
 * `AI_REQUEST_KINDS` is compile-pinned exhaustive over the `AiRequestKind`
 * union in both directions (`satisfies` one way, the `_KindExhaustive` pin the
 * other), so tsc already forbids the list drifting from the TYPE. What tsc
 * cannot see is the two places the same vocabulary is restated outside the
 * union: the card registry's forward routing tokens, and the Python half of the
 * bridge. Those are pinned here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AI_REQUEST_KINDS, isAiRequestKind, UNKNOWN_AI_REQUEST_KIND } from "@/lib/ai-request-kind";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_KINDS } from "@/cards/predicates";

function pySource(rel: string): string {
  return readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../..", rel),
    "utf8",
  );
}

describe("the AiRequestKind vocabulary", () => {
  it("covers every forward routing token the card registry declares", () => {
    // The outbound direction: `bridgeCardAiRequestFlag` writes
    // `CARD_REGISTRY[k].aiRequest.kind` into the file. A token the registry can
    // WRITE but this list does not know would be rendered "Unrecognized" by the
    // app's own bridge — the inbound gate failing on the app's own output.
    for (const k of CARD_KINDS) {
      const routing = CARD_REGISTRY[k].aiRequest;
      if (!routing) continue;
      expect(isAiRequestKind(routing.kind), `${k} → ${routing.kind}`).toBe(true);
    }
  });

  it("is a set, with no accidental duplicate", () => {
    expect(new Set(AI_REQUEST_KINDS).size).toBe(AI_REQUEST_KINDS.length);
  });

  it("rejects everything that is not a member", () => {
    expect(isAiRequestKind("totally-not-a-kind")).toBe(false);
    expect(isAiRequestKind(UNKNOWN_AI_REQUEST_KIND)).toBe(false);
    expect(isAiRequestKind(undefined)).toBe(false);
    expect(isAiRequestKind(null)).toBe(false);
    expect(isAiRequestKind(7)).toBe(false);
    expect(isAiRequestKind("")).toBe(false);
    // Near-misses: case and whitespace are not forgiven, because the token is a
    // WIRE value shared with Python, not a display string.
    expect(isAiRequestKind("Footnote")).toBe(false);
    expect(isAiRequestKind(" footnote")).toBe(false);
  });

  it("the marker for a MISSING kind is deliberately not a member", () => {
    // Otherwise the gate would launder an absent field into a real kind.
    expect(AI_REQUEST_KINDS).not.toContain(UNKNOWN_AI_REQUEST_KIND);
  });
});

describe("cross-language parity with the Python vocabulary", () => {
  it("_common.AI_REQUEST_KINDS holds exactly the same eight tokens", () => {
    // The Python twin, read live — so adding a kind on either side of the
    // language line trips a test instead of silently drifting. This is the
    // shape `ai-request-open-parity.test.ts` uses for the STATUS vocabulary.
    const src = pySource("editor/scripts/_common.py");
    const m = src.match(/AI_REQUEST_KINDS = \(([\s\S]*?)\)/);
    expect(m, "AI_REQUEST_KINDS not found in _common.py").toBeTruthy();
    const pyKinds = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect([...pyKinds].sort()).toEqual([...AI_REQUEST_KINDS].sort());
  });

  it("apply_response REFUSES an off-union kind rather than defaulting it", () => {
    // `req["kind"] = op.get("kind") or "footnote"` mislabelled a kind-less op as
    // a footnote and passed a caller typo straight through to a file no TS
    // consumer could read. A refusal has a voice (`die`); a mislabel has none.
    const src = pySource("editor/scripts/apply_response.py").replace(/\s+/g, " ");
    expect(src).toContain("_validated_request_kind(");
    expect(src).not.toContain('"kind": op.get("kind") or "footnote"');
  });
});
