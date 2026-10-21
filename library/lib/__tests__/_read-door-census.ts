/**
 * The Library read-door caller census engine (task 1210). Not a suite (vitest
 * collects only `*.test.{ts,tsx}`); `read-door-caller-census.test.ts` drives it.
 *
 * The door (`library/lib/library-storage.ts`) answers `undefined` for absence
 * and REJECTS on a real failure (task 1115). A contract change there once
 * stranded six callers written for "undefined on any failure" — so this engine
 * follows every call of a door reader to where its rejection ENDS:
 *
 *   - GUARDED — a `try` block in the same function, a `.catch(…)`, or a
 *     two-argument `.then(ok, fail)`;
 *   - FLOATING — a `void` / bare expression statement with no handler: a
 *     rejection nobody hears (the PaperFileBody / unsorted-poll shape). Always
 *     a violation;
 *   - PROPAGATES — out of a NAMED function (declared, `const x = …`,
 *     `useCallback(…)`, an object method). A door function propagates by
 *     contract and is traced automatically; anywhere else the function must be
 *     declared in the census ledger (with why), and its own callers are then
 *     traced the same way — so a helper cannot launder a rejection;
 *   - UNKNOWN — a shape the engine can't follow (a promise stored in a
 *     variable, say). A violation, so the census never passes by not looking.
 *
 * Promise flow it follows: parentheses, `await` (after which the rejection is
 * a THROW that climbs to the nearest `try` block or the function boundary),
 * `.then(ok)` / `.finally`, array literals and call arguments (`Promise.all`,
 * `libPerfAsync(…, () => read())`), an IIFE, and an anonymous callback (its
 * rejection becomes the receiving call's — `entries.map(async …)`).
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

export const REPO = path.resolve(__dirname, "../../..");
export const DOOR = "library/lib/library-storage.ts";
/** The door's READERS — the functions whose contract task 1115 changed. */
export const READ_PRIMITIVES = ["readTextFile", "readJsonFile", "readFile", "listDir", "fileExists"];

export type Site =
  | { kind: "guarded" }
  | { kind: "floating" }
  | { kind: "propagates"; key: string }
  | { kind: "unknown"; why: string };

export interface Hit {
  /** `file::name` of the watched function being called. */
  callee: string;
  file: string;
  line: number;
  site: Site;
}

const keyOf = (file: string, name: string) => `${file}::${name}`;

/** Resolve an import specifier from `fromFile` to a repo-relative module path
 *  (extension-less match against `files`), or null for a package import. */
function resolveModule(spec: string, fromFile: string, files: ReadonlySet<string>): string | null {
  let base: string;
  if (spec.startsWith("@library/")) base = `library/${spec.slice("@library/".length)}`;
  else if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  else return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (files.has(base + ext)) return base + ext;
  }
  return null;
}

/** localName → `file::exportedName` for every binding the file can call. */
function bindings(sf: ts.SourceFile, file: string, files: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  const bindFrom = (spec: string, local: string, imported: string) => {
    const mod = resolveModule(spec, file, files);
    if (mod) out.set(local, keyOf(mod, imported));
  };
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const named = n.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          bindFrom(n.moduleSpecifier.text, el.name.text, (el.propertyName ?? el.name).text);
        }
      }
    }
    // const { a, b } = await import("./x")
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer) {
      let init: ts.Expression = n.initializer;
      if (ts.isAwaitExpression(init)) init = init.expression;
      if (
        ts.isCallExpression(init) &&
        init.expression.kind === ts.SyntaxKind.ImportKeyword &&
        init.arguments[0] &&
        ts.isStringLiteral(init.arguments[0])
      ) {
        for (const el of n.name.elements) {
          if (!ts.isIdentifier(el.name)) continue;
          const imported = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
          bindFrom(init.arguments[0].text, el.name.text, imported);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  // Local declarations shadow nothing we care about but bind the file's own
  // functions, so an in-file call of a watched function is seen too.
  const local = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name) out.set(n.name.text, keyOf(file, n.name.text));
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && functionOf(n.initializer)) {
      out.set(n.name.text, keyOf(file, n.name.text));
    }
    ts.forEachChild(n, local);
  };
  local(sf);
  return out;
}

