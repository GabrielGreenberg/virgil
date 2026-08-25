// @vitest-environment node
//
// A field whose transition another op OWNS is not an editable field, and no
// skill may TEACH it as one (task 467).
//
// Task 156 closed this class at PANEL granularity: `MUTATION_PANEL_POLICY` is
// the ONE table every mutation op asks — "may I write this STORE?" — and it is
// exhaustive-by-construction over the card-store universe. Nothing answered
// "may I write this FIELD?", and `cmd_update`'s `set` loop is
// `for k, v in sets.items(): card[k] = v`: arbitrary key, arbitrary value, no
// allow-list, no deny-list, no coupling check.
//
// So `update {"set":{"status":"accepted"}}` on a suggestion did step 5 of
// `cmd_accept` and NOTHING else — no `.tex` splice, no stale-guard, no Task
// completion. The panel reads *accepted*, the user's paper is byte-unchanged,
// the Task stays open, exit 0. And it was TAUGHT: `edit-card.md`'s Applicability
// named `status` among the suggestion family's editable `--field`s, while
// `accept-suggestion.md`'s own description routed field edits back to
// `edit-card` — two routing copies composing into a loop that lands on the
// unsafe door, with no card-CRUD skill referencing accept/reject at all.
//
// THE LEG WITH TEETH IS THE CENSUS. `apply_response.OP_OWNED_FIELDS` was never
// the part that could misbehave — a skill that keeps teaching the unsafe door
// is, and a code fix alone would have left `edit-card.md` naming `status` as an
// editable field for the next agent to read. Every allowlist here is EMPTY.
//
// The rule is not "never mention a reserved field": routing copy MUST mention
// it ("`status` belongs to accept-suggestion"), and that is exactly the fix.
// The rule is that a mention inside the FIELD-EDITING vocabulary must ROUTE —
// the same segment has to name the door that owns the transition. A segment is
// a markdown bullet (or table row, or paragraph) plus its continuation lines,
// because that is the unit a field list is written in: the offending mention
// sat two lines below its own `--field` bullet marker, so a LINE-scoped needle
// would have missed the one violation in the tree it shipped with.
//
// The vocabulary is DERIVED from the Python table (`OP_OWNED_FIELDS`), never
// re-listed here — the premise is CHECKED rather than restated (task 148's
// instrument), so a field reserved later is covered by declaring itself.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

const SKILLS = "editor/skills";
const CONTRACT = "editor/scripts/apply_response.py";

/** The card-CRUD family plus the two doors that own the suggestion transition. */
const CARD_CRUD = [
  "create-card.md",
  "edit-card.md",
  "move-card.md",
  "archive-card.md",
  "restore-card.md",
  "link-cards.md",
] as const;

/**
 * Field-editing vocabulary: the shapes that mean "this is a field you may set".
 * A mention of a reserved field OUTSIDE these is descriptive prose (archive-card
 * saying what the op writes; link-cards saying `links` is the anchor it does not
 * touch) and needs no route.
 */
