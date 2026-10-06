/**
 * The CALLER-SIDE leg of the dead-prop census (task 963).
 *
 * `dead-panel-prop-guardrail`'s member rule asks the CALLEE's question — "does
 * this declared prop occur again in its own file?" — and a prop a component
 * destructures and forwards answers yes however dead it is. Task 963 found the
 * shape that rule cannot see: twelve anchored cards each declared optional
 * `onTogglePopout` / `onHoverChange` overrides, consumed them faithfully
 * (`onTogglePopout ?? fromContext`, `onHoverChange?.(h)`), and no JSX site
 * anywhere ever passed one. The override branch was unreachable in every card,
 * and the declarations were what kept each new card copying it back.
 *
 * So this leg asks the CALLER's question: for an exported component under the
 * censused roots, is each OPTIONAL prop supplied by at least one JSX site in
 * `src/`? Required props need no census — the compiler already makes every
 * caller pass them.
 *
 * It fails toward SILENCE wherever a grep cannot see the supply, and says so:
 *   • a component with NO JSX call site is skipped (it is rendered some other
 *     way, or it is dead — `dead-component-import-guardrail`'s question);
 *   • a component named anywhere OUTSIDE a JSX tag (`component: Name`,
 *     `createElement(Name, …)`, a `memo(Name)` wrapper) is skipped — its props
 *     may arrive programmatically. A caller file is read for a component only
 *     when it IMPORTS that component's value (directly or through a one-hop
 *     barrel) or is its own file — several cards share their name with the
 *     DATA type they render (`ReportCard`), and a type mention is not a use;
 *   • a call site that SPREADS a non-literal (`{...props}`) supplies "anything",
 *     so the component is skipped. A spread of an object LITERAL
 *     (`{...{ a: 1 }}`) is read for its keys.
 * Test files are not callers: a prop only a test passes is a prop no product
 * surface passes.
 */
import { existsSync, readFileSync, statSync } from "fs";
import { dirname, resolve } from "path";
import { walkFiles } from "../../lib/__tests__/_source-scan";

/** Blank comments, preserving offsets (the census's own `stripComments`). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

/** Blank string / template literal BODIES, preserving offsets and quotes, so a
 *  `{`, `>` or `=` inside a string cannot skew the bracket scans below. */
function blankStrings(src: string): string {
  return src.replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\\n])*\1/g, (m) => m[0] + " ".repeat(m.length - 2) + m[m.length - 1]);
}

function prep(src: string): string {
  return blankStrings(stripComments(src));
}

/** Index of the bracket closing the one opened at `open`. */
function matchClose(src: string, open: number): number {
  const o = src[open];
  const c = o === "{" ? "}" : o === "(" ? ")" : o === "[" ? "]" : ">";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c && --depth === 0) return i;
  }
  return -1;
}

/** Top-level members of a type-literal BODY, with their optionality. */
export function topLevelMembers(body: string): Array<{ name: string; optional: boolean }> {
  const out: Array<{ name: string; optional: boolean }> = [];
  let depth = 0;
  let atStart = true;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "=" && body[i + 1] === ">") { i++; continue; }
    if ("{([<".includes(ch)) { depth++; atStart = false; continue; }
    if ("})]>".includes(ch)) { depth--; continue; }
    if (depth !== 0) continue;
    if (ch === ";" || ch === "," || ch === "\n") { atStart = true; continue; }
    if (!atStart || /\s/.test(ch)) continue;
    atStart = false;
    const m = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*[:(]/.exec(body.slice(i));
    if (m) out.push({ name: m[1], optional: !!m[2] });
  }
  return out;
}

export interface ComponentDecl {
  file: string;
  name: string;
  optional: string[];
}

/** Exported function components and the OPTIONAL members of their props shape
 *  — the inline literal annotating a destructured parameter, or a `*Props`
 *  interface / type alias declared in the same file. */
