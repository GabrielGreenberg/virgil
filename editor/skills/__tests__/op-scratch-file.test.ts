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

  it.each(OP_FILE_SKILLS)("%s says WHY the location is a decision", (skill) => {
    // Hard-wrapped prose: assert against a whitespace-collapsed copy so a
    // future re-wrap cannot fail a rule it did not change.
    const flat = read(`${SKILLS}/${skill}`).replace(/\s+/g, " ");
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
