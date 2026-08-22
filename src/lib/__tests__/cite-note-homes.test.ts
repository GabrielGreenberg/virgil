// Task 403 — "one datum, two homes, the reader picks by convention", in the
// citation-command model.
//
// `parseNatbibCommand` put a citation's `[pre][post]` at the TOP LEVEL,
// `parseBiblatexCommand` put it on `entries[]` AND mirrored `entries[0]`'s onto
// the top level, and each of the three consumers then guessed which home was
// authoritative — with three DIFFERENT guesses:
//
//   - the panel's `rowsFromCommand` mirrored `entries[0]`'s note onto EVERY row
//     (under a comment reading "For natbib" over code that ran always), so a
//     biblatex `\cites[p. 1]{a}{b}` rendered "p. 1" on `b` and the next
//     `persist()` WROTE `\cites[p. 1]{a}[p. 1]{b}` into the user's `.tex` — a
//     page range invented on a citation that never had one;
//   - `serializeCiteCommand` read `entries[]` only, so a natbib top-level note
//     was silently DROPPED on the round trip;
//   - the display formatter guessed a third way, from the command NAME plus the
//     document's package.
//
// The two homes are now unrepresentable (a discriminated union on `noteScope`)
// and the ONE placement rule is `resolveCiteNoteRows`, read by both renderers.
//
// SHAPE OF THESE LEGS: every byte leg runs TWO cycles, because this class's
// fixed points are what make the invention permanent — cycle 1 writes it, and
// from then on the file simply says something the author never wrote. Controls
// run through the identical harness so no leg can pass by dropping every note.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  parseCiteCommand,
  parseNatbibCommand,
  parseBiblatexCommand,
  resolveCiteNoteRows,
  serializeCiteCommand,
  citeNotesDroppedByPackage,
  derivePlural,
  type ParsedCiteCommand,
} from "@/lib/cite-command-model";
import { formatInlineCitation } from "@/lib/bib-parser";
import type { BibEntry } from "@/lib/types";
import { commentsStripped } from "./_source-scan";

/** What `CitationCard.persist()` does: take the per-key rows the UI edits and
 *  re-serialize them for the document's package. The panel's own row builder is
 *  a thin `resolveCiteNoteRows` wrapper, so this IS the save cycle. */
function saveCycle(command: string, bibPackage: string): string {
  const parsed = parseCiteCommand(command);
  if (!parsed) return command;
  return serializeCiteCommand(
    {
      type: parsed.type,
      starred: parsed.starred,
      capitalized: parsed.capitalized,
      noteScope: "per-key",
      entries: resolveCiteNoteRows(parsed),
    },
    bibPackage,
  );
}

/** What the card's package-flip effect does: re-derive the singular↔plural
 *  shape for the new package, then re-serialize the same rows. */
function flipPackage(command: string, bibPackage: string): string {
  const parsed = parseCiteCommand(command);
  if (!parsed) return command;
  const rows = resolveCiteNoteRows(parsed);
  return serializeCiteCommand(
    {
      type: derivePlural(parsed.type, rows, bibPackage),
      starred: parsed.starred,
      capitalized: parsed.capitalized,
      noteScope: "per-key",
      entries: rows,
    },
    bibPackage,
  );
}

function twoCycles(command: string, bibPackage: string): [string, string] {
  const one = saveCycle(command, bibPackage);
  return [one, saveCycle(one, bibPackage)];
}

// ── #1 — the headline: no note is INVENTED on a key that never had one ───────

