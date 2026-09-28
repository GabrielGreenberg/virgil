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
      "answer-todo-request.md", // step 4's `update {cardId, set:{done:true}}` (task 785)
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

// ---------------------------------------------------------------------------
// TASK 786 — the rule reaches past op-json: ANY free-text payload a skill writes
// to a file.
//
// `answer-bib-review` handed a bib entry's `fields` object to
// `bib_auth.py --fields-file` via `printf '%s' '<the fields object …>' >
// /tmp/<bibKey>-fields.json` — a single-quoted PLACEHOLDER (so free text by
// construction: nobody has seen its bytes) that breaks on the first `O'Neill`,
// truncating the file and costing the DOI/arXiv/ISBN fast-paths. The 468 census
// above could not see it: it only classifies `apply_response.py` invocations.
//
// This census does: every `printf`/`echo` whose argument is a single-quoted
// `'<…>'` placeholder AND whose output goes to a file or a pipe, across BOTH
// skill silos (editor + library). Allowlist EMPTY — a hit is CONVERT-it (pipe
// from the producing script, or a quoted heredoc to `mktemp` scratch).

const SKILL_SILOS = ["editor/skills", "library/skills"] as const;
/** `printf`/`echo` with a `'<placeholder>'` argument, redirected or piped. */
const INLINE_PLACEHOLDER_WRITE =
  /\b(?:printf|echo)\b[^\n]*'<[^'\n]*>'[^\n]*(?:>|\|)/;

function inlinePlaceholderWrites(rel: string): string[] {
  return read(rel)
    .split("\n")
    .flatMap((line, i) =>
      INLINE_PLACEHOLDER_WRITE.test(line) ? [`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`] : [],
    );
}

const siloFiles = () =>
  SKILL_SILOS.flatMap((dir) =>
    readdirSync(join(REPO, dir))
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => `${dir}/${f}`),
  );

