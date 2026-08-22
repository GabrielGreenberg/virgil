import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  bibFieldDisplay,
  parseBibFile,
  serializeBibFile,
} from "@/lib/bib-parser";
import { codeOnlyLines } from "./_source-scan";
import type { BibEntry } from "@/lib/types";

/**
 * Task 2026-08-21-409 — the bib ROW family.
 *
 * Task 368 gave a raw LaTeX fragment shown as DISPLAY TEXT a door
 * (`latexToDisplayText`) and applied it over the finished output of the four
 * citation FORMATTERS. Its census discovers its population from the
 * bib-parsers' `format*` exports, so it is structurally blind to a COMPONENT
 * that reads `entry.fields.title` into JSX itself — and that is the whole bib
 * row family: the Library list row (the most-viewed bib surface in the app),
 * the entry picker, the bib cards, the Citations per-key rows, the paper
 * detail header. Those rendered `L{\'o}pez` and `\&` verbatim, beside body
 * text that rendered the same bytes correctly.
 *
 * The sharpest single piece of evidence, and the first leg below: ONE picker
 * row already projected its AUTHOR (`formatAuthorsTruncated` has projected
 * since 368) beside a RAW title.
 *
 * ── what this suite pins ──
 *  1. the accessor's contract, including the two decided behaviours a later
 *     reader would otherwise file as bugs (grouping braces survive; ABSENCE is
 *     `undefined`, so a `?? catalogValue` chain reads as it always did);
 *  2. the sort keys (decision 3) — including the one-time export re-ordering;
 *  3. THE CENSUS, which is the leg with teeth: the accessor was never the part
 *     that could misbehave; a surface that reads `entry.fields.<name>` itself
 *     is, and that type-checks perfectly.
 */

const LOPEZ: BibEntry = {
  uid: "u1",
  key: "lopez2009",
  type: "article",
  fields: {
    author: "L{\\'o}pez, Luis and M{\\\"u}ller, Gereon",
    editor: "S{\\'a}nchez, Ana",
    year: "2009",
    title: "Ellipsis, Anaphora \\& the {DNA} of Language",
    journal: "Linguistic Inquiry \\& Beyond",
    pages: "10--25",
  },
  raw: "",
};

/**
 * The sort case, and it took MEASUREMENT to pick. `L{\'o}pez` does NOT sort
 * wrong: ICU treats the interior braces as punctuation and collates it under
 * "l" either way. What moves is a field whose FIRST character is the escape —
 * ICU's default collation is `alternate: non-ignorable`, so a LEADING
 * backslash (or brace) sorts before every letter and files the entry at the
 * TOP of the list. `\'Alvarez` is the ordinary shape of that.
 */
const ALVAREZ: BibEntry = {
  uid: "u3",
  key: "alvarez2011",
  type: "article",
  fields: { author: "\\'Alvarez, Ana", year: "2011", title: "A Paper" },
  raw: "",
};

const ADAMS: BibEntry = {
  uid: "u2",
  key: "adams1999",
  type: "book",
  fields: { author: "Adams, Ann", year: "1999", title: "A Book" },
  raw: "",
};

// ── 1. the accessor ──────────────────────────────────────────────────────────

