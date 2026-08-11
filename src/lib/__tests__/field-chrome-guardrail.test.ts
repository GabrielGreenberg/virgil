/**
 * FIELD-CHROME CENSUS (task 190) — the leg with teeth.
 *
 * `Button` publishes a variant×size SSOT so its consumers *can't* drift, and a
 * repo-wide sweep for hand-rolled filled buttons found zero. Text fields
 * published only PROSE (`src/STYLE_GUIDE.md` "Inputs"), and roughly half of ~50
 * sites had drifted off it: ten spelled `focus:border-[var(--accent)]` where the
 * spec keeps input focus on the neutral `edge-strong`, three added a
 * spec-forbidden `focus:ring-1`, and the 4px `rounded` was near-universal where
 * the radius scale files a primary control at 6px. Nothing structural stopped
 * any of it. `src/components/field-primitives.tsx` is now the one spelling, and
 * this is what keeps it the one spelling.
 *
 * The census is a SITE census, not a file census: it parses each JSX opening tag
 * for the three field elements and asks about THAT element's own className, so a
 * file may legitimately hold both a chromeless inline editor and a primitive
 * call. The `type=` exclusion is what makes it precise rather than merely broad
 * — a checkbox, radio, color swatch or range slider shares the tag name and
 * nothing else, and several legitimately carry `rounded border border-edge-*`
 * for their own (non-field) chrome.
 *
 * What is deliberately NOT censused, stated rather than implied:
 *  - **Chromeless fields.** A bare search box inside a container that already
 *    paints the border, a `border-b` inline rename editor, a NodeView input
 *    styled from `globals.css` — these are different controls, they never
 *    drifted, and forcing them onto the primitive would be a worse app. They
 *    carry none of the needles, so they are invisible here by construction.
 *  - **The `library/` silo's inline-styled fields.** They paint from
 *    `var(--border-light)` / `var(--radius-sm)` in `style={{…}}`, a separate
 *    token system with no Tailwind class to grep. The walk still covers
 *    `library/` so a Tailwind-class field landing there IS caught — which is
 *    the drift path that actually exists, since the shared components live in
 *    `src/`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { strip } from "./_source-scan";

const REPO = path.resolve(__dirname, "../../..");
const SRC = path.join(REPO, "src");
const LIBRARY = path.join(REPO, "library");
/** The primitive itself is the one place the chrome may be spelled. */
const PRIMITIVE = "src/components/field-primitives.tsx";

/**
 * A bespoke field that may keep its own chrome. EMPTY, and meant to stay that
 * way: a hit is MIGRATE-it (`<Input>` / `<Select>` / `<Textarea>`), not
 * allowlist-it. An entry must say why this control is not the ordinary bordered
 * field the spec describes — and, as with the pane-drag family's
 * `PERMITTED_UNCHROMED_RESIZERS`, an exception buys a different SHAPE, never a
 * different palette: it still takes `--edge-*` / `--danger`, never `--accent`
 * and never a ring (both of which the second leg forbids unconditionally).
 */
const PERMITTED_BESPOKE_FIELDS: Record<string, string> = {};

/* ── The scanner ────────────────────────────────────────────────────────── */

/** Native `type=` values that are NOT bordered text fields. A `<Input>` cannot
 *  express these at all (`TextInputType`), so the exclusion can't be used to
 *  smuggle a real field past the census. */
