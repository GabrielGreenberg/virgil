/**
 * Shell-fence census — both silos (task 445).
 *
 * A skill markdown is a PROMPT, so "a documented invocation is an executed
 * invocation" (task 1f57c85c). `skill-script-cli-guardrail.test.ts` polices
 * what a documented command SAYS — that every flag on it exists in the script.
 * This one polices whether the command bash reads is the command the author
 * wrote at all.
 *
 * The defect it was built from: eight multi-line commands across four shipped
 * library skills ended their first line with a literal `\\` where a bash line
 * continuation `\` belongs. Bash reads `\\` as an escaped backslash — a
 * literal `\` argument, and the line ENDS — so every flag on the continuation
 * line was dropped and that line ran as its own command (`--resume-baseline:
 * command not found`). Seven of the eight failed loudly at exit 2 or 127 and
 * their documented step simply did not happen; the eighth
 * (`repair_pgmarks.py`, which hand-rolls its argv walk) swallowed the stray
 * `\` in SILENCE and ran without `--resume-baseline`, computing its 50%
 * pgmark-deletion safeguard against the already-reduced in-place count instead
 * of the baseline — deleting legitimate `\pgmark{N}` anchors from a user's
 * `main.tex` on a resume pass, which is the exact loophole deep-index's own
 * prose says that flag exists to close.
 *
 * Nothing could see it. The eight sites were shipped markdown, so no type and
 * no build read them; and the ONE guard that reads these commands folded a
 * continuation with `endsWith("\\")`, which is true of a line ending in one
 * backslash and equally true of two — so it stitched the broken pairs back
 * together and saw eight healthy invocations. That fork is closed at the
 * source: both readers now take `_shell-fence.ts`, which states bash's
 * odd/even rule once.
 *
 * The sites were never the part that could misbehave — an authoring habit that
 * reproduces is. Every other multi-line command in the family spells a correct
 * single `\`, which is what makes this a drift rather than a convention, and
 * why the census is the deliverable.
 *
 * Allowlist: EMPTY, and it stays that way. An entry here is a skill telling an
 * agent to run a command that will not run.
 */
import { describe, it, expect } from "vitest";
import {
  SHELL_LANGS,
  continuesLine,
  fenceBlocks,
  fenceLineDefect,
  listSkillMarkdown,
  readSkillMarkdown,
  trailingBackslashRun,
} from "./_shell-fence";

interface Finding {
  file: string;
  line: number;
  kind: string;
  detail: string;
}

/**
 * Fenced shell lines a skill may break in a way bash will not honour.
 *
 * Deliberately EMPTY. The fix is to spell the continuation correctly — never
 * to list the command that does not run.
 */
const PERMITTED_BROKEN_CONTINUATIONS: string[] = [];

/**
 * Files whose fences may be left unclosed.
 *
 * Also empty. An unclosed fence swallows the rest of the document into a code
 * block — for the reader below, and for the agent reading the prompt.
 */
const PERMITTED_UNBALANCED_FENCES: string[] = [];

const DEFECT_DETAIL: Record<string, string> = {
  "escaped-continuation":
    "ends in an EVEN run of backslashes — bash passes a literal `\\` and the " +
    "line ENDS, so the next line runs as its own command",
  "whitespace-after-continuation":
    "has whitespace after the trailing `\\` — the backslash escapes the SPACE, " +
    "not the newline, so the line ENDS",
};

function scan(): Finding[] {
  const findings: Finding[] = [];
  for (const rel of listSkillMarkdown()) {
    const blocks = fenceBlocks(rel, readSkillMarkdown(rel));
    for (const block of blocks) {
      if (block.closeLine === null && !PERMITTED_UNBALANCED_FENCES.includes(rel)) {
        findings.push({
          file: rel,
          line: block.openLine,
          kind: "unbalanced-fence",
          detail: `\`\`\`${block.lang || "(untagged)"} fence opened and never closed`,
        });
      }
      if (!SHELL_LANGS.has(block.lang)) continue;
      block.body.forEach((raw, i) => {
        const lineNo = block.openLine + 1 + i;
        const site = `${rel}:${lineNo}`;
        if (PERMITTED_BROKEN_CONTINUATIONS.includes(site)) return;
        const defect = fenceLineDefect(raw);
        if (defect !== null) {
          findings.push({ file: rel, line: lineNo, kind: defect, detail: DEFECT_DETAIL[defect] });
        }
      });
      // A continuation on the LAST body line dangles onto the closing marker:
      // the command swallows whatever follows the fence. Same class, and free
      // to check once the block boundaries are already resolved.
      const last = block.body[block.body.length - 1];
      if (last !== undefined && continuesLine(last)) {
        findings.push({
          file: rel,
          line: block.closeLine === null ? block.openLine : block.closeLine - 1,
          kind: "dangling-continuation",
          detail: "the fence's last line ends in `\\` — the command runs past the fence",
        });
      }
    }
  }
  return findings;
}

