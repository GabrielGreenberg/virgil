import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { SCROLLBAR_THUMB_WIDTH } from "@/components/editor-layout/constants";

/**
 * Scrollbar CENSUS (task 1175).
 *
 * The bug: the Outline's word counts sat under a fat (~15px) native overlay
 * scrollbar. Two defects, one class ("dead scrollbar styling"):
 *
 *   1. The "Firefox parallel" set an inheritable `scrollbar-color` on `html`
 *      and `*:hover`. Chromium 121+ IGNORES every `::-webkit-scrollbar*` rule
 *      on an element that carries a standard `scrollbar-color` /
 *      `scrollbar-width` — so the styled 6px bar was dead code everywhere and
 *      macOS drew its overlay bar instead. The fix fences those rules in
 *      `@supports not selector(::-webkit-scrollbar)`.
 *   2. No scroller reserved a gutter, so the bar landed ON right-aligned row
 *      meta. The fix is ONE utility, `.panel-scroll` (overflow-y:auto +
 *      scrollbar-gutter:stable), worn by every panel / list scroller.
 *
 * And ONE size: `--scrollbar-size` feeds the webkit bar and is mirrored by
 * the editor's custom thumb (`SCROLLBAR_THUMB_WIDTH`).
 */
const ROOT = path.resolve(__dirname, "..", "..");
const globalsPath = path.join(ROOT, "src/app/globals.css");
const css = postcss.parse(readFileSync(globalsPath, "utf8"));

const FENCE = /^not\s+selector\(\s*::-webkit-scrollbar\s*\)$/;

function insideWebkitFence(rule: Rule): boolean {
  for (let p = rule.parent; p; p = p.parent as typeof p) {
    if (p.type === "atrule") {
      const at = p as AtRule;
      if (at.name === "supports" && FENCE.test(at.params.trim())) return true;
    }
    if (p.type === "root") break;
  }
  return false;
}

