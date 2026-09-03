/**
 * Shared NodeView-census helpers (tasks 548 / 551).
 *
 * ONE discovery of "every vanilla NodeView body in the tree", read by every
 * census that asks a question of that population — the timer-lifetime census
 * (548) and the idempotent-update census (551). Two enumerations of who the
 * NodeViews are is how one guard comes to be scanning a set the other no
 * longer is.
 *
 * Population: every shipped file in either silo that spells `addNodeView(`.
 * Reach: each `addNodeView()` body plus the bodies of every same-file
 * `function NAME(` it reaches, transitively — a list NodeView's whole body is
 * `createListTitleNodeView(…)`, one call away; a region that stopped at the
 * method would see nothing but a `return`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, codeOnly, trackedFiles } from "@/lib/__tests__/_source-scan";

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

export function nodeViewRegions(file: string): Region[] {
  const raw = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
  const src = codeOnly(raw);
  const fnBodies = new Map<string, string>();
  for (const m of src.matchAll(/\bfunction\s+(\w+)\s*\(/g)) {
    const open = src.indexOf("{", src.indexOf(")", m.index!));
    if (open < 0) continue;
    const [a, b] = braceBody(src, open);
    fnBodies.set(m[1], src.slice(a, b + 1));
  }
  const regions: Region[] = [];
  let ordinal = 0;
  for (const m of src.matchAll(/\baddNodeView\s*\(\s*\)\s*\{/g)) {
    const open = m.index! + m[0].length - 1;
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
    ordinal++;
    regions.push({ file, label: `${file}#addNodeView[${ordinal}]`, text });
  }
  return regions;
}

export function nodeViewPopulation(): string[] {
  const files = [...trackedFiles("src", /\.tsx?$/), ...trackedFiles("library", /\.tsx?$/)]
    .filter((p) => !p.includes("__tests__"))
    .map((p) => path.relative(REPO_ROOT, p));
  return files.filter((f) =>
    /\baddNodeView\s*\(/.test(codeOnly(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"))),
  );
}

/**
 * Every `update(…) { … }` METHOD body inside a region — the NodeView spec's
 * own `update`, plus any same-shaped method a reached helper declares. The
 * body is the method's own braces, not the reach: a helper the body CALLS
 * (`renderTitle()`, a pod's `render()`) is gated at the call site, and that
 * gate is what the behavioural legs measure.
 */
export function updateBodies(region: Region): string[] {
  const out: string[] = [];
  for (const m of region.text.matchAll(/\bupdate\s*\([^)]*\)\s*\{/g)) {
    const [a, b] = braceBody(region.text, m.index! + m[0].length - 1);
    out.push(region.text.slice(a, b + 1));
  }
  return out;
}
