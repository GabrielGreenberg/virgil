/**
 * Task 535 — the PRINT **CHROME** POSTURE, the third hook on the vocabulary
 * that already had two (`print-fold-posture.test.ts` for the HIDE half,
 * `print-view-only-posture.test.ts` for the PAINT half).
 *
 * The law all three enforce, stated once in `src/lib/print.ts`:
 *
 *   **WHAT PRINTS IS THE DOCUMENT, NOT THE EDITOR'S CURRENT STATE.**
 *
 * WHY A THIRD CENSUS, AND WHY THE SECOND COULD NOT SEE THIS. Task 523's
 * population is *every production file that constructs a PM decoration* —
 * the literal `Decoration.(inline|node|widget)(` call form. **A NodeView
 * constructs no decoration. It renders JSX (or builds DOM by hand).** So the
 * third generation of the same hole is the chrome a NodeView paints beside
 * the node it renders, and the figure NodeView paints more of it than
 * anything else in the app: a "Choose image…" button, "or click anywhere to
 * edit code", a "Figure not found: …" line in danger red, "Loading …", the
 * empty state's `×`, and the blue label lozenge — all reaching paper, through
 * both print doors, while the lozenge's exact twin `.heading-annotation` sat
 * on a two-item HAND LIST in the print block whose own comment said a hand
 * list was the thing it existed to replace.
 *
 * So this census asks the QUESTION over a population DISCOVERED from what
 * actually paints editor-only chrome into `.ProseMirror`: **every NodeView
 * surface — the vanilla `addNodeView` bodies and the React components a
 * `ReactNodeViewRenderer` mounts, plus what those components render — and
 * within each, every element that is CHROME-SHAPED (a control, or a run of
 * static UI copy that is not the node's content). Each such element is
 * either DECLARED chrome-only (`chromeOnly(<class>)` on itself or on an
 * ancestor), or it carries a class on the small reviewed allowlist that
 * states why it is DOCUMENT content.** A hit is COVER-it.
 *
 * "Chrome-shaped" is derived from two signals, and both are needed: an
 * AFFORDANCE (a `<button>`/`<input>`, a click/press handler, `role="button"`,
 * a `data-hint`) and STATIC COPY (a text run the
 * source spells as a literal — "Choose image…", "Loading …" — rather than
 * reads out of the node). The first alone misses "Figure not found"; the
 * second alone misses the `×`. A NodeView's ROOT (the `NodeViewWrapper`, the
 * `dom` a vanilla view returns) is never chrome-shaped: it IS the node, and
 * it legitimately carries click handlers (`handleBodyClick`) and text.
 *
 * WHY IT IS CSS-SHAPED — inherited from both siblings: jsdom implements no
 * media queries and no cascade origins, so "does this paint on paper?" is not
 * a question it can answer. What IS assertable is the MECHANISM, and the
 * mechanism is the whole finding.
 *
 * STATED LIMITS. The React closure follows `.tsx` imports from each NodeView
 * component and stops at a file that PORTALS or mounts a `SystemDialog` —
 * a dialog is on screen only while open and is its own print question, not
 * NodeView chrome. Vanilla ancestry is resolved from `appendChild`/`append`/
 * `prepend`/`insertBefore` statements within one `addNodeView` region, so an
 * element appended through a helper that takes the parent as a PARAMETER
 * resolves to no ancestor and must carry its own stamp (`math-placeholder`
 * is exactly that shape, and is stamped). And static copy is recognised by
 * LETTERS: a glyph-only control (`×`, `#`, `(1)`) is caught only by the
 * affordance half, so a glyph-only, handler-less, hint-less span would be
 * invisible here — the same limit the subscriber census states about its
 * callbacks. `aria-hidden` is deliberately NOT a signal: it marks what a
 * screen reader skips, and that is true of the forest tree's edge layer and
 * of the pod's PAPER body itself — document content both. The invisible
 * row sensor it would have caught is pinned by name instead.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  cssCommentsStripped,
  commentsStripped,
  tagEnd,
  trackedFiles,
  REPO_ROOT,
} from "./_source-scan";
import { CHROME_ONLY_CLASS, chromeOnly } from "@/lib/view-only-chrome";

const CSS = cssCommentsStripped(readFileSync(join(REPO_ROOT, "src/app/globals.css"), "utf8"));

/** Everything from `@media print {` to the end of the file. */
const PRINT_BLOCK = CSS.slice(CSS.indexOf("@media print"));

