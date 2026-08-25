// @vitest-environment node
//
// A skill's op-json file is SCRATCH — it does not live in the user's paper
// folder (task 466).
//
// Two skills need `@`-file input because their op payload carries LaTeX braces
// and backslashes (`find-citation`'s BibTeX entry, `style-merge`'s merged
// preamble), and both wrote it to a FIXED name INSIDE the paper —
// `mkdir -p "<docPath>/.virgil"` then `cat > "<docPath>/.virgil/<skill>-op.json"`
// — and neither removed it. Three costs, none severe, all avoidable:
//
//   1. DEBRIS IN A SYNCED FOLDER. `<docPath>/.virgil/` is real and
//      user-visible (the synced skill bundle, `.skill-bundle-version.json`,
//      the cowork `memos/` stream) and paper folders live in Dropbox. Every
//      run left a permanent stray JSON in the very folder whose write traffic
//      tasks 363/415 spent two passes reducing — and this one bought nothing.
//   2. The composed BibTeX / merged preamble sat on disk outside the sidecar
//      that owns it: unversioned, un-penned, readable long after the run.
//   3. A FIXED NAME races. Two concurrent skill invocations on one paper write
//      the same path, and the loser's op is silently replaced between its `cat`
//      and its `apply_response.py`.
//
// And it never had to be there: `apply_response.py::parse_op_json` does
// `Path(arg[1:]).expanduser().resolve()`, so `@` accepts ANY absolute path. The
// scratch file has no relationship to the doc; only the op's CONTENT does.
//
// THE LEG WITH TEETH IS THE CENSUS. The contract was never the part that could
// misbehave — a skill that picks the paper folder for its scratch is, and that
// is perfectly runnable shell no behavioural test of `apply_response.py` could
// see. The allowlist is EMPTY.
//
// The one SANCTIONED in-folder write channel is the cowork memo stream,
// `<docPath>/.virgil/memos/` (`answer-note-request` files a per-paper memo
// there; `reflect` names it three times to say a dev reflection must NEVER go
// there). The exemption is keyed on the `memos/` PATH FRAGMENT, not on the
// file — a file-scoped exemption would excuse a real scratch write added
// beside it later (task 204's rule, and the reason the sanctioned-channel leg
// below asserts the fragment is still in use rather than merely permitted).

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// editor/skills/__tests__/ → repo root is three levels up.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

const SKILLS = "editor/skills";
const CONTRACT = "editor/scripts/apply_response.py";
/** The ONE sanctioned in-folder channel — a path fragment, never a filename. */
const SANCTIONED_FRAGMENT = "/.virgil/memos/";
/** Skills whose op payload carries LaTeX and therefore needs an `@` file. */
const OP_FILE_SKILLS = ["find-citation.md", "style-merge.md"] as const;
/** The op-json delivery doctrine (task 468). */
const SSOT = "editor/skills/_op-json.md";
const POINTER = "[`_op-json.md`](_op-json.md)";

const mdFiles = () =>
  readdirSync(join(REPO, SKILLS))
    .filter((f) => f.endsWith(".md"))
    .sort();

/**
 * A shell write whose TARGET is under the user's paper folder: a redirect
 * (`>`/`>>`), a `tee`, or an `mkdir -p` aimed at a `<docPath>/…` path. Matched
 * per line, which is where the shape lives in these documents.
 */
