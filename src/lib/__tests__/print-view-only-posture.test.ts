/**
 * Task 523 — the PRINT **PAINT** POSTURE, the sibling of
 * `print-fold-posture.test.ts`'s HIDE half.
 *
 * The law both suites enforce, stated once in `src/lib/print.ts`:
 *
 *   **WHAT PRINTS IS THE DOCUMENT, NOT THE EDITOR'S CURRENT STATE.**
 *
 * WHY A SECOND CENSUS, AND WHY THE FIRST ONE COULD NOT SEE THIS. Task 408's
 * census discovers its population from `class:` literals inside TWO HAND-NAMED
 * FILES (`section-folding.ts`, `focus-view.ts`) and asks *does this decoration
 * HIDE something on screen?* — a census of the MECHANISM where the law is about
 * the QUESTION (task 404's own finding, one surface over). A decoration that
 * PAINTS view state is invisible to it twice: it is in neither file, and it
 * hides nothing. Ten days after 408, task 518 landed the spellchecker and its
 * red wavy underline printed — through both print doors, with `checkSpelling`
 * defaulting on, and (unlike every other member of the class) with no
 * dependency on the viewer's "Background graphics" setting, because
 * `text-decoration` is painted with the text.
 *
 * So this census asks the QUESTION, over a population DISCOVERED across the
 * whole tree: **every production ProseMirror decoration is either declared
 * view-only (and therefore neutralised by the ONE print rule), or it is a HIDE
 * class 408 already governs, or it renders DOCUMENT CONTENT and says so.**
 * A hit is COVER-it.
 *
 * WHY IT IS CSS-SHAPED — inherited verbatim from the fold suite, which states
 * it in its own header: jsdom implements no media queries, no cascade origins
 * and no `getComputedStyle` cascade, so "does this element paint on paper?" is
 * not a question it can answer at all. What IS assertable is the MECHANISM,
 * and the mechanism is the whole finding.
 *
 * STATED LIMITS, two, neither papered over. The discovered population is
 * ProseMirror decorations. View-only paint can also arrive IMPERATIVELY on live
 * editor DOM — by `classList.add` (the bib cross-highlight) or by
 * `setAttribute` (`useLinkHighlight`'s `data-link-highlight`, the reconciler's
 * Mode-B `data-card-*` path) — and THAT population is unbounded. Those three
 * are covered because each writes a name the vocabulary DECLARES, which is why
 * the attention half is keyed on names rather than on a marker; a fourth
 * imperative painter inventing a fresh hook would be invisible here, the same
 * limit the subscriber census states about its callbacks. And the discovery
 * needle is the literal `Decoration.<ctor>(` call form, so a decoration built
 * through an ALIASED import evades it — the limit the link-surface census
 * already carries, and no file in either silo aliases it today.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cssCommentsStripped, commentsStripped, strip, trackedFiles, REPO_ROOT } from "./_source-scan";
import {
  VIEW_ONLY_CLASS,
  VIEW_ONLY_ATTENTION_ATTRS,
  VIEW_ONLY_ZEROED_PROPERTIES,
  ATTENTION_COLOR_VAR,
  viewOnly,
} from "@/lib/view-only-chrome";

const CSS = cssCommentsStripped(readFileSync(join(REPO_ROOT, "src/app/globals.css"), "utf8"));

/** Everything from `@media print {` to the end of the file. */
const PRINT_BLOCK = CSS.slice(CSS.indexOf("@media print"));

/* ── population: every production file that constructs a PM decoration ───── */

const DECO_CTOR = /\bDecoration\.(inline|node|widget)\s*\(/g;

function productionSources(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  for (const root of ["src", "library"]) {
    for (const abs of trackedFiles(root, /\.tsx?$/)) {
      if (/__tests__|\.test\.tsx?$/.test(abs)) continue;
      out.push({ rel: abs.slice(REPO_ROOT.length + 1), src: readFileSync(abs, "utf8") });
    }
  }
  return out;
}

/** Balanced-paren argument text starting at the `(` index. */
function argsAt(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(openParen + 1, i);
    }
  }
  return src.slice(openParen + 1);
}