/** A selector that hands an INHERITED value to (nearly) every element. */
function isBroadSelector(sel: string): boolean {
  return /(^|[\s,>+~(])(html|body|:root|\*)(?=$|[\s,:.[>+~)])/.test(sel) || /:hover/.test(sel);
}

describe("scrollbar census (task 1175)", () => {
  it("no inheritable scrollbar-color / scrollbar-width on html / * / :hover outside the webkit fence", () => {
    const offenders: string[] = [];
    css.walkRules((rule) => {
      if (!isBroadSelector(rule.selector)) return;
      rule.walkDecls((d) => {
        if (d.parent !== rule) return;
        if (d.prop !== "scrollbar-color" && d.prop !== "scrollbar-width") return;
        if (insideWebkitFence(rule)) return;
        offenders.push(`${rule.selector} { ${d.prop}: ${d.value} } @ line ${d.source?.start?.line}`);
      });
    });
    expect(
      offenders,
      "Chromium 121+ ignores ::-webkit-scrollbar* on any element carrying a standard " +
        "scrollbar-color/scrollbar-width; on a broad selector that kills the styled bar " +
        "everywhere. Move it inside `@supports not selector(::-webkit-scrollbar) { … }`.",
    ).toEqual([]);
  });

  it("the fence still exists and still carries the Firefox parallel", () => {
    let fenced = 0;
    css.walkAtRules("supports", (at) => {
      if (!FENCE.test(at.params.trim())) return;
      at.walkDecls("scrollbar-color", () => void fenced++);
    });
    expect(fenced).toBeGreaterThan(0);
  });

  it("--scrollbar-size is declared once on :root and mirrors SCROLLBAR_THUMB_WIDTH", () => {
    const values: string[] = [];
    css.walkDecls("--scrollbar-size", (d) => void values.push(d.value.trim()));
    expect(values).toEqual([`${SCROLLBAR_THUMB_WIDTH}px`]);
  });

  it("the webkit bar's width and height read --scrollbar-size", () => {
    const decls: Record<string, string> = {};
    css.walkRules((rule) => {
      if (rule.selector.trim() !== "::-webkit-scrollbar") return;
      rule.walkDecls((d) => void (decls[d.prop] = d.value));
    });
    expect(decls.width).toMatch(/^var\(--scrollbar-size\b/);
    expect(decls.height).toMatch(/^var\(--scrollbar-size\b/);
  });

  it(".panel-scroll is vertical scroll with a stable gutter", () => {
    const decls: Record<string, string> = {};
    css.walkRules((rule) => {
      if (rule.selector.trim() !== ".panel-scroll") return;
      rule.walkDecls((d) => void (decls[d.prop] = d.value));
    });
    expect(decls["overflow-y"]).toBe("auto");
    expect(decls["scrollbar-gutter"]).toBe("stable");
  });
});

// ── Panel scroller census ────────────────────────────────────────────────
// Panel / list scrollers wear `.panel-scroll`, never a bare vertical-auto.

const SCOPE = [
  "src/panels",
  "src/components/panel-primitives.tsx",
  "src/components/library",
  "library/components",
];

/** Bare vertical scrollers that deliberately do NOT reserve a gutter. */
const ALLOW: { file: string; snippet: string; reason: string }[] = [
  {
    file: "src/components/panel-primitives.tsx",
    snippet: '" overflow-y-auto"',
    reason:
      "a docked card BODY's max-height scroll: reserving a gutter would narrow the " +
      "prose of every card, overflowing or not; its classic bar only takes width while " +
      "the body actually overflows, and it carries no right-aligned row meta",
  },
  {
    file: "src/panels/Citations/CitationCard.tsx",
    snippet: 'className="ml-4 overflow-y-auto"',
    reason: "the inline bib-entry form inside a citation card body — same card-body case",
  },
];

const BARE = /overflow-y-auto|overflowY:\s*["']auto["']/;

function walk(rel: string, out: string[]) {
  const abs = path.join(ROOT, rel);
  const st = statSync(abs);
  if (st.isFile()) {
    if (/\.tsx?$/.test(rel)) out.push(rel);
    return;
  }
  for (const name of readdirSync(abs)) {
    if (name === "__tests__" || name === "node_modules") continue;
    walk(path.join(rel, name), out);
  }
}

describe("panel scroller census (task 1175)", () => {
  const files: string[] = [];
  for (const s of SCOPE) walk(s, files);

  it("scans a real tree", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("every panel scroller wears .panel-scroll, not a bare overflow-y-auto", () => {
    const offenders: string[] = [];
    const usedAllow = new Set<number>();
    for (const rel of files) {
      const lines = readFileSync(path.join(ROOT, rel), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!BARE.test(line)) return;
        if (/^\s*(\/\/|\*)/.test(line)) return; // prose
        const a = ALLOW.findIndex((x) => x.file === rel && line.includes(x.snippet));
        if (a >= 0) {
          usedAllow.add(a);
          return;
        }
        offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      'Use className="panel-scroll" (globals.css) so the scrollbar gutter is reserved, ' +
        "or add an ALLOW row with a reason.",
    ).toEqual([]);
    // A stale allow row is dead weight — every row must still match.
    expect(ALLOW.filter((_, i) => !usedAllow.has(i)).map((x) => x.file)).toEqual([]);
  });

  it("the named panel scrollers wear the utility", () => {
    const wears = (rel: string, needle: RegExp) =>
      expect(readFileSync(path.join(ROOT, rel), "utf8"), rel).toMatch(needle);
    wears("src/panels/Outline/OutlinePanel.tsx", /ref=\{scrollRef\} className="panel-scroll /);
    wears("src/components/panel-primitives.tsx", /list: "panel-card-list panel-scroll /);
    wears("src/panels/Omni/OmniViewPanel.tsx", /className="panel-scroll /);
    wears("src/components/library/BibEntryPickerMenu.tsx", /className="panel-scroll /);
    wears("library/components/LeftList.tsx", /className="panel-scroll"/);
    wears("library/components/NavPod.tsx", /className="panel-scroll"/);
  });
});