describe("bibFieldDisplay — the per-field bib-row door", () => {
  it("projects an accent command, an escaped ampersand and an en dash", () => {
    expect(bibFieldDisplay(LOPEZ, "author")).toBe("L{ó}pez, Luis and M{ü}ller, Gereon");
    expect(bibFieldDisplay(LOPEZ, "title")).toBe(
      "Ellipsis, Anaphora & the {DNA} of Language",
    );
    expect(bibFieldDisplay(LOPEZ, "pages")).toBe("10–25");
  });

  it("DECIDED, not a gap: the BibTeX grouping braces SURVIVE", () => {
    // Gabriel, 2026-08-21, decision 1. `L{ó}pez` is strictly better than
    // `L{\'o}pez` and it is the SAME characters body text shows for the same
    // bytes — the property task 368's suite pins. A full BibTeX-semantics
    // projection (a bare `{…}` is pure grouping and never prints) needs a
    // vocabulary this codebase has no SSOT for, and hand-listing one here is
    // the drift every census in this file exists to prevent. Pinned so the
    // next reader does not file the surviving braces as a bug.
    expect(bibFieldDisplay(LOPEZ, "author")).toContain("{ó}");
    expect(bibFieldDisplay(LOPEZ, "author")).not.toContain("\\'");
  });

  it("ABSENCE is `undefined` and EMPTY is the empty string", () => {
    // Load-bearing: every converted site keeps its `?? catalogValue` fallback
    // chain, which is only faithful because absence is distinguishable. A door
    // that coalesced both to "" would let an empty bib title shadow a real
    // catalog title.
    expect(bibFieldDisplay(LOPEZ, "doi")).toBeUndefined();
    expect(bibFieldDisplay(undefined, "title")).toBeUndefined();
    expect(bibFieldDisplay(null, "title")).toBeUndefined();
    expect(bibFieldDisplay({ fields: { title: "" } }, "title")).toBe("");
    expect(bibFieldDisplay({}, "title")).toBeUndefined();
  });

  it("is idempotent, so a doubly-projected field is byte-stable", () => {
    // Several converted sites hand a PROJECTED author to a surname helper that
    // projects its own output (`formatAuthorsTruncated`). The composition must
    // not drift.
    const once = bibFieldDisplay(LOPEZ, "author")!;
    expect(bibFieldDisplay({ fields: { author: once } }, "author")).toBe(once);
  });

  it("projection can neither create nor destroy the ` and ` separator", () => {
    // The premise every converted surname helper rests on: they split the
    // PROJECTED string, not the raw one.
    const projected = bibFieldDisplay(LOPEZ, "author")!;
    expect(projected.split(" and ")).toHaveLength(
      LOPEZ.fields.author.split(" and ").length,
    );
  });
});

// ── 2. sort keys (decision 3) ────────────────────────────────────────────────

/** The comparator `BibliographyPanel` declares, re-derived here through the
 *  same door so the leg states the RULE rather than a second implementation. */
function byProjectedAuthor(a: BibEntry, b: BibEntry): number {
  const keyOf = (e: BibEntry) => (bibFieldDisplay(e, "author") || e.key).toLowerCase();
  return keyOf(a).localeCompare(keyOf(b));
}

describe("author sort runs on projected text", () => {
  it("an accented surname no longer sorts above `Adams`", () => {
    // The pre-409 rule, reimplemented LOCALLY rather than re-parameterising the
    // live one, so this leg fails for the reason it names.
    const rawSort = (a: BibEntry, b: BibEntry) =>
      (a.fields.author || a.key)
        .toLowerCase()
        .localeCompare((b.fields.author || b.key).toLowerCase());

    expect([ADAMS, ALVAREZ].sort(rawSort).map((e) => e.key)).toEqual([
      "alvarez2011",
      "adams1999",
    ]);
    expect([ADAMS, ALVAREZ].sort(byProjectedAuthor).map((e) => e.key)).toEqual([
      "adams1999",
      "alvarez2011",
    ]);
  });

  it("CONTROL — an entry the projection cannot re-order keeps its place", () => {
    // So the leg above cannot pass by the comparator simply being different.
    // `L{ó}pez` collates exactly where `L{\'o}pez` did.
    for (const cmp of [
      byProjectedAuthor,
      (a: BibEntry, b: BibEntry) =>
        (a.fields.author || a.key)
          .toLowerCase()
          .localeCompare((b.fields.author || b.key).toLowerCase()),
    ]) {
      expect([LOPEZ, ADAMS].sort(cmp).map((e) => e.key)).toEqual([
        "adams1999",
        "lopez2009",
      ]);
    }
  });

  it("the panel list and the cited-export share ONE comparator", () => {
    // Two comparators is how the exported `.bib`'s byte ORDER drifts from the
    // order the user was looking at. The one-time re-ordering of the first
    // export after this lands is the accepted cost (decision 3) — a diff, not
    // a loss — and it is only a ONE-time diff because the two agree.
    const code = codeOnlyLines(
      readFileSync(
        join(REPO_ROOT, "src", "panels", "Bibliography", "BibliographyPanel.tsx"),
        "utf8",
      ),
    );
    expect(code).toContain("function byProjectedAuthor(");
    expect([...code.matchAll(/byProjectedAuthor\b/g)]).toHaveLength(3); // decl + 2 uses
    // …and neither call site kept a private copy of the old key.
    expect(code).not.toContain("const authorA =");
  });
});

