/**
 * THE linked-card answer (task 1137) — `resolveLinkedCardFrom`, the ONE gate
 * every flag-bearing kind's `linkedTo` resolves through for the AI window's
 * Cancel routing and snippet.
 *
 * The defect: the footnote case alone answered on PRESENCE, skipping the
 * loaded/loadError gate its six siblings took. Before `footnotes.json` had
 * loaded (or after its read threw) a footnote-linked row resolved `absent`,
 * Cancel took the raw delete, and the footnote's AI flag stayed lit over a row
 * that no longer existed. Now every kind is a SOURCE in one table, and the
 * census below pins that the table covers every kind that can carry a flag.
 */
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(),
  writeSidecar: vi.fn(),
}));

import {
  linkedCardSource,
  resolveLinkedCardFrom,
  LINKED_CARD_ABSENT,
  LINKED_CARD_UNKNOWN,
} from "@/components/AIWindow";
import { CARD_REGISTRY } from "@/cards/card-registry";

const ref = { id: "fn1", body: "Check this quote" };
const footnotes = (loaded: boolean, loadError: boolean, cards: { id: string; body: string }[]) => ({
  footnote: linkedCardSource(loaded, loadError, cards, (c) => c.body),
});

describe("resolveLinkedCardFrom — one gate for every kind", () => {
  it("a footnote missing before footnotes.json has loaded is UNKNOWN, not absent", () => {
    expect(resolveLinkedCardFrom(footnotes(false, false, []), "footnote", "fn1")).toEqual(
      LINKED_CARD_UNKNOWN,
    );
  });

  it("a footnote missing after an UNREADABLE footnotes.json is UNKNOWN", () => {
    // useFootnotes leaves `loaded` false on a failed read; `loadError` says why.
    expect(resolveLinkedCardFrom(footnotes(false, true, []), "footnote", "fn1")).toEqual(
      LINKED_CARD_UNKNOWN,
    );
    // …and a source that reports loaded + loadError (the usePersistentState
    // shape) is unknown too.
    expect(resolveLinkedCardFrom(footnotes(true, true, []), "footnote", "fn1")).toEqual(
      LINKED_CARD_UNKNOWN,
    );
  });

  it("a footnote missing from a RESOLVED, error-free mirror is ABSENT", () => {
    expect(resolveLinkedCardFrom(footnotes(true, false, []), "footnote", "fn1")).toEqual(
      LINKED_CARD_ABSENT,
    );
  });

  it("a present card answers with its live text, whatever the read state", () => {
    expect(resolveLinkedCardFrom(footnotes(false, false, [ref]), "footnote", "fn1")).toEqual({
      state: "present",
      text: "Check this quote",
    });
  });

  it("a kind with no source has no collection to ask → absent (raw delete)", () => {
    expect(resolveLinkedCardFrom({}, "citation", "c1")).toEqual(LINKED_CARD_ABSENT);
  });
});

describe("census — EditorPane's source table covers every flag-bearing kind", () => {
  it("every CARD_REGISTRY kind with an `aiRequest` contract has a linkedCardSources entry", () => {
    const src = readFileSync(join(__dirname, "../EditorPane.tsx"), "utf8");
    const start = src.indexOf("const linkedCardSources = useMemo(");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("\n    }),\n", start));
    const keys = new Set(
      [...block.matchAll(/^\s{6}(?:"([\w-]+)"|([\w]+)): linkedCardSource\(/gm)].map(
        (m) => m[1] ?? m[2],
      ),
    );
    const flagBearing = Object.entries(CARD_REGISTRY)
      .filter(([, entry]) => (entry as { aiRequest?: unknown }).aiRequest)
      .map(([kind]) => kind);
    expect(flagBearing.length).toBeGreaterThan(0);
    const missing = flagBearing.filter((k) => !keys.has(k));
    expect(missing, `flag-bearing kinds with no linked-card source: ${missing.join(", ")}`).toEqual(
      [],
    );
  });
});
