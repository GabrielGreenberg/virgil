// Task 519 — the CURATED table's own contract, and the census.
//
// "Unambiguous" is the whole premise of autocorrect, and an assertion in a
// comment is not a premise anybody can check. So the arbiter is the app's OWN
// shipped Hunspell dictionary — the same one the checker (task 518) reads:
// every `wrong` must be a word it REJECTS (a `wrong` it accepts is a real word
// someone mistook for a typo, and correcting it would rewrite the user's
// vocabulary), and every `right` a word it ACCEPTS. That leg is what makes the
// list safe to GROW: a row added by hand is vetted by CI rather than by
// whoever added it.
//
// The census is the leg with teeth. The table was never the part that could
// misbehave — a second copy of it somewhere, a hand-written alternation that
// stops tracking it, a consumer that re-derives the prose gate, or an
// extension mounted with no port, all type-check perfectly and are invisible
// to every behavioural test of the rule.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import nspell from "nspell";
import {
  AUTOCORRECT_TABLE,
  correctionFor,
  type AutocorrectRow,
} from "@/lib/tiptap/autocorrect";
import { isCheckableWord } from "@/lib/spell/prose-words";
import { DICTIONARY_ASSET_PATHS } from "@/lib/spell/dictionary-asset";
import { REPO_ROOT, commentsStripped, trackedFiles } from "@/lib/__tests__/_source-scan";

const read = (rel: string) => readFileSync(path.resolve(REPO_ROOT, rel), "utf8");
const title = (w: string) => w[0].toUpperCase() + w.slice(1);

// The REAL vendored pair — the arbiter has to be the one that ships, or the
// vetting speaks for a dictionary the user does not have.
const spell = nspell(
  read(path.join("public", DICTIONARY_ASSET_PATHS.aff)),
  read(path.join("public", DICTIONARY_ASSET_PATHS.dic)),
);

describe("every row is vetted by the shipped dictionary", () => {
  it("has rows at all — a vacuous sweep would pass every leg below", () => {
    expect(AUTOCORRECT_TABLE.length).toBeGreaterThan(20);
  });

  it.each(AUTOCORRECT_TABLE.map((r) => [r.wrong, r.right] as const))(
    "%s → %s: the typo is NOT a word, the correction IS",
    (wrong, right) => {
      expect(spell.correct(wrong), `"${wrong}" is a real word — not a typo`).toBe(false);
      expect(spell.correct(right), `"${right}" is not in the dictionary`).toBe(true);
      // The DERIVED Title-case spelling is vetted too, because that is a
      // second replacement the rule will actually perform.
      expect(spell.correct(title(wrong))).toBe(false);
      expect(spell.correct(title(right))).toBe(true);
    },
  );
});

describe("the table's shape is the `words only` invariant", () => {
  const rows: readonly AutocorrectRow[] = AUTOCORRECT_TABLE;

  it("one word in, one word out — no whitespace, no punctuation, ever", () => {
    // This is what "never capitalization or punctuation" MEANS structurally: a
    // row cannot express inserting a space (`alot` → `a lot`), a full stop, or
    // a case change, so no rule can perform one.
    for (const { wrong, right } of rows) {
      expect(wrong).toMatch(/^\p{Ll}+$/u);
      expect(right).toMatch(/^\p{Ll}+$/u);
    }
  });

  it("no duplicate typo, and no row that changes nothing", () => {
    const seen = new Set<string>();
    for (const { wrong, right } of rows) {
      expect(seen.has(wrong), `duplicate row for "${wrong}"`).toBe(false);
      seen.add(wrong);
      expect(wrong).not.toBe(right);
    }
  });

  it("both halves are WORDS by the checker's own rule", () => {
    // `prose-words.ts` is the ONE place that decides what a word is. A row
    // whose halves it would not tokenize is a row the corrector could fire on
    // and the checker could never see.
    for (const { wrong, right } of rows) {
      expect(isCheckableWord(wrong)).toBe(true);
      expect(isCheckableWord(right)).toBe(true);
    }
  });
});

describe("the case rule", () => {
  it("resolves every row in its lower and Title spellings, and nothing else", () => {
    for (const { wrong, right } of AUTOCORRECT_TABLE) {
      expect(correctionFor(wrong)).toBe(right);
      expect(correctionFor(title(wrong))).toBe(title(right));
      expect(correctionFor(wrong.toUpperCase())).toBeNull();
    }
  });

  it("declines a mixed casing — we cannot say what was meant", () => {
    expect(correctionFor("tEh")).toBeNull();
    expect(correctionFor("tEH")).toBeNull();
  });

  it("declines a word the table does not name", () => {
    expect(correctionFor("the")).toBeNull();
    expect(correctionFor("")).toBeNull();
  });
});