// ── 2b. the bytes ────────────────────────────────────────────────────────────

describe("nothing projected ever reaches the `.bib`", () => {
  it("a parse → serialize round trip is byte-identical over two cycles", () => {
    // The task's own Verify item, and the premise the whole fix rests on:
    // the projection is DISPLAY ONLY. This is structural (no converted site
    // writes) and pinned anyway, because the failure mode is silent — a
    // rendering persisted over the source is a one-directional rewrite of the
    // user's file that no later save heals.
    const src = [
      "@article{lopez2009,",
      "  author = {L{\\'o}pez, Luis and M{\\\"u}ller, Gereon},",
      "  title = {Ellipsis, Anaphora \\& the {DNA} of Language},",
      "  pages = {10--25},",
      "  year = {2009}",
      "}",
      "",
    ].join("\n");
    const once = serializeBibFile(parseBibFile(src));
    const twice = serializeBibFile(parseBibFile(once));
    expect(twice).toBe(once);
    for (const bytes of [once, twice]) {
      expect(bytes).toContain("L{\\'o}pez");
      expect(bytes).toContain("\\&");
      expect(bytes).toContain("10--25");
      expect(bytes).not.toContain("ó");
      expect(bytes).not.toContain("–");
    }
  });
});

// ── 3. THE CENSUS ────────────────────────────────────────────────────────────

const REPO_ROOT = join(__dirname, "..", "..", "..");

/**
 * A raw `.bib` field member/index READ. Assignment targets are excluded: a
 * `fields.title = r.t` inside a record BUILDER (`bib-index.ts`,
 * `cslToBibEntry`) is writing a structure, not rendering one.
 */
const FIELD_READ =
  /(?:^|[^A-Za-z0-9_$])fields\s*(?:\?\.)?\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]*\])/g;

/** Marker forms. A LINE marker governs its own line and the next 12; a FILE
 *  marker governs the whole file. The window is a stated limit, not a claim:
 *  it is wide enough for every multi-field block in the tree today and narrow
 *  enough that a marker cannot silently excuse an unrelated read further down. */
const LINE_MARKER = "bib-display-exempt:";
const FILE_MARKER = "bib-display-exempt-file:";
const MARKER_WINDOW = 12;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "__tests__" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

function rawFieldReads(file: string): number[] {
  const raw = readFileSync(file, "utf8");
  if (raw.includes(FILE_MARKER)) return [];
  const code = codeOnlyLines(raw).split("\n");
  const rawLines = raw.split("\n");
  const hits: number[] = [];
  code.forEach((line, i) => {
    FIELD_READ.lastIndex = 0;
    if (!FIELD_READ.test(line)) return;
    // Exclude a write: `fields.x = …` / `fields[k] = …` (but not `==`, `=>`).
    if (/fields\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]*\])\s*=[^=>]/.test(line)) return;
    const from = Math.max(0, i - MARKER_WINDOW);
    const window = rawLines.slice(from, i + 1).join("\n");
    if (window.includes(LINE_MARKER)) return;
    hits.push(i + 1);
  });
  return hits;
}