describe("skill markdown shell fences", () => {
  it("every fenced shell line breaks the way bash reads it", () => {
    const findings = scan();
    const report = findings.map((f) => `  ${f.file}:${f.line} — ${f.kind}: ${f.detail}`).join("\n");
    expect(
      findings,
      `A shipped skill documents a command bash will not run as written.\n` +
        `A skill is a prompt: an agent runs this verbatim, and a mis-broken\n` +
        `line drops every flag after it (or, for a hand-rolled argv walk,\n` +
        `drops them SILENTLY). Spell the continuation as a single \`\\\`.\n${report}`,
    ).toEqual([]);
  });

  it("the two readers agree about where a command ends", () => {
    // The fork that hid task 445 was a SECOND continuation rule, not a bad
    // one: `endsWith("\\")` is right about `\` and wrong about `\\`. Pin the
    // disagreement so a reader cannot quietly re-derive the loose form.
    expect(continuesLine("cmd \\")).toBe(true);
    expect(continuesLine("cmd \\\\")).toBe(false);
    expect("cmd \\\\".trimEnd().endsWith("\\")).toBe(true); // the retired rule
    expect(continuesLine("cmd \\\\\\")).toBe(true);
    expect(trailingBackslashRun("cmd \\\\\\\\")).toBe(4);
    expect(continuesLine("cmd")).toBe(false);
  });

  it("flags each defect shape, and clears the shapes that are legitimate", () => {
    expect(fenceLineDefect("python3 x.py foo \\")).toBeNull();
    expect(fenceLineDefect("python3 x.py foo \\\\")).toBe("escaped-continuation");
    expect(fenceLineDefect("python3 x.py foo \\ ")).toBe("whitespace-after-continuation");
    expect(fenceLineDefect("echo 'a \\\\ b' | cat")).toBeNull(); // mid-line, not a break
    expect(fenceLineDefect("plain line")).toBeNull();
  });

  it("the census actually sees the fences it is meant to police", () => {
    // A language filter or a fence walk that silently matched nothing would
    // make the check above pass forever. Pin a floor on both, and pin that the
    // walk really reaches a KNOWN multi-line command in a shipped skill.
    const files = listSkillMarkdown();
    expect(files.length).toBeGreaterThan(40);

    let shellFences = 0;
    let shellLines = 0;
    let continuations = 0;
    const langs = new Set<string>();
    for (const rel of files) {
      for (const block of fenceBlocks(rel, readSkillMarkdown(rel))) {
        langs.add(block.lang);
        if (!SHELL_LANGS.has(block.lang)) continue;
        shellFences += 1;
        shellLines += block.body.length;
        continuations += block.body.filter(continuesLine).length;
      }
    }
    expect(shellFences).toBeGreaterThan(200);
    expect(shellLines).toBeGreaterThan(1000);
    // Multi-line commands are the whole population this guard exists for. If
    // the fence walk ever stops reaching them, this is what says so.
    expect(continuations).toBeGreaterThan(20);
    // A `latex` fence's `\\` is a line break, not a broken continuation — the
    // reason the language filter is opt-IN. Prove such fences exist, so the
    // filter is doing real work rather than being vacuously narrow.
    expect(langs.has("latex")).toBe(true);
  });

  it("fails on the pre-fix shape", () => {
    // Synthetic, not a live line: a canary standing on the drained defect
    // evaporates the moment the tree is clean.
    const md = [
      "prose",
      "```bash",
      "python3 .virgil/scripts/library/repair_pgmarks.py papers/x/main.tex \\\\",
      "    --resume-baseline .virgil/baselines/x-pre-deepindex.tex",
      "```",
      "```latex",
      "line one \\\\",
      "line two",
      "```",
      "```bash",
      "unclosed --forever",
    ].join("\n");
    const blocks = fenceBlocks("fixture.md", md);
    expect(blocks.map((b) => b.lang)).toEqual(["bash", "latex", "bash"]);
    expect(blocks[0].body.map(fenceLineDefect)).toEqual(["escaped-continuation", null]);
    // The LaTeX fence carries the identical bytes and is deliberately unread.
    expect(SHELL_LANGS.has(blocks[1].lang)).toBe(false);
    expect(blocks[2].closeLine).toBeNull();
  });
});
