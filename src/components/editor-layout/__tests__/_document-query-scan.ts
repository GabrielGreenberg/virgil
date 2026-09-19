/**
 * Task 600 — the AST needle for `pane-dom-census.test.ts`.
 *
 * Not a suite (vitest collects only `*.test.{ts,tsx}`); the census imports it.
 *
 * The census used to find a document-global DOM query with a REGEX over source
 * text and then substring-test the captured argument for a marker name. That
 * reads SPELLING, not meaning, so the same violation walked through it written
 * any of these ways:
 *
 *   document.querySelector(`[${DATA_STACK_FRAME}]`)      // no literal marker
 *   document.getElementById(…)                           // method not listed
 *   const d = document; d.querySelector(…)               // aliased receiver
 *   el.ownerDocument.querySelector(…)                    // aliased receiver
 *   document.querySelector("[data-" + "dock-slot]")      // concatenation
 *   document.querySelector(`[${attrOf(x)}="${k}"]`)      // `[^)]*` truncated at the inner `)`
 *
 * So this module PARSES each file (the TypeScript compiler, already a
 * dependency) and answers two questions structurally:
 *
 *  1. RECEIVER — does the call's object RESOLVE to a document? `document`,
 *     `window.document` / `globalThis.document` / `self.document`, any
 *     `.ownerDocument`, `document.body` / `document.documentElement`, a local
 *     binding initialised to any of those, and a `x ?? document` / `x || document`
 *     / `c ? x : document` fallback (whose document arm is a global read).
 *  2. ARGUMENT — what TEXT does it fold to? String and template literals,
 *     `+` concatenation, identifiers resolved to `const` string bindings —
 *     local ones AND ones imported from another production module (relative or
 *     `@/` specifier, named or renamed) — and, since task 645, a PATH into a
 *     `const` object literal (`ATOM_REGISTRY.footnote.domIdAttr`, dotted or
 *     string-keyed, through an `as const satisfies …` declaration and across
 *     module boundaries). A part that cannot be folded (a call, a runtime
 *     value) contributes a placeholder, so the literal parts around it still
 *     count.
 *
 * STATED LIMITS — what still passes, so an empty allowlist is not read as a
 * stronger claim than it is:
 *  - a selector computed at RUNTIME (a function's return value, a `let`, a
 *    parameter, an object property reached through a NON-const binding or a
 *    computed key) contributes nothing;
 *  - an alias is resolved per FILE by name, not by scope, and only through a
 *    `const`/`let`/`var` initialiser (a parameter named `doc` that is passed
 *    `document` is invisible);
 *  - a namespace import (`import * as m`) and a re-export chain are not followed;
 *  - a DOM query reached through a non-DOM wrapper (`$(…)`, a helper that
 *    takes a selector) is out of scope — the census asks about the DOM API.
 */
import ts from "typescript";
import path from "node:path";

export const QUERY_METHODS = new Set([
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "getElementsByClassName",
  "getElementsByName",
]);

/** An unfoldable part of a selector. Never a character a marker name contains. */
export const HOLE = "\u0000";

export type DocumentQuery = {
  /** The call expression's source text, whitespace-collapsed. */
  hit: string;
  method: string;
  /** The first argument folded to text; unfoldable parts are `HOLE`. */
  selector: string;
};

type FileFacts = {
  sf: ts.SourceFile;
  /** `const NAME = <foldable>` bindings anywhere in the file, by name. */
  consts: Map<string, ts.Expression>;
  /** Locally bound name → [resolved module file, exported name]. */
  imports: Map<string, [string, string]>;
  /** Names bound to a document-valued initialiser. */
  docAliases: Set<string>;
};

const unwrap = (e: ts.Expression): ts.Expression => {
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isTypeAssertionExpression(e) ||
    ts.isSatisfiesExpression(e)
  ) {
    e = e.expression;
  }
  return e;
};