describe("a whole-citation note is placed, never mirrored", () => {
  it("a biblatex multi-cite with a note on the FIRST key only round-trips", () => {
    // THE REPORTED SHAPE. Pre-fix this became `\cites[p. 1]{a}[p. 1]{b}` on the
    // first save and stayed there — `b` acquired a page range out of nothing.
    const src = "\\cites[p. 1]{a}{b}";
    expect(twoCycles(src, "biblatex")).toEqual([src, src]);

    const rows = resolveCiteNoteRows(parseCiteCommand(src)!);
    expect(rows.map((r) => r.postnote)).toEqual(["p. 1", undefined]);
  });

  it("…and the CONTROL, divergent per-key notes, keeps BOTH", () => {
    const src = "\\cites[p. 1]{a}[p. 2]{b}";
    expect(twoCycles(src, "biblatex")).toEqual([src, src]);
    const rows = resolveCiteNoteRows(parseCiteCommand(src)!);
    expect(rows.map((r) => r.postnote)).toEqual(["p. 1", "p. 2"]);
  });

  it("a note on the LAST key only stays on the last key", () => {
    const src = "\\cites{a}[p. 9]{b}";
    expect(twoCycles(src, "biblatex")).toEqual([src, src]);
    expect(
      resolveCiteNoteRows(parseCiteCommand(src)!).map((r) => r.postnote),
    ).toEqual([undefined, "p. 9"]);
  });

  it("the same invention one command shape over: a biblatex SINGULAR form with comma keys", () => {
    // `\parencite[p. 1]{a,b}` is ONE bracket group before ONE brace group — a
    // whole-citation note, exactly like natbib's. Pre-fix the parser published
    // it per-key on BOTH entries, so the card's next save wrote
    // `\parencites[p. 1][]{a}[p. 1][]{b}` — the note DUPLICATED onto `a`.
    const src = "\\parencite[p. 1]{a,b}";
    expect(
      resolveCiteNoteRows(parseCiteCommand(src)!).map((r) => r.postnote),
    ).toEqual([undefined, "p. 1"]);

    // The MODEL round-trips it byte-identically.
    expect(serializeCiteCommand(parseCiteCommand(src)!, "biblatex")).toBe(src);

    // DECLARED NORMALIZATION, stated rather than claimed away: the CARD's rows
    // are per-key by construction (each row owns a `+range` input), so its next
    // save re-spells the same citation in the plural form. One-time and
    // idempotent, and — the part that matters — the single note stays on the
    // single key that owns it.
    const [one, two] = twoCycles(src, "biblatex");
    expect(one).toBe("\\parencites{a}[p. 1]{b}");
    expect(two).toBe(one);
    expect(one.match(/p\. 1/g)?.length).toBe(1);
  });
});

// ── #2 — a natbib top-level note survives the round trip ─────────────────────

describe("serializeCiteCommand cannot read the wrong home", () => {
  it("a natbib single-key postnote survives parse → serialize", () => {
    // Pre-fix: `serializeCiteCommand(parseCiteCommand("\\citep[p.~22]{k}"))`
    // returned `\citep{k}` — the note read from `entries[]`, which natbib's
    // parser deliberately leaves note-less.
    const src = "\\citep[p.~22]{k}";
    const parsed = parseCiteCommand(src)!;
    expect(serializeCiteCommand(parsed)).toBe(src);
    expect(serializeCiteCommand(parseCiteCommand(serializeCiteCommand(parsed))!)).toBe(src);
  });

  it("a natbib pre+post over several keys survives, and stays at the edges", () => {
    const src = "\\citep[see][p.~22]{a,b}";
    expect(serializeCiteCommand(parseCiteCommand(src)!)).toBe(src);
    expect(twoCycles(src, "natbib")).toEqual([src, src]);
    expect(resolveCiteNoteRows(parseCiteCommand(src)!)).toEqual([
      { key: "a", prenote: "see", postnote: undefined },
      { key: "b", prenote: undefined, postnote: "p.~22" },
    ]);
  });

  it("a note-less command is unchanged in either package", () => {
    for (const [src, pkg] of [
      ["\\cite{a,b}", "natbib"],
      ["\\citep{a}", "natbib"],
      ["\\cites{a}{b}", "biblatex"],
    ] as const) {
      expect(twoCycles(src, pkg)).toEqual([src, src]);
    }
  });
});

// ── the model itself: the two homes are UNREPRESENTABLE ──────────────────────

