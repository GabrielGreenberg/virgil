// The static + dynamic import closure of `EditorPane.tsx` — the files whose
// code runs once per mounted pane (or once per module, shared by every pane).
// Shared by the two keep-alive censuses: task 598's window/document listener
// census and task 739's module-subscriber census, so both walk ONE set.
//
// Import reachability over-approximates "mounted per pane"; `import type`
// edges are skipped (erased at build time).

import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { commentsStripped } from "@/lib/__tests__/_source-scan";

export const SRC = path.resolve(__dirname, "../../..");
export const PANE_ROOT = "components/EditorPane.tsx";

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/g;
const DYNAMIC_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

/** Absolute path → comments-stripped source, for every file in the closure. */
export function paneImportClosure(): Map<string, string> {
  const code = new Map<string, string>();
  const stack = [path.join(SRC, PANE_ROOT)];
  while (stack.length) {
    const f = stack.pop()!;
    if (code.has(f)) continue;
    const src = readFileSync(f, "utf8");
    code.set(f, commentsStripped(src));
    for (const m of src.matchAll(IMPORT_RE)) {
      if (m[1]) continue; // `import type` erases at build time
      const r = resolveSpec(f, m[2]);
      if (r) stack.push(r);
    }
    for (const m of src.matchAll(DYNAMIC_RE)) {
      const r = resolveSpec(f, m[1]);
      if (r) stack.push(r);
    }
  }
  return code;
}

/** `src/`-relative, forward-slashed. */
export const relToSrc = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
