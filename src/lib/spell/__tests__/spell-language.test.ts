// Task 2026-08-31-518 — the LANGUAGE half, and the two things the checker
// asks of it.
//
// Driven from a FIVE-WORD inline Hunspell pair rather than the 550 KB vendored
// one. That is the whole point of keeping the engine a pure function of its two
// assets: the user's own words are composed on the main thread by
// `accepted-words.ts`, so nothing here needs a dictionary, a worker, or a fetch
// to be exercised.
import { describe, expect, it } from "vitest";
import { createSpellEngine } from "@/lib/spell/spell-core";
import {
  acceptedWordKey,
  bibNameWords,
  buildAcceptedWords,
} from "@/lib/spell/accepted-words";
import type { BibEntry } from "@/lib/types";

// A minimal Hunspell pair. `S` is a suffix rule so one entry covers a plural,
// which is what makes the "the dictionary decides morphology, not us" claim
// testable at all.
const AFF = ["SET UTF-8", "", "SFX S Y 1", "SFX S   0     s    ."].join("\n");
const DIC = ["4", "the", "claim/S", "English", "receive"].join("\n");

const engine = createSpellEngine({ aff: AFF, dic: DIC });

describe("the engine answers about ENGLISH and nothing else", () => {
  it("knows its words, and their affixed forms", () => {
    expect(engine.isKnown("the")).toBe(true);
    expect(engine.isKnown("claim")).toBe(true);
    expect(engine.isKnown("claims")).toBe(true);
  });

  it("does not know a typo", () => {
    expect(engine.isKnown("teh")).toBe(false);
    expect(engine.isKnown("recieve")).toBe(false);
  });

  it("case is the DICTIONARY's business, not a pre-fold of ours", () => {
    // A pre-lowercased lookup would accept `english`; a pre-capitalized one
    // would accept `Teh`. Hunspell encodes which words may be capitalized, so
    // the token is handed over verbatim.
    expect(engine.isKnown("English")).toBe(true);
    expect(engine.isKnown("english")).toBe(false);
    expect(engine.isKnown("The")).toBe(true);
    expect(engine.isKnown("Teh")).toBe(false);
  });

  it("suggests, and only when asked", () => {
    expect(engine.suggest("teh")).toContain("the");
  });
});

// ── the USER's words ─────────────────────────────────────────────────────────

function entry(fields: Record<string, string>): BibEntry {
  return { key: "k", type: "article", fields } as unknown as BibEntry;
}

describe("the accepted-word authority", () => {
  it("composes the three sources into ONE answer", () => {
    const acc = buildAcceptedWords({
      paper: ["epistemicism"],
      global: ["Gricean"],
      bibEntries: [entry({ author: "López, María and Berg, Jan van der" })],
    });
    expect(acc.has("epistemicism")).toBe(true);
    expect(acc.has("Gricean")).toBe(true);
    expect(acc.has("López")).toBe(true);
    expect(acc.has("María")).toBe(true);
    expect(acc.has("Berg")).toBe(true);
    // …and the control: a word from none of the three is not excused.
    expect(acc.has("teh")).toBe(false);
  });

  it("matches case-insensitively in BOTH directions, and strips one possessive", () => {
    const acc = buildAcceptedWords({ paper: ["Gricean"], global: ["supervenience"] });
    expect(acc.has("gricean")).toBe(true);
    expect(acc.has("GRICEAN")).toBe(true);
    expect(acc.has("Gricean's")).toBe(true);
    expect(acc.has("Gricean’s")).toBe(true);
    expect(acc.has("Supervenience")).toBe(true);
    // Nothing else is inferred — a plural is a different word and stays
    // flagged until it is added. Guessing it would be morphology invented for
    // a name the dictionary has never seen.
    expect(acc.has("Griceans")).toBe(false);
  });

  it("`acceptedWordKey` is the ONE normalization the add-affordance must reuse", () => {
    expect(acceptedWordKey("Gricean's")).toBe("gricean");
    expect(acceptedWordKey("gricean")).toBe("gricean");
  });

  it("a bibliography name is read through the DISPLAY door, not raw bytes", () => {
    // `L{\'o}pez` must contribute `López` — what the prose actually says —
    // which is task 409's projection rather than a second unescaper here.
    const names = bibNameWords([entry({ author: "L{\\'o}pez, Mar{\\'i}a" })]);
    expect(names).toContain("López");
    expect(names).not.toContain("pez");
  });

  it("EDITOR names count too, and a phrase entry indexes its words", () => {
    const acc = buildAcceptedWords({
      paper: ["de re"],
      bibEntries: [entry({ editor: "Kripke, Saul" })],
    });
    expect(acc.has("Kripke")).toBe(true);
    expect(acc.has("Saul")).toBe(true);
    expect(acc.has("de")).toBe(true);
    expect(acc.has("re")).toBe(true);
  });

  it("an empty authority excuses nothing — the accepting control", () => {
    expect(buildAcceptedWords({}).has("anything")).toBe(false);
  });
});