describe("census — nobody renders a raw `.bib` field", () => {
  it("every raw field read is MARKED with its reason, at the site", () => {
    // The leg with teeth. The door was never the part that could misbehave —
    // a surface that reads `entry.fields.title` into JSX is, and no type can
    // see it. There is no allowlist: an exemption is an in-place marker, so
    // its REASON is at the site and cannot go stale in a table somewhere else.
    const files = [
      ...walk(join(REPO_ROOT, "src")),
      ...walk(join(REPO_ROOT, "library")),
    ];
    const offenders: string[] = [];
    for (const f of files) {
      for (const line of rawFieldReads(f)) {
        offenders.push(`${f.slice(REPO_ROOT.length + 1)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the census is not vacuous — it SEES a planted raw read", () => {
    // A canary on a SYNTHETIC line, never on a line the fix drained: a canary
    // standing on the defect evaporates the day the defect is fixed.
    const scratch = [
      "const t = entry.fields.title;",
      "const y = bib?.fields.year ?? '';",
      "const v = fields[k];",
    ];
    for (const line of scratch) {
      FIELD_READ.lastIndex = 0;
      expect(FIELD_READ.test(codeOnlyLines(line)), line).toBe(true);
    }
    // …and it does NOT see a record BUILDER's write, or a mere mention.
    for (const line of ["fields.title = r.t;", "// see fields.title above"]) {
      const stripped = codeOnlyLines(line);
      FIELD_READ.lastIndex = 0;
      const isRead =
        FIELD_READ.test(stripped) &&
        !/fields\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]*\])\s*=[^=>]/.test(stripped);
      expect(isRead, line).toBe(false);
    }
  });

  it("every marker states one of the three declared REASONS", () => {
    // Two categories the obvious display/edit split misses (the task's TRAP):
    // a RAW-SOURCE VIEW is a deliberate rendering of the source, and a
    // NON-DISPLAY read reaches no reader at all (sort integers, field
    // equality, a synthetic catalog record, a search haystack).
    const REASONS = ["raw-source view", "edit surface", "non-display", "EDIT SURFACE", "THE DOOR'S OWN HOME", "same reason"];
    const files = [
      ...walk(join(REPO_ROOT, "src")),
      ...walk(join(REPO_ROOT, "library")),
    ];
    const unreasoned: string[] = [];
    let markers = 0;
    for (const f of files) {
      const raw = readFileSync(f, "utf8");
      for (const [, marker] of [
        [FILE_MARKER, FILE_MARKER],
        [LINE_MARKER, LINE_MARKER],
      ] as const) {
        let at = raw.indexOf(marker);
        while (at !== -1) {
          markers++;
          const tail = raw.slice(at, at + 220);
          if (!REASONS.some((r) => tail.includes(r))) {
            unreasoned.push(`${f.slice(REPO_ROOT.length + 1)} :: ${tail.split("\n")[0]}`);
          }
          at = raw.indexOf(marker, at + 1);
        }
      }
    }
    expect(unreasoned).toEqual([]);
    // Not vacuous: the tree really does carry the exemptions this task filed.
    expect(markers).toBeGreaterThanOrEqual(8);
  });

  it("the RAW-SOURCE views and the EDIT surface are still raw", () => {
    // Decision 2: a projected header above a raw `.bib` source pod, in ONE
    // card, is correct and desirable — a rendered view above its source, the
    // same relationship the editor has to the code pane. So these three must
    // NOT have been "fixed"; projecting the edit surface is the one change in
    // this family that would write a rendering into the `.bib`.
    for (const [rel, needle] of [
      ["library/components/BibEditModal.tsx", FILE_MARKER],
      ["library/components/BibCard.tsx", "bib-display-exempt: raw-source view"],
      ["src/components/BibEntryCard.tsx", "RAW-SOURCE VIEW"],
    ] as const) {
      expect(readFileSync(join(REPO_ROOT, rel), "utf8"), rel).toContain(needle);
    }
  });
});