// ── the census ──────────────────────────────────────────────────────────────

const PRODUCTION = [
  ...trackedFiles("src", /\.(ts|tsx)$/),
  ...trackedFiles("library", /\.(ts|tsx)$/),
].filter((p) => !p.includes("__tests__") && !p.endsWith(".d.ts"));

const rel = (p: string) => path.relative(REPO_ROOT, p);
const AUTOCORRECT_FILE = "src/lib/tiptap/autocorrect.ts";
const GATE_FILE = "src/lib/tiptap/typed-prose-gate.ts";

describe("census — the table is the SSOT and the gate is the door", () => {
  it("the rule's pattern is BUILT from the table, never hand-written", () => {
    const src = commentsStripped(read(AUTOCORRECT_FILE));
    expect(src).toMatch(/AUTOCORRECT_TABLE\.map\(\(r\) => r\.wrong\)\.join\("\|"\)/);
  });

  it("…and the needle really can see a literal — the stripper keeps them", () => {
    // `codeOnly` BLANKS string literals, which would make the leg below pass on
    // a tree with three copies of the table in it. Proven on a synthetic
    // fixture rather than on the one production line the census exists to
    // drain: a canary must not stand on the defect.
    expect(commentsStripped('const x = "teh"; // teh\n')).toContain('"teh"');
    expect(commentsStripped('const x = "teh"; // teh\n')).not.toMatch(/\/\/ teh/);
  });

  it("no production file outside it spells a curated typo", () => {
    // A second copy of the list is how the two come to disagree about what a
    // typo is — and a literal is exactly how one starts.
    const needles = AUTOCORRECT_TABLE.map((r) => r.wrong);
    const offenders: string[] = [];
    for (const file of PRODUCTION) {
      if (rel(file) === AUTOCORRECT_FILE) continue;
      const src = commentsStripped(read(rel(file)));
      for (const w of needles) {
        if (new RegExp(`["'\`]${w}["'\`]`).test(src)) offenders.push(`${rel(file)}: ${w}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the gate reads the SSOTs — it spells no mark name and no node list", () => {
    const src = commentsStripped(read(GATE_FILE));
    expect(src).toContain("isRawLatexMarkName");
    expect(src).toContain("blockCarriesProse");
    expect(src).toContain("forEachBareCommand");
    // A hand-spelled carrier name here would silently stop covering a fourth
    // one the family gains by declaration.
    expect(src).not.toMatch(/["']latexCommand["']/);
    expect(src).not.toMatch(/["']latexVerbatim["']/);
  });

  it("nothing re-derives the gate — one door, one caller", () => {
    const callers = PRODUCTION.filter((f) => rel(f) !== GATE_FILE).filter((f) =>
      commentsStripped(read(rel(f))).includes("typedTextIsProse"),
    );
    // The barrel re-export plus the rule itself. A THIRD site would be a
    // consumer that should be asking the door rather than a second gate.
    expect(callers.map(rel).sort()).toEqual([AUTOCORRECT_FILE, "src/lib/tiptap/index.ts"]);
  });

  it("the extension is mounted ONCE, and handed the document's port", () => {
    const src = commentsStripped(read("src/lib/editor-extensions.ts"));
    const mounts = src.match(/Autocorrect\.configure\(/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(src).toMatch(/Autocorrect\.configure\(\{ portRef: ctx\.spellcheckPortRef \?\? null \}\)/);
  });
});

describe("census — the preference has one row and three agreeing spellings", () => {
  it("the registry declares it, ON by default, in the Display menu", () => {
    const src = commentsStripped(read("src/lib/view-prefs/registry.ts"));
    expect(src).toMatch(
      /autocorrectTypos:\s*\{ kind: "toggle", scope: "global", default: true,[^}]*menu: "display"/,
    );
  });

  it("the shipped defaults JSON agrees with the registry default", () => {
    const defaults = JSON.parse(read("src/hooks/useViewPrefs.defaults.json"));
    expect(defaults.autocorrectTypos).toBe(true);
  });

  it("it participates in the promotion pipeline, like its sibling", () => {
    const reg = JSON.parse(read("src/lib/dev-prefs-registry.json"));
    const viewPrefs = reg.promotable.find(
      (e: { storageKey: string }) => e.storageKey === "virgil-view-prefs/global",
    );
    expect(viewPrefs.whitelist).toContain("autocorrectTypos");
  });
});