const GLOBAL_OBJECTS = new Set(["window", "globalThis", "self"]);

/** Does `e` evaluate to a Document (or a node that queries the same set)? */
function isDocumentish(e: ts.Expression, aliases: Set<string>, depth = 0): boolean {
  if (depth > 8) return false;
  e = unwrap(e);
  if (ts.isIdentifier(e)) return e.text === "document" || aliases.has(e.text);
  if (ts.isPropertyAccessExpression(e)) {
    const name = e.name.text;
    if (name === "ownerDocument") return true;
    if (name === "document") {
      const obj = unwrap(e.expression);
      return ts.isIdentifier(obj) && GLOBAL_OBJECTS.has(obj.text);
    }
    // `document.body` / `document.documentElement` resolve the same global set.
    if (name === "body" || name === "documentElement") {
      return isDocumentish(e.expression, aliases, depth + 1);
    }
    return false;
  }
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.BarBarToken
    ) {
      return (
        isDocumentish(e.left, aliases, depth + 1) ||
        isDocumentish(e.right, aliases, depth + 1)
      );
    }
    return false;
  }
  if (ts.isConditionalExpression(e)) {
    return (
      isDocumentish(e.whenTrue, aliases, depth + 1) ||
      isDocumentish(e.whenFalse, aliases, depth + 1)
    );
  }
  return false;
}

export type ModuleResolver = (fromFile: string, specifier: string) => string | null;

export class DocumentQueryScanner {
  private facts = new Map<string, FileFacts>();

  constructor(
    /** file path → source text, for every file that may be scanned or imported. */
    private readonly sources: Map<string, string>,
    private readonly resolve: ModuleResolver,
  ) {}