/** The function an initializer defines: `() => …`, `function …`, or
 *  `useCallback(() => …, deps)`. */
function functionOf(e: ts.Expression): ts.FunctionLikeDeclaration | null {
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return e;
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "useCallback") {
    const f = e.arguments[0];
    if (f && (ts.isArrowFunction(f) || ts.isFunctionExpression(f))) return f;
  }
  return null;
}

const isFn = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isConstructorDeclaration(n);

/** Where does the rejection of `call` end? */
export function classify(call: ts.CallExpression, file: string): Site {
  let node: ts.Node = call;
  let mode: "promise" | "throw" = "promise";
  for (let guard = 0; guard < 200; guard++) {
    const p = node.parent;
    if (!p) return { kind: "unknown", why: "reached the top of the file" };
    if (mode === "throw") {
      if (ts.isTryStatement(p) && p.tryBlock === node) return { kind: "guarded" };
      if (isFn(p)) {
        const next = leaveFunction(p, file);
        if (next.kind !== "continue") return next;
        node = next.node;
        mode = "promise";
        continue;
      }
      node = p;
      continue;
    }
    // promise mode: who consumes the promise `node`?
    if (ts.isParenthesizedExpression(p) || ts.isArrayLiteralExpression(p) || ts.isAsExpression(p)) {
      node = p;
      continue;
    }
    if (ts.isAwaitExpression(p)) {
      node = p;
      mode = "throw";
      continue;
    }
    if (ts.isPropertyAccessExpression(p) && p.expression === node) {
      const c = p.parent;
      if (!ts.isCallExpression(c) || c.expression !== p) {
        return { kind: "unknown", why: `property .${p.name.text} read off a pending promise` };
      }
      const m = p.name.text;
      if (m === "catch") return { kind: "guarded" };
      if (m === "then") {
        if (c.arguments.length >= 2) return { kind: "guarded" };
        node = c;
        continue;
      }
      if (m === "finally") {
        node = c;
        continue;
      }
      return { kind: "unknown", why: `.${m}() on a pending promise` };
    }
    if (ts.isVoidExpression(p) || ts.isExpressionStatement(p)) return { kind: "floating" };
    if (ts.isCallExpression(p) && p.arguments.some((a) => a === node)) {
      // Handed to a receiver (`Promise.all`, a perf wrapper): the receiver's
      // result carries the rejection.
      node = p;
      continue;
    }
    if (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === node)) {
      const fn = ts.isReturnStatement(p) ? enclosingFn(p) : p;
      if (!fn) return { kind: "unknown", why: "return outside a function" };
      const next = leaveFunction(fn, file);
      if (next.kind !== "continue") return next;
      node = next.node;
      continue;
    }
    return { kind: "unknown", why: `promise consumed by a ${ts.SyntaxKind[p.kind]}` };
  }
  return { kind: "unknown", why: "flow too deep" };
}

function enclosingFn(n: ts.Node): ts.FunctionLikeDeclaration | null {
  for (let p = n.parent; p; p = p.parent) if (isFn(p)) return p;
  return null;
}

/** The function `fn` now returns a rejecting promise. Either it has a NAME
 *  (→ propagates to its callers) or it is anonymous and its promise flows on
 *  from the expression that holds it (an IIFE, a callback argument). */