const NON_TEXT_TYPE =
  /type=\{?\s*["'](checkbox|radio|color|range|file|submit|button|image|reset)["']/;

/**
 * Field chrome, as the classes that actually paint it. Each alternation is a
 * shape the census found drifting:
 *  - `rounded…`      the radius axis (the near-universal 4px drift)
 *  - `border-edge-…` the resting border color
 *  - `border-[var(--border…` the warm legacy border token, same role
 *  - `focus:border-…`/`focus:ring` the focus axis (accent drift + the rings)
 */
const FIELD_CHROME =
  /\bfocus:border-|\bfocus:ring|\bborder-edge-|\brounded\b|\brounded-(?:xs|sm|md|lg|xl|pill|full)\b|border-\[var\(--border/;

/** The two rules STYLE_GUIDE §Inputs states absolutely. */
const BANNED_FOCUS = /focus:border-\[var\(--accent\)\]|focus:border-accent\b|focus:ring-(?!0\b)/;

/**
 * A site is keyed by FILE, not by line. `strip` drops block comments including
 * their newlines, so a line number counted on stripped source is a lie — and a
 * census that prints a wrong line is worse than one that prints none, because
 * the next reader chases it. Every sibling guardrail in this directory censuses
 * per file for the same reason; the `tag` is what actually locates the site.
 */
interface Site {
  rel: string;
  tag: string;
}

/** Parse every OPENING TAG of the named elements, brace-aware so a JSX
 *  expression containing `>` (an arrow function in an inline handler — the
 *  common case here) can't end the tag early. */
export function tagSites(rel: string, source: string, tags: RegExp): Site[] {
  // Comments stripped, string literals KEPT: the needles live inside the
  // className string, so blanking literals would make every leg unfalsifiable
  // (the task-205 mistake). Stripping comments is what keeps doctrine prose —
  // this file's own header, the primitive's docblock — from reading as a site.
  const src = strip(source, true);
  const out: Site[] = [];
  const re = new RegExp(tags.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let depth = 0;
    let end = src.length;
    while (i < src.length) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        end = i + 1;
        break;
      }
      i++;
    }
    out.push({ rel, tag: src.slice(m.index, end).replace(/\s+/g, " ") });
  }
  return out;
}

/** The raw DOM elements — the drift surface the census governs. */
const RAW_FIELD_TAG = /<(?:input|select|textarea)\b/;
/** The primitive's call sites — governed by the color leg below. */
const PRIMITIVE_TAG = /<(?:Input|Select|Textarea)\b/;

export const fieldSites = (rel: string, source: string) =>
  tagSites(rel, source, RAW_FIELD_TAG);
export const primitiveSites = (rel: string, source: string) =>
  tagSites(rel, source, PRIMITIVE_TAG);

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "__tests__" || entry === "__fixtures__" || entry === "node_modules") continue;
      out.push(...walkSource(full));
    } else if (/\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function walkBothSilos(): Array<{ rel: string; source: string }> {
  const files: Array<{ rel: string; source: string }> = [];
  for (const [prefix, root] of [
    ["src", SRC],
    ["library", LIBRARY],
  ] as const) {
    for (const f of walkSource(root)) {
      files.push({
        rel: `${prefix}/${path.relative(root, f).split(path.sep).join("/")}`,
        source: readFileSync(f, "utf8"),
      });
    }
  }
  return files;
}

const FILES = walkBothSilos();
const SITES = FILES.flatMap((f) => fieldSites(f.rel, f.source));
const TEXT_SITES = SITES.filter((s) => !NON_TEXT_TYPE.test(s.tag));

/* ── Leg 1: the census can see ──────────────────────────────────────────── */

describe("field-chrome census — the walk works", () => {
  it("finds the field elements in both silos", () => {
    // Anchored on a floor rather than a list so ordinary refactors don't churn
    // it, but high enough that a walk which stopped working can't pass.
    expect(SITES.length).toBeGreaterThanOrEqual(40);
    expect(TEXT_SITES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(SITES.map((s) => s.rel.split("/")[0]))).toEqual(
      new Set(["src", "library"]),
    );
  });

  it("would flag a naive off-spec field (the exact pre-fix shape)", () => {
    // Verbatim `PreferencesModal`'s pre-190 preset-name input.
    const naive = `
      export function Preset() {
        return (
          <input
            type="text"
            value={newName}
            className="text-xs border border-edge-hover rounded px-2 py-1.5 w-28 outline-none focus:border-[var(--accent)]"
          />
        );
      }`;
    const sites = fieldSites("src/x.tsx", naive).filter(
      (s) => !NON_TEXT_TYPE.test(s.tag),
    );
    expect(sites).toHaveLength(1);
    expect(FIELD_CHROME.test(sites[0].tag)).toBe(true);
    expect(BANNED_FOCUS.test(sites[0].tag)).toBe(true);
  });

  it("does NOT flag a chromeless field or a non-text native control", () => {
    // Both are real shapes from the tree: the Search panel's bare box inside a
    // bordered container, and a color swatch that legitimately wears
    // `rounded border border-edge-subtle` chrome of its own.
    const fixture = `
      <input value={q} className="flex-1 text-sm bg-transparent outline-none placeholder:text-ink-muted" />
      <input type="color" className="w-6 h-6 rounded border border-edge-subtle cursor-pointer p-0 bg-transparent" />`;
    const sites = fieldSites("src/x.tsx", fixture);
    expect(sites).toHaveLength(2);
    const flagged = sites.filter(
      (s) => !NON_TEXT_TYPE.test(s.tag) && FIELD_CHROME.test(s.tag),
    );
    expect(flagged).toHaveLength(0);
  });
});

/* ── Leg 2: every chromed field goes through the primitive ──────────────── */

describe("field-chrome census — no hand-rolled field chrome", () => {
  it("flags exactly the allowlisted bespoke fields — none today", () => {
    // A hit here is a raw <input>/<select>/<textarea> painting its own border,
    // radius or focus state. Use `<Input>` / `<Select>` / `<Textarea>` from
    // `src/components/field-primitives` and keep only the box (width, padding,
    // font-size) in `className`. Allowlist ONLY a control that genuinely is not
    // the bordered field STYLE_GUIDE §Inputs describes.
    const offenders = TEXT_SITES.filter(
      (s) => s.rel !== PRIMITIVE && FIELD_CHROME.test(s.tag),
    ).map((s) => s.rel);
    expect([...new Set(offenders)].sort()).toEqual(
      Object.keys(PERMITTED_BESPOKE_FIELDS).sort(),
    );
  });

  it("keeps the bespoke allowlist free of stale entries", () => {
    const byRel = new Map(FILES.map((f) => [f.rel, f.source]));
    for (const rel of Object.keys(PERMITTED_BESPOKE_FIELDS)) {
      expect(byRel.get(rel), `${rel} missing from the walk`).toBeDefined();
      expect(
        fieldSites(rel, byRel.get(rel) as string).some(
          (s) => !NON_TEXT_TYPE.test(s.tag) && FIELD_CHROME.test(s.tag),
        ),
        `${rel} no longer hand-rolls field chrome — drop its allowlist entry`,
      ).toBe(true);
    }
  });
});

/* ── Leg 3: the two absolute spec rules, primitive calls included ───────── */

describe("field-chrome census — the accent-focus and ring bans", () => {
  /**
   * This leg is what the first one structurally cannot do. The census above
   * asks about RAW elements, and a migrated site can still hand the primitive
   * `className="focus:border-[var(--accent)]"` — same defect, one indirection
   * in, and invisible to a tag census that no longer matches `<input`. So the
   * ban is asserted over every field-bearing FILE: the raw elements, the
   * `<Input|Select|Textarea …>` calls, and the primitive itself.
   *
   * Scope is deliberately the field family rather than the whole repo:
   * `focus-visible:ring-2` is the correct, shipped affordance on `Button`, and
   * a future non-field control may want a ring honestly. `focus:ring-0` is
   * excluded from the needle — it REMOVES a ring, which is the spec's own
   * position.
   */
  const fieldBearing = (source: string) =>
    /<(?:input|select|textarea)\b/.test(source) ||
    /<(?:Input|Select|Textarea)[\s/>]/.test(source);

  it("no field anywhere spells an accent focus border or a focus ring", () => {
    const offenders = FILES.filter((f) => fieldBearing(f.source))
      .map((f) => ({ rel: f.rel, src: strip(f.source, true) }))
      .filter((f) => BANNED_FOCUS.test(f.src))
      .map((f) => f.rel);
    // STYLE_GUIDE §Inputs: focus THICKENS the border to the neutral
    // `edge-strong`; there is no ring on inputs. `--accent` is the saturated,
    // user-overridable brown — a field that focuses to it re-colors itself
    // with the user's card palette, which is not what a text box should say.
    expect(offenders.sort()).toEqual([]);
  });

  it("can see a banned spelling passed THROUGH the primitive", () => {
    // The canary for the leg above — proof it isn't vacuous now that no raw
    // element carries the needle.
    const viaPrimitive = `<Input className="px-2 focus:border-[var(--accent)]" />`;
    const viaRing = `<Textarea className="px-2 focus:ring-1 focus:ring-edge-hover" />`;
    expect(fieldBearing(viaPrimitive) && BANNED_FOCUS.test(viaPrimitive)).toBe(true);
    expect(fieldBearing(viaRing) && BANNED_FOCUS.test(viaRing)).toBe(true);
    // …and that `focus:ring-0` (removing a ring) is not caught by it.
    expect(BANNED_FOCUS.test(`<Input className="focus:ring-0" />`)).toBe(false);
  });
});

/* ── Leg 4: the primitive owns COLOR; the call site owns the box ────────── */

describe("field-chrome census — no color utility appended to a primitive", () => {
  /**
   * The subtler half of the same defect, and the one an adversarial pass on
   * THIS task's own first draft turned up. A migrated site that keeps
   * `className="text-ink-subtle"` next to the primitive's baked
   * `text-ink-body` has not overridden anything: two utilities set the same
   * property, and Tailwind resolves them by STYLESHEET order, not by the order
   * they appear in the attribute. The site renders one of the two colors, the
   * author cannot tell which by reading the JSX, and a Tailwind upgrade may
   * silently swap the answer. So color is stated as a PROP (`tone` / `ink` /
   * `invalid`) and never appended.
   *
   * **The rule is CONFLICT, not "mentions a color"** — a needle that merely
   * looked for color words would have flagged the citation card's
   * `hover:border-edge-hover` + `focus:border-solid`, which are a STATE layer
   * the base doesn't define and a border STYLE, neither of which the primitive
   * bakes and neither of which can lose a coin flip. Flagging honest
   * composition is how a guard gets relaxed by the next person, so this one is
   * precise: a class is flagged only when it sets a property the primitive
   * ALREADY sets, in the SAME variant.
   *
   * Font SIZE (`text-xs`, `text-[10px]`) is deliberately NOT caught: different
   * property, the caller's business, and it never drifted.
   */
  const BAKED = {
    bg: /^bg-/,
    // `text-` is two properties wearing one prefix. An arbitrary value decides
    // which: `text-[10px]` is a SIZE (the caller's, and the reason this can't
    // just match `^text-\[`), `text-[#fff]` / `text-[var(--muted)]` is a COLOR.
    textColor: /^text-(?:ink-|danger\b|white\b|black\b|\[(?:#|var\(|rgb|hsl|color))/,
    borderColor: /^border-(?:edge-|danger\b|red-|\[)/,
    radius: /^rounded/,
  };

  /** Split `hover:focus:text-x` into its last variant and the utility. */
  function classify(cls: string): { variant: string; util: string } {
    const i = cls.lastIndexOf(":");
    // An arbitrary value can itself contain a colon (`bg-[var(--x)]`), so only
    // split on a colon that sits outside brackets.
    const bracket = cls.indexOf("[");
    if (i < 0 || (bracket >= 0 && i > bracket)) return { variant: "", util: cls };
    return { variant: cls.slice(0, i), util: cls.slice(i + 1) };
  }

  function conflictingClasses(tag: string): string[] {
    // Only the className attribute — other props carry prose (`placeholder=`,
    // `data-hint=`) that must never be tokenized as utilities.
    const out: string[] = [];
    const re = /className=/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tag))) {
      let i = m.index + m[0].length;
      let value = "";
      if (tag[i] === '"' || tag[i] === "'") {
        const q = tag[i];
        const end = tag.indexOf(q, i + 1);
        value = tag.slice(i + 1, end < 0 ? tag.length : end);
      } else if (tag[i] === "{") {
        let depth = 0;
        const start = i;
        while (i < tag.length) {
          if (tag[i] === "{") depth++;
          else if (tag[i] === "}") {
            depth--;
            if (depth === 0) break;
          }
          i++;
        }
        value = tag.slice(start, i + 1);
      }
      // Split on everything a class can sit between EXCEPT `:` — the colon is
      // the variant separator, and splitting on it would strip `hover:` off
      // `hover:border-edge-hover`, leaving a bare border color that the rule
      // below would (wrongly) flag. A lone `:` from a ternary survives as its
      // own token and classifies to nothing.
      // …and not on parentheses either: `text-[var(--muted)]` is ONE class, and
      // splitting it would hide an arbitrary color behind a `text-[var` stub.
      for (const cls of value.split(/[\s"'`{}?,]+/).filter(Boolean)) {
        const { variant, util } = classify(cls);
        const setsBaked =
          BAKED.bg.test(util) ||
          BAKED.textColor.test(util) ||
          BAKED.borderColor.test(util) ||
          BAKED.radius.test(util);
        if (variant === "" && setsBaked) out.push(cls);
        else if (variant === "placeholder") out.push(cls);
        else if (variant === "focus" && BAKED.borderColor.test(util)) out.push(cls);
      }
    }
    return out;
  }

  const PRIMITIVE_SITES = FILES.flatMap((f) => primitiveSites(f.rel, f.source));

  it("finds the primitive's call sites (the leg can see)", () => {
    expect(PRIMITIVE_SITES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(PRIMITIVE_SITES.map((s) => s.rel)).size).toBeGreaterThanOrEqual(12);
  });

  it("no primitive call appends a class the chrome already sets", () => {
    const offenders = PRIMITIVE_SITES.filter(
      (s) => conflictingClasses(s.tag).length > 0,
    ).map((s) => `${s.rel} → ${conflictingClasses(s.tag).join(" ")}`);
    expect(offenders.sort()).toEqual([]);
  });

  it("catches a conflict, and leaves honest composition alone", () => {
    const caught = [
      `<Input className="text-xs px-1 text-ink-subtle" />`, // color coin flip
      `<Textarea className="px-2 bg-surface-muted" />`, // background coin flip
      `<Select className="px-1 rounded-lg" />`, // radius, the density axis
      `<Input className="px-2 placeholder:text-ink-body" />`, // same variant as the base
      `<Input className="px-2 focus:border-edge-hover" />`, // base owns focus border
      `<Input className="px-2 text-[var(--muted)]" />`, // arbitrary COLOR
    ];
    const allowed = [
      `<Select className="text-[10px] px-1.5 py-0.5 min-w-0 font-mono" />`, // the box
      `<Input className="px-2 border-dashed hover:border-edge-hover focus:border-solid" />`, // state layer + border STYLE
      `<Input className="w-full px-3 py-1.5 text-sm tabular-nums" />`,
      `<Input className="text-[11px] w-20" />`, // arbitrary SIZE, not a color
    ];
    for (const src of caught) {
      expect(conflictingClasses(primitiveSites("x", src)[0].tag), src).not.toEqual([]);
    }
    for (const src of allowed) {
      expect(conflictingClasses(primitiveSites("x", src)[0].tag), src).toEqual([]);
    }
  });

  it("reads the className attribute only, never a prose prop", () => {
    // `placeholder="Add from library…"` and `data-hint="…"` must not tokenize.
    const tag = primitiveSites(
      "x",
      `<Input placeholder="rounded corners are nice" data-hint="bg-surface" className="px-2" />`,
    )[0].tag;
    expect(conflictingClasses(tag)).toEqual([]);
  });
});

/* ── Leg 5: the stripper self-check ─────────────────────────────────────── */

describe("field-chrome census — the stripper does not swallow", () => {
  it("keeps string literals and roughly all of a real file", () => {
    const real = FILES.find((f) => f.rel === PRIMITIVE)!.source;
    const stripped = strip(real, true);
    // Comments go, code stays: the primitive's docblock is ~40% of the file,
    // so a floor rather than an equality — but a stripper that ate the file
    // (the task-202b runaway) would fail this, and every leg above would have
    // been silently vacuous.
    expect(stripped.length).toBeGreaterThan(real.length * 0.3);
    expect(stripped).toContain("focus:border-edge-strong");
    expect(stripped).not.toContain("STYLE_GUIDE.md");
  });
});