function paperFolderWrites(rel: string): string[] {
  const out: string[] = [];
  read(rel)
    .split("\n")
    .forEach((line, i) => {
      const target = line.match(/(?:>>?|\btee\b|\bmkdir\s+-p)\s+"?(<docPath>\/[^"'\s]*)/);
      if (!target) return;
      if (target[1].includes(SANCTIONED_FRAGMENT)) return;
      out.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  return out;
}

describe("op scratch file — the CENSUS (allowlist EMPTY)", () => {
  it("no editor skill writes into the user's paper folder", () => {
    const offenders = mdFiles().flatMap((f) => paperFolderWrites(`${SKILLS}/${f}`));
    expect(
      offenders,
      "a shell write aimed at <docPath>/ — the paper folder is the user's" +
        " (often sync-backed) working directory and every write there is sync" +
        " traffic (tasks 363/415). Scratch belongs in $TMPDIR: `op=$(mktemp -t" +
        " virgil-op)`, and `apply_response.py`'s `@` reader resolves any" +
        " absolute path. The only sanctioned in-folder channel is" +
        ` ${SANCTIONED_FRAGMENT} (the cowork memo stream).`,
    ).toEqual([]);
  });

  it("the census can see a violation, and spares the sanctioned channel (canary)", () => {
    // Synthetic, never a live line — a canary standing on the site the census
    // drains evaporates the moment the census works.
    const violations = [
      '   mkdir -p "<docPath>/.virgil"',
      `   cat > "<docPath>/.virgil/find-citation-op.json" <<'JSON'`,
      '   echo x >> "<docPath>/notes.txt"',
    ];
    const spared = [
      "`<docPath>/.virgil/memos/<YYYY-MM-DD>-answer-note-<requestId>.md`",
      '   cat > "<docPath>/.virgil/memos/2026-01-01-note.md" <<\'MD\'',
      '   op=$(mktemp -t virgil-op)',
      '   cat > "$op" <<\'JSON\'',
    ];
    const hit = (line: string) =>
      /(?:>>?|\btee\b|\bmkdir\s+-p)\s+"?(<docPath>\/[^"'\s]*)/.exec(line) !== null &&
      !(/(?:>>?|\btee\b|\bmkdir\s+-p)\s+"?(<docPath>\/[^"'\s]*)/.exec(line)![1] ?? "")
        .includes(SANCTIONED_FRAGMENT);
    for (const line of violations) expect(hit(line), line).toBe(true);
    for (const line of spared) expect(hit(line), line).toBe(false);
  });

  it("the sanctioned channel is still in use — the exemption excuses something", () => {
    // A carve-out that has stopped excusing anything is a standing licence for
    // the next in-folder write under the exempted name.
    const users = mdFiles().filter((f) => read(`${SKILLS}/${f}`).includes(SANCTIONED_FRAGMENT));
    expect(users).toContain("answer-note-request.md");
    expect(users.length).toBeGreaterThan(1);
  });
});

describe("op scratch file — both `@`-file sites take the scratch shape", () => {
  it.each(OP_FILE_SKILLS)("%s mints scratch with mktemp and removes it", (skill) => {
    const src = read(`${SKILLS}/${skill}`);
    expect(src).toMatch(/op=\$\(mktemp -t virgil-op\)/);
    expect(src).toContain('cat > "$op"');
    expect(src).toContain('"@$op"');
    expect(src).toMatch(/rm -f "\$op"/);
    // The cleanup must survive a failing call, so the exit code is captured
    // BEFORE the rm and re-raised after it.
    expect(src).toMatch(/rc=\$\?[\s\S]{0,80}rm -f "\$op"[\s\S]{0,40}exit "\$rc"/);
  });

  it.each(OP_FILE_SKILLS)("%s no longer names an in-folder op file", (skill) => {
    // The retired shape, pinned by its own words so a revert is loud.
    const src = read(`${SKILLS}/${skill}`);
    expect(src).not.toMatch(/mkdir -p "<docPath>/);
    expect(src).not.toMatch(/-op\.json/);
  });

  // RENEGOTIATED (task 468), with the reason at the site: 466 asserted these
  // three phrases IN each of the two skills, because at the time the WHY was
  // written out at both sites. 468 hoisted that prose into the `_op-json.md`
  // SSOT — the rule is a property of the PAYLOAD, not of these two skills, and
  // 13 more sites needed it. Paraphrasing doctrine back into a skill is what
  // the include exists to stop, so the phrase pin moves to the include and the
  // per-skill obligation becomes the POINTER (see the reference-pin leg below).
  it("the include says WHY the location is a decision", () => {
    const flat = read(SSOT).replace(/\s+/g, " ");
    expect(flat).toMatch(/must \*\*not\*\* land in `<docPath>`/);
    expect(flat).toMatch(/sync traffic \(tasks 363\/415\)/);
    expect(flat).toMatch(/resolves any absolute path/);
  });
});

describe("op scratch file — the contract's `@` reader accepts any path", () => {
  it("parse_op_json resolves the argument rather than joining it to the doc", () => {
    // The premise the whole fix rests on: if `@` ever became doc-relative, the
    // scratch-in-$TMPDIR instruction would stop working.
    const src = read(CONTRACT);
    expect(src).toContain("def parse_op_json");
    expect(src).toMatch(/Path\(arg\[1:\]\)\.expanduser\(\)\.resolve\(\)/);
  });
});

// ---------------------------------------------------------------------------
// TASK 468 — the rule is keyed on the PAYLOAD, and it lives in an include.
//
// 466 put two skills on the `@`-file form and wrote down why, at their own
// sites. That reason is a property of the op's PAYLOAD, not of those two
// skills: `apply_response.py` takes its op through TWO hops of quoting at once
// (the shell's and JSON's), so an op carrying free text is hazardous wherever
// it is composed. Measured at HEAD `d201d16b`, the silo stated two answers to
// one question — 2 sites on the file form and 13 more carrying free text as a
// hand-built single-quoted shell argument.
//
// Both failure modes are stated in `_op-json.md`; the one that costs is the
// SILENT one — the JSON parses but the escaping was wrong by one level, so a
// mangled body lands in the user's paper through the pen, atomically, with
// `ok: true`.
//
// THE LEG WITH TEETH IS THE CENSUS, and its population is DISCOVERED: every
// `apply_response.py` invocation in the silo is classified by the op it
// carries, so a skill added tomorrow is covered by shipping. Allowlist EMPTY —
// a hit is CONVERT-it, never a listing.
//
// The id-only sites (`{"cardId":"…"}`-shaped) are the ACCEPTING CONTROLS, and
// they matter: without them the census would be satisfied by banning inline
// JSON outright, which would turn a payload with nothing to escape into a
// five-line ceremony — and dead ceremony teaches an agent to skip the rule
// where it actually matters.

/** Keys whose value is prose you composed, or a span lifted from the paper. */
const FREE_TEXT_KEYS = [
  "body",
  "card",
  "content",
  "text",
  "original_text",
  "suggested_text",
  "user_text",
  "explanation",
  "instructions",
  "summary",
  "note",
  "entry",
  "fields",
  "replacement",
  "annotation",
] as const;

/**
 * A free-text key in KEY POSITION — `"summary":` / `summary:`. Strictly key
 * position, so `"bibReviewType": "fields"` (a VALUE that happens to spell a
 * key on the list) is not a hit. Stated limit: a bare shorthand list
 * (`{ requestId, card, summary }`) is therefore NOT matched — but such a list
 * only ever documents a `'<op-json>'` PLACEHOLDER, which this classifier
 * already calls free text by construction, so the gap fails closed.
 */
const keyPresent = (op: string, key: string) =>
  new RegExp(`(^|[^A-Za-z0-9_])"?${key}"?\\s*:`).test(op);

type OpSite = {
  ref: string;
  form: "file" | "inline";
  /** A `'<op-json>'` placeholder: an op you compose is free text by construction. */
  composed: boolean;
  keys: string[];
  freeText: boolean;
};

/** The `cat > "$op" <<'JSON' … JSON` block nearest ABOVE `from`. */
function heredocAbove(lines: string[], from: number): string {
  for (let i = from; i >= 0; i -= 1) {
    if (!/cat\s+>\s+"\$op"\s+<<'JSON'/.test(lines[i])) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === "JSON") break;
      body.push(lines[j]);
    }
    return body.join("\n");
  }
  return "";
}

/** Every `apply_response.py` invocation carrying a positional op argument. */
function opSites(rel: string): OpSite[] {
  const lines = read(rel).split("\n");
  const out: OpSite[] = [];
  lines.forEach((line, i) => {
    if (!/apply_response\.py["']?\s+<docPath>/.test(line)) return;
    // Shell line continuations are part of one command.
    let cmd = line;
    for (let j = i; /\\\s*$/.test(cmd) && j + 1 < lines.length; j += 1) cmd += `\n${lines[j + 1]}`;

    const isFile = cmd.includes('"@');
    const composed = cmd.includes("'<op-json>'");
    const literal = /'\{/.test(cmd);
    // Neither an `@` file, a placeholder, nor inline JSON ⇒ a flags-only call
    // (`complete-only <requestId> --note "…"`), which carries no op-json.
    if (!isFile && !composed && !literal) return;

    let op = "";
    if (literal) {
      const rest = cmd.slice(cmd.indexOf("'{") + 1);
      const end = rest.indexOf("'");
      op = end === -1 ? rest : rest.slice(0, end);
    } else if (isFile) {
      op = heredocAbove(lines, i);
    }

    const keys = FREE_TEXT_KEYS.filter((k) => keyPresent(op, k));
    out.push({
      ref: `${rel}:${i + 1}`,
      form: isFile ? "file" : "inline",
      composed,
      keys,
      freeText: composed || keys.length > 0,
    });
  });
  return out;
}

const allSites = () => mdFiles().flatMap((f) => opSites(`${SKILLS}/${f}`));
/** Skills (commands only — an include need not point at itself) with a free-text op. */
const freeTextSkills = () =>
  [
    ...new Set(
      mdFiles()
        .filter((f) => !f.startsWith("_"))
        .filter((f) => opSites(`${SKILLS}/${f}`).some((s) => s.freeText)),
    ),
  ].sort();

describe("op-json delivery — the CENSUS (allowlist EMPTY)", () => {
  it("no free-text op-json reaches the contract as an inline argument", () => {
    const offenders = allSites()
      .filter((s) => s.freeText && s.form === "inline")
      .map((s) => `${s.ref} — ${s.composed ? "a composed <op-json>" : s.keys.join(", ")}`);
    expect(
      offenders,
      "an op carrying FREE TEXT passed as a hand-built single-quoted shell" +
        " argument. It must reach `apply_response.py` through an `@` scratch" +
        " file — see `editor/skills/_op-json.md`. The loud failure is a stray" +
        " apostrophe; the SILENT one is escaping that is wrong by one level," +
        " which lands a mangled body in the user's paper through the pen with" +
        " `ok: true`.",
    ).toEqual([]);
  });

  it("the population is non-vacuous — the census is looking at real sites", () => {
    const sites = allSites();
    expect(sites.filter((s) => s.freeText).length).toBeGreaterThanOrEqual(13);
    expect(sites.filter((s) => !s.freeText).length).toBeGreaterThanOrEqual(6);
  });

  it("the ID-ONLY ops stay INLINE — the accepting controls", () => {
    // If these go red, the needle is banning the wrong thing: a payload with
    // nothing to escape must not be forced into a five-line ceremony.
    const inlineOwners = [
      ...new Set(
        mdFiles().filter((f) =>
          opSites(`${SKILLS}/${f}`).some((s) => s.form === "inline" && !s.freeText),
        ),
      ),
    ].sort();
    expect(inlineOwners).toEqual([
      "accept-suggestion.md",
      "answer-bib-review.md", // the bare `complete-only` with no bibEdit
      "archive-card.md",
      "link-cards.md",
      "move-card.md",
      "reject-suggestion.md",
      "restore-card.md",
    ]);
  });

  it("the classifier can see both shapes (canary)", () => {
    // Synthetic, never a live line.
    const free = [
      `python3 editor/scripts/apply_response.py <docPath> update '{"cardId":"<c>","body":"<b>"}'`,
      `python3 editor/scripts/apply_response.py <docPath> complete-task --propose '<op-json>'`,
      `python3 editor/scripts/apply_response.py <docPath> complete-only '{"summary":"x"}'`,
    ];
    const idOnly = [
      `python3 editor/scripts/apply_response.py <docPath> archive '{"cardId":"<c>"}'`,
      `python3 editor/scripts/apply_response.py <docPath> link '{"cardAId":"<a>","cardBId":"<b>","kind":"related"}'`,
      `python3 editor/scripts/apply_response.py <docPath> complete-only '{"requestId":"<k>","bibReviewType":"fields"}'`,
    ];
    const classify = (cmd: string) => {
      const composed = cmd.includes("'<op-json>'");
      const rest = cmd.slice(cmd.indexOf("'{") + 1);
      const op = /'\{/.test(cmd) ? rest.slice(0, rest.indexOf("'")) : "";
      return composed || FREE_TEXT_KEYS.some((k) => keyPresent(op, k));
    };
    for (const cmd of free) expect(classify(cmd), cmd).toBe(true);
    for (const cmd of idOnly) expect(classify(cmd), cmd).toBe(false);
  });
});

describe("op-json delivery — every free-text site points at the SSOT", () => {
  it("the doctrine file exists and is not a slash command", () => {
    // The leading underscore is what filters it out of the command mirror in
    // both build scripts (`editor/build/build-editor-bundle.mjs`).
    expect(SSOT.split("/").pop()!.startsWith("_")).toBe(true);
    expect(read(SSOT).length).toBeGreaterThan(1000);
  });

  it("the doctrine states the rule, both failure modes, and the id-only carve-out", () => {
    const flat = read(SSOT).replace(/\s+/g, " ");
    expect(flat).toMatch(/carrying FREE TEXT goes through an `@` scratch file/);
    expect(flat).toMatch(/carrying only IDS stays inline/);
    expect(flat).toMatch(/\*\*Loud\.\*\*/);
    expect(flat).toMatch(/\*\*Silent\.\*\*/);
    expect(flat).toMatch(/correct as it stands/);
  });

  it("the doctrine holds the canonical block", () => {
    const src = read(SSOT);
    expect(src).toMatch(/op=\$\(mktemp -t virgil-op\)/);
    expect(src).toContain('cat > "$op" <<\'JSON\'');
    expect(src).toContain('"@$op"');
    expect(src).toMatch(/rc=\$\?[\s\S]{0,80}rm -f "\$op"[\s\S]{0,40}exit "\$rc"/);
  });

  it("every skill with a free-text op carries the pointer", () => {
    const missing = freeTextSkills().filter((f) => !read(`${SKILLS}/${f}`).includes(POINTER));
    expect(
      missing,
      `a skill whose op carries free text but which does not link ${POINTER}.` +
        " The rule is authored ONCE in the include and referenced — do not" +
        " paraphrase it back into a skill.",
    ).toEqual([]);
    expect(freeTextSkills().length).toBeGreaterThanOrEqual(8);
  });

  it("every free-text site spells the scratch shape it links to", () => {
    // The pointer alone would let a skill link the doctrine and keep the
    // inline form for its own op; and the block is a per-site INSTANTIATION
    // (each op's JSON differs), so it cannot be shared — only pinned.
    for (const f of freeTextSkills()) {
      const src = read(`${SKILLS}/${f}`);
      expect(src, f).toMatch(/op=\$\(mktemp -t virgil-op\)/);
      expect(src, f).toContain('cat > "$op"');
      expect(src, f).toContain('"@$op"');
      expect(src, f).toMatch(/rm -f "\$op"/);
      expect(src, f).toMatch(/rc=\$\?[\s\S]{0,400}rm -f "\$op"[\s\S]{0,40}exit "\$rc"/);
    }
  });

  it("the retired concession is gone", () => {
    // `find-citation.md` used to end its own scratch-file instruction with
    // "Inline `'<op-json>'` works too if you quote carefully" — exactly the
    // kind of sentence a doctrine exists to remove.
    for (const f of mdFiles()) {
      expect(read(`${SKILLS}/${f}`), f).not.toMatch(/works too if you quote carefully/);
    }
  });
});