function leaveFunction(
  fn: ts.FunctionLikeDeclaration,
  file: string,
): Site | { kind: "continue"; node: ts.Node } {
  if (ts.isFunctionDeclaration(fn) && fn.name) return { kind: "propagates", key: keyOf(file, fn.name.text) };
  if (ts.isMethodDeclaration(fn) && ts.isIdentifier(fn.name)) {
    return { kind: "propagates", key: keyOf(file, fn.name.text) };
  }
  let holder: ts.Node = fn;
  while (ts.isParenthesizedExpression(holder.parent)) holder = holder.parent;
  const p = holder.parent;
  if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
    return { kind: "propagates", key: keyOf(file, p.name.text) };
  }
  if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
    return { kind: "propagates", key: keyOf(file, p.name.text) };
  }
  if (ts.isCallExpression(p)) {
    // `useCallback(fn, deps)` bound to a name is that name.
    if (
      ts.isIdentifier(p.expression) &&
      p.expression.text === "useCallback" &&
      ts.isVariableDeclaration(p.parent) &&
      ts.isIdentifier(p.parent.name)
    ) {
      return { kind: "propagates", key: keyOf(file, p.parent.name.text) };
    }
    // An IIFE, or an anonymous callback: the call's result carries it on.
    return { kind: "continue", node: p };
  }
  return { kind: "unknown", why: `anonymous function held by a ${ts.SyntaxKind[p.kind]}` };
}

export interface ScanInput {
  /** repo-relative path → source text. */
  files: Record<string, string>;
  /** `file::name` → why it may propagate a rejection to its callers (which
   *  are then traced in turn). */
  propagators: Record<string, string>;
  /** `file::name` → why its callers are NOT traced (a terminal: e.g. a writer
   *  whose callers already handle the rejections writes always had). */
  terminals: Record<string, string>;
}

export interface ScanResult {
  hits: Hit[];
  /** Human-readable violations; empty = the census passes. */
  violations: string[];
  /** Every key traced (door readers + door functions + ledgered propagators). */
  traced: string[];
}

export function scanReadDoorCallers(input: ScanInput): ScanResult {
  const fileSet = new Set(Object.keys(input.files));
  const parsed = Object.entries(input.files).map(([file, text]) => {
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    return { file, sf, binds: bindings(sf, file, fileSet) };
  });

  const watched = new Set(READ_PRIMITIVES.map((n) => keyOf(DOOR, n)));
  const queue = [...watched];
  const hits: Hit[] = [];
  const violations: string[] = [];
  const reported = new Set<string>();

  while (queue.length > 0) {
    const target = queue.shift()!;
    for (const { file, sf, binds } of parsed) {
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && binds.get(n.expression.text) === target) {
          const site = classify(n, file);
          const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
          hits.push({ callee: target, file, line, site });
          const at = `${file}:${line} ${n.expression.text}(…)`;
          if (site.kind === "floating") {
            violations.push(`${at} — FLOATING: a rejection nobody handles (add .catch / a try)`);
          } else if (site.kind === "unknown") {
            violations.push(`${at} — UNTRACEABLE: ${site.why}`);
          } else if (site.kind === "propagates" && !watched.has(site.key)) {
            const inDoor = site.key.startsWith(`${DOOR}::`);
            if (inDoor || site.key in input.propagators) {
              watched.add(site.key);
              queue.push(site.key);
            } else if (site.key in input.terminals) {
              watched.add(site.key);
            } else if (!reported.has(site.key)) {
              reported.add(site.key);
              violations.push(
                `${at} — UNDECLARED PROPAGATOR ${site.key}: catch the failure inside it, or ledger it ` +
                  `(propagators/terminals) saying what its callers do with a rejection`,
              );
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }
  // A ledger row nothing reaches is stale doctrine.
  for (const key of [...Object.keys(input.propagators), ...Object.keys(input.terminals)]) {
    if (!watched.has(key)) violations.push(`STALE LEDGER ROW ${key}: no traced rejection reaches it`);
  }
  return { hits, violations, traced: [...watched].sort() };
}

/** The census's scope: every production TS/TSX file of the Library silo. */
export function libraryProductionFiles(walk: (root: string) => string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const root of ["library/components", "library/hooks", "library/lib", "src/components/library"]) {
    for (const abs of walk(path.join(REPO, root))) {
      const rel = path.relative(REPO, abs).split(path.sep).join("/");
      if (!/\.tsx?$/.test(rel) || rel.endsWith(".d.ts")) continue;
      if (rel.includes("/__tests__/") || /\.test\.tsx?$/.test(rel)) continue;
      out[rel] = fs.readFileSync(abs, "utf8");
    }
  }
  return out;
}