interface DecoSite {
  rel: string;
  /** `inline` | `node` | `widget`. */
  kind: string;
  /** The full argument text, comments stripped. */
  args: string;
  /** The whole file, comments stripped — used to resolve identifiers. */
  fileSrc: string;
  line: number;
}

const SITES: DecoSite[] = (() => {
  const out: DecoSite[] = [];
  for (const { rel, src: raw } of productionSources()) {
    // Literals KEPT (every class name IS a string literal, which `codeOnly`
    // blanks) and LINE-ALIGNED, so the `file:line` this census reports is the
    // line a reader can open — a census whose diagnostic points at the wrong
    // line is a census someone stops trusting.
    const src = strip(raw, true, true);
    DECO_CTOR.lastIndex = 0;
    for (const m of src.matchAll(DECO_CTOR)) {
      const open = src.indexOf("(", m.index!);
      out.push({
        rel,
        kind: m[1],
        args: argsAt(src, open),
        fileSrc: src,
        line: src.slice(0, m.index!).split("\n").length,
      });
    }
  }
  return out;
})();

/** Resolve an identifier's string value(s) from the same file. */
function resolveIdent(fileSrc: string, ident: string): string[] {
  const found: string[] = [];
  // `const X = "a b"` / `const X: T = "a"`
  for (const m of fileSrc.matchAll(
    new RegExp(`\\b${ident}\\s*(?::[^=;]+)?=\\s*"([^"]*)"`, "g"),
  )) {
    found.push(...m[1].split(/\s+/).filter(Boolean));
  }
  // `const X = ["a", "b"]` plus any `X.push("c")`
  for (const m of fileSrc.matchAll(new RegExp(`\\b${ident}\\s*=\\s*\\[([^\\]]*)\\]`, "g"))) {
    for (const lit of m[1].matchAll(/"([^"]*)"/g)) found.push(...lit[1].split(/\s+/).filter(Boolean));
  }
  for (const m of fileSrc.matchAll(new RegExp(`\\b${ident}\\.push\\(([^)]*)\\)`, "g"))) {
    for (const lit of m[1].matchAll(/"([^"]*)"/g)) found.push(...lit[1].split(/\s+/).filter(Boolean));
  }
  return found;
}

/**
 * Every class name a site can put on the DOM. For a widget the class lives in
 * the builder function it names, so the builder's body is resolved too.
 */
function classesOf(site: DecoSite): string[] {
  const names: string[] = [];
  const collect = (expr: string) => {
    for (const lit of expr.matchAll(/"([^"]*)"/g)) {
      names.push(...lit[1].split(/\s+/).filter(Boolean));
    }
    for (const id of expr.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      if (id[1] === "viewOnly") continue;
      names.push(...resolveIdent(site.fileSrc, id[1]));
    }
  };

  if (site.kind === "widget") {
    // `Decoration.widget(pos, <builder>, …)` — resolve the builder's body.
    const builder = site.args.split(",")[1]?.trim().match(/^[A-Za-z_$][\w$]*/)?.[0];
    if (builder) {
      const at = site.fileSrc.search(
        new RegExp(`(function\\s+${builder}\\b|\\b${builder}\\s*(?::[^=]+)?=\\s*(\\(|function))`),
      );
      if (at >= 0) {
        const body = site.fileSrc.slice(at, at + 1400);
        for (const m of body.matchAll(/class(?:Name)?\s*[:=]\s*("[^"]*"|[A-Za-z_$][\w$.]*)/g)) {
          collect(m[1]);
        }
        for (const m of body.matchAll(/class="([^"]*)"/g)) {
          names.push(...m[1].split(/\s+/).filter(Boolean));
        }
      }
    }
    return [...new Set(names)];
  }

  for (const m of site.args.matchAll(/\bclass\s*:\s*([^,\n}]+)/g)) collect(m[1]);
  // A spec object built earlier and passed by name (`Decoration.inline(a, b,
  // domAttrs)`) — resolve its object literal in the same file. Without this a
  // decoration hides its class behind one variable and reads as class-less.
  if (names.length === 0) {
    for (const id of site.args.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      const at = site.fileSrc.search(
        new RegExp(`\\b${id[1]}\\s*(?::[^=;]+)?=\\s*\\{`),
      );
      if (at < 0) continue;
      const open = site.fileSrc.indexOf("{", at);
      let depth = 0;
      let end = open;
      for (let i = open; i < site.fileSrc.length; i++) {
        if (site.fileSrc[i] === "{") depth++;
        else if (site.fileSrc[i] === "}") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const body = site.fileSrc.slice(open, end);
      for (const m of body.matchAll(/\bclass\s*:\s*([^,\n}]+)/g)) collect(m[1]);
      for (const m of site.fileSrc.matchAll(
        new RegExp(`\\b${id[1]}\\[\\s*"class"\\s*\\]\\s*=\\s*([^;\n]+)`, "g"),
      )) {
        collect(m[1]);
      }
    }
  }
  return [...new Set(names)];
}

