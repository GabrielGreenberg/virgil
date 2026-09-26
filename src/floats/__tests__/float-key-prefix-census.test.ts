// Float keys are classified by the grammar's parser, never a prefix literal
// (task 788).
//
// `src/floats/float-key.ts` owns the popout-key grammar (`buildFloatKey`,
// `parseFloatKey`, the dual-read `parseAnyKey`). A consumer that matches a key
// by a hand-written prefix — `key.startsWith("textobject:linkedRange:")` — is a
// second, private copy of that grammar, and it drifts: task 788's transient-
// anchor watcher kept the pre-flip `textobject:` spelling after every live key
// became `float:textobject:…`, matched nothing, and leaked `\vlid` markers into
// the user's .tex. This census forbids a `"float:` / `"textobject:` string
// literal in production code outside the grammar module and the two stated
// LEGACY-MIGRATION readers, whose whole job is to read the retired spellings.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..", "..");

const ALLOWED = new Set([
  "floats/float-key.ts", // the grammar itself
  "hooks/useViewPrefs.ts", // read-time legacy-key migration
  "text-objects/post-load-migrations.ts", // doc-aware legacy-key migration
]);

// A string/template literal that OPENS with a float-key domain prefix.
const KEY_PREFIX_LITERAL = /["'`](?:float|textobject):/;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("float-key prefix census (task 788)", () => {
  it("no production module spells a float-key prefix literal outside the grammar", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC, [])) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      // Blank out block comments (JSDoc, JSX `{/* … */}`) line-preservingly,
      // so prose that NAMES the grammar is not mistaken for code spelling it.
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) =>
        c.replace(/[^\n]/g, " "),
      );
      source
        .split("\n")
        .forEach((line, i) => {
          const code = line.replace(/(^|[^:])\/\/.*$/, "$1");
          if (KEY_PREFIX_LITERAL.test(code)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
