/**
 * The ONE reader of a skill markdown's shell fences (task 445).
 *
 * A skill markdown is a PROMPT: whatever invocation it prints inside a
 * ```` ```bash ```` fence, an agent runs verbatim. So a fenced shell block is
 * source code that this repo ships, and two questions get asked about it —
 * "where does this command END?" (the CLI guardrail folds continuation lines
 * before reading a command's flags) and "does any line here break in a way
 * bash would not honour?" (the fence census). Both are the same question about
 * one grammar, so they read one module.
 *
 * **They did not, and that fork is what hid task 445.** The CLI guardrail
 * folded a continuation with `line.trimEnd().endsWith("\\")` — true for a line
 * ending in ONE backslash and equally true for one ending in TWO. Bash reads
 * those oppositely: `\` at end of line escapes the newline (the command
 * continues), while `\\` is an escaped backslash that passes a literal `\` as
 * an argument and the line ENDS. Eight shipped commands across four library
 * skills ended their first line with `\\`, so bash dropped every flag on the
 * continuation line and ran that line as its own command — while the guard
 * built to police those very flags folded the two lines together and saw a
 * healthy invocation. One of the eight (`repair_pgmarks.py`) hand-rolls its
 * argv walk, so it swallowed the stray `\` with no error and ran WITHOUT its
 * `--resume-baseline` safeguard, deleting legitimate `\pgmark{N}` anchors from
 * a user's `main.tex` on a resume pass.
 *
 * The grammar, stated once so neither reader can restate it differently:
 *
 * - A backslash escapes the character after it. At end of line, the character
 *   after it is the NEWLINE — so the line continues.
 * - Backslashes therefore pair up: count the run at the very end of the line.
 *   An **ODD** run leaves one backslash escaping the newline ⇒ CONTINUES.
 *   An **EVEN** run (≥2) is whole escaped backslashes ⇒ the line ENDS.
 * - The run is counted against the RAW line, never a trimmed one. A backslash
 *   followed by a space escapes the SPACE, not the newline, so trailing
 *   whitespace after a would-be continuation ends the line too — invisibly, in
 *   a markdown file where nothing renders it.
 *
 * Consumers: `skill-shell-fence-guardrail.test.ts` (the census) and
 * `skill-script-cli-guardrail.test.ts` (the fold).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** Every silo that authors skill markdown. */
export const SKILL_DIRS = ["editor/skills", "library/skills"] as const;

/**
 * Fence info strings whose body is SHELL.
 *
 * Deliberately an opt-IN list rather than "anything that isn't json". An
 * untagged fence is not asserted to be shell, and a `latex` fence's `\\` is a
 * line break — legitimate, and exactly what a language-blind census would
 * indict. 244 of the family's 344 fences are `bash`.
 */
export const SHELL_LANGS = new Set(["bash", "sh", "shell", "zsh", "console"]);

/** Repo root, from `library/lib/__tests__/`. */
export const REPO_ROOT = path.resolve(__dirname, "../../..");

/** Number of backslashes the line ends with, counted on the RAW line. */
export function trailingBackslashRun(line: string): number {
  let n = 0;
  for (let i = line.length - 1; i >= 0 && line[i] === "\\"; i--) n += 1;
  return n;
}

/** Bash's own rule: an odd trailing run escapes the newline. */
export function continuesLine(line: string): boolean {
  return trailingBackslashRun(line) % 2 === 1;
}

export type FenceDefect =
  /** Even trailing run (≥2): reads as a continuation, is an escaped backslash. */
  | "escaped-continuation"
  /** Odd run, then whitespace to EOL: the backslash escapes the space. */
  | "whitespace-after-continuation";

/**
 * The defect on this line, or null.
 *
 * Both shapes are "the author meant a continuation and bash disagrees", which
 * is why they share a reader: the only difference is which character the
 * backslash ended up escaping.
 */
export function fenceLineDefect(line: string): FenceDefect | null {
  if (continuesLine(line)) return null;
  if (trailingBackslashRun(line) >= 2) return "escaped-continuation";
  const trimmed = line.replace(/[ \t]+$/, "");
  if (trimmed !== line && continuesLine(trimmed)) return "whitespace-after-continuation";
  return null;
}

export interface FenceBlock {
  /** Repo-relative path of the markdown file. */
  file: string;
  /** Lowercased first token of the info string; "" when untagged. */
  lang: string;
  /** 1-based line of the opening fence marker. */
  openLine: number;
  /** 1-based line of the closing marker, or null when the fence never closed. */
  closeLine: number | null;
  /** The body lines, verbatim, markers excluded. */
  body: string[];
}

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

/**
 * Walk one markdown file's fences.
 *
 * A fence closes on a marker of the SAME character, at least as long as the
 * opener, carrying no info string — CommonMark's rule, so a nested
 * ```` ````bash ```` block inside a longer fence is read as body rather than
 * as a close.
 */
export function fenceBlocks(file: string, source: string): FenceBlock[] {
  const lines = source.split("\n");
  const blocks: FenceBlock[] = [];
  let open: { marker: string; block: FenceBlock } | null = null;
  lines.forEach((raw, i) => {
    const m = FENCE.exec(raw);
    if (m) {
      const [, marker, info] = m;
      const trimmedInfo = info.trim();
      if (open === null) {
        open = {
          marker,
          block: {
            file,
            lang: trimmedInfo ? trimmedInfo.split(/\s+/)[0].toLowerCase() : "",
            openLine: i + 1,
            closeLine: null,
            body: [],
          },
        };
        return;
      }
      if (
        marker[0] === open.marker[0] &&
        marker.length >= open.marker.length &&
        trimmedInfo === ""
      ) {
        open.block.closeLine = i + 1;
        blocks.push(open.block);
        open = null;
        return;
      }
    }
    if (open !== null) open.block.body.push(raw);
  });
  // An unclosed fence is still reported — with `closeLine: null`, which is the
  // census's own finding. Swallowing it would make every line after the
  // opener invisible to this reader, which is the failure mode a fence census
  // most needs to see.
  if (open !== null) blocks.push((open as { block: FenceBlock }).block);
  return blocks;
}

/** Every `*.md` under the skill dirs, repo-relative, sorted. */
export function listSkillMarkdown(): string[] {
  const out: string[] = [];
  for (const dir of SKILL_DIRS) {
    const absDir = path.join(REPO_ROOT, dir);
    if (!existsSync(absDir)) continue;
    for (const name of readdirSync(absDir).sort()) {
      if (name.endsWith(".md")) out.push(path.join(dir, name));
    }
  }
  return out;
}

export function readSkillMarkdown(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}