describe("the note's home is a discriminated union", () => {
  it("natbib always parses to the WHOLE arm, with note-less entries", () => {
    const p = parseNatbibCommand("\\citep[see][p. 22]{a,b}")!;
    expect(p.noteScope).toBe("whole");
    expect(p.prenote).toBe("see");
    expect(p.postnote).toBe("p. 22");
    // The entries carry no note field AT ALL — that is the fix, not a value.
    for (const e of p.entries) expect(Object.keys(e)).toEqual(["key"]);
  });

  it("biblatex discriminates on SYNTAX — how many bracket groups, not the package", () => {
    // One group ⇒ whole. Several ⇒ per-key. Both are biblatex.
    expect(parseBiblatexCommand("\\parencite[p. 1]{a,b}")!.noteScope).toBe("whole");
    expect(parseBiblatexCommand("\\cites[p. 1]{a}[p. 2]{b}")!.noteScope).toBe("per-key");
    expect(parseBiblatexCommand("\\cites[p. 1]{a}{b}")!.noteScope).toBe("per-key");
  });

  it("the PER-KEY arm carries no top-level note to be mirrored from", () => {
    const p = parseCiteCommand("\\cites[p. 1]{a}{b}")! as ParsedCiteCommand;
    expect(p.noteScope).toBe("per-key");
    // `prenote`/`postnote` are absent from this arm's TYPE; assert the runtime
    // shape too, so a hand-built object can't smuggle them back in.
    expect("prenote" in p).toBe(false);
    expect("postnote" in p).toBe(false);
  });

  it("an empty / keyless draft still parses to zero keys (the pristine path)", () => {
    for (const src of ["\\cite{}", "\\cite{ }", "\\citep{a,,b}"]) {
      const p = parseCiteCommand(src);
      expect(p, src).not.toBeNull();
    }
    expect(parseCiteCommand("\\cite{}")!.keys).toEqual([]);
    expect(parseCiteCommand("\\citep{a,,b}")!.keys).toEqual(["a", "b"]);
    expect(parseCiteCommand("\\cite")).toBeNull();
  });
});

// ── the two RENDERERS read one answer ────────────────────────────────────────

const BIB: BibEntry[] = [
  { uid: "u1", key: "a", type: "book", fields: { author: "Alpha, A.", year: "2001", title: "A" }, raw: "" },
  { uid: "u2", key: "b", type: "book", fields: { author: "Beta, B.", year: "2002", title: "B" }, raw: "" },
];

describe("the display formatter and the panel rows agree BY CONSTRUCTION", () => {
  it("the note shows once, beside the key that owns it", () => {
    const shown = formatInlineCitation("\\cites[p. 1]{a}{b}", BIB, "biblatex");
    // "Alpha 2001, p. 1; Beta 2002" — one occurrence, not two.
    expect(shown.match(/p\. 1/g)?.length).toBe(1);
    expect(shown).toContain("Alpha 2001, p. 1");
    expect(shown).toContain("Beta 2002");
    expect(shown).not.toContain("Beta 2002, p. 1");
  });

  it("a whole-citation note renders at the edges in either package", () => {
    // natbib: prenote before the first, postnote after the last.
    expect(formatInlineCitation("\\citep[see][p. 22]{a,b}", BIB, "natbib")).toBe(
      "(see Alpha, 2001; Beta, 2002, p. 22)",
    );
    // biblatex's singular comma form says the same thing and now renders it the
    // same way (pre-fix it repeated the note on every key).
    const bl = formatInlineCitation("\\parencite[p. 22]{a,b}", BIB, "biblatex");
    expect(bl.match(/p\. 22/g)?.length).toBe(1);
  });
});

// ── #3 — a package flip may be lossy, but never SILENTLY ─────────────────────

describe("citeNotesDroppedByPackage names what a flip would cost", () => {
  it("biblatex → natbib loses the note natbib cannot represent", () => {
    // natbib renders ONE bracket pair at the edges, so of `[p. 1]` and `[p. 99]`
    // only the last survives.
    expect(citeNotesDroppedByPackage("\\cites[p. 1]{a}[p. 99]{b}", "natbib")).toEqual(["a"]);
    // A note on the FIRST key alone is lost too — natbib's single bracket is
    // read as the POSTnote, which comes off the LAST key.
    expect(citeNotesDroppedByPackage("\\cites[p. 1]{a}{b}", "natbib")).toEqual(["a"]);
  });

  it("…and says nothing when nothing is lost", () => {
    // Representable: the only note already sits on the last key.
    expect(citeNotesDroppedByPackage("\\cites{a}[p. 9]{b}", "natbib")).toEqual([]);
    // Note-less, single-key, and the widening direction are all free.
    expect(citeNotesDroppedByPackage("\\cites{a}{b}", "natbib")).toEqual([]);
    expect(citeNotesDroppedByPackage("\\citep[p. 22]{k}", "biblatex")).toEqual([]);
    expect(citeNotesDroppedByPackage("\\citep[see][p. 22]{a,b}", "biblatex")).toEqual([]);
    expect(citeNotesDroppedByPackage("not a command", "natbib")).toEqual([]);
  });

  it("the answer is DERIVED from the real serializer, so it matches the bytes", () => {
    // The predicate must not be a second statement of the flatten rule: what it
    // reports lost is exactly what the save cycle removes.
    const src = "\\cites[p. 1]{a}[p. 99]{b}";
    const flipped = flipPackage(src, "natbib");
    expect(flipped).toBe("\\cite[p. 99]{a,b}");
    expect(flipped).not.toContain("p. 1");
    expect(citeNotesDroppedByPackage(src, "natbib")).toEqual(["a"]);
  });
});