const IDENT = "[A-Za-z_$][\\w$]*";

/* ── population: every NodeView surface in either silo ────────────────────── */

function readRel(rel: string): string {
  return commentsStripped(readFileSync(join(REPO_ROOT, rel), "utf8"));
}

function productionFiles(): string[] {
  const out: string[] = [];
  for (const root of ["src", "library"]) {
    for (const abs of trackedFiles(root, /\.tsx?$/)) {
      if (/__tests__|\.test\.tsx?$/.test(abs)) continue;
      out.push(abs.slice(REPO_ROOT.length + 1));
    }
  }
  return out;
}

/** Resolve an import specifier from `fromRel` to a tracked repo-relative path. */
function resolveImport(fromRel: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(fromRel), spec);
  else return null;
  base = resolve(REPO_ROOT, base).slice(REPO_ROOT.length + 1);
  for (const cand of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(join(REPO_ROOT, cand)) && /\.tsx?$/.test(cand)) return cand;
  }
  return null;
}

/** `{ ident → spec }` for every import in the file. */
function importsOf(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/import\s+(?:type\s+)?([^'"]+?)\s+from\s+["']([^"']+)["']/g)) {
    const clause = m[1];
    const spec = m[2];
    const def = clause.match(new RegExp(`^(${IDENT})`));
    if (def) out.set(def[1], spec);
    const named = clause.match(/\{([^}]*)\}/);
    if (named) {
      for (const part of named[1].split(",")) {
        const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
        if (name) out.set(name, spec);
      }
    }
  }
  return out;
}

const POPULATION = (() => {
  const files = productionFiles();
  const vanilla: string[] = [];
  const react = new Set<string>();
  for (const rel of files) {
    const src = readRel(rel);
    if (!/\baddNodeView\s*\(/.test(src)) continue;
    // A vanilla view builds DOM by hand; a React one only names a component.
    if (/document\.createElement\(/.test(src)) vanilla.push(rel);
    const imports = importsOf(src);
    for (const m of src.matchAll(new RegExp(`ReactNodeViewRenderer\\(\\s*(${IDENT})`, "g"))) {
      const ident = m[1];
      if (new RegExp(`function\\s+${ident}\\b`).test(src)) react.add(rel);
      else {
        const spec = imports.get(ident);
        const target = spec ? resolveImport(rel, spec) : null;
        if (target) react.add(target);
      }
    }
  }
  // Closure over what a React surface RENDERS: every `.tsx` it imports, to a
  // fixed point. A file that portals or mounts a SystemDialog is a floating
  // SURFACE of its own (a dialog prints only if it is open at print time,
  // which is a different question) and is dropped with that reason.
  const queue = [...react];
  while (queue.length) {
    const rel = queue.pop()!;
    const src = readRel(rel);
    for (const spec of new Set(importsOf(src).values())) {
      const target = resolveImport(rel, spec);
      if (!target || !target.endsWith(".tsx") || react.has(target)) continue;
      const tsrc = readRel(target);
      if (/createPortal\(|<SystemDialog\b/.test(tsrc)) continue;
      react.add(target);
      queue.push(target);
    }
  }
  return { vanilla: vanilla.sort(), react: [...react].sort() };
})();

/* ── the allowlist: chrome-SHAPED elements that are DOCUMENT content ─────── */

/**
 * A claim, not an escape hatch: every entry names a class that a chrome-shaped
 * element carries and states why what it renders belongs on paper. A hit that
 * is NOT document content is COVER-it (`chromeOnly(<class>)`), never an entry.
 */
const DOCUMENT_CONTENT_CLASSES: Record<string, string> = {
  "figure-caption-label":
    "the `Figure N:` prefix LaTeX itself typesets in front of a caption",
  "par-title-annotation":
    "a paragraph title is the user's own writing (sidecar-carried) and prints; " +
    "its `+T` / `×` / input CHILDREN are chrome and carry their own stamp",
  "par-title-text": "the title text itself — click-to-edit is how it is EDITED, not what it is",
  "source-pod-derived":
    "the DERIVED body — a rendered forest tree — is the document's own picture " +
    "on paper (its frame is flattened by a print rule); click-to-edit is how it " +
    "is edited, not what it is",
};

/* ── React surfaces: chrome-shaped JSX elements ───────────────────────────── */

interface JsxHit {
  rel: string;
  line: number;
  name: string;
  tag: string;
  start: number;
  /** Index just past the close tag (or past a self-closing tag). */
  end: number;
  classes: string[];
  shaped: string[];
}

/** Skip a balanced `{ … }` starting at `i` (which must be `{`). */
function skipBraces(src: string, i: number): number {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      j++;
      while (j < src.length && src[j] !== q) {
        if (src[j] === "\\") j++;
        j++;
      }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return src.length;
}

/** The index just past the element opened at `start` (its tag ends at `tagClose`). */
function elementEnd(src: string, start: number, tagClose: number, name: string): number {
  if (src[tagClose - 1] === "/") return tagClose + 1;
  const step = new RegExp(`</?${name.replace(/\./g, "\\.")}(?![\\w.-])`, "g");
  let depth = 1;
  step.lastIndex = tagClose + 1;
  let m: RegExpExecArray | null;
  while ((m = step.exec(src))) {
    if (m[0].startsWith("</")) {
      depth--;
      if (depth === 0) return src.indexOf(">", m.index) + 1;
      continue;
    }
    const end = tagEnd(src, m.index);
    if (end < 0) return src.length;
    if (src[end - 1] !== "/") depth++;
    step.lastIndex = end;
  }
  return src.length;
}

/** The element's DIRECT text: expressions and nested elements removed. */
function directText(src: string, from: number, to: number): string {
  let out = "";
  let i = from;
  while (i < to) {
    const c = src[i];
    if (c === "{") {
      i = skipBraces(src, i);
      continue;
    }
    if (c === "<") {
      const nxt = src[i + 1] ?? "";
      if (/[A-Za-z]/.test(nxt)) {
        const close = tagEnd(src, i);
        if (close < 0) break;
        const name = /^<([A-Za-z][\w.-]*)/.exec(src.slice(i))?.[1] ?? "";
        i = elementEnd(src, i, close, name);
        continue;
      }
      if (nxt === "/" || nxt === ">") {
        // A stray close (the caller's own) or a fragment — stop / skip.
        const gt = src.indexOf(">", i);
        i = gt < 0 ? to : gt + 1;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

/** Every class literal inside the tag's `className=` value. */
function classesInTag(tag: string): string[] {
  const at = tag.search(/\bclassName\s*=/);
  if (at < 0) return [];
  const eq = tag.indexOf("=", at);
  let value: string;
  const first = tag[eq + 1];
  if (first === '"') value = tag.slice(eq + 1, tag.indexOf('"', eq + 2) + 1);
  else if (first === "{") value = tag.slice(eq + 1, skipBraces(tag, eq + 1));
  else return [];
  const out: string[] = [];
  for (const lit of value.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    const text = (lit[1] ?? lit[2] ?? lit[3]).replace(/\$\{[^}]*\}/g, " ");
    out.push(...text.split(/\s+/).filter(Boolean));
  }
  return out;
}

const AFFORDANCE_TAGS = new Set(["button", "input", "textarea", "select"]);
const ROOT_TAGS = new Set(["NodeViewWrapper", "NodeViewContent"]);

function jsxHits(rel: string): JsxHit[] {
  const src = readRel(rel);
  const out: JsxHit[] = [];
  const open = /<([A-Za-z][\w.-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(src))) {
    const name = m[1];
    // Generics (`useState<Foo>`) and comparisons never open a JSX tag with a
    // preceding identifier character; a real tag follows `(`, `{`, `>`,
    // whitespace or a line start.
    const before = src[m.index - 1] ?? "\n";
    if (/[\w$]/.test(before)) continue;
    const close = tagEnd(src, m.index);
    if (close < 0) continue;
    const tag = src.slice(m.index, close + 1);
    const end = elementEnd(src, m.index, close, name);
    const shaped: string[] = [];
    if (!ROOT_TAGS.has(name)) {
      if (AFFORDANCE_TAGS.has(name)) shaped.push(`<${name}>`);
      if (/\bon(?:Click|MouseDown|PointerDown|DoubleClick|KeyDown)\s*=/.test(tag)) shaped.push("handler");
      if (/\brole=["']button["']/.test(tag)) shaped.push("role=button");
      if (/\bdata-hint\s*=/.test(tag)) shaped.push("data-hint");
      if (src[close - 1] !== "/") {
        const text = directText(src, close + 1, end);
        if (/[A-Za-z]{2,}/.test(text)) shaped.push(`copy ${JSON.stringify(text.trim().slice(0, 40))}`);
      }
    }
    out.push({
      rel,
      line: src.slice(0, m.index).split("\n").length,
      name,
      tag,
      start: m.index,
      end,
      classes: classesInTag(tag),
      shaped,
    });
    open.lastIndex = close;
  }
  return out;
}

function reactUncovered(): string[] {
  const out: string[] = [];
  for (const rel of POPULATION.react) {
    const hits = jsxHits(rel);
    const stamped = hits.filter((h) => /\bchromeOnly\s*\(/.test(h.tag));
    for (const h of hits) {
      if (h.shaped.length === 0) continue;
      if (/\bchromeOnly\s*\(/.test(h.tag)) continue;
      if (stamped.some((s) => s.start < h.start && h.end <= s.end)) continue;
      if (h.classes.some((c) => c in DOCUMENT_CONTENT_CLASSES)) continue;
      out.push(`${rel}:${h.line} <${h.name} …> [${h.shaped.join(", ")}] classes=${JSON.stringify(h.classes)}`);
    }
  }
  return out;
}

/* ── vanilla surfaces: chrome-shaped DOM elements per addNodeView region ─── */

interface DomHit {
  rel: string;
  line: number;
  name: string;
  classes: string[];
  shaped: string[];
  stamped: boolean;
  covered: boolean;
}

/** Does a same-file literal declaration named `ident` hold a word? */
function identHoldsCopy(fileSrc: string, ident: string): boolean {
  const m = fileSrc.match(new RegExp(`\\b(?:const|let)\\s+${ident}\\b[^=]*=\\s*(["'\`{\\[])`));
  if (!m) return false;
  const at = fileSrc.indexOf(m[1], m.index! + m[0].length - 1);
  const body = m[1] === "{" || m[1] === "[" ? fileSrc.slice(at, skipBraces(fileSrc, at)) : fileSrc.slice(at, at + 200);
  return /["'`][^"'`]*[A-Za-z]{2,}[^"'`]*["'`]/.test(body);
}

function rhsIsCopy(fileSrc: string, rhs: string): boolean {
  // Any string literal in the expression that spells a word — a ternary's arm
  // (`displayMode ? "( empty display math )" : "( empty math )"`) is copy as
  // much as a bare literal is. `${…}` holes are blanked first.
  for (const lit of rhs.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    const text = (lit[1] ?? lit[2] ?? lit[3]).replace(/\$\{[^}]*\}/g, " ");
    if (/[A-Za-z]{2,}/.test(text)) return true;
  }
  for (const id of rhs.matchAll(new RegExp(`\\b(${IDENT})\\b`, "g"))) {
    if (/^[A-Z][A-Z0-9_]+$/.test(id[1]) && identHoldsCopy(fileSrc, id[1])) return true;
  }
  return false;
}

function domHits(rel: string): DomHit[] {
  const src = readRel(rel);
  const out: DomHit[] = [];
  // Regions: everything before the first `addNodeView(` (module helpers such
  // as `renderMath`), then one region per view.
  const bounds = [0, ...[...src.matchAll(/\baddNodeView\s*\(/g)].map((m) => m.index!), src.length];
  for (let r = 0; r + 1 < bounds.length; r++) {
    const region = src.slice(bounds[r], bounds[r + 1]);
    const offset = bounds[r];
    const parents = new Map<string, string>();
    for (const m of region.matchAll(
      new RegExp(`\\b(${IDENT})\\.(?:appendChild|append|prepend|replaceChildren)\\(([^)]*)\\)`, "g"),
    )) {
      for (const child of m[2].matchAll(new RegExp(`\\b(${IDENT})\\b`, "g"))) {
        if (!parents.has(child[1])) parents.set(child[1], m[1]);
      }
    }
    for (const m of region.matchAll(new RegExp(`\\b(${IDENT})\\.insertBefore\\(\\s*(${IDENT})`, "g"))) {
      if (!parents.has(m[2])) parents.set(m[2], m[1]);
    }
    const roots = new Set<string>();
    for (const m of region.matchAll(new RegExp(`\\b(?:dom|contentDOM)\\s*:\\s*(${IDENT})`, "g"))) roots.add(m[1]);
    if (/\{\s*dom\s*[,}]|,\s*dom\s*[,}]/.test(region)) roots.add("dom");
    if (/\bcontentDOM\s*[,}]/.test(region)) roots.add("contentDOM");

    const elements = [
      ...region.matchAll(new RegExp(`\\b(${IDENT})\\s*=\\s*document\\.createElement\\(\\s*(?:"([^"]+)"|[^)]+)\\)`, "g")),
    ];
    const stampedOf = (v: string) =>
      new RegExp(`\\b${v}\\.className\\s*=\\s*chromeOnly\\s*\\(`).test(region);
    for (const m of elements) {
      const v = m[1];
      const tagName = m[2] ?? "?";
      if (roots.has(v)) continue;
      const classes: string[] = [];
      for (const c of region.matchAll(new RegExp(`\\b${v}\\.className\\s*=\\s*(?:chromeOnly\\s*\\()?\\s*(?:"([^"]*)"|\`([^\`]*)\`)`, "g"))) {
        classes.push(...(c[1] ?? c[2]).replace(/\$\{[^}]*\}/g, " ").split(/\s+/).filter(Boolean));
      }
      for (const c of region.matchAll(new RegExp(`\\b${v}\\.classList\\.add\\(([^)]*)\\)`, "g"))) {
        for (const lit of c[1].matchAll(/"([^"]*)"/g)) classes.push(...lit[1].split(/\s+/).filter(Boolean));
      }
      const shaped: string[] = [];
      if (AFFORDANCE_TAGS.has(tagName)) shaped.push(`<${tagName}>`);
      if (new RegExp(`\\b${v}\\.addEventListener\\(\\s*"(?:click|mousedown|pointerdown|dblclick)"`).test(region)) shaped.push("handler");
      if (new RegExp(`\\b${v}\\.onclick\\s*=`).test(region)) shaped.push("handler");
      if (new RegExp(`\\b${v}\\.(?:title|dataset\\.hint)\\s*=`).test(region)) shaped.push("hint");
      if (new RegExp(`\\b${v}\\.setAttribute\\(\\s*"role"\\s*,\\s*"button"`).test(region)) shaped.push("role=button");
      for (const t of region.matchAll(new RegExp(`\\b${v}\\.(?:textContent|innerHTML|innerText)\\s*=\\s*([^;\\n]+)`, "g"))) {
        if (rhsIsCopy(src, t[1])) {
          shaped.push(`copy ${JSON.stringify(t[1].trim().slice(0, 40))}`);
          break;
        }
      }
      let covered = stampedOf(v);
      let cur = v;
      const seen = new Set<string>();
      while (!covered && parents.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        cur = parents.get(cur)!;
        if (stampedOf(cur)) covered = true;
      }
      out.push({
        rel,
        line: src.slice(0, offset + m.index!).split("\n").length,
        name: v,
        classes,
        shaped,
        stamped: stampedOf(v),
        covered,
      });
    }
  }
  return out;
}

function vanillaUncovered(): string[] {
  const out: string[] = [];
  for (const rel of POPULATION.vanilla) {
    for (const h of domHits(rel)) {
      if (h.shaped.length === 0 || h.covered) continue;
      if (h.classes.some((c) => c in DOCUMENT_CONTENT_CLASSES)) continue;
      out.push(`${rel}:${h.line} ${h.name} [${h.shaped.join(", ")}] classes=${JSON.stringify(h.classes)}`);
    }
  }
  return out;
}

/** Every class a stamped element carries, across both shapes. */
function stampedClasses(): Set<string> {
  const out = new Set<string>();
  for (const rel of POPULATION.react) {
    for (const h of jsxHits(rel)) if (/\bchromeOnly\s*\(/.test(h.tag)) h.classes.forEach((c) => out.add(c));
  }
  for (const rel of POPULATION.vanilla) {
    for (const h of domHits(rel)) if (h.stamped) h.classes.forEach((c) => out.add(c));
  }
  return out;
}

/** Every class carried by a chrome-shaped element (stamped or not). */
function shapedClasses(): Set<string> {
  const out = new Set<string>();
  for (const rel of POPULATION.react) {
    for (const h of jsxHits(rel)) if (h.shaped.length) h.classes.forEach((c) => out.add(c));
  }
  for (const rel of POPULATION.vanilla) {
    for (const h of domHits(rel)) if (h.shaped.length) h.classes.forEach((c) => out.add(c));
  }
  return out;
}

/* ── legs ────────────────────────────────────────────────────────────────── */

describe("the chrome-only census — population", () => {
  it("discovers both shapes of NodeView surface", () => {
    // Floors that prove the discovery WORKS; a needle matching nothing would
    // make every leg below vacuous. The TRUE current counts, so a discovery
    // that silently stopped seeing a file cannot clear a loose bar.
    expect(POPULATION.vanilla.length).toBeGreaterThanOrEqual(8);
    expect(POPULATION.react.length).toBeGreaterThanOrEqual(6);
    expect(POPULATION.react).toContain("src/components/FigureBlockNodeView.tsx");
    expect(POPULATION.react).toContain("src/components/FigureAnnotation.tsx");
    expect(POPULATION.react).toContain("src/components/SourcePodNodeView.tsx");
    expect(POPULATION.react).toContain("src/components/ForestRefusalBadge.tsx");
    expect(POPULATION.vanilla).toContain("src/lib/editor-extensions.ts");
    expect(POPULATION.vanilla).toContain("src/lib/tiptap/title.ts");
    expect(POPULATION.vanilla).toContain("src/lib/tiptap/expex.ts");
  });

  it("the JSX scanner sees the figure family's chrome shapes", () => {
    // The resolver's own canary: the six members the task measured must be
    // chrome-SHAPED under this scanner, or the coverage leg below could pass
    // on a scanner that reads them as inert.
    const hits = jsxHits("src/components/FigureBlockNodeView.tsx");
    const shapedOf = (cls: string) =>
      hits.filter((h) => h.classes.includes(cls)).flatMap((h) => h.shaped);
    expect(shapedOf("figure-empty-cta")).toContain("<button>");
    expect(shapedOf("figure-empty-hint").join(" ")).toMatch(/copy/);
    expect(shapedOf("figure-placeholder").join(" ")).toMatch(/copy/);
    expect(shapedOf("figure-error").join(" ")).toMatch(/copy/);
    expect(shapedOf("figure-scale-btn")).toContain("<button>");
    // RENEGOTIATED (task 536): the lozenge's `×` was a `<span role="button">`
    // and is a real `<button>` now — the shape this scanner reads as
    // `<button>`. The `role=button` needle stays in the scanner for the next
    // hand-rolled control; `role-button-census.test.ts` is what keeps that
    // needle from ever matching production again.
    const loz = jsxHits("src/components/FigureAnnotation.tsx");
    expect(loz.filter((h) => h.classes.includes("figure-annotation-delete")).flatMap((h) => h.shaped)).toContain(
      "<button>",
    );
  });
});

describe("the chrome-only census — every chrome-shaped element is declared or content", () => {
  it("React NodeView surfaces", () => {
    expect(
      reactUncovered(),
      "COVER it: stamp `chromeOnly(<class>)` on the element (or its chrome " +
        "container), or add its class to DOCUMENT_CONTENT_CLASSES with a stated " +
        "reason it belongs on paper",
    ).toEqual([]);
  });

  it("vanilla NodeView surfaces", () => {
    expect(
      vanillaUncovered(),
      "COVER it: `el.className = chromeOnly(\"<class>\")` on the element (or the " +
        "container it is appended to), or add its class to " +
        "DOCUMENT_CONTENT_CLASSES with a stated reason",
    ).toEqual([]);
  });

  it("every allowlist entry still excuses a live chrome-shaped element", () => {
    // An exemption that has stopped excusing anything is a standing licence
    // for the next thing that takes its name (task 204's rule).
    const live = shapedClasses();
    const stale = Object.keys(DOCUMENT_CONTENT_CLASSES).filter((c) => !live.has(c));
    expect(stale, "DELETE these — no chrome-shaped element carries them any more").toEqual([]);
  });

  it("no allowlisted class is ALSO stamped chrome-only", () => {
    // One answer per class: an element cannot be document content and
    // editor chrome at once.
    const both = [...stampedClasses()].filter((c) => c in DOCUMENT_CONTENT_CLASSES);
    expect(both).toEqual([]);
  });

  it("names the figure family on the pre-fix tree", () => {
    // Measured by neutering: with the six stamps removed from
    // `FigureBlockNodeView.tsx` / `FigureAnnotation.tsx` the React leg above
    // names every member. This leg keeps that claim honest by pinning the
    // coverage table the task measured — each member carries the marker.
    const stamped = stampedClasses();
    for (const cls of [
      "figure-annotation",
      "figure-empty-stack",
      "figure-chrome",
      "figure-placeholder",
      "figure-error",
    ]) {
      expect(stamped.has(cls), `\`.${cls}\` is not stamped chrome-only`).toBe(true);
    }
  });

  it("the former hand list and the pod trio are members like the rest", () => {
    const stamped = stampedClasses();
    for (const cls of [
      "heading-annotation",
      "title-field-annotation",
      "source-pod-corner",
      "source-pod-fold-chevron",
      "source-pod-row-sensor",
      "forest-refusal-badge",
      "heading-fold-chevron",
    ]) {
      expect(stamped.has(cls), `\`.${cls}\` is not stamped chrome-only`).toBe(true);
    }
  });
});

describe("the print block carries ONE rule for the marker", () => {
  it("hides the marker with `display: none !important`", () => {
    const at = PRINT_BLOCK.indexOf(`.${CHROME_ONLY_CLASS}`);
    expect(at, "the print block never names the chrome-only marker").toBeGreaterThan(-1);
    const body = PRINT_BLOCK.slice(PRINT_BLOCK.indexOf("{", at), PRINT_BLOCK.indexOf("}", at));
    // `display: none`, not the view-only de-paint: a "Choose image…" button
    // with no background is still a button reading "Choose image…".
    expect(body).toMatch(/display:\s*none\s*!important/);
  });

  it("the marker has NO screen rule, so stamping it restyles nothing", () => {
    const outside = CSS.slice(0, CSS.indexOf("@media print"));
    expect(outside).not.toContain(`.${CHROME_ONLY_CLASS}`);
  });

  it("nothing a stamped element carries is ALSO hidden by name — no hand list", () => {
    // The rule the print block wrote about itself and then broke: "anything
    // ADDED here is a hand list of the kind the rule above exists to replace".
    // With the marker, a class hidden BY NAME in the print block is a second
    // spelling of the same posture, and the one that drifts.
    const rules = [...PRINT_BLOCK.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const byName: string[] = [];
    for (const cls of stampedClasses()) {
      for (const r of rules) {
        if (new RegExp(`\\.${cls}(?![\\w-])`).test(r[1]) && /display\s*:\s*none/.test(r[2])) {
          byName.push(cls);
        }
      }
    }
    expect(byName, "fold these onto the marker — the writer already stamps it").toEqual([]);
  });

  it("the retired hand-list classes are not named in the print block at all", () => {
    for (const cls of [
      "heading-annotation",
      "title-field-annotation",
      "source-pod-corner",
      "source-pod-fold-chevron",
      "source-pod-row-sensor",
      "forest-refusal-badge",
      "source-pod-preview",
    ]) {
      expect(PRINT_BLOCK, `\`.${cls}\` is still spelled in @media print`).not.toMatch(
        new RegExp(`\\.${cls}(?![\\w-])`),
      );
    }
  });

  it("an EMPTY figure's root loses its drop-zone paint on paper", () => {
    // The root is the node (a `figure` env with nothing in it), so it is not
    // hidden; but its dashed box, background and 80px floor are editor paint
    // on that root — the `.citation-node` flatten shape, stated at the site.
    const m = PRINT_BLOCK.match(/\.figure-block\.figure-block-empty\s*\{([^}]*)\}/);
    expect(m, "no print flatten for the empty figure root").toBeTruthy();
    expect(m![1]).toMatch(/border:\s*0\s*!important/);
    expect(m![1]).toMatch(/min-height:\s*0\s*!important/);
    expect(m![1]).toMatch(/background:\s*none\s*!important/);
  });
});

describe("the mechanism is path-independent", () => {
  it("no chrome-only posture is keyed on `data-printing` or a print-element toggle", () => {
    // `html[data-printing]` and every `data-print-e-*` are stamped ONLY by
    // `runPrint`; the browser's own File → Print stamps nothing (408's
    // constraint on every future print change).
    for (const m of CSS.matchAll(/\[data-print(?:ing|-e-)[^\]]*\][^{]*\{[^}]*\}/g)) {
      expect(m[0]).not.toMatch(new RegExp(`${CHROME_ONLY_CLASS}|figure-annotation|figure-chrome|figure-empty`));
    }
  });
});

describe("the vocabulary", () => {
  it("`chromeOnly()` composes the marker after the caller's own class", () => {
    expect(chromeOnly("x")).toBe(`x ${CHROME_ONLY_CLASS}`);
  });

  it("`view-only-chrome.ts` still imports nothing", () => {
    const src = readFileSync(join(REPO_ROOT, "src/lib/view-only-chrome.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