/**
 * Does this site DECLARE itself view-only?
 *
 * The attention branch is SITE-scoped, not file-scoped, and that distinction is
 * the one this suite's own spell-error leg already makes ("it is the SITE that
 * declares it, not merely the file"). File-scoped, a second unrelated PAINTING
 * decoration added to `anchor-highlight-deco.ts` would be waved through with no
 * class check at all, on the strength of a constant seventy lines away. So a
 * site qualifies only if it hands over an ATTR BAG *and* its file takes the
 * attention vocabulary from the leaf — a declaration rather than a coincidence
 * of containing the right string.
 */
function declaresViewOnly(site: DecoSite): boolean {
  if (/\bviewOnly\s*\(/.test(site.args)) return true;
  // The attention chrome carries no class — it paints declared ATTRIBUTES onto
  // a DOCUMENT element, which the print block neutralises by name (a blanket
  // marker there would erase the user's persistent highlight tint).
  // The import CLAUSE must name an attention constant (`DATA_*` are the only
  // such exports), not merely reach the leaf — otherwise any file that imports
  // `viewOnly` would inherit the exemption for a class-less site.
  const takesVocabulary =
    /import\s*\{[^}]*\bDATA_[A-Z_]+\b[^}]*\}\s*from\s*"@\/lib\/view-only-chrome"/.test(
      site.fileSrc,
    );
  return takesVocabulary && /\battrs\b/i.test(site.args);
}

/** The `@media screen { … }` block, brace-matched — where the hide classes
 *  declare their `display: none`. `""` when there is none, so the ONE leg that
 *  names it fails rather than throwing at module scope. */