export function exportedComponents(file: string, raw: string): ComponentDecl[] {
  const src = prep(raw);
  const decls: ComponentDecl[] = [];
  const HEAD =
    /export\s+(?:default\s+)?(?:function\s+([A-Z][\w$]*)\s*(?:<[^>(]*>)?\s*\(|const\s+([A-Z][\w$]*)\s*=\s*(?:(?:memo|forwardRef)\s*(?:<[^(]*>)?\s*\(\s*)?(?:function\s*[\w$]*\s*)?\()/g;
  for (const m of src.matchAll(HEAD)) {
    const name = m[1] ?? m[2];
    const paren = m.index! + m[0].length - 1;
    const close = matchClose(src, paren);
    if (close < 0) continue;
    const params = src.slice(paren + 1, close);
    // The FIRST parameter: a destructuring pattern, or a plain identifier
    // (`props`), followed by `: <type>`.
    let patClose: number;
    const lead = /^\s*\{/.exec(params);
    if (lead) {
      patClose = matchClose(src, paren + 1 + lead[0].length - 1);
      if (patClose < 0 || patClose > close) continue;
    } else {
      const ident = /^\s*[A-Za-z_$][\w$]*/.exec(params);
      if (!ident) continue;
      patClose = paren + ident[0].length;
    }
    const ann = /^\s*:\s*/.exec(src.slice(patClose + 1));
    if (!ann) continue;
    const typeAt = patClose + 1 + ann[0].length;
    let body: string | null = null;
    if (src[typeAt] === "{") {
      const tClose = matchClose(src, typeAt);
      if (tClose > 0) body = src.slice(typeAt + 1, tClose);
    } else {
      const ref = /^([A-Z][\w$]*Props)\b/.exec(src.slice(typeAt));
      if (ref) {
        const decl = new RegExp(`(?:interface|type)\\s+${ref[1]}\\s*(?:<[^>]*>)?\\s*(?:extends [^{]+)?=?\\s*\\{`).exec(src);
        if (decl) {
          const o = decl.index + decl[0].length - 1;
          const c = matchClose(src, o);
          if (c > 0) body = src.slice(o + 1, c);
        }
      }
    }
    if (body === null) continue;
    const optional = topLevelMembers(body).filter((x) => x.optional).map((x) => x.name);
    if (optional.length) decls.push({ file, name, optional });
  }
  return decls;
}

interface CallSites {
  /** Props named at some JSX site of this component. */
  supplied: Set<string>;
  jsxSites: number;
  /** A non-literal spread, or a non-JSX reference, somewhere: supply unknown. */
  opaque: boolean;
}

/** Attribute names an opening tag supplies, and whether it spreads opaquely. */
export function tagAttributes(tag: string): { names: string[]; opaque: boolean } {
  const names: string[] = [];
  let opaque = false;
  let depth = 0;
  for (let i = 0; i < tag.length; i++) {
    const ch = tag[i];
    if (ch === "{") {
      if (depth === 0) {
        const close = matchClose(tag, i);
        const inner = tag.slice(i + 1, close < 0 ? tag.length : close);
        const spread = /^\s*\.\.\.\s*/.exec(inner);
        if (spread) {
          const rest = inner.slice(spread[0].length).trim();
          if (rest.startsWith("{")) {
            const lit = rest.slice(1, matchClose(rest, 0));
            for (const k of lit.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?=[:,]|$)/g)) names.push(k[1]);
          } else {
            opaque = true;
          }
        }
        if (close < 0) break;
        i = close;
        continue;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
    } else if (depth === 0) {
      const m = /^([A-Za-z_$][\w$-]*)\s*=/.exec(tag.slice(i));
      if (m && (i === 0 || /\s/.test(tag[i - 1]))) {
        names.push(m[1]);
        i += m[1].length - 1;
      } else {
        // A bare boolean attribute (`<X canJump />`).
        const b = /^([A-Za-z_$][\w$-]*)(?=\s|\/?$)/.exec(tag.slice(i));
        if (b && (i === 0 || /\s/.test(tag[i - 1]))) {
          names.push(b[1]);
          i += b[1].length - 1;
        }
      }
    }
  }
  return { names, opaque };
}

/** Resolve an import specifier to a source file (`@/` alias or relative). */
function resolveSpec(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = resolve(SRC_ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

let SRC_ROOT = resolve("src");

/** Local names under which `file` imports the VALUE `name` declared in
 *  `declFile` — directly, or through a barrel that re-exports it in one hop. */
function localNamesFor(file: string, src: string, name: string, declFile: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    if (m[1]) continue;
    for (const part of m[2].split(",")) {
      const pm = /^\s*(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
      if (!pm || pm[1] || pm[2] !== name) continue;
      const target = resolveSpec(file, m[3]);
      if (!target) continue;
      if (target === declFile || reExports(target, name, declFile)) out.push(pm[3] ?? pm[2]);
    }
  }
  return out;
}

function reExports(barrel: string, name: string, declFile: string): boolean {
  const src = stripComments(readFileSync(barrel, "utf8"));
  for (const m of src.matchAll(/export\s+(\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g)) {
    if (m[1] !== "*" && !new RegExp(`\\b${name}\\b`).test(m[1])) continue;
    if (resolveSpec(barrel, m[2]) === declFile) return true;
  }
  return false;
}

export function collectCallSites(decls: ComponentDecl[], callerFiles: string[]): Map<ComponentDecl, CallSites> {
  const sites = new Map<ComponentDecl, CallSites>();
  for (const d of decls) sites.set(d, { supplied: new Set(), jsxSites: 0, opaque: false });
  for (const f of callerFiles) {
    const raw = readFileSync(f, "utf8");
    // Import / re-export statements (multi-line ones included) name a
    // component without using it — blank them before reading uses.
    const src = prep(raw).replace(
      /^\s*(?:import|export)\b[^;]*?\bfrom\s*["'][^"'\n]*["'];?/gm,
      (m) => m.replace(/[^\n]/g, " "),
    );
    const imports = stripComments(raw);
    for (const d of decls) {
      if (!src.includes(d.name)) continue;
      const locals = resolve(f) === resolve(d.file) ? [d.name] : localNamesFor(f, imports, d.name, resolve(d.file));
      const s = sites.get(d)!;
      for (const n of locals) scanUses(src, n, s);
    }
  }
  return sites;
}

function scanUses(src: string, n: string, s: CallSites): void {
  for (const m of src.matchAll(new RegExp(`\\b${n}\\b`, "g"))) {
    const at = m.index!;
    const before = src.slice(Math.max(0, at - 1), at);
    if (before === "<") {
      // JSX opening tag: scan to its closing `>` at brace depth 0.
      let depth = 0;
      let end = at;
      for (; end < src.length; end++) {
        const ch = src[end];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (ch === ">" && depth === 0 && src[end - 1] !== "=") break;
      }
      const { names: attrs, opaque } = tagAttributes(src.slice(at + n.length, end).replace(/\/$/, ""));
      s.jsxSites++;
      if (opaque) s.opaque = true;
      for (const a of attrs) s.supplied.add(a);
      continue;
    }
    if (before === "/" || before === ".") continue; // `</Name>`, `x.Name`
    const line = src.slice(src.lastIndexOf("\n", at) + 1, src.indexOf("\n", at));
    if (/\bimport\s*\(/.test(line)) continue;
    // Its own declaration (`function Name(`) or a type position
    // (`typeof Name`) is not a supply.
    if (/(?:function|typeof)\s+$/.test(src.slice(Math.max(0, at - 12), at))) continue;
    s.opaque = true;
  }
}

/** `file::Component::prop` for every optional prop of an exported component
 *  under `roots` that no JSX site in `callerRoot` supplies. */
export function neverSuppliedProps(roots: string[], callerRoot = "src"): string[] {
  const isSource = (p: string) => /\.tsx?$/.test(p) && !/\.(d\.ts|stories\.tsx?|test\.tsx?)$/.test(p);
  const decls = roots
    .flatMap((r) => walkFiles(r, { skipDirs: ["__tests__"] }))
    .filter(isSource)
    .flatMap((f) => exportedComponents(f, readFileSync(f, "utf8")));
  SRC_ROOT = resolve(callerRoot);
  const callers = walkFiles(callerRoot, { skipDirs: ["__tests__"] }).filter(isSource);
  const sites = collectCallSites(decls, callers);
  const hits: string[] = [];
  for (const d of decls) {
    const s = sites.get(d)!;
    if (s.jsxSites === 0 || s.opaque) continue;
    for (const p of d.optional) if (!s.supplied.has(p)) hits.push(`${d.file}::${d.name}::${p}`);
  }
  return hits;
}