const FIELD_EDIT_VOCAB = [/--field\b/, /"set"\s*:/, /\bset\s*\{/] as const;

type Row = {
  fields: string[];
  route: string;
  ops: string[];
  skills: string[];
  kinds: string[] | null;
};

/** The reserved vocabulary, read out of the Python SSOT. */
function ownershipTable(): Record<string, Row> {
  const dumped = execFileSync(
    "python3",
    [
      "-c",
      [
        `import sys, json; sys.path.insert(0, ${JSON.stringify(join(REPO, "editor/scripts"))})`,
        "import apply_response as AR",
        "print(json.dumps({k: {",
        "  'fields': sorted(v.fields), 'route': v.route, 'ops': sorted(v.ops),",
        "  'skills': list(v.skills),",
        "  'kinds': (sorted(v.kinds) if v.kinds is not None else None)}",
        "  for k, v in AR.OP_OWNED_FIELDS.items()}))",
      ].join("\n"),
    ],
    { cwd: REPO, encoding: "utf8" },
  );
  return JSON.parse(dumped) as Record<string, Row>;
}

const TABLE = ownershipTable();
/** field → the skills that own its transition (what a routing mention must name). */
const OWNERS = new Map<string, string[]>();
for (const row of Object.values(TABLE)) {
  for (const f of row.fields) {
    OWNERS.set(f, [...(OWNERS.get(f) ?? []), ...row.skills]);
  }
}

const mdFiles = () =>
  readdirSync(join(REPO, SKILLS))
    .filter((f) => f.endsWith(".md"))
    .sort();

/**
 * Split a markdown document into SEGMENTS — a bullet / table row / paragraph
 * plus its continuation lines. A field list is written as one bullet whose
 * items wrap across lines, which is precisely why a line-scoped scan is blind
 * to the shape this file exists to catch.
 */
function segments(text: string): { line: number; body: string }[] {
  const out: { line: number; body: string }[] = [];
  let cur: string[] = [];
  let start = 1;
  const flush = () => {
    if (cur.some((l) => l.trim())) out.push({ line: start, body: cur.join("\n") });
    cur = [];
  };
  text.split("\n").forEach((line, i) => {
    const opensSegment =
      /^\s*[-*+]\s/.test(line) || /^\s*\|/.test(line) || /^\s*\d+\.\s/.test(line);
    if (!line.trim() || opensSegment) {
      flush();
      start = i + 1;
    }
    if (!cur.length) start = i + 1;
    cur.push(line);
  });
  flush();
  return out;
}

/** Reserved-field mentions inside the field-editing vocabulary that name no owner. */
function unroutedTeachings(rel: string): string[] {
  const out: string[] = [];
  for (const seg of segments(read(rel))) {
    if (!FIELD_EDIT_VOCAB.some((re) => re.test(seg.body))) continue;
    for (const [field, owners] of OWNERS) {
      // `\`field\`` or a bare JSON key — the two ways these documents name one.
      const named = new RegExp(`\`${field}\`|"${field}"`).test(seg.body);
      if (!named) continue;
      // A mention that ROUTES names a door that owns the transition — the skill
      // file, its slash-command name, or the contract table itself.
      const routed =
        owners.some((s) => seg.body.includes(s)) || seg.body.includes("OP_OWNED_FIELDS");
      if (!routed) {
        out.push(`${rel}:${seg.line}: teaches \`${field}\` as settable with no route to ${owners.join(" / ")}`);
      }
    }
  }
  return out;
}

describe("field ownership — the CENSUS (allowlist EMPTY)", () => {
  it("no editor skill teaches a reserved field as an editable --field / set value", () => {
    const hits = mdFiles().flatMap((f) => unroutedTeachings(`${SKILLS}/${f}`));
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("the census can SEE the shape it forbids (canary)", () => {
    // Synthetic, not a live line: a canary standing on the defect evaporates the
    // moment the defect is drained (task 220's rule).
    const canary = [
      "- **Named fields only** (`--field`, no single editable body): `highlight`",
      "  (`highlightColor`), the suggestion family (`cutter-suggestion` /",
      "  `revision-suggestion` — edit `suggested_text` / `user_text` / `status`).",
    ].join("\n");
    const segs = segments(canary);
    expect(segs).toHaveLength(1);
    const seg = segs[0];
    expect(FIELD_EDIT_VOCAB.some((re) => re.test(seg.body))).toBe(true);
    expect(/`status`/.test(seg.body)).toBe(true);
    expect(seg.body.includes("accept-suggestion")).toBe(false);
    // …and the same segment WITH the route is clean, so the rule is "route it",
    // not "never say it".
    const routed = `${canary}\n  Route a status change to /editor/accept-suggestion.`;
    const rSeg = segments(routed)[0];
    expect(rSeg.body.includes("accept-suggestion")).toBe(true);
  });
});

describe("field ownership — the ROUTING LOOP the two copies made", () => {
  it("edit-card names both owners of the suggestion status transition", () => {
    const t = read(`${SKILLS}/edit-card.md`);
    expect(t).toContain("accept-suggestion");
    expect(t).toContain("reject-suggestion");
  });

  it("each suggestion door DECLARES that it owns the status transition", () => {
    for (const rel of ["accept-suggestion.md", "reject-suggestion.md"]) {
      const t = read(`${SKILLS}/${rel}`);
      expect(t, `${rel} must state that it owns the status transition`).toMatch(
        /OWNS the `status` transition/,
      );
      expect(t, `${rel} must name the table that enforces it`).toContain("OP_OWNED_FIELDS");
    }
  });

  it("a pointer at edit-card for FIELD edits is qualified — the loop is broken", () => {
    // The pre-fix description read "…or editing a card's fields (use
    // /editor/edit-card)" with nothing said about `status`, so an agent asked to
    // "mark this suggestion accepted" that started here was routed to the door
    // that could not do it. Any segment sending field edits to edit-card must
    // now also QUALIFY that pointer.
    //
    // "mentions the word status somewhere in the segment" is NOT the test, and
    // measuring proved why: a frontmatter description is one segment, and both
    // of these files legitimately say "flip the card status → accepted" while
    // describing what the op does — so the obvious needle passed vacuously
    // under its own neuter. The needle is a SENTENCE that both names the field
    // and says something about who owns it.
    const QUALIFIES = /`?status`?[^.]*\b(transition|NOT|refuses?|owns?|belongs)\b/i;
    for (const rel of ["accept-suggestion.md", "reject-suggestion.md"]) {
      const t = read(`${SKILLS}/${rel}`);
      for (const seg of segments(t)) {
        if (!/\/editor\/edit-card|\(edit-card\.md\)/.test(seg.body)) continue;
        const sentences = seg.body.replace(/\s+/g, " ").split(/(?<=\.)\s+/);
        expect(
          sentences.some((s) => QUALIFIES.test(s)),
          `${rel}:${seg.line}: routes field edits to edit-card without saying that ` +
            `the \`status\` transition is NOT among them`,
        ).toBe(true);
      }
    }
  });
});

describe("field ownership — the table is DERIVED, and its owners exist", () => {
  it("every reserved field names at least one owning skill that exists", () => {
    const present = new Set(mdFiles());
    expect(OWNERS.size).toBeGreaterThan(0);
    for (const [field, owners] of OWNERS) {
      expect(owners.length, `${field} names no owning skill`).toBeGreaterThan(0);
      for (const s of owners) {
        expect(present.has(`${s}.md`), `${field} names a missing skill: ${s}.md`).toBe(true);
      }
    }
  });

  it("`status` is reserved for the suggestion kinds only", () => {
    const row = TABLE.accept;
    expect(row.fields).toContain("status");
    expect(row.kinds).toEqual(["cutter-suggestion", "revision-suggestion"]);
  });

  it("`aiRequest` is NOT reserved — a blanket refusal breaks a shipped feature", () => {
    // draft-footnote's virtual-request branch clears a footnote's flag with
    // exactly `update {"set":{"aiRequest":false}}`; the unbridged-card-flag
    // fallback makes the raised direction first-class too. This is the 156
    // lesson (the naive sibling-copy guard breaks footnote body editing) one
    // granularity in, so it is pinned rather than left to be re-tightened.
    expect([...OWNERS.keys()]).not.toContain("aiRequest");
    expect(read(`${SKILLS}/draft-footnote.md`)).toContain('"set":{"aiRequest":false}');
  });

  it("cmd_update asks the field guard, right after the panel guard", () => {
    // The guard was never the part that could misbehave — an op that never asks
    // it is, and that runs perfectly well.
    const src = read(CONTRACT);
    const i = src.indexOf('_guard_panel("update", hit, kind)');
    const j = src.indexOf('_guard_fields("update", hit, kind, sets)');
    expect(i, "cmd_update must ask the panel guard").toBeGreaterThan(-1);
    expect(j, "cmd_update must ask the FIELD guard").toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    // …and before the transaction opens, so a refusal writes nothing.
    expect(j).toBeLessThan(src.indexOf("txn = _Txn(doc)", j - 400));
  });
});

describe("field ownership — the behavioural half (Python)", () => {
  // If `python3` is genuinely unavailable this FAILS rather than skips: a guard
  // that quietly opts out of the environment it protects is the thing this file
  // exists to stop.
  it("passes editor/scripts/tests/test_field_policy_slice.py", { timeout: 240_000 }, () => {
    let output: string;
    try {
      output = execFileSync(
        "python3",
        [join(REPO, "editor/scripts/tests/test_field_policy_slice.py")],
        { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      throw new Error(
        `Python field-policy suite failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`,
      );
    }
    const m = output.match(/=====\s+(\d+) passed,\s+(\d+) failed\s+=====/);
    expect(m, `no pass tally in output:\n${output.slice(-2000)}`).not.toBeNull();
    expect(Number(m![2])).toBe(0);
    expect(Number(m![1])).toBeGreaterThan(100);
  });
});
