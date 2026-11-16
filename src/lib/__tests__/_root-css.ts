/**
 * The SHIPPED value of a `:root` token, as the stylesheets state it — ONE
 * resolver shared by every guard that pins something to "what ships"
 * (task 1651, extracted from task 1417's leg in `phantom-css-var.test.ts`).
 *
 * "Its value" is the CASCADE WINNER: the LAST declaration across the TOP-LEVEL
 * `:root` rules (the promote-defaults block overrides the hand-written first
 * one). A `:root` nested in an at-rule is conditional and is not read; a token
 * whose value (or any re-declaration) goes through `var()`/`env()` is not a
 * literal and is left out.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { cssCommentsStripped } from "@/lib/__tests__/_source-scan";

const ROOT = path.resolve(__dirname, "..", "..", "..");

/** Every stylesheet the app ships. `globals.css` `@import`s the library one. */
export const SHIPPED_STYLESHEETS = ["src/app/globals.css", "library/styles/library.css"];

/** The bodies of the TOP-LEVEL `:root` rules in comment-stripped `css`. */
export function topLevelRootBodies(css: string): string[] {
  const bodies: string[] = [];
  let depth = 0;
  let selStart = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "}") {
      depth = Math.max(0, depth - 1);
      selStart = i + 1;
    } else if (css[i] === "{") {
      const selector = css.slice(selStart, i).split(";").pop()!.trim();
      if (depth === 0 && selector === ":root") {
        let j = i + 1;
        for (let d = 1; j < css.length && d > 0; j++) {
          if (css[j] === "{") d++;
          else if (css[j] === "}") d--;
        }
        bodies.push(css.slice(i + 1, j - 1));
        i = j - 1;
        selStart = j;
      } else {
        depth++;
        selStart = i + 1;
      }
    }
  }
  return bodies;
}

/** Every `--tok: value;` declaration in a rule body, in source order. */
export const rootDeclarations = (body: string) =>
  [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => ({ tok: d[1], value: d[2].trim() }));

/** token → its cascade-winning TOP-LEVEL `:root` declaration, over comment-stripped `css`. */
export function rootWinners(css: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const body of topLevelRootBodies(css))
    for (const d of rootDeclarations(body)) values.set(d.tok, d.value); // last wins
  return values;
}

const volatile = (v: string) => /var\(|env\(|\b(?:inherit|initial|unset)\b/.test(v);

/**
 * token → its cascade-winning `:root` literal, over comment-stripped `css` —
 * STRICT: a token re-declared anywhere through `var()`/`env()` is left out,
 * because there its fallback can be live (task 1417's question).
 */
export function rootLiteralValues(css: string): Map<string, string> {
  const literal = new Map<string, string>();
  for (const [tok, v] of rootWinners(css)) {
    if (volatile(v)) continue;
    const decls = [...css.matchAll(new RegExp(`(?<![\\w-])${tok}\\s*:\\s*([^;}]+)`, "g"))];
    if (decls.some((d) => volatile(d[1]))) continue;
    literal.set(tok, v);
  }
  return literal;
}

/** Every `var(--tok, <fallback>)` in `text`, the fallback balanced on parens. */
export function fallbackReads(text: string): { tok: string; fallback: string; at: number }[] {
  const out: { tok: string; fallback: string; at: number }[] = [];
  const re = /var\(\s*(--[\w-]+)\s*,/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let i = re.lastIndex;
    for (let depth = 1; i < text.length && depth > 0; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
    out.push({ tok: m[1], fallback: text.slice(re.lastIndex, i - 1).trim(), at: m.index });
  }
  return out;
}

export const sameValue = (a: string, b: string) =>
  a.toLowerCase().replace(/\s+/g, "") === b.toLowerCase().replace(/\s+/g, "");

const shippedCss = () =>
  SHIPPED_STYLESHEETS.map((f) => cssCommentsStripped(readFileSync(path.join(ROOT, f), "utf8"))).join("\n");

/** token → its shipped `:root` literal, STRICT (see `rootLiteralValues`). */
export function shippedRootValues(): Map<string, string> {
  return rootLiteralValues(shippedCss());
}

/**
 * token → the value it ships with at the document root: the cascade-winning
 * top-level `:root` declaration, literal only, whatever scoped selectors do
 * further down. What a SEPARATE document that inherits none of those scopes
 * (the pdf.js iframe) should fall back to.
 */
export function shippedRootDefaults(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [tok, v] of rootWinners(shippedCss())) if (!volatile(v)) out.set(tok, v);
  return out;
}