describe("free-text scratch payloads — the CENSUS (allowlist EMPTY)", () => {
  it("no skill writes a placeholder payload through an inline single-quoted printf/echo", () => {
    const offenders = siloFiles().flatMap(inlinePlaceholderWrites);
    expect(
      offenders,
      "a free-text payload written as a hand-quoted `printf '<…>' > file`. It" +
        " breaks on the first apostrophe. Pipe it straight from the script that" +
        " produced it, or write it through a quoted heredoc to `mktemp` scratch" +
        " — see `editor/skills/_op-json.md`, \"it reaches past op-json\".",
    ).toEqual([]);
  });

  it("the census looks at both silos (non-vacuous)", () => {
    const files = siloFiles();
    expect(files.filter((f) => f.startsWith("editor/")).length).toBeGreaterThan(10);
    expect(files.filter((f) => f.startsWith("library/")).length).toBeGreaterThan(10);
  });

  it("the needle sees the retired shape and spares the sanctioned ones (canary)", () => {
    // Synthetic, never a live line.
    const violations = [
      "     printf '%s' '<the fields object from bib_resolve.py>' > /tmp/<bibKey>-fields.json",
      "echo '<the note you drafted>' >> \"$f\"",
      "printf '%s' '<entry>' | python3 helper.py",
    ];
    const spared = [
      "     fields=$(mktemp -t virgil-fields)",
      "     python3 \"$scripts_editor/bib_resolve.py\" <docPath> <bibKey> \\",
      "echo \"No library set up. Pick a library in Virgil first.\"",
      "printf '%s\\n' \"$x\" > \"$f\"",
      "cat > \"$op\" <<'JSON'",
    ];
    for (const line of violations) expect(INLINE_PLACEHOLDER_WRITE.test(line), line).toBe(true);
    for (const line of spared) expect(INLINE_PLACEHOLDER_WRITE.test(line), line).toBe(false);
  });

  it("answer-bib-review pipes the fields object from bib_resolve into mktemp scratch", () => {
    const src = read(`${SKILLS}/answer-bib-review.md`);
    expect(src).toMatch(/fields=\$\(mktemp -t virgil-fields\)/);
    expect(src).toMatch(/bib_resolve\.py" <docPath> <bibKey> \\\n\s*\| python3 -c [^\n]*\["fields"\]/);
    expect(src).toContain('--fields-file "$fields"');
    expect(src).toMatch(/rm -f "\$fields"/);
    expect(src).not.toMatch(/\/tmp\/<bibKey>/);
  });

  it("answer-bib-review binds --library before it tests $LIBRARY", () => {
    const src = read(`${SKILLS}/answer-bib-review.md`);
    const bind = src.indexOf('LIBRARY="<the --library path');
    const test = src.indexOf('if [ -n "$LIBRARY" ]');
    expect(bind).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(bind);
  });
});

// ---------------------------------------------------------------------------
// TASK 815 — the rule is about FREE-TEXT ARGUMENTS, so it reaches the FLAGS.
//
// `create_card.py` — the door every card-producing skill uses — takes its prose
// as FLAGS (`--body/--title/--notes/--item/--task-text`), and 29 skill sites
// taught them as a DOUBLE-QUOTED argv. Inside `"…"` bash treats a backtick as
// command substitution and `$x` as a variable, so ``quotes'' and $math$
// vanished with exit 0 — and a footnote body was spliced into the `.tex`
// mangled, through the pen, `ok: true`. The 468 census above could not see it:
// it classifies only `apply_response.py` OP arguments.
//
// Both helpers now read `@<path>` for every free-text flag (`_common.text_arg`,
// pinned byte-exact by editor/scripts/tests/test_text_file_args.py). This
// census DERIVES which flags are free text from the helpers' own argparse
// declarations (`type=text_arg`), DISCOVERS every invocation in both silos, and
// classifies each free-text flag's value. Allowlist EMPTY.
//
// The ACCEPTING CONTROL is the fixed literal: a note the skill author wrote
// out in full, with no placeholder and nothing for the shell to expand
// (`--note "No preamble drift detected; nothing to merge."`), stays inline —
// the id-only carve-out's twin. A `<placeholder>` or `…` is composed by
// construction, and a value holding `` ` ``, `$` or `\` is shell-active.

const HELPERS = {
  create_card: "editor/scripts/create_card.py",
  apply_response: "editor/scripts/apply_response.py",
} as const;

/** The flags a helper declares with `type=text_arg` — read, not hand-listed. */
function textArgFlags(rel: string): string[] {
  return read(rel)
    .split("add_argument(")
    .slice(1)
    .flatMap((chunk) => {
      const flag = /^\s*"--([a-z-]+)"/.exec(chunk);
      return flag && /type=text_arg\b/.test(chunk) ? [flag[1]] : [];
    });
}

const FREE_TEXT_FLAGS = () => [
  ...new Set([...textArgFlags(HELPERS.create_card), ...textArgFlags(HELPERS.apply_response)]),
];

type FlagSite = { ref: string; flag: string; value: string; verdict: "file" | "literal" | "violation" };

/** Classify one flag value. */
function classifyValue(value: string): FlagSite["verdict"] {
  const v = value.replace(/^"|"$/g, "");
  if (v.startsWith("@")) return "file";
  const composed = /<[^>]*>|…/.test(v);
  const shellActive = /[`$\\]/.test(v);
  return value.startsWith('"') && !composed && !shellActive ? "literal" : "violation";
}

/**
 * Every `create_card.py` / `complete-only` invocation in `rel`, with its
 * free-text flags. A command's extent: in a fenced block, the line plus its
 * `\` continuations (and any lines an open op-json quote spans); in inline code, up to the closing backtick (which may sit
 * on a later line — prose wraps inside it).
 */
function flagSites(rel: string, flags: string[]): FlagSite[] {
  const src = read(rel);
  const lines = src.split("\n");
  const out: FlagSite[] = [];
  let inFence = false;
  const flagRe = new RegExp(`--(${flags.join("|")})\\s+("[^"]*"|'[^']*'|\\S+)`, "g");
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    const tok = /create_card\.py|complete-only/.exec(line);
    if (!tok) return;
    let cmd: string;
    if (inFence) {
      // A `\` continuation, or an op-json single quote still open, carries on.
      cmd = line;
      const open = (c: string) => (c.match(/'/g) ?? []).length % 2 === 1;
      for (let j = i; (/\\\s*$/.test(lines[j]) || open(cmd)) && j + 1 < lines.length; j += 1) {
        cmd += `\n${lines[j + 1]}`;
      }
    } else {
      const rest = lines.slice(i).join("\n").slice(tok.index);
      const close = rest.indexOf("`");
      cmd = close === -1 ? line.slice(tok.index) : rest.slice(0, close);
    }
    for (const m of cmd.matchAll(flagRe)) {
      out.push({ ref: `${rel}:${i + 1}`, flag: m[1], value: m[2], verdict: classifyValue(m[2]) });
    }
  });
  return out;
}

const allFlagSites = () => siloFiles().flatMap((f) => flagSites(f, FREE_TEXT_FLAGS()));

describe("free-text FLAGS — both helpers read `@<path>` (task 815)", () => {
  it("create_card.py declares every free-text flag with type=text_arg", () => {
    expect(textArgFlags(HELPERS.create_card).sort()).toEqual(
      ["body", "item", "notes", "task-text", "title"].sort(),
    );
  });

  it("apply_response.py's --note takes type=text_arg (complete-only + legacy)", () => {
    expect(textArgFlags(HELPERS.apply_response)).toEqual(["note", "note"]);
  });

  it("text_arg resolves the path rather than joining it to the doc", () => {
    const src = read("editor/scripts/_common.py");
    expect(src).toContain("def text_arg");
    expect(src).toMatch(/Path\(value\[1:\]\)\.expanduser\(\)\.resolve\(\)/);
  });

  it("the doctrine names every derived free-text flag", () => {
    const doc = read(SSOT);
    for (const f of FREE_TEXT_FLAGS()) expect(doc, f).toContain(`\`--${f}\``);
    expect(doc.replace(/\s+/g, " ")).toMatch(/any free-text argument to a Virgil helper/);
  });
});

describe("free-text FLAGS — the CENSUS (allowlist EMPTY)", () => {
  it("no skill passes a composed or shell-active free-text flag as a quoted argv", () => {
    const offenders = allFlagSites()
      .filter((s) => s.verdict === "violation")
      .map((s) => `${s.ref} — --${s.flag} ${s.value.slice(0, 60)}`);
    expect(
      offenders,
      "a free-text flag passed inline. Inside double quotes bash eats" +
        " ``quotes'' and $math$ with exit 0, and a footnote body is spliced into" +
        " the .tex mangled. Write the value through a quoted heredoc into" +
        ' `t=$(mktemp -d -t virgil-txt)` and pass `--body "@$t/body"` — see' +
        ' `editor/skills/_op-json.md`, "Free-text FLAGS".',
    ).toEqual([]);
  });

  it("the population is non-vacuous, and the fixed literals are the accepting controls", () => {
    const sites = allFlagSites();
    expect(sites.filter((s) => s.verdict === "file").length).toBeGreaterThanOrEqual(29);
    const literals = sites.filter((s) => s.verdict === "literal").map((s) => s.ref.split(":")[0]);
    expect([...new Set(literals)].sort()).toEqual([
      "editor/skills/answer-bib-review.md",
      "editor/skills/style-merge.md",
    ]);
  });

  it("the classifier sees every shape (canary)", () => {
    // Synthetic, never a live value.
    expect(classifyValue('"<composed body>"')).toBe("violation");
    expect(classifyValue('"…"')).toBe("violation");
    expect(classifyValue("\"As ``x'' costs $n$.\"")).toBe("violation");
    expect(classifyValue("'<the user''s ask>'")).toBe("violation");
    expect(classifyValue('"@$t/body"')).toBe("file");
    expect(classifyValue('"No preamble drift detected; nothing to merge."')).toBe("literal");
    // The discovery reaches an inline-code command that wraps across lines.
    const fake = flagSites(`${SKILLS}/answer-todo-request.md`, ["body"]);
    expect(fake.some((s) => s.value === '"@$t/body"')).toBe(true);
  });

  it("every skill with a file-form flag links the doctrine and spells the scratch block", () => {
    const owners = [
      ...new Set(
        allFlagSites()
          .filter((s) => s.verdict === "file" && s.ref.startsWith(`${SKILLS}/`))
          .map((s) => s.ref.split(":")[0].split("/").pop()!)
          .filter((f) => !f.startsWith("_")),
      ),
    ].sort();
    expect(owners.length).toBeGreaterThanOrEqual(9);
    for (const f of owners) {
      const src = read(`${SKILLS}/${f}`);
      expect(src, f).toContain(POINTER);
      expect(src, f).toMatch(/t=\$\(mktemp -d -t virgil-txt\)/);
      expect(src, f).toMatch(/cat > "\$t\/[a-z0-9]+" <<'TXT'/);
      expect(src, f).toMatch(/rc=\$\?\s*\n\s*rm -rf "\$t"\s*\n\s*exit "\$rc"/);
    }
  });
});
