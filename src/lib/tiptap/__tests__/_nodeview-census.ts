/**
 * Shared NodeView-census helpers (tasks 548 / 551).
 *
 * ONE discovery of "every vanilla NodeView body in the tree", read by every
 * census that asks a question of that population — the timer-lifetime census
 * (548) and the idempotent-update census (551). Two enumerations of who the
 * NodeViews are is how one guard comes to be scanning a set the other no
 * longer is.
 *
 * Population: every shipped file in either silo that spells `addNodeView(`,
 * plus every file that declares a SHARED NodeView factory
 * (`function NAME(…): NodeView {` — task 840's `createLeafNodeView`). Without
 * the second clause a factory's body lives in a file no census reads: the
 * four inline-atom views' click and `update()` moved there, and a timer or a
 * bare write planted in it would have been invisible to both guards.
 * Reach: each `addNodeView()` body plus the bodies of every same-file helper
 * it reaches, transitively — `function NAME(` AND `const NAME = (…) =>` (task
 * 840: citation's `applyCitationContent` is a const arrow, and a reach that
 * followed only declarations stopped at its call). A list NodeView's whole
 * body is `createListTitleNodeView(…)`, one call away; a region that stopped
 * at the method would see nothing but a `return`.
 *
 * ONE discovery, TWO readings (task 552). A census whose needle is a SYMBOL
 * (`setTimeout`, `setAttribute`) wants `codeOnly`, which blanks string
 * literals so a name quoted in prose or an error message cannot indict its
 * file. A census whose needle IS a quoted string — the title input's own
 * class — wants `commentsStripped`, which keeps literals. Passing the
 * transform in keeps both readings on the SAME population and the SAME reach;
 * a second `matchAll(/addNodeView/)` somewhere else is how one census comes to
 * be scanning a set another no longer is, which is the failure this file's
 * existence is against.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, codeOnly, commentsStripped, trackedFiles } from "@/lib/__tests__/_source-scan";

/** How a region's source is read. `code` blanks string literals; `literals`
 *  keeps them (and still strips comments). */
export type RegionReading = "code" | "literals";

export interface Region {
  file: string;
  label: string;
  text: string;
}

/** `[openIdx, closeIdx]` of the brace body opening at `openIdx`. */
export function braceBody(s: string, openIdx: number): [number, number] {
  let depth = 0;
  for (let j = openIdx; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}") {
      depth--;
      if (depth === 0) return [openIdx, j];
    }
  }
  return [openIdx, s.length - 1];
}

/** A shared NodeView factory's declaration: `function NAME(…): NodeView {`. */
const NODEVIEW_FACTORY = /\bfunction\s+(\w+)\s*\([^)]*\)\s*:\s*NodeView\s*\{/g;

/** A same-file const-arrow helper whose body is a block:
 *  `const NAME = (…) => {` / `const NAME = async (…): T => {`. */
const CONST_ARROW_HELPER =
  /\b(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(([^()]|\([^()]*\))*\)\s*(?::\s*[^=;{]+)?=>\s*\{/g;

/** Every same-file helper body a region can reach, by name. */
export function helperBodies(src: string): Map<string, string> {
  const fnBodies = new Map<string, string>();
  for (const m of src.matchAll(/\bfunction\s+(\w+)\s*\(/g)) {
    const open = src.indexOf("{", src.indexOf(")", m.index!));
    if (open < 0) continue;
    const [a, b] = braceBody(src, open);
    fnBodies.set(m[1], src.slice(a, b + 1));
  }
  for (const m of src.matchAll(CONST_ARROW_HELPER)) {
    const open = m.index! + m[0].length - 1;
    const [a, b] = braceBody(src, open);
    if (!fnBodies.has(m[1])) fnBodies.set(m[1], src.slice(a, b + 1));
  }
  return fnBodies;
}

export function nodeViewRegions(file: string, reading: RegionReading = "code"): Region[] {
  const raw = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
  const src = reading === "literals" ? commentsStripped(raw) : codeOnly(raw);
  const fnBodies = helperBodies(src);
  const regions: Region[] = [];
  let ordinal = 0;
  const roots: Array<{ label: string; open: number }> = [];
  for (const m of src.matchAll(/\baddNodeView\s*\(\s*\)\s*\{/g)) {
    roots.push({ label: `addNodeView[${++ordinal}]`, open: m.index! + m[0].length - 1 });
  }
  for (const m of src.matchAll(NODEVIEW_FACTORY)) {
    roots.push({ label: `factory:${m[1]}`, open: m.index! + m[0].length - 1 });
  }
  for (const { label, open } of roots) {
    const [a, b] = braceBody(src, open);
    let text = src.slice(a, b + 1);
    // Transitive closure over same-file function declarations.
    const seen = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const [name, body] of fnBodies) {
        if (seen.has(name)) continue;
        if (new RegExp(`\\b${name}\\s*\\(`).test(text)) {
          seen.add(name);
          text += "\n" + body;
          grew = true;
        }
      }
    }
    regions.push({ file, label: `${file}#${label}`, text });
  }
  return regions;
}

export function nodeViewPopulation(): string[] {
  const files = [...trackedFiles("src", /\.tsx?$/), ...trackedFiles("library", /\.tsx?$/)]
    .filter((p) => !p.includes("__tests__"))
    .map((p) => path.relative(REPO_ROOT, p));
  return files.filter((f) => {
    const src = codeOnly(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"));
    NODEVIEW_FACTORY.lastIndex = 0;
    return /\baddNodeView\s*\(/.test(src) || NODEVIEW_FACTORY.test(src);
  });
}

/**
 * Every per-transaction METHOD body inside a region: the NodeView spec's own
 * `update(…) { … }` (plus any same-shaped method a reached helper declares),
 * and every `paint(…) { … }` — the `createLeafNodeView` spec method its
 * `update()` runs on every change (task 840). The
 * body is the method's own braces, not the reach: a helper the body CALLS
 * (`renderTitle()`, a pod's `render()`) is gated at the call site, and that
 * gate is what the behavioural legs measure.
 */
export function updateBodies(region: Region): string[] {
  const out: string[] = [];
  for (const m of region.text.matchAll(/\b(?:update|paint)\s*\([^)]*\)\s*\{/g)) {
    const [a, b] = braceBody(region.text, m.index! + m[0].length - 1);
    out.push(region.text.slice(a, b + 1));
  }
  return out;
}