const SCREEN_BLOCK = (() => {
  const at = CSS.indexOf("@media screen");
  if (at < 0) return "";
  let depth = 0;
  let i = CSS.indexOf("{", at);
  const open = i;
  for (; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return CSS.slice(open + 1, i);
})();

/**
 * The HIDE classes — DISCOVERED from the two plugins that stamp them, exactly
 * as 408's own census does, so the two suites cannot come to disagree about who
 * is a hide class. They must NOT carry the view-only marker: they are governed
 * by ABSENCE from the print block (408's finding — there is no value `display`
 * could be restated as), and the marker's neutralisation would reach the
 * document blocks *inside* a folded section.
 *
 * The `@media screen` cross-check is load-bearing and was found by planting a
 * canary: 408's discovery takes EVERY `class: "…"` literal in those two files,
 * so a new PAINT decoration added beside a fold — the likeliest place for one,
 * since that is where view state already lives — would be classified a hide
 * class and walk straight out of this census. A class is a hide class only if
 * the screen block actually hides it.
 */
const HIDE_CLASSES = (() => {
  const found = new Set<string>();
  for (const rel of ["src/lib/section-folding.ts", "src/lib/focus-view.ts"]) {
    const src = commentsStripped(readFileSync(join(REPO_ROOT, rel), "utf8"));
    for (const m of src.matchAll(/\bclass:\s*"([a-z0-9-]+)"/g)) {
      // MENTIONED is not HIDDEN: the screen block must carry a rule whose
      // selector names the class AND whose body declares `display`. A
      // substring test would let a PAINT rule added to that block launder a
      // new class into this bucket.
      const hidden = [...SCREEN_BLOCK.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(
        (r) =>
          new RegExp(`\\.${m[1]}(?![\\w-])`).test(r[1]) && /display\s*:/.test(r[2]),
      );
      if (hidden) found.add(m[1]);
    }
  }
  return found;
})();

/**
 * The allowlist, and it is a claim rather than an escape hatch: each entry is a
 * decoration that renders DOCUMENT CONTENT, so it belongs on paper and must
 * never carry the marker. A hit that is NOT document content is COVER-it.
 */
const DOCUMENT_CONTENT_CLASSES: Record<string, string> = {
  "latex-cmd":
    "raw LaTeX the schema does not model — the TEXT is document content, and it " +
    "prints. Its grey monospace is NOT flattened on paper today the way " +
    "`.citation-node` is; whether it should be is a visible product change, " +
    "deliberately not decided under a fix about editor STATE",
  "pgmark-chip": "renders a real `\\pgmark{N}` page label from the source",
  "pgmark-chip-low": "same chip, low-confidence variant",
  "pgmark-chip-first": "same chip, first-anchor variant",
  "pgmark-rule": "the page-break rule a `\\pgmark` anchor denotes",
  "pgmark-rule-top": "the page-break rule for the document's first page",
  "pgmark-rule-tag": "the 'page break' caption inside that rule",
};

/* ── legs ────────────────────────────────────────────────────────────────── */

describe("the view-only census", () => {
  it("discovers decoration sites across the tree at all", () => {
    // A floor that proves the discovery WORKS. A needle that matched nothing
    // would make every leg below vacuous.
    // The floor is the TRUE current count, not a soft guess: a discovery that
    // silently stopped seeing a file would still clear a loose bar. It is a
    // floor rather than an exact set because a new decoration is legitimate —
    // what must never happen is the population SHRINKING.
    expect(SITES.length).toBeGreaterThanOrEqual(9);
    expect(new Set(SITES.map((s) => s.rel)).size).toBeGreaterThanOrEqual(7);
  });

  it("every production decoration is view-only, a hide class, or document content", () => {
    const uncovered: string[] = [];
    for (const site of SITES) {
      if (declaresViewOnly(site)) continue;
      const classes = classesOf(site);
      if (classes.length === 0) {
        uncovered.push(`${site.rel}:${site.line} — a decoration that declares neither a class nor the view-only marker`);
        continue;
      }
      for (const cls of classes) {
        if (HIDE_CLASSES.has(cls)) continue;
        if (cls in DOCUMENT_CONTENT_CLASSES) continue;
        uncovered.push(`${site.rel}:${site.line} — \`.${cls}\` paints unclassified state onto the document`);
      }
    }
    expect(
      uncovered,
      "COVER it: stamp `viewOnly(<class>)` at the decoration, or add it to " +
        "DOCUMENT_CONTENT_CLASSES with a stated reason it belongs on paper",
    ).toEqual([]);
  });

  it("every allowlist entry still excuses a live decoration", () => {
    // An exemption that has stopped excusing anything is a standing licence
    // for the next thing that takes its name (task 204's rule). Discovered
    // from the same sites the leg above judges, so a retired decoration
    // retires its entry with it.
    const painted = new Set<string>();
    for (const site of SITES) for (const c of classesOf(site)) painted.add(c);
    const stale = Object.keys(DOCUMENT_CONTENT_CLASSES).filter((c) => !painted.has(c));
    expect(stale, "DELETE these — no production decoration stamps them any more").toEqual([]);
  });

  it("a hide class is one the screen block actually hides", () => {
    // The floor for the cross-check above, and it is what keeps the two
    // 408-named files from being an escape hatch: `HIDE_CLASSES` must be the
    // two shipped folds and nothing else.
    expect([...HIDE_CLASSES].sort()).toEqual(["focus-hidden", "section-folded"]);
    expect(SCREEN_BLOCK).not.toBe("");
  });

  it("the two hide classes never take the view-only marker", () => {
    // The marker neutralises background/box-shadow on the marked element, and
    // a folded section's blocks are DOCUMENT content that prints.
    for (const site of SITES) {
      const classes = classesOf(site);
      if (!classes.some((c) => HIDE_CLASSES.has(c))) continue;
      expect(site.args, `${site.rel}:${site.line}`).not.toMatch(/\bviewOnly\s*\(/);
    }
  });

  it("names `spell-error` on the pre-fix tree", () => {
    // Measured by neutering: with `class: SPELL_ERROR_CLASS` restored the leg
    // above reports `spell-error`. This leg keeps that claim honest by proving
    // the resolver actually reads that site's class.
    const site = SITES.find((s) => s.rel.endsWith("spellcheck-decorator.ts"));
    expect(site).toBeDefined();
    expect(declaresViewOnly(site!)).toBe(true);
    // …and it is the SITE that declares it, not merely the file.
    expect(site!.args).toMatch(/\bviewOnly\s*\(/);
  });
});

describe("the print block carries ONE rule for the marker", () => {
  it("declares the marker selector with every zeroed property, each `!important`", () => {
    const at = PRINT_BLOCK.indexOf(`.${VIEW_ONLY_CLASS}`);
    expect(at, "the print block never names the view-only marker").toBeGreaterThan(-1);
    const body = PRINT_BLOCK.slice(PRINT_BLOCK.indexOf("{", at), PRINT_BLOCK.indexOf("}", at));
    // Swept FROM the declaration, so a fifth property is covered by declaring
    // itself. `text-decoration` is the one that matters with DEFAULT print
    // settings — Chrome drops backgrounds and shadows unless "Background
    // graphics" is on. `!important` is load-bearing: the transient band carries
    // an INLINE `background-color`, and an `!important` author declaration is
    // what outranks a normal inline style.
    for (const prop of VIEW_ONLY_ZEROED_PROPERTIES) {
      expect(body, `the marker rule never zeroes \`${prop}\``).toMatch(
        new RegExp(`${prop}:\\s*none\\s*!important`),
      );
    }
  });

  it("the marker has NO screen rule, so stamping it restyles nothing", () => {
    // A marker that painted on screen would silently restyle every decoration
    // that adopts it — the fix would become a visual change.
    const outside = CSS.slice(0, CSS.indexOf("@media print"));
    expect(outside).not.toContain(`.${VIEW_ONLY_CLASS}`);
  });

  it("neutralises the attention chrome by ATTRIBUTE, on the one colour var", () => {
    for (const attr of VIEW_ONLY_ATTENTION_ATTRS) {
      const at = PRINT_BLOCK.indexOf(`[${attr}]`);
      expect(at, `the print block never names [${attr}]`).toBeGreaterThan(-1);
    }
    // ONE `.tiptap`-scoped rule naming EVERY declared attention attribute,
    // zeroing the colour var. `!important` because the per-kind rules set the
    // same var at higher specificity; `.tiptap`-scoped so a card in the print
    // appendix keeps its inline kind accent. Built from the declaration, so a
    // fourth channel joins by declaring itself — which is the whole reason
    // `data-link-highlight` is a member: it painted a HEAVIER wash than the
    // selection one and was covered only by the coincidence that the anchor
    // reconciler stamps `data-card-selected` on the same element.
    const selectors = VIEW_ONLY_ATTENTION_ATTRS.map((a) => `\\.tiptap\\s*\\[${a}\\]`).join(
      "[^{]*",
    );
    const m = PRINT_BLOCK.match(new RegExp(`${selectors}[^{]*\\{([^}]*)\\}`));
    expect(
      m,
      "the declared attention attributes are not neutralised by ONE .tiptap-scoped rule",
    ).toBeTruthy();
    expect(m![1]).toMatch(
      new RegExp(`${ATTENTION_COLOR_VAR}:\\s*transparent\\s*!important`),
    );
  });

  it("kills the appendix card outline with an UNSCOPED attention rule", () => {
    // A selected card printed into the appendix carries
    // `body.card-outline-chrome [data-card-key][data-card-selected] { outline }`
    // — and its root sits OUTSIDE `.tiptap` by design, which is exactly why the
    // var rule above is scoped and this one must not be.
    const unscoped = [...PRINT_BLOCK.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(
      (r) =>
        VIEW_ONLY_ATTENTION_ATTRS.every((a) => r[1].includes(`[${a}]`)) &&
        !r[1].includes(".tiptap") &&
        /outline:\s*none\s*!important/.test(r[2]),
    );
    expect(unscoped, "no unscoped `outline: none` for the attention attributes").toBeTruthy();
  });

  it("the CITATION attention variant is flattened by the older citation rule", () => {
    // The one attention rule that does NOT paint from `--link-anchor-color` (it
    // uses the amber highlight vars), so the var-zeroing does nothing for it.
    // It reaches paper flattened only because this OLDER rule is `!important`
    // and the attention rule is not — a fact about THIS rule, pinned here so a
    // future "tidy" of it cannot silently print a hover wash.
    const m = PRINT_BLOCK.match(/\.citation-node,\s*\.label-ref-node\s*\{([^}]*)\}/);
    expect(m, "the print block no longer flattens `.citation-node`").toBeTruthy();
    expect(m![1]).toMatch(/background:\s*transparent\s*!important/);
    expect(m![1]).toMatch(/border:\s*0\s*!important/);
  });

  it("the screen rules the marker rides beside are UNCHANGED", () => {
    // The squiggle still paints on screen; the band still carries its geometry.
    expect(CSS).toMatch(/\.tiptap \.spell-error\s*\{[^}]*text-decoration:\s*underline wavy/);
    expect(CSS).toMatch(/\.tiptap \.virgil-transient-highlight\s*\{/);
  });
});

describe("the mechanism is path-independent", () => {
  // `html[data-printing]` and every `data-print-e-*` are stamped ONLY by
  // `runPrint`. The browser's own File → Print reaches the `beforeprint`
  // listener and nothing else, so a posture keyed on either silently fails for
  // the door most people use. 408 states this as a constraint on every future
  // print change; it is a leg here for the same reason.
  it("no view-only posture is keyed on `data-printing` or a print-element toggle", () => {
    for (const m of CSS.matchAll(/\[data-print(?:ing|-e-)[^\]]*\][^{]*\{[^}]*\}/g)) {
      expect(
        m[0],
        "a view-only posture keyed on a print attribute is invisible to File → Print",
      ).not.toMatch(
        new RegExp(`${VIEW_ONLY_CLASS}|${VIEW_ONLY_ATTENTION_ATTRS.join("|")}|spell-error`),
      );
    }
  });
});

describe("the vocabulary is a leaf, and its one imperative painter pairs with it", () => {
  it("`view-only-chrome.ts` imports nothing", () => {
    // CSS cannot import TS, so the binding is this census — which means the
    // vocabulary must be reachable from every layer that paints, including the
    // TipTap-free ones. A facet the layer that needs it cannot import will be
    // re-copied, every time.
    const src = readFileSync(join(REPO_ROOT, "src/lib/view-only-chrome.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });

  it("`viewOnly()` composes the marker after the caller's own class", () => {
    expect(viewOnly("x")).toBe(`x ${VIEW_ONLY_CLASS}`);
  });

  it("the bib cross-highlight adds and removes the marker with its own class", () => {
    // Not a decoration, so the discovered population above cannot see it —
    // pinned by source instead. Both halves: an add that forgot the marker
    // prints a ring, a remove that forgot it leaves the marker on a citation
    // for the rest of the session.
    const src = commentsStripped(
      readFileSync(join(REPO_ROOT, "src/components/EditorLayout.tsx"), "utf8"),
    );
    for (const verb of ["add", "remove"]) {
      const m = src.match(new RegExp(`classList\\.${verb}\\(([^)]*CITATION_HIGHLIGHT_BIB[^)]*)\\)`));
      expect(m, `no classList.${verb} for the bib cross-highlight`).toBeTruthy();
      expect(m![1]).toContain("VIEW_ONLY_CLASS");
    }
  });
});