  private factsFor(file: string): FileFacts | null {
    const cached = this.facts.get(file);
    if (cached) return cached;
    const text = this.sources.get(file);
    if (text === undefined) return null;
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const consts = new Map<string, ts.Expression>();
    const imports = new Map<string, [string, string]>();
    const docAliases = new Set<string>();
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const list = node.parent;
        const isConst =
          ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
        if (isConst) consts.set(node.name.text, node.initializer);
        if (isDocumentish(node.initializer, docAliases)) docAliases.add(node.name.text);
      }
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        const target = this.resolve(file, node.moduleSpecifier.text);
        if (target) {
          for (const el of node.importClause.namedBindings.elements) {
            imports.set(el.name.text, [target, (el.propertyName ?? el.name).text]);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    const facts = { sf, consts, imports, docAliases };
    this.facts.set(file, facts);
    return facts;
  }

  /** Fold an expression to the text it evaluates to; `HOLE` where unknowable. */
  private fold(e: ts.Expression, file: string, depth = 0): string {
    if (depth > 12) return HOLE;
    e = unwrap(e);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) {
      let s = e.head.text;
      for (const span of e.templateSpans) {
        s += this.fold(span.expression, file, depth + 1) + span.literal.text;
      }
      return s;
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return this.fold(e.left, file, depth + 1) + this.fold(e.right, file, depth + 1);
    }
    if (ts.isIdentifier(e)) return this.foldName(e.text, file, depth + 1);
    // `REGISTRY.footnote.domIdAttr` — a path into a `const` object literal
    // (task 645). Without this, moving a selector's marker name from a literal
    // into an SSOT row makes the read INVISIBLE to the census: the fix that
    // kills one drift blinds the guard that watches another. The fold is the
    // same question as an identifier's, asked one level deeper.
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
      const resolved = this.resolveAccess(e, file, depth + 1);
      if (resolved) return this.fold(resolved.expr, resolved.file, depth + 1);
    }
    return HOLE;
  }

  /** The `const` initialiser a NAME binds to, with the file it lives in (a
   *  re-exported name resolves in its own module, so the file must travel). */
  private resolveName(
    name: string,
    file: string,
    depth: number,
  ): { expr: ts.Expression; file: string } | null {
    if (depth > 12) return null;
    const facts = this.factsFor(file);
    if (!facts) return null;
    const local = facts.consts.get(name);
    if (local) return { expr: local, file };
    const imported = facts.imports.get(name);
    if (imported) return this.resolveName(imported[1], imported[0], depth + 1);
    return null;
  }

  /** Walk `A.b.c` / `A["b"]` down to the expression it names, or null if any
   *  hop is not a `const` object literal with that key. `unwrap` already strips
   *  the `as const satisfies …` an SSOT table is typically declared with. */
  private resolveAccess(
    e: ts.Expression,
    file: string,
    depth: number,
  ): { expr: ts.Expression; file: string } | null {
    if (depth > 12) return null;
    e = unwrap(e);
    if (ts.isIdentifier(e)) return this.resolveName(e.text, file, depth + 1);

    let key: string | null = null;
    let objExpr: ts.Expression | null = null;
    if (ts.isPropertyAccessExpression(e)) {
      key = e.name.text;
      objExpr = e.expression;
    } else if (ts.isElementAccessExpression(e)) {
      const arg = unwrap(e.argumentExpression);
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        key = arg.text;
        objExpr = e.expression;
      }
    }
    if (key === null || objExpr === null) return null;

    const parent = this.resolveAccess(objExpr, file, depth + 1);
    if (!parent) return null;
    const obj = unwrap(parent.expr);
    if (!ts.isObjectLiteralExpression(obj)) return null;
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const n = prop.name;
      // `footnote:` is an Identifier; `"inline-math":` a StringLiteral.
      const propKey = ts.isIdentifier(n)
        ? n.text
        : ts.isStringLiteral(n) || ts.isNumericLiteral(n)
          ? n.text
          : null;
      if (propKey === key) return { expr: prop.initializer, file: parent.file };
    }
    return null;
  }

  private foldName(name: string, file: string, depth: number): string {
    const resolved = this.resolveName(name, file, depth);
    return resolved ? this.fold(resolved.expr, resolved.file, depth) : HOLE;
  }

  /** Every call of a DOM query method on a document-valued receiver. */
  documentQueries(file: string): DocumentQuery[] {
    const facts = this.factsFor(file);
    if (!facts) return [];
    const out: DocumentQuery[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        if (
          ts.isPropertyAccessExpression(callee) &&
          QUERY_METHODS.has(callee.name.text) &&
          isDocumentish(callee.expression, facts.docAliases)
        ) {
          const arg = node.arguments[0];
          out.push({
            hit: node.getText(facts.sf).replace(/\s+/g, " "),
            method: callee.name.text,
            selector: arg ? this.fold(arg, file) : "",
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(facts.sf);
    return out;
  }

  /** Every call to a function NAMED `callee` (any receiver), args folded and joined. */
  callsTo(file: string, callee: RegExp): Array<{ hit: string; args: string }> {
    const facts = this.factsFor(file);
    if (!facts) return [];
    const out: Array<{ hit: string; args: string }> = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const c = unwrap(node.expression);
        const name = ts.isIdentifier(c)
          ? c.text
          : ts.isPropertyAccessExpression(c)
            ? c.name.text
            : null;
        if (name && callee.test(name)) {
          out.push({
            hit: node.getText(facts.sf).replace(/\s+/g, " "),
            args: node.arguments.map((a) => this.fold(a, file)).join(HOLE),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(facts.sf);
    return out;
  }
}

/** Resolve a relative or `@/` specifier to a file present in `sources`. */
export function makeResolver(srcRoot: string, sources: Map<string, string>): ModuleResolver {
  return (fromFile, specifier) => {
    let base: string;
    if (specifier.startsWith("@/")) base = path.join(srcRoot, specifier.slice(2));
    else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
    else return null;
    for (const cand of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
    ]) {
      if (sources.has(cand)) return cand;
    }
    return null;
  };
}