// ── the leg with teeth: nobody keeps a second copy of the answer ─────────────

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SSOT = join("src", "lib", "cite-command-model.ts");

function productionFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(REPO_ROOT, dir))) {
      const rel = join(dir, name);
      const abs = join(REPO_ROOT, rel);
      if (statSync(abs).isDirectory()) {
        if (name === "__tests__" || name === "node_modules") continue;
        walk(rel);
        continue;
      }
      if (!/\.tsx?$/.test(name)) continue;
      if (/\.test\.tsx?$/.test(name)) continue;
      out.push(rel);
    }
  };
  walk("src");
  walk("library");
  return out;
}

describe("census — the model has ONE home", () => {
  const files = productionFiles();

  it("is not vacuous: it reads the real trees", () => {
    expect(files.length).toBeGreaterThan(400);
    expect(files).toContain(SSOT);
    expect(files).toContain(join("src", "lib", "bib-parser.ts"));
    expect(files).toContain(join("library", "lib", "bib-parser.ts"));
  });

  it("no file outside the SSOT re-declares the parse/serialize model", () => {
    // `library/lib/bib-parser.ts` WAS a fourth copy of this answer — a
    // self-declared whole-file clone whose parse half had already silently
    // diverged from `src/` (the empty-key filter and the `matchedGroup` guard
    // never landed there). A copy is not caught by any behavioural test of
    // either file, which is exactly how it drifted.
    const NEEDLES = [
      "NATBIB_HEAD_RE",
      "BIBLATEX_HEAD_RE",
      "HAS_PLURAL_FORM",
      "function parseNatbibCommand",
      "function parseBiblatexCommand",
      "function serializeCiteCommand",
      "function derivePlural",
    ];
    const offenders: string[] = [];
    for (const rel of files) {
      if (rel === SSOT) continue;
      const code = commentsStripped(readFileSync(join(REPO_ROOT, rel), "utf8"));
      for (const n of NEEDLES) if (code.includes(n)) offenders.push(`${rel}: ${n}`);
    }
    expect(offenders).toEqual([]);
  });

  it("every consumer that parses a command and touches a note asks the placement rule", () => {
    // The SSOT was never the part that could misbehave — a call site that
    // places the note by its own convention is, and `parsed.prenote` type-checks
    // perfectly on the arm that has it. Allowlist EMPTY: a hit is ASK-it.
    const offenders: string[] = [];
    let population = 0;
    for (const rel of files) {
      if (rel === SSOT) continue;
      const code = commentsStripped(readFileSync(join(REPO_ROOT, rel), "utf8"));
      const parses = /parseCiteCommand\s*\(/.test(code);
      const touchesNote = /prenote|postnote/.test(code);
      if (!parses || !touchesNote) continue;
      population++;
      if (!code.includes("resolveCiteNoteRows(")) offenders.push(rel);
    }
    // The three that must be in the population: both bib-parsers and the panel
    // card whose rows ARE the per-key view.
    expect(population).toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
  });

  it("the Package control asks BEFORE it writes", () => {
    // A warning nothing renders is the shape this repo keeps re-finding, so the
    // wiring is pinned rather than assumed: the package buttons route through
    // the gate, and only the gate (and the confirm's own onConfirm) may call
    // the writer.
    const rel = join("src", "panels", "Citations", "CitationsPanel.tsx");
    const code = commentsStripped(readFileSync(join(REPO_ROOT, rel), "utf8"));
    expect(code).toContain("citeNotesDroppedByPackage(");
    expect(code).toContain("onClick={() => requestBibPackage(p.value)}");
    expect(code).toContain('tone="danger"');
    // Exactly THREE writer calls, and every one of them is inside the gate or
    // the confirm it opens: the same-package re-confirm (which cannot lose
    // anything), the zero-loss fast path, and the acknowledged switch. A fourth
    // is a package button writing directly again.
    expect(code.match(/onSetBibPackage\(/g)?.length).toBe(3);
  });
});
