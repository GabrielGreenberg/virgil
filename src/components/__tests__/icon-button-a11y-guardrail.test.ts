/**
 * ICON-BUTTON A11Y CENSUS (task 2026-08-02-281).
 *
 * > An icon-only `<button>` — one whose children render no text — states its
 * > accessible name ONCE, through `iconHint`, and supplies the design system's
 * > focus indicator.
 *
 * Task 142 gave the side-rail strip buttons an `aria-label` and explicitly
 * deferred the codebase-wide sweep. What the deferral left was a codebase
 * split down a card-vs-chrome line: the newer card components paired
 * `data-hint` with `aria-label`, and the older panel chrome carried the hint
 * alone — which is a CSS tooltip hook, not an accessible name, so those
 * controls announced as a bare "button" (WCAG 4.1.2). Half a convention is
 * worse than none: the next panel copies whichever neighbour it lands beside.
 *
 * Two failure modes, opposite in shape, and this file censuses both because
 * draining one alone re-opens the other:
 *
 *  - **No name.** `data-hint` only ⇒ nothing announces.
 *  - **Two names.** `data-hint="X" aria-label="X"` ⇒ one string spelled twice,
 *    with nothing holding the copies together. That is not hypothetical:
 *    `StatusCluster`'s toolbar toggle announced "Expand toolbar" while its
 *    tooltip said "Collapse toolbar", silently, for as long as the conditional
 *    had existed. `iconHint({ label })` is the one door; where the tooltip
 *    genuinely differs from the name it takes `hint` beside it, so the two are
 *    still decided in one place.
 *
 * The THIRD leg is the focus indicator. Stated honestly, because the finding
 * that opened this task overstated it: a hand-rolled icon button is not
 * invisible to keyboard users — nothing in `globals.css` resets `outline`, so
 * it falls back to the UA ring. What it lacks is the app's ring (`outline:
 * none` + a 2px `--edge-strong` shadow), which every `iconbtn-*` and
 * `.topbarbtn` supplies and which `.focus-ring` now supplies WITHOUT the
 * geometry — so a 10px outline chevron or an accent-when-locked control can
 * take the indicator without taking a 20×20 box and a fixed ink.
 *
 * ── What this census can and cannot see ────────────────────────────────
 *
 * It reads MARKUP, through the shared JSX scanner in `_source-scan.ts`, and
 * three limits are recorded rather than implied:
 *
 *  - **A props SPREAD is opaque.** `<button {...rest}>` (the `Button`
 *    primitive) and `<button {...getItemProps()}>` (every roving menu row) can
 *    receive a name, a tabIndex, or a className from elsewhere, so a tag
 *    carrying a spread this file cannot resolve is SKIPPED. It fails toward
 *    silence rather than toward a false accusation, and an accusation here is
 *    not cheap — the "fix" for a wrong one is an `aria-label` that OVERRIDES a
 *    control's visible text, which is a worse defect than the one being cured.
 *  - **A computed className is opaque.** `className={btnClass}` cannot be read
 *    for a ring token, so leg C skips it too.
 *  - **Only `<button>`.** An `<a>` is a different (and rarer) shape here and
 *    is not censused. A `role="button"` on anything ELSE is censused one file
 *    over — `role-button-census.test.ts` (task 536): the role is spelled ONCE,
 *    by `activatableProps`, and only on a container that must hold other
 *    interactive content; every other control is a real `<button>` and so
 *    lands in THIS census.
 *
 * What it deliberately does NOT require is `aria-hidden` on the icon child.
 * An `aria-label` REPLACES the subtree in the name computation, and these SVGs
 * declare no `role="img"` and hold no `<title>`, so they contribute nothing to
 * announce — stamping ~100 of them would be churn that changes no behaviour.
 * (`StripButton` keeps the hidden host task 142 gave it; nothing is lost.)
 *
 * The icon-only test is the interesting part, and its rule is: text that lands
 * in a CHILD position counts; JS scaffolding does not. `{item.done ? <svg/> :
 * <svg/>}` is an element-CHOOSING expression and renders no text, while
 * `{leading ? <span>{label}</span> : <span>{label}</span>}` renders `label` —
 * the two are the same shape to any regex, and the first version of this
 * classifier called both of them icon-only.
 *
 * ── The OTHER half of the same rule (task 424) ─────────────────────────
 *
 * `STYLE_GUIDE.md` states the naming rule in TWO directions and this file
 * censused only one of them: an icon-only control needs a name, and
 * **"Where the element already has visible text, that text is the name —
 * keep `useHint`/`data-hint` alone and don't add a redundant `aria-label`
 * (an `aria-label` that disagrees with visible text is a worse defect than a
 * missing one)."** Leg D is that second direction. Its absence is the shape
 * task 404 names — *a census scoped to the shape of the LAST defect* — and
 * this file's own header had already named the resulting defect as the thing
 * a wrong accusation would CAUSE, without ever checking for it. Four sites
 * had accumulated: two disclosure toggles whose label merely restated their
 * visible "Original text", and a library "Pop out" button announcing "Open
 * this paper in a new tab" — a WCAG 2.5.3 *Label in Name* failure, since a
 * voice-control user saying "click pop out" does not reach it.
 *
 * **Leg D asks a LOWER-BOUND question, and that is what makes it safe.** It
 * does not try to reconstruct what a button renders — it looks for LITERAL
 * alphanumeric text in a position that contributes to the accessible name
 * (so an `aria-hidden` subtree is skipped, and every computed expression is
 * simply not counted). Finding some is proof the control HAS visible text;
 * opaque content can only ADD to that, never remove it. So the leg fails
 * toward silence exactly as legs A–C do, and the two false-positive shapes an
 * exact reconstruction would produce — a glyph expression (`{FACET_GLYPH[f]}`)
 * and an icon wrapped in an aria-hidden span — cannot arise.
 *
 * The rule enforced is the GUIDE's (no `aria-label` at all where there is
 * visible text), which is strictly stronger than WCAG 2.5.3's containment
 * test and subsumes it. A control that genuinely needs to announce more than
 * it shows takes `aria-labelledby` (pointing at its own visible text plus the
 * extra) or a visually-hidden span — both of which keep the visible text IN
 * the name. So the allowlist is EMPTY, for the same reason legs A and B have
 * none: there is no true statement of the form "this control has visible text
 * and should announce something else instead."
 *
 * What leg D CANNOT see is the same shape wearing a computed label — the omni
 * bin pills render `{count} unanchored` through a shared primitive, so both
 * the text and the label are identifiers. That half is pinned by RENDER legs
 * in `accessible-name-agrees-with-visible-control.test.tsx`, which also holds
 * the per-site pin for the strip's blank-gutter toggle (a name/polarity
 * question that requires reading intent and is not automatable as a census).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  commentsStripped,
  cssCommentsStripped,
  elementsNamed,
  strip,
  tagEnd,
  trackedFiles,
  type JsxElementHit,
} from "@/lib/__tests__/_source-scan";

const ROOT = path.resolve(__dirname, "../../..");
const SILOS = ["src", "library"];

/**
 * Icon-only buttons that cannot take the app's focus ring, with the reason.
 *
 * A ring here would be strictly WORSE than the UA default it replaces:
 * `.focus-ring` opens with `outline: none`, and an INLINE `box-shadow` beats
 * any stylesheet declaration, so on a button whose elevation is inline the
 * class removes the browser's indicator and cannot draw its own.
 *
 * The list may only SHRINK. A new icon button belongs on a ring, not here.
 */
const PERMITTED_UNRINGED_ICON_BUTTONS: Record<string, string> = {
  "src/components/stack/StackIcon.tsx":
    "the portal-mounted Stack pill carries its elevation (and its illuminated drag halo) as an INLINE box-shadow, which no stylesheet ring can override — it keeps the UA outline, which is a real indicator, rather than taking a class that would delete one and supply none.",
};

function sources(): { file: string; src: string; raw: string }[] {
  const out: { file: string; src: string; raw: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (["node_modules", ".next", "out", "__tests__"].includes(e.name)) continue;
        walk(p);
      } else if (e.name.endsWith(".tsx")) {
        const raw = fs.readFileSync(p, "utf8");
        out.push({ file: path.relative(ROOT, p), src: commentsStripped(raw), raw });
      }
    }
  };
  for (const silo of SILOS) walk(path.join(ROOT, silo));
  return out;
}

/* ── The icon-only question ──────────────────────────────────────────── */

/** Index just past the `}` matching the `{` at `i`. */
function skipBraces(s: string, i: number): number {
  let depth = 1;
  let j = i + 1;
  while (j < s.length && depth > 0) {
    const c = s[j];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      j++;
      while (j < s.length && s[j] !== q) {
        if (s[j] === "\\") j++;
        j++;
      }
    } else if (c === "{") depth++;
    else if (c === "}") depth--;
    j++;
  }
  return j;
}

/**
 * The text a JSX children region renders — "" when it renders only icons.
 *
 * `elementDepth` starts at 1 for a real children region and at 0 inside a JS
 * expression, where top-level characters are the CONDITION and the operators,
 * not anything a user reads. Recursing at 0 is what tells an element-choosing
 * ternary apart from one that chooses between two labels.
 *
 * Returns null when the region can't be parsed — fail LOUD, never "no text".
 */
export function renderedText(region: string, elementDepth = 1): string | null {
  let out = "";
  let i = 0;
  while (i < region.length) {
    const c = region[i];
    if (c === "<" && /[A-Za-z/]/.test(region[i + 1] ?? "")) {
      const closing = region[i + 1] === "/";
      const end = tagEnd(region, i);
      if (end < 0) return null;
      const selfClosing = region[end - 1] === "/";
      if (closing) elementDepth--;
      else if (!selfClosing) elementDepth++;
      i = end + 1;
      continue;
    }
    if (c === "{") {
      const end = skipBraces(region, i);
      const inner = region.slice(i + 1, end - 1);
      if (elementDepth > 0) {
        if (/<[A-Za-z]/.test(inner)) {
          const nested = renderedText(inner, 0);
          if (nested === null) return null;
          out += nested;
        } else if (inner.trim()) {
          // Any other child expression may evaluate to text.
          out += "TEXT";
        }
      }
      i = end;
      continue;
    }
    if (elementDepth > 0) out += c;
    i++;
  }
  return out;
}

/** True when the element renders no text of its own; null when unparsable. */
export function isIconOnly(hit: JsxElementHit): boolean | null {
  if (hit.subtree === null) return null;
  const text = renderedText(hit.subtree, 1);
  if (text === null) return null;
  return !/[A-Za-z0-9]/.test(text);
}

/**
 * A LOWER BOUND on the text a JSX children region contributes to the
 * accessible name: the literal characters, with every `aria-hidden` subtree
 * dropped and every `{expression}` ignored.
 *
 * Deliberately not `renderedText`: that one answers "does anything render
 * here", counting a computed expression as "TEXT" and counting it wherever it
 * sits. Both are wrong for the naming question — an `aria-hidden` icon wrapper
 * contributes NOTHING to the name (`aria-hidden` removes the subtree from the
 * accessibility tree), and `{glyph}` is not evidence of a visible LABEL. So
 * this returns only what can be READ, and a caller may conclude "there is
 * visible text" from a non-empty answer but never "there is none".
 *
 * Returns null when the region can't be parsed — fail LOUD, never "no text".
 */
export function literalVisibleText(region: string): string | null {
  let out = "";
  let i = 0;
  // Depth of the nearest enclosing aria-hidden element, or 0 when outside one.
  let hiddenDepth = 0;
  let depth = 1;
  while (i < region.length) {
    const c = region[i];
    if (c === "<" && /[A-Za-z/]/.test(region[i + 1] ?? "")) {
      const closing = region[i + 1] === "/";
      const end = tagEnd(region, i);
      if (end < 0) return null;
      const selfClosing = region[end - 1] === "/";
      if (closing) {
        depth--;
        if (hiddenDepth > depth) hiddenDepth = 0;
      } else if (!selfClosing) {
        depth++;
        // `aria-hidden` with no value is `true` in JSX (`aria-hidden` alone),
        // and `aria-hidden={false}` / `="false"` does NOT hide.
        const tag = region.slice(i, end + 1);
        const m = /(?<![\w-])aria-hidden(\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*'))?/.exec(tag);
        const hides = m ? !/false/.test(m[2] ?? "") : false;
        // An `<svg>`'s own content is GRAPHICS, not a label: this file's
        // header already establishes that these icons declare no `role="img"`
        // and hold no `<title>`, so they announce nothing — and a `<text>`
        // digit inside a numbered-list glyph is not something a voice-control
        // user would ever say. Counting it accused three correctly-labelled
        // icon-only buttons (`RichTextField`, `BibEntryCard`,
        // `ActionsMenuPanel`), measured.
        const graphics = /^<svg(?![\w.-])/i.test(tag);
        if ((hides || graphics) && hiddenDepth === 0) hiddenDepth = depth;
      }
      i = end + 1;
      continue;
    }
    if (c === "{") {
      // Every child expression is opaque here — see the docstring.
      i = skipBraces(region, i);
      continue;
    }
    if (hiddenDepth === 0) out += c;
    i++;
  }
  return out;
}

/**
 * True when the element shows a WORD — text a user can read and say aloud.
 *
 * A run of two or more alphanumerics, not one: a single letterform is a
 * GLYPH, not a label, and this codebase draws several. `ActionsMenuPanel`'s
 * text-colour swatch is a serif capital `A` over a colour bar; the close
 * buttons are `×`, which the icon-only classifier's own self-check already
 * calls "exactly a control that needs a name". A voice-control user says a
 * WORD, so a word is what leg D is entitled to demand be in the name.
 */
export function hasVisibleText(hit: JsxElementHit): boolean | null {
  if (hit.subtree === null) return null;
  const text = literalVisibleText(hit.subtree);
  if (text === null) return null;
  return /[A-Za-z0-9]{2,}/.test(text);
}

/* ── Tag predicates ──────────────────────────────────────────────────── */

/** A spread this census cannot resolve — anything but an `iconHint(…)` call. */
const opaqueSpread = (tag: string) => /\{\s*\.\.\.\s*(?!iconHint\s*\()/.test(tag);
const namesItself = (tag: string) =>
  /(?<![\w-])aria-label\s*=|(?<![\w-])aria-labelledby\s*=|iconHint\s*\(/.test(tag);
const literalHint = (tag: string) => /(?<![\w-])data-hint\s*=/.test(tag);
const literalLabel = (tag: string) => /(?<![\w-])aria-label\s*=/.test(tag);
const RING = /iconbtn-(?:xs|sm|md|lg)|topbarbtn|focus-ring|focus-visible:ring/;
/** A literal `className="…"` / `` className={`…`} ``, or null when computed. */
function literalClassName(tag: string): string | null {
  const m = /(?<![\w-])className\s*=\s*/.exec(tag);
  if (!m) return "";
  const at = m.index + m[0].length;
  if (tag[at] === '"') return tag.slice(at + 1, tag.indexOf('"', at + 1));
  if (tag[at] === "{" && tag[at + 1] === "`") return tag.slice(at + 2, tag.indexOf("`", at + 2));
  return null;
}
/** Roving menu rows are focused programmatically and show `data-active`
 *  instead; they are not tab stops, so the ring question doesn't apply. */
const notATabStop = (tag: string) => /tabIndex\s*=\s*\{?\s*-1/.test(tag);

interface Site extends JsxElementHit {
  file: string;
  line: number;
}

/** Buttons whose subtree the scanner could not read — asserted empty in the
 *  self-check leg rather than here, because a bare `expect` in module scope
 *  reports as a harness error rather than as a failing census. */
const unparsable: string[] = [];

/** Every `<button>` in both silos, located, with its two classifications. */
function buttonSites(): { icon: Site[]; text: Site[] } {
  const icon: Site[] = [];
  const text: Site[] = [];
  for (const { file, src, raw } of sources()) {
    // Advanced past each located tag so two BYTE-IDENTICAL open tags in one
    // file report their OWN lines. `suggestion-fields` holds exactly that
    // pair, and a bare `indexOf` named the first one twice — a census whose
    // report sends you to the wrong site is a census you stop trusting.
    // Safe because `commentsStripped` keeps strings, so a tag is byte-equal
    // in both views, and `elementsNamed` walks in source order.
    let cursor = 0;
    for (const hit of elementsNamed(src, "button")) {
      const isIcon = isIconOnly(hit);
      if (isIcon === null) {
        unparsable.push(`${file}: unreadable <button> subtree`);
        continue;
      }
      // Line numbers come from the RAW file: the stripper drops block
      // comments outright, so a line counted in the stripped copy drifts by
      // every multi-line comment above it — the same dishonesty task 326
      // repaired in `phantom-css-var`'s reports.
      const rawAt = raw.indexOf(hit.tag, cursor);
      if (rawAt >= 0) cursor = rawAt + hit.tag.length;
      const before = rawAt >= 0 ? raw.slice(0, rawAt) : src.slice(0, hit.index);
      const site: Site = { ...hit, file, line: before.split("\n").length };
      if (isIcon) icon.push(site);
      // NOT `!isIcon`: the two classifiers ask different questions and are
      // deliberately not complements. `isIconOnly` counts any child
      // expression as text, so a button whose only child is `{glyph}` is
      // "not icon-only" while showing nothing a user could say aloud —
      // exactly the false accusation leg D must not make.
      if (hasVisibleText(hit) === true) text.push(site);
    }
  }
  return { icon, text };
}

const at = (s: Site) => `${s.file}:${s.line}`;

const ALL = buttonSites();

describe("icon-only buttons announce, once, and focus visibly", () => {
  const sites = ALL.icon;

  it("sees a population worth censusing (self-check)", () => {
    // A classifier that silently stopped matching would make every leg below
    // pass vacuously — the canary is a floor on the population, anchored well
    // under today's count so ordinary churn doesn't trip it.
    expect(sites.length).toBeGreaterThan(60);
    expect(sites.some((s) => s.file.startsWith("library/"))).toBe(true);
    // An unreadable subtree is a HOLE, not a pass: it would silently drop that
    // button out of all three legs.
    expect(unparsable).toEqual([]);
  });

  it("every icon-only button exposes an accessible name", () => {
    const nameless = sites
      .filter((s) => !opaqueSpread(s.tag) && !namesItself(s.tag))
      .map(at);
    // No allowlist: `data-hint` is not a name, and there is no true statement
    // of the form "this control is icon-only and should announce nothing".
    expect(nameless).toEqual([]);
  });

  it("no icon-only button spells its label twice", () => {
    const twice = sites.filter((s) => literalHint(s.tag) && literalLabel(s.tag)).map(at);
    // The pair goes through `iconHint({ label })` — or `{ label, hint }` when
    // the tooltip really must differ. One call site, one decision.
    expect(twice).toEqual([]);
  });

  it("every tab-stoppable icon-only button carries the app's focus ring", () => {
    const unringed = sites
      .filter((s) => !opaqueSpread(s.tag) && !notATabStop(s.tag))
      .filter((s) => {
        const cls = literalClassName(s.tag);
        return cls !== null && !RING.test(cls);
      })
      .filter((s) => !PERMITTED_UNRINGED_ICON_BUTTONS[s.file]);
    expect(unringed.map(at)).toEqual([]);
  });

  it("the unringed allowlist has no stale entries", () => {
    for (const file of Object.keys(PERMITTED_UNRINGED_ICON_BUTTONS)) {
      const live = sites.filter((s) => s.file === file && !opaqueSpread(s.tag));
      expect(live.length, `${file} no longer holds an icon-only button`).toBeGreaterThan(0);
    }
  });
});

/* ── Leg D: a control that SHOWS text announces that text (task 424) ─── */

describe("a button with visible text does not override it with an aria-label", () => {
  const sites = ALL.text;

  it("sees a population worth censusing (self-check)", () => {
    // Anchored well under today's count so ordinary churn doesn't trip it.
    // Without this floor a classifier that quietly stopped matching would make
    // the leg below pass vacuously.
    expect(sites.length).toBeGreaterThan(40);
    expect(sites.some((s) => s.file.startsWith("library/"))).toBe(true);
  });

  it("no text-bearing button carries an aria-label", () => {
    // `aria-label` only: `aria-labelledby` can POINT AT the visible text (and
    // at extra text beside it), so it is the sanctioned way to say more —
    // `aria-label` is the one that replaces the subtree outright.
    const overridden = sites.filter((s) => literalLabel(s.tag));
    // Allowlist EMPTY, deliberately — see the header. A control that must
    // announce more than it shows keeps its visible text IN the name
    // (`aria-labelledby` onto its own text plus the extra, or a
    // visually-hidden span), it does not replace it.
    expect(overridden.map(at)).toEqual([]);
  });
});

describe("the icon-only classifier (self-check)", () => {
  const hit = (subtree: string): JsxElementHit => ({ tag: "<button>", subtree, index: 0 });

  it("reads an element-choosing expression as icon-only", () => {
    expect(isIconOnly(hit(`{done ? (<svg width="14"><rect x="1" /></svg>) : (<svg><path d="M3 3" /></svg>)}`))).toBe(true);
  });

  it("reads an expression that renders a label as text", () => {
    expect(isIconOnly(hit(`{leading ? (<span className="x">{label}</span>) : (<span>{label}</span>)}`))).toBe(false);
    expect(isIconOnly(hit(`{reloadLabel}`))).toBe(false);
    expect(isIconOnly(hit(` Retry `))).toBe(false);
  });

  it("reads a bare icon child, and a letterless glyph, as icon-only", () => {
    expect(isIconOnly(hit(" <IconX /> "))).toBe(true);
    // `×` announces as nothing useful, so it is exactly a control that needs
    // a name — the classifier must not mistake it for a visible label.
    expect(isIconOnly(hit(" × "))).toBe(true);
  });

  it("fails LOUD on a subtree it cannot parse", () => {
    expect(isIconOnly({ tag: "<button>", subtree: null, index: 0 })).toBeNull();
  });
});

describe("the visible-text classifier (self-check)", () => {
  const hit = (subtree: string): JsxElementHit => ({ tag: "<button>", subtree, index: 0 });

  it("reads a literal label as visible text", () => {
    expect(hasVisibleText(hit(" <span>Original text</span> <Chevron /> "))).toBe(true);
    expect(hasVisibleText(hit(" <ExternalLinkIcon size={12} /> <span>Pop out</span> "))).toBe(true);
  });

  it("does not read a computed child as visible text", () => {
    // The whole point of the lower bound: `{glyph}` and `{label}` are not
    // evidence of a label a user can read and say aloud, so a leg built on
    // them would accuse `RowMenu`, `LeftList` and every glyph button.
    expect(hasVisibleText(hit(" {glyph} "))).toBe(false);
    expect(hasVisibleText(hit(" {expanded ? \"less\" : \"more\"} "))).toBe(false);
    expect(hasVisibleText(hit(" <IconX /> "))).toBe(false);
  });

  it("does not read a single letterform as a label", () => {
    // The text-colour swatch: a serif `A` over an aria-hidden colour bar.
    expect(hasVisibleText(hit(' <span style={{ fontWeight: 600 }}>A</span> <span aria-hidden /> '))).toBe(false);
    expect(hasVisibleText(hit(" × "))).toBe(false);
  });

  it("does not read an svg's own text content as a label", () => {
    expect(
      hasVisibleText(hit('<svg width="12"><text x="0" fontSize="5">1</text><rect x="5" /></svg>')),
    ).toBe(false);
  });

  it("skips an aria-hidden subtree, which contributes nothing to the name", () => {
    expect(hasVisibleText(hit(' <span aria-hidden="true">Menu</span> '))).toBe(false);
    expect(hasVisibleText(hit(' <span aria-hidden>Menu</span> '))).toBe(false);
    // …and closing the hidden element restores counting.
    expect(hasVisibleText(hit(' <span aria-hidden="true">Menu</span> Save '))).toBe(true);
    // `aria-hidden={false}` does NOT hide.
    expect(hasVisibleText(hit(' <span aria-hidden={false}>Menu</span> '))).toBe(true);
  });

  it("fails LOUD on a subtree it cannot parse", () => {
    expect(hasVisibleText({ tag: "<button>", subtree: null, index: 0 })).toBeNull();
  });
});

/* ── The focus indicator has ONE mechanism (task 2026-08-31-503) ─────── */

/**
 * > A focus indicator is `.focus-ring` (or `.iconbtn-*` / `.topbarbtn`, which
 * > bake the same declaration in). Tailwind's `ring-*` is for a DECORATIVE,
 * > non-focus ring only, and never on an element that also carries one of
 * > those — and a ring's colour is a token, never a raw palette value.
 *
 * `globals.css` is UNLAYERED (`@import "tailwindcss"` puts every Tailwind
 * utility in `@layer theme|base|components|utilities`), and the file states
 * the consequence itself: *"unlayered always wins the cascade."* Tailwind's
 * `ring-*` is implemented AS `box-shadow`, and so is the focus indicator — so
 * on an element carrying both, the class wins whatever the class order and
 * every `ring-*` on it paints NOTHING.
 *
 * This is task 502's law read one property over: *an unlayered utility that
 * writes a property OWNS that property for the element.* 502 found it on
 * `transition-*`; here it is on `box-shadow`.
 *
 * Two shipped sites had the shape and the first is why it needed a census:
 *
 *  - **`BUTTON_BASE`, i.e. the exemplar.** The canonical `<Button>` ended with
 *    `focus-visible:outline-none focus-visible:ring-2
 *    focus-visible:ring-edge-strong` and then appended `focus-ring`. Three
 *    dead utilities on the one primitive every new button is supposed to be
 *    copied from — harmless only because the two spellings happened to agree
 *    at the default zero ring-offset, which is exactly why nobody noticed and
 *    exactly why the next hand-rolled button would copy the dead one.
 *  - **`PanelThemePicker`'s selected swatch.** Three indicators declared on
 *    one 20x20 element: selected (`ring-2 ring-offset-1 ring-stone-500`,
 *    box-shadow), roving (`outline …`, outline) and `focus-ring` (box-shadow).
 *    Two of the three wrote the same property. It also carried the app's LAST
 *    raw `stone-*` value — `docs/virgil-design-system/10-audit.md` item 7's
 *    straggler, recorded 2026-08-09 and never filed.
 *
 * ── Two things the filing claimed that MEASUREMENT refutes, recorded here
 *    rather than left to be re-filed ─────────────────────────────────────
 *
 *  - **The swatch's symptom was LATENT, not live.** The filing said a keyboard
 *    user tabbing the palette could not see which swatch was selected. A
 *    `PresetSwatch` is a roving menu row: `useMenuItem`'s `getItemProps()`
 *    gives it `tabIndex: -1` and nothing anywhere calls `.focus()` on a menu
 *    item (roving `aria-activedescendant` only, so the editor caret never
 *    moves), so it can never match `:focus-visible` and `.focus-ring` was dead
 *    there twice over. That is also why the fix is a DELETION rather than a
 *    reshuffle of properties: its own `ResetRow` sibling and
 *    `SelectionColorPopover`'s swatch — the app's other roving swatch grid —
 *    already carry none, and leg C of the census above says the ring question
 *    "doesn't apply" to a row that is not a tab stop.
 *  - **`PanelThemePicker`'s TRIGGER is not a member.** The filing said the
 *    anchored-menu trigger "also gives `.focus-ring`". It did not:
 *    `AnchoredMenu` rendered its trigger with `className={triggerClassName}`
 *    and appended nothing, so `hover:ring-2 hover:ring-edge-subtle` there was
 *    a decorative ring on an element with no focus indicator — the sanctioned
 *    shape. (Its `shadow-inner` neighbour composes rather than collides:
 *    Tailwind v4 folds `--tw-shadow` and `--tw-ring-shadow` into one
 *    `box-shadow`. Only an UNLAYERED rule, or an INLINE style, replaces it.)
 *
 *    RENEGOTIATED by task 507, with the reason at the site. That reading was
 *    right about the tree it was measured on and it recorded the DEFECT as the
 *    contract: the trigger is the element that KEEPS DOM focus while the menu
 *    is open (rows are `tabIndex: -1`; task 477 puts `aria-activedescendant`
 *    on it), and five of the eight consumers gave it no indicator at all. So
 *    the shell supplies one now — which makes that trigger a member after all,
 *    and its `hover:ring-2` a real collision. The hover affordance moved to
 *    `border-color`; the block below is what keeps the next one from arriving.
 *
 * ── What this census can and cannot see ──────────────────────────────
 *
 * It reads CLASS-LIST VALUES: every `…[Cc]lass(Name)?=` attribute or prop
 * value (`className`, `triggerClassName`, `extraCardClass`, …), which is one
 * element's class list, expanded through that file's own `const NAME = …`
 * bindings wherever the value spells `${NAME}` or is exactly `{NAME}`. The
 * expansion is what makes `<Button>` visible at all — its ring lived in a
 * module const and its `focus-ring` in the JSX, so a value-only scan would
 * have read the two halves as unrelated and reported the exemplar clean.
 *
 * Three limits, recorded rather than implied:
 *
 *  - **A value assembled from something other than a plain const is opaque** —
 *    a function call, a prop, an object member. It fails toward silence.
 *  - **Cross-FILE flow is invisible.** A parent that appends `focus-ring` to a
 *    child's `className` prop is two files; only the halves each file can see
 *    are joined. Since task 507 exactly one such pair EXISTS and it is
 *    deliberate — `AnchoredMenu` appends the indicator to every
 *    `triggerClassName` it is handed — so the block at the end of this file
 *    censuses that flow directly rather than leaving it to this limit.
 *  - **A ring reached as an inline `style` is a different mechanism** and is
 *    not censused here. Inline beats the sheet outright — the caveat
 *    `PERMITTED_UNRINGED_ICON_BUTTONS` above already records for `StackIcon`.
 */

/** A Tailwind ring utility, variant prefixes included (`hover:ring-2`,
 *  `focus-visible:ring-edge-strong`). The lookbehind is what keeps
 *  `focus-ring` itself — whose `ring` is preceded by `-` — out of it. */
const RING_UTILITY = /(?<![\w-])ring-/;

/** The app's focus indicator, in any of its four spellings. */
const FOCUS_INDICATOR =
  /(?<![\w-])(?:focus-ring(?![\w-])|iconbtn-(?:xs|sm|md|lg)|topbarbtn)/;

/** A ring whose colour is a raw Tailwind palette value rather than an app
 *  token (`ring-edge-strong`, `ring-drag-target`, `ring-accent`). */
const RAW_PALETTE_RING = new RegExp(
  "(?<![\\w-])ring-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|" +
    "lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|" +
    "rose)-\\d",
);

/** Index just past the `close` matching the `open` at `i`, skipping strings.
 *  (Nested template literals are not modelled — the same limit `tagEnd` in
 *  `_source-scan` carries; none exists in either silo.) */
function balancedEnd(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      j++;
      while (j < s.length && s[j] !== q) {
        if (s[j] === "\\") j++;
        j++;
      }
    } else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return -1;
}

/** `NAME` → its initializer text, for every `const NAME = …;` in the file
 *  (module or function scope — `stateClass` is a function-scope one). */
function constBindings(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const decl = /(?:^|[\n;{])[ \t]*(?:export[ \t]+)?const[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?::[^=;]*)?=[ \t]*/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(src))) {
    const start = m.index + m[0].length;
    let j = start;
    let depth = 0;
    while (j < src.length) {
      const c = src[j];
      if (c === '"' || c === "'" || c === "`") {
        const q = c;
        j++;
        while (j < src.length && src[j] !== q) {
          if (src[j] === "\\") j++;
          j++;
        }
      } else if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === ";" && depth <= 0) break;
      j++;
    }
    out.set(m[1], src.slice(start, j));
  }
  return out;
}

/** One element's class list, with `${NAME}` / `{NAME}` resolved. Bounded at
 *  three passes so a self-referential binding cannot spin. */
function expandConsts(value: string, consts: Map<string, string>): string {
  let out = value;
  for (let pass = 0; pass < 3; pass++) {
    const whole = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(out);
    const before = out;
    if (whole && consts.has(whole[1])) out = consts.get(whole[1])!;
    out = out.replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (m, n: string) =>
      consts.has(n) ? consts.get(n)! : m,
    );
    if (out === before || out.length > 20000) break;
  }
  return out;
}

interface ClassValue {
  file: string;
  line: number;
  attr: string;
  value: string;
  /** The enclosing JSX opening tag, so a leg can ask what ELSE the element
   *  declares (an inline `boxShadow` is the other way to own the property).
   *  Empty when the attribute is not inside a tag — a class constant. */
  tag: string;
}

/** Every class-list value in both silos' production `.tsx`. Comments blanked,
 *  string literals KEPT (the needle lives inside a `className` literal, so
 *  blanking strings makes every leg unfalsifiable — the trap `_source-scan`'s
 *  own header records), LINE-ALIGNED so a hit names its site. */
function classValues(): ClassValue[] {
  const out: ClassValue[] = [];
  const files = [
    ...trackedFiles("src", /\.tsx$/),
    ...trackedFiles("library", /\.tsx$/),
  ].filter((p) => !p.includes("__tests__"));
  for (const abs of files) {
    const rel = path.relative(ROOT, abs);
    const src = strip(fs.readFileSync(abs, "utf8"), true, true);
    const consts = constBindings(src);
    /**
     * The JSX opening tag an attribute at `at` belongs to, or "" when it
     * belongs to none (a class CONSTANT sits inside no tag).
     *
     * Walks BACK over candidate `<` positions and keeps the first whose
     * `tagEnd` actually COVERS the attribute — `tagEnd` is brace/quote aware,
     * so an `onMouseDown={(e) => …}` arrow cannot truncate a tag (the trap
     * AGENTS.md records for the pane-drag census), and a `<` that opened a
     * TypeScript generic (`useState<Foo>`) closes early and is rejected by
     * that same test. Bounded twice (candidates and distance) so the scan is
     * O(1)-ish per attribute rather than quadratic on a 7000-line component;
     * both bounds are far past any real tag, and overrunning them reports ""
     * — silence, never a wrong neighbour.
     */
    const enclosingTag = (at: number): string => {
      let open = src.lastIndexOf("<", at);
      for (let tries = 0; tries < 60 && open >= 0 && at - open < 8000; tries++) {
        if (/[A-Za-z]/.test(src[open + 1] ?? "")) {
          const end = tagEnd(src, open);
          if (end >= at) return src.slice(open, end + 1);
        }
        open = src.lastIndexOf("<", open - 1);
      }
      return "";
    };
    const attr = /(?<![\w$.])([\w$]*[Cc]lass(?:Name)?)\s*=\s*/g;
    let m: RegExpExecArray | null;
    while ((m = attr.exec(src))) {
      const at = m.index + m[0].length;
      const q = src[at];
      let raw: string | null = null;
      if (q === '"' || q === "'") {
        const close = src.indexOf(q, at + 1);
        if (close > 0) raw = src.slice(at + 1, close);
      } else if (q === "{") {
        const end = balancedEnd(src, at, "{", "}");
        if (end > 0) raw = src.slice(at + 1, end - 1);
      }
      if (raw === null) continue;
      out.push({
        file: rel,
        line: src.slice(0, m.index).split("\n").length,
        attr: m[1],
        value: expandConsts(raw, consts),
        tag: enclosingTag(m.index),
      });
    }
  }
  return out;
}

const CLASS_VALUES = classValues();
const RINGED = CLASS_VALUES.filter((v) => RING_UTILITY.test(v.value));
const site = (v: ClassValue) => `${v.file}:${v.line}`;

describe("a focus indicator has ONE mechanism", () => {
  it("sees a population worth censusing (self-check)", () => {
    // A scanner that quietly stopped matching would make both legs pass
    // vacuously. Floors anchored well under today's counts.
    expect(CLASS_VALUES.length).toBeGreaterThan(1500);
    expect(CLASS_VALUES.some((v) => v.file.startsWith("library/"))).toBe(true);
    // …and it must still be able to SEE a ring at all. That half is now
    // SYNTHETIC, not a floor on the live population: the population has been
    // shrinking one deliberate task at a time (3 → 2 in task 507 when the
    // picker TRIGGER's hover ring left; 2 → 1 in task 508 when the citation
    // drop halo moved into `themedCardStyle`'s inline box-shadow), so a
    // numeric floor is a canary standing on whichever site has not been
    // retired yet — it fails for the wrong reason on the next honest removal,
    // and it would evaporate entirely at zero. A fixture cannot. The
    // production floor stays at ≥1 only to prove the scanner still reaches
    // real source; the exact-set leg below is what pins the survivors.
    expect(RING_UTILITY.test('className="ring-2 ring-drag-target"')).toBe(true);
    expect(RING_UTILITY.test('className="focus-ring rounded-md"')).toBe(false);
    expect(RINGED.length).toBeGreaterThanOrEqual(1);
  });

  it("no element declares a ring utility AND the focus indicator", () => {
    const both = RINGED.filter((v) => FOCUS_INDICATOR.test(v.value)).map(site);
    // Allowlist EMPTY, and there is no shape that would earn one: the class
    // wins the property outright, so a `ring-*` beside it is not a weaker
    // indicator — it is no indicator. A hit is DELETE-the-ring (when the focus
    // indicator is the one that should paint) or DROP-the-indicator (when the
    // element is not a tab stop, which is what the swatch turned out to be).
    expect(both).toEqual([]);
  });

  it("no ring names a raw Tailwind palette value", () => {
    const raw = RINGED.filter((v) => RAW_PALETTE_RING.test(v.value)).map(site);
    // Allowlist EMPTY. A ring is chrome like any other: it reads a token
    // (`--edge-strong`, `--ring-drag-target`), so a theme change moves it.
    expect(raw).toEqual([]);
  });

  it("keeps the surviving rings to a set someone decided on", () => {
    // A tripwire, not a rule — legs 2 and 3 already govern the SHAPE of any
    // ring anywhere. Kept at FILE granularity so ordinary line churn doesn't
    // trip it, and so a `ring-*` appearing in a new file is an acknowledged
    // decision rather than a silent one.
    expect([...new Set(RINGED.map((v) => v.file))].sort()).toEqual([
      // The selected swatch's ring. (The picker TRIGGER's decorative hover ring
      // was the file's other member until task 507 gave that trigger the
      // shell's focus indicator, which owns `box-shadow` there; the hover
      // affordance moved to `border-color`.)
      "src/components/PanelThemePicker.tsx",
      // `src/panels/Citations/CitationCard.tsx` was this file's other member
      // until task 508. Its bib-merge drop halo was the sanctioned SHAPE (a
      // decorative ring on an element carrying no focus indicator, reading
      // `--ring-drag-target`) and it never painted: `PanelCard` writes that
      // same root's `box-shadow` INLINE, and inline beats every stylesheet
      // rule. The halo is now a LAYER of that inline declaration
      // (`themedCardStyle`'s `dropTarget` option), so the class is gone —
      // the same law this file's own "no element that takes the indicator
      // also owns box-shadow INLINE" leg states, arriving from the side where
      // the ring is decorative rather than the indicator.
    ]);
  });

  it("no element that takes the indicator also owns box-shadow INLINE", () => {
    // The same law through the other mechanism, and it fails the OPPOSITE way:
    // an inline declaration beats every stylesheet rule, so here the ring is
    // the loser — `.focus-ring` supplies `outline: none` and then cannot paint
    // its own box-shadow, leaving a keyboard-reachable control with NO
    // indicator at all. That is worse than never taking the class, which is
    // why `PERMITTED_UNRINGED_ICON_BUTTONS` records `StackIcon` as unringed
    // rather than ringed; `SelectionActionsMenu`'s margin bolt had taken it
    // anyway (task 503) and is now unringed too.
    //
    // Allowlist EMPTY. A control whose elevation is genuinely inline drops the
    // class; one whose elevation could live on the CLASS layer moves it there
    // (the remedy the bolt's own neighbouring comment already takes for
    // `background`, task 299), and then the ring wins normally.
    const inlineShadow = CLASS_VALUES.filter(
      (v) => FOCUS_INDICATOR.test(v.value) && /(?<![\w$.])boxShadow\s*:/.test(v.tag),
    ).map(site);
    expect(inlineShadow).toEqual([]);
  });

  it("no element that takes the indicator also owns box-shadow INLINE", () => {
    // The same law through the other mechanism, and it fails the OPPOSITE way:
    // an inline declaration beats every stylesheet rule, so here the ring is
    // the loser — `.focus-ring` supplies `outline: none` and then cannot paint
    // its own box-shadow, leaving a keyboard-reachable control with NO
    // indicator at all. That is worse than never taking the class, which is
    // why `PERMITTED_UNRINGED_ICON_BUTTONS` records `StackIcon` as unringed
    // rather than ringed; `SelectionActionsMenu`'s margin bolt had taken it
    // anyway (task 503) and is unringed now too.
    //
    // Allowlist EMPTY. A control whose elevation is genuinely inline drops the
    // class; one whose elevation could live on the CLASS layer moves it there
    // (the remedy the bolt's own neighbouring comment already takes for
    // `background`, task 299) and then the ring wins normally. Stated limit: a
    // `boxShadow` arriving through a variable or a spread is invisible here.
    const inlineShadow = CLASS_VALUES.filter(
      (v) => FOCUS_INDICATOR.test(v.value) && /(?<![\w$.])boxShadow\s*:/.test(v.tag),
    ).map(site);
    expect(inlineShadow).toEqual([]);
  });

  it("CAN SEE both retired shapes, through a const (synthetic canary)", () => {
    // A census that reports zero must be shown to report non-zero, or "clean"
    // and "blind" look identical. The const indirection is the load-bearing
    // half: `<Button>`'s two halves lived in two places.
    const fixture = [
      'const BASE = "rounded-md focus-visible:ring-2 focus-visible:ring-edge-strong";',
      "export function B() {",
      "  return <button className={`${BASE} px-2 focus-ring`} />;",
      "}",
      "function S({ active }: { active: boolean }) {",
      "  return (",
      "    <button",
      "      className={`w-5 h-5 ${",
      '        active ? "ring-2 ring-offset-1 ring-stone-500" : "border-edge-hover"',
      '      } focus-ring`}',
      "    />",
      "  );",
      "}",
    ].join("\n");
    const src = strip(fixture, true, true);
    const consts = constBindings(src);
    expect(consts.get("BASE")).toContain("focus-visible:ring-2");

    const values: string[] = [];
    const attr = /(?<![\w$.])([\w$]*[Cc]lass(?:Name)?)\s*=\s*/g;
    let m: RegExpExecArray | null;
    while ((m = attr.exec(src))) {
      const at = m.index + m[0].length;
      const end = balancedEnd(src, at, "{", "}");
      if (end > 0) values.push(expandConsts(src.slice(at + 1, end - 1), consts));
    }
    expect(values).toHaveLength(2);
    // The exemplar: the ring came from the const, the indicator from the JSX.
    expect(RING_UTILITY.test(values[0]) && FOCUS_INDICATOR.test(values[0])).toBe(true);
    // The swatch: a MULTI-LINE template whose ring sits inside a `${…}`
    // ternary — a line-based scan would have split the two halves apart.
    expect(RING_UTILITY.test(values[1]) && FOCUS_INDICATOR.test(values[1])).toBe(true);
    expect(RAW_PALETTE_RING.test(values[1])).toBe(true);

    // …and the two needles do NOT read each other: `focus-ring` is not a ring
    // utility, and `focus-visible:ring-*` is not the focus indicator.
    expect(RING_UTILITY.test("px-2 focus-ring")).toBe(false);
    expect(FOCUS_INDICATOR.test("focus-visible:ring-2")).toBe(false);
    expect(RAW_PALETTE_RING.test("ring-edge-strong ring-drag-target")).toBe(false);
  });
});
/* ── A SHELL supplies its focusable element's indicator (tasks 507, 554) ── */

/**
 * > **A component that OWNS a focusable element supplies that element's focus
 * > indicator.** Where a shell renders the `<button>` / `<input>` / card root
 * > itself and takes only its CLASS from a prop, the indicator is the SHELL's
 * > obligation — never N callers' to remember — and it is APPENDED, never
 * > `??`-replaced.
 *
 * Task 507 stated the law and applied it to `AnchoredMenu`, and censused it by
 * scanning `<AnchoredMenu …>` TAGS. That population is the shape of the ONE
 * member it had fixed — task 404's finding, in this file — and the read-only
 * sweep that followed found six more members it was structurally blind to.
 * So the population is now DISCOVERED FROM THE SHELLS: every className-ish
 * prop that reaches a `className={…}` on a FOCUSABLE element the shell renders
 * ITSELF. Ten members fall out (`Button`, `PopoutButton`, `AiRequestCheckbox`,
 * `PanelCard`, `AnchoredMenu`'s trigger, `OpenEntryLink`, `HexColorField`'s
 * swatch, `Input`/`Textarea`/`Select`), and a new shell joins by existing.
 *
 * ── The three questions, and why the third had to be added ────────────
 *
 * 507 asked two, of CALL SITES: no `ring-*` in the prop, and no inline
 * `boxShadow` in the paired style prop — both because the appended class owns
 * `box-shadow` while focused, so either one leaves the element with NO
 * indicator (worse than never appending). Both survive here, GENERALIZED and
 * CONDITIONED: they bite only for a member whose indicator IS the box-shadow
 * ring. A member on `.focus-outline` — `PanelCard`, whose ambient lift is an
 * inline `box-shadow` written by `themedCardStyle` — is immune to both by
 * construction, which is the entire reason that second class exists.
 *
 * The THIRD is what the sweep's own members needed. `className ?? DEFAULT`
 * type-checks, renders, and DELETES the indicator for any caller that passes a
 * class: `PopoutButton`'s default IS `iconbtn-sm`, so its one live caller
 * (`FloatChrome`, passing `iconbtn-xs`) was safe by luck, and `OpenEntryLink`'s
 * default carried none either, so BOTH its branches were bare. A default
 * PARAMETER is the same shape one spelling over (`HexColorField`'s swatch).
 * No behavioural test of any of them can see it — each renders perfectly for
 * the caller it happens to have.
 *
 * ── What this census can and cannot see ───────────────────────────────
 *
 *  - **Reach is ONE HOP over same-file functions.** `AnchoredMenu` writes
 *    `className={anchoredTriggerClassName(…)}`, and that resolver enters the
 *    door; a resolver two hops away, or one imported from another file, would
 *    read as unindicated and fail CLOSED. That is the safe direction and the
 *    same limit every reach-based census in this repo records.
 *  - **A member with a STATED POSTURE declares it in place.** The three field
 *    primitives take a thickened border rather than a ring
 *    (`STYLE_GUIDE.md` → Interaction → Focus: "Inputs use a thicker border
 *    instead of a ring"), which no class needle can see because it lives
 *    inside `fieldChrome()`. They carry a `focus-indicator-posture:` marker at
 *    the element, read from RAW source — a marker inside a comment is invisible
 *    to the stripped source every needle below reads. There is NO allowlist:
 *    a posture travels with the code or it is not stated.
 *  - **A PASS-THROUGH is not a member, by construction.** `EditableCard`'s
 *    `wrapperClassName` and `CitationCard`'s go to another COMPONENT, so
 *    neither reaches an intrinsic element here and neither is double-counted
 *    against `PanelCard`, which is the shell that renders the root.
 *  - **A computed prop VALUE at a call site is opaque**, exactly as leg C
 *    above records: `triggerClassName={cls}` cannot be read for a ring token.
 */

/** A className-ish identifier: `className`, `triggerClassName`, `swatchClassName`. */
const CLASSNAME_ISH = /(?<![\w"'`.])(?:[a-zA-Z][A-Za-z0-9]*)?[cC]lassName(?![\w])/g;

/** Intrinsic tags that take DOM focus with no `tabIndex` at all. */
const INTRINSIC_FOCUSABLE = new Set(["button", "input", "select", "textarea"]);

/**
 * Index just past the `close` matching the `open` at `i`, modelling NESTED
 * template literals.
 *
 * `balancedEnd` above states the un-modelled-nesting limit and is right about
 * the tags it reads; a whole component BODY is a different scale, and
 * `field-primitives`' `` `${…${className}…}` `` desynchronizes a flat
 * quote-skipper — measured, it swallowed `Input`'s body through `Textarea`'s
 * and reported both shells against the same element. A `${…}` is scanned as a
 * brace group, recursing back through here, so a template inside it is handled
 * at any depth.
 */
function balancedBody(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === "/" && s[j + 1] === "/") {
      while (j < s.length && s[j] !== "\n") j++;
      continue;
    }
    if (c === "/" && s[j + 1] === "*") {
      const e = s.indexOf("*/", j + 2);
      j = e < 0 ? s.length : e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      j++;
      while (j < s.length && s[j] !== q) {
        if (s[j] === "\\") j++;
        j++;
      }
      j++;
      continue;
    }
    if (c === "`") {
      j = skipTemplateLiteral(s, j);
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return -1;
}

/** Index just past the backtick closing the template literal opening at `j`. */
function skipTemplateLiteral(s: string, j: number): number {
  j++;
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "`") return j + 1;
    if (c === "$" && s[j + 1] === "{") {
      const e = balancedBody(s, j + 1, "{", "}");
      j = e > 0 ? e : s.length;
      continue;
    }
    j++;
  }
  return j;
}

/** Every JSX opening tag in `body` whose element name is INTRINSIC (lowercase). */
function intrinsicTags(body: string): { name: string; tag: string }[] {
  const out: { name: string; tag: string }[] = [];
  const re = /<([a-z][a-zA-Z0-9-]*)(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    let j = m.index + 1;
    while (j < body.length) {
      const c = body[j];
      if (c === '"' || c === "'") {
        const q = c;
        j++;
        while (j < body.length && body[j] !== q) {
          if (body[j] === "\\") j++;
          j++;
        }
      } else if (c === "`") {
        j = skipTemplateLiteral(body, j) - 1;
      } else if (c === "{") {
        const e = balancedBody(body, j, "{", "}");
        j = e > 0 ? e - 1 : j;
      } else if (c === ">") break;
      j++;
    }
    out.push({ name: m[1], tag: body.slice(m.index, j + 1) });
  }
  return out;
}

/** The RAW source of `name={…}` / `name="…"` inside a tag, or null. */
function propValue(tag: string, name: string): string | null {
  const m = new RegExp(`(?<![\\w-])${name}\\s*=\\s*`).exec(tag);
  if (!m) return null;
  const at = m.index + m[0].length;
  const q = tag[at];
  if (q === '"' || q === "'") {
    const close = tag.indexOf(q, at + 1);
    return close > 0 ? tag.slice(at + 1, close) : null;
  }
  if (q === "{") {
    const end = balancedEnd(tag, at, "{", "}");
    return end > 0 ? tag.slice(at + 1, end - 1) : null;
  }
  return null;
}

interface ShellMember {
  /** Repo-relative file of the SHELL. */
  file: string;
  /** The component that renders the element. */
  shell: string;
  /** The className-ish prop whose value reaches it. */
  prop: string;
  /** The intrinsic tag name. */
  tag: string;
  /** The raw `className={…}` expression. */
  expr: string;
  /** The element's whole opening tag. */
  tagSource: string;
  /** RAW source from the shell's declaration to the element — where an
   *  in-place `focus-indicator-posture:` marker is read from. */
  rawAbove: string;
  /** Same-file function declarations, for the one-hop reach. */
  fileSource: string;
}

/**
 * Every (shell, className-ish prop, focusable element) triple in both silos.
 *
 * A component declaration is `export function X(` / `const X = forwardRef<…>(
 * function X(` / `const X = (`; its body is brace-balanced from the `{` after
 * the parameter list. An element is FOCUSABLE when it is intrinsically so, or
 * carries a literal `tabIndex`, or receives the shell's `{...rest}` spread —
 * which for `PanelCard` is how `tabIndex` arrives (its props extend
 * `HTMLAttributes<HTMLDivElement>`, and `EditableCard` plus four panels thread
 * `tabIndex={selected ? 0 : -1}` through it). That last clause can
 * over-collect a non-focusable `<div {...rest}>`; the cost of a false member is
 * one posture marker, and the direction is the safe one for an a11y census.
 */
function shellFocusMembers(): ShellMember[] {
  const out: ShellMember[] = [];
  const files = SILOS.flatMap((s) => trackedFiles(s, /\.tsx$/)).filter(
    (p) => !p.includes("__tests__"),
  );
  for (const abs of files) {
    const rel = path.relative(ROOT, abs);
    const raw = fs.readFileSync(abs, "utf8");
    // Comments blanked, string literals KEPT — every needle below lives inside
    // a quoted class list or a prop name (the trap `_source-scan`'s own header
    // records). The POSTURE marker is read from `raw`, since it IS a comment.
    const src = strip(raw, true, true);
    const decl =
      /(?:^|\n)\s*(?:export\s+)?(?:const\s+(\w+)\s*(?::[^=\n]*)?=\s*(?:forwardRef<[^>]*>\(\s*)?(?:function\s+\w*\s*)?|function\s+(\w+)\s*)\(/g;
    let m: RegExpExecArray | null;
    while ((m = decl.exec(src))) {
      const shell = m[1] ?? m[2];
      if (!shell || !/^[A-Z]/.test(shell)) continue; // components only
      const paramOpen = decl.lastIndex - 1;
      const paramEnd = balancedBody(src, paramOpen, "(", ")");
      if (paramEnd < 0) continue;
      const params = src.slice(paramOpen, paramEnd);
      const props = [...new Set(params.match(CLASSNAME_ISH) ?? [])];
      if (props.length === 0) continue;
      const spreads = /\.\.\.(rest|props)\b/.test(params);
      const bodyOpen = src.indexOf("{", paramEnd);
      if (bodyOpen < 0) continue;
      const bodyEnd = balancedBody(src, bodyOpen, "{", "}");
      const body = src.slice(bodyOpen, bodyEnd < 0 ? src.length : bodyEnd);
      for (const t of intrinsicTags(body)) {
        const focusable =
          INTRINSIC_FOCUSABLE.has(t.name) ||
          (t.name === "a" && /(?<![\w-])href\s*=/.test(t.tag)) ||
          /(?<![\w-])tabIndex\s*=/.test(t.tag) ||
          (spreads && /\{\s*\.\.\.(?:rest|props)\s*\}/.test(t.tag));
        if (!focusable) continue;
        const expr = propValue(t.tag, "className");
        if (expr === null) continue;
        for (const prop of props) {
          if (!new RegExp(`(?<![\\w.])${prop}(?![\\w])`).test(expr)) continue;
          // The RAW window the posture marker is read from: the element's own
          // tag plus everything back to the shell's declaration. Raw offsets
          // are not the stripped ones, so anchor on the tag's own first line.
          const firstLine = t.tag.split("\n")[0];
          const rawAt = raw.indexOf(firstLine);
          out.push({
            file: rel,
            shell,
            prop,
            tag: t.name,
            expr,
            tagSource: t.tag,
            rawAbove: rawAt > 0 ? raw.slice(Math.max(0, rawAt - 900), rawAt) : "",
            fileSource: src,
          });
        }
      }
    }
  }
  return out;
}

const MEMBERS = shellFocusMembers();
const memberAt = (m: ShellMember) => `${m.file}::${m.shell}(${m.prop})`;

/** The door, and the two classes it hands out. */
const DOOR = /(?<![\w-])withFocusIndicator\s*\(/;
const OUTLINE_MEMBER = /(?<![\w-])(?:FOCUS_OUTLINE_CLASS|focus-outline(?![\w-]))/;
/** A member that states, in place, why it takes no class from the door. */
const POSTURE_MARKER = /focus-indicator-posture:/;

/** Does the member's className expression reach the door — directly, or one
 *  hop through a resolver declared in the same file? */
function reachesDoor(m: ShellMember): boolean {
  if (DOOR.test(m.expr)) return true;
  for (const call of m.expr.matchAll(/(?<![\w.])([a-z][A-Za-z0-9]*)\s*\(/g)) {
    const name = call[1];
    const at = new RegExp(`function\\s+${name}\\s*\\(`).exec(m.fileSource);
    if (!at) continue;
    const bodyOpen = m.fileSource.indexOf("{", at.index + at[0].length);
    if (bodyOpen < 0) continue;
    const end = balancedBody(m.fileSource, bodyOpen, "{", "}");
    if (DOOR.test(m.fileSource.slice(bodyOpen, end < 0 ? undefined : end))) return true;
  }
  return false;
}

/** Which indicator a member supplies — the two the door hands out, or a
 *  posture stated at the site. Everything else is `none`, which is the defect. */
type Mechanism = "ring" | "outline" | "posture" | "none";
function mechanismOf(m: ShellMember): Mechanism {
  if (POSTURE_MARKER.test(m.rawAbove)) return "posture";
  if (!reachesDoor(m)) return "none";
  return OUTLINE_MEMBER.test(m.expr) ? "outline" : "ring";
}

describe("a SHELL that owns a focusable element supplies its indicator", () => {
  it("sees a population worth censusing (self-check)", () => {
    // A discovery that stopped matching would make every leg below pass
    // vacuously. Floors anchored under today's ten, across four files, with
    // BOTH class mechanisms and the stated posture represented — a census that
    // only ever saw rings could not have caught the card wrapper.
    expect(MEMBERS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(MEMBERS.map((m) => m.file)).size).toBeGreaterThanOrEqual(4);
    const mechs = new Set(MEMBERS.map(mechanismOf));
    expect(mechs.has("ring")).toBe(true);
    expect(mechs.has("outline")).toBe(true);
    expect(mechs.has("posture")).toBe(true);
    // The named members the sweep found, so a discovery that silently narrowed
    // to a subset fails here rather than reporting a clean subset.
    const named = new Set(MEMBERS.map((m) => `${m.shell}(${m.prop})`));
    for (const key of [
      "Button(className)",
      "PopoutButton(className)",
      "AiRequestCheckbox(className)",
      "PanelCard(className)",
      "AnchoredMenu(triggerClassName)",
      "OpenEntryLink(className)",
      "HexColorField(swatchClassName)",
      "Input(className)",
      "Textarea(className)",
      "Select(className)",
    ]) {
      expect(named).toContain(key);
    }
  });

  it("every member SUPPLIES an indicator — the door, or a stated posture", () => {
    // The law itself. Allowlist EMPTY: a shell that renders the element and
    // takes its class from a prop either enters the door or says at the site
    // why its indicator is something else. Before task 554 three members
    // supplied nothing at all — `AiRequestCheckbox` (seven callers, every
    // AI-request checkbox in every card panel), `OpenEntryLink`, and
    // `HexColorField`'s swatch.
    const bare = MEMBERS.filter((m) => mechanismOf(m) === "none").map(memberAt);
    expect(bare).toEqual([]);
  });

  it("every member COMPOSES — the caller's class never REPLACES the indicator", () => {
    // The third question, and the one no behavioural test can ask: a
    // `className ?? DEFAULT` renders perfectly for the caller it happens to
    // have. The rule is not "no `??`" — a shell may legitimately fall back to a
    // default GEOMETRY — it is that the indicator must be applied OUTSIDE the
    // fallback, which entering the door guarantees by construction.
    const replacing = MEMBERS.filter((m) => {
      const fallback = new RegExp(
        `(?<![\\w.])${m.prop}\\s*(?:\\?\\?|\\|\\|)`,
      ).test(m.expr);
      if (!fallback) return false;
      return !DOOR.test(m.expr);
    }).map(memberAt);
    expect(replacing).toEqual([]);
  });

  it("the door is the ONE place either class is bound to a NAME", () => {
    // The shell was never the part that could misbehave; a private copy of the
    // class is — which is exactly what task 507 left behind
    // (`AnchoredMenu`'s own `const TRIGGER_FOCUS_RING_CLASS = "focus-ring"`),
    // and what this task retired onto the door rather than growing a seventh
    // spelling of.
    //
    // Scoped to a NAMED BINDING, deliberately, because the alternative is
    // wrong: spelling `className="focus-ring"` on an element you own is the
    // SANCTIONED reach-for-it case STYLE_GUIDE describes ("a 10px outline
    // chevron, a button whose ink is accent-when-active") and six production
    // files legitimately do it. What a shell must not do is re-derive the
    // door's job under a local name — that is the copy that drifts, and it is
    // invisible to every behavioural test of the shell that holds it.
    const DOOR_FILE = "src/components/focus-indicator.ts";
    const BOUND =
      /(?:const|let|var)\s+\w+(?:\s*:[^=]*?)?\s*=\s*["'`](?:focus-ring|focus-outline)["'`]/;
    const offenders: string[] = [];
    for (const silo of SILOS) {
      for (const abs of trackedFiles(silo, /\.tsx?$/)) {
        const rel = path.relative(ROOT, abs);
        if (rel === DOOR_FILE || rel.includes("__tests__")) continue;
        if (BOUND.test(commentsStripped(fs.readFileSync(abs, "utf8")))) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
    // …and the canary: the retired shape, which must still be visible.
    expect(BOUND.test('const TRIGGER_FOCUS_RING_CLASS = "focus-ring";')).toBe(true);
    expect(BOUND.test('className="focus-ring"')).toBe(false);
  });

  it("the RING composes with an iconbtn-* rather than double-painting", () => {
    // Three `AnchoredMenu` triggers and `PopoutButton`'s default already carry
    // an `iconbtn-*`, so the append gives them BOTH class names. That is ONE
    // indicator because the two selectors share ONE declaration block in
    // `globals.css` — a fact about the stylesheet no jsdom render can observe.
    const css = cssCommentsStripped(
      fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8"),
    );
    const at = css.indexOf(".focus-ring:focus-visible");
    expect(at).toBeGreaterThan(0);
    const open = css.indexOf("{", at);
    const close = css.indexOf("}", open);
    const selectors = css.slice(at, open);
    const body = css.slice(open + 1, close);
    for (const size of ["xs", "sm", "md", "lg"]) {
      expect(selectors).toContain(`.iconbtn-${size}:focus-visible`);
    }
    expect(body.match(/box-shadow\s*:/g) ?? []).toHaveLength(1);
    expect(body).toContain("var(--focus-ring-shadow)");
  });

  it("the OUTLINE member draws the same edge, and its restore wins", () => {
    // The second class exists for one reason — an element whose `box-shadow`
    // is taken by an inline style — so it must draw the SAME edge through the
    // free property, and its `:focus-visible` rule must come SECOND: both
    // selectors are (0,2,0), so source order is what makes the restore beat the
    // strip. Reversed, `.focus-outline` would be `outline: none` and nothing
    // else: the exact defect the six hand-spelled `focus:outline-none` card
    // wrappers had.
    const css = cssCommentsStripped(
      fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8"),
    );
    const strip1 = css.indexOf(".focus-outline:focus");
    const restore = css.indexOf(".focus-outline:focus-visible");
    expect(strip1).toBeGreaterThan(0);
    expect(restore).toBeGreaterThan(strip1);
    const open = css.indexOf("{", restore);
    const body = css.slice(open + 1, css.indexOf("}", open));
    expect(body).toMatch(/outline\s*:\s*2px solid var\(--edge-strong\)/);
    // …and the ring's own edge is the same token, so the two cannot drift.
    const ringAt = css.indexOf(":root");
    expect(css.slice(ringAt)).toMatch(
      /--focus-ring-shadow:[^;]*var\(--edge-strong\)/,
    );
  });

  it("no caller passes a ring utility into a RING member's prop", () => {
    // The collision no other leg can see: the ring lives in the CALLER's file
    // and the indicator in the SHELL's. A `ring-*` there paints NOTHING while
    // focused — for a `hover:ring-*` the affordance dies exactly when a
    // keyboard user is pointing at it. CONDITIONED on the mechanism: an
    // `.focus-outline` member owns no `box-shadow`, so a ring beside it is
    // fine, which is that member's whole point. Allowlist EMPTY: the remedy is
    // another PROPERTY (`border-color`), which is what `PanelThemePicker` took.
    const ringed = callSiteHits(
      (m) => mechanismOf(m) === "ring",
      (value) => RING_UTILITY.test(value),
    );
    expect(ringed).toEqual([]);
  });

  it("no caller declares an inline boxShadow beside a RING member", () => {
    // The same law through the other mechanism, failing the OPPOSITE way: an
    // inline declaration beats the sheet, so the shell's `outline: none` lands
    // and its box-shadow cannot — a keyboard-reachable element with NO
    // indicator, strictly worse than never appending. The style prop is
    // DERIVED from the class prop (`triggerClassName` → `triggerStyle`,
    // `className` → `style`), never a hand list. Again conditioned: `PanelCard`
    // writes exactly such a shadow ITSELF, which is why it is on the outline.
    const shadowed = callSiteHits(
      (m) => mechanismOf(m) === "ring",
      () => false,
      (styleValue) => /(?<![\w$.])boxShadow\s*:/.test(styleValue),
    );
    expect(shadowed).toEqual([]);
  });

  it("an opted-out trigger carries its OWN indicator — never a silent skip", () => {
    // `AnchoredMenu`'s opt-out is the one per-member escape in the family, and
    // no consumer takes it today, so this is a BOUNDS pin rather than a defect
    // leg — the canary below is what keeps it falsifiable.
    const bare = anchoredMenuTags()
      .filter((tag) => {
        if (!optsOut(tag)) return false;
        const cls = propValue(tag, "triggerClassName");
        return cls === null || !FOCUS_INDICATOR.test(cls);
      })
      .map(() => "an opted-out <AnchoredMenu> with no indicator of its own");
    expect(bare).toEqual([]);
  });

  it("CAN SEE every shape it forbids, on a synthetic fixture (canary)", () => {
    // A census that reports zero must be shown to report non-zero, or "clean"
    // and "blind" look identical. Synthetic rather than standing on a live
    // line: an allowlist this file drains would take the canary with it.
    const fixture = [
      "export function Bare({ className }: { className?: string }) {",
      "  return <button className={className}>x</button>;",
      "}",
      "export function Replacing({ className }: { className?: string }) {",
      '  return <button className={className ?? "iconbtn-sm"}>x</button>;',
      "}",
      "export function Fine({ className }: { className?: string }) {",
      "  return <button className={withFocusIndicator(className)}>x</button>;",
      "}",
      "export function Postured({ className }: { className?: string }) {",
      "  return (",
      "    /* focus-indicator-posture: BORDER, not ring. */",
      "    <input className={className} />",
      "  );",
      "}",
    ].join("\n");

    const found = membersIn("fixture.tsx", fixture);
    expect(found.map((m) => `${m.shell}(${m.prop})`)).toEqual([
      "Bare(className)",
      "Replacing(className)",
      "Fine(className)",
      "Postured(className)",
    ]);
    const mech = Object.fromEntries(found.map((m) => [m.shell, mechanismOf(m)]));
    expect(mech.Bare).toBe("none"); // leg 2 flags it
    expect(mech.Replacing).toBe("none"); // …and so does leg 2, for `??` too
    expect(mech.Fine).toBe("ring");
    expect(mech.Postured).toBe("posture");

    // Leg 3's own shape, isolated: a `??` fallback INSIDE the door is fine
    // (`PopoutButton` is exactly that), and one outside it is not.
    const outside = found.find((m) => m.shell === "Replacing")!;
    expect(DOOR.test(outside.expr)).toBe(false);
    expect(/(?<![\w.])className\s*(?:\?\?|\|\|)/.test(outside.expr)).toBe(true);
    const inside = MEMBERS.find((m) => m.shell === "PopoutButton")!;
    expect(/(?<![\w.])className\s*\?\?/.test(inside.expr)).toBe(true);
    expect(DOOR.test(inside.expr)).toBe(true);

    // …and the call-site needles read a real value rather than a prop NAME.
    expect(RING_UTILITY.test("w-5 h-5 hover:ring-2")).toBe(true);
    expect(RING_UTILITY.test("px-2 focus-ring")).toBe(false);
    expect(/(?<![\w$.])boxShadow\s*:/.test('{ boxShadow: "0 1px 2px" }')).toBe(true);
  });
});

/** Discovery run over a synthetic source — the canary's half of the census. */
function membersIn(rel: string, raw: string): ShellMember[] {
  const src = strip(raw, true, true);
  const out: ShellMember[] = [];
  const decl =
    /(?:^|\n)\s*(?:export\s+)?(?:const\s+(\w+)\s*(?::[^=\n]*)?=\s*(?:forwardRef<[^>]*>\(\s*)?(?:function\s+\w*\s*)?|function\s+(\w+)\s*)\(/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(src))) {
    const shell = m[1] ?? m[2];
    if (!shell || !/^[A-Z]/.test(shell)) continue;
    const paramOpen = decl.lastIndex - 1;
    const paramEnd = balancedBody(src, paramOpen, "(", ")");
    if (paramEnd < 0) continue;
    const params = src.slice(paramOpen, paramEnd);
    const props = [...new Set(params.match(CLASSNAME_ISH) ?? [])];
    if (props.length === 0) continue;
    const bodyOpen = src.indexOf("{", paramEnd);
    const bodyEnd = balancedBody(src, bodyOpen, "{", "}");
    const body = src.slice(bodyOpen, bodyEnd < 0 ? src.length : bodyEnd);
    for (const t of intrinsicTags(body)) {
      if (!INTRINSIC_FOCUSABLE.has(t.name)) continue;
      const expr = propValue(t.tag, "className");
      if (expr === null) continue;
      for (const prop of props) {
        if (!new RegExp(`(?<![\\w.])${prop}(?![\\w])`).test(expr)) continue;
        const firstLine = t.tag.split("\n")[0];
        const rawAt = raw.indexOf(firstLine);
        out.push({
          file: rel,
          shell,
          prop,
          tag: t.name,
          expr,
          tagSource: t.tag,
          rawAbove: rawAt > 0 ? raw.slice(Math.max(0, rawAt - 900), rawAt) : "",
          fileSource: src,
        });
      }
    }
  }
  return out;
}

/** Every `<AnchoredMenu …>` opening tag in both silos' production `.tsx`. */
function anchoredMenuTags(): string[] {
  const out: string[] = [];
  for (const silo of SILOS) {
    for (const abs of trackedFiles(silo, /\.tsx$/)) {
      if (abs.includes("__tests__")) continue;
      const src = strip(fs.readFileSync(abs, "utf8"), true, true);
      for (const hit of elementsNamed(src, "AnchoredMenu")) out.push(hit.tag);
    }
  }
  return out;
}

/** A trigger that declares it composes its own indicator. */
const optsOut = (tag: string) =>
  /(?<![\w-])triggerOwnsFocusIndicator(?!\s*=\s*\{\s*false\s*\})/.test(tag);

/**
 * Call sites of the censused shells, filtered.
 *
 * The style prop is DERIVED from the class prop rather than listed:
 * `triggerClassName` → `triggerStyle`, `wrapperClassName` → `wrapperStyle`,
 * `className` → `style`. `AnchoredMenu`'s opt-out is honoured — that caller
 * has declared it composes its own — and a computed value the scanner cannot
 * read is SKIPPED, the same fail-toward-silence limit leg C records.
 */
function callSiteHits(
  include: (m: ShellMember) => boolean,
  classBad: (value: string) => boolean,
  styleBad?: (value: string) => boolean,
): string[] {
  const wanted = MEMBERS.filter(include);
  const byShell = new Map<string, ShellMember[]>();
  for (const m of wanted) {
    const list = byShell.get(m.shell) ?? [];
    list.push(m);
    byShell.set(m.shell, list);
  }
  const hits: string[] = [];
  for (const silo of SILOS) {
    for (const abs of trackedFiles(silo, /\.tsx$/)) {
      if (abs.includes("__tests__")) continue;
      const rel = path.relative(ROOT, abs);
      const src = strip(fs.readFileSync(abs, "utf8"), true, true);
      for (const [shell, members] of byShell) {
        for (const hit of elementsNamed(src, shell)) {
          if (optsOut(hit.tag)) continue;
          for (const m of members) {
            const cls = propValue(hit.tag, m.prop);
            if (cls !== null && classBad(cls)) {
              hits.push(`${rel} <${shell} ${m.prop}>`);
            }
            if (!styleBad) continue;
            const styleProp = m.prop.replace(/[cC]lassName$/, "") + "Style";
            const style = propValue(
              hit.tag,
              styleProp === "Style" ? "style" : styleProp,
            );
            if (style !== null && styleBad(style)) {
              hits.push(`${rel} <${shell} ${styleProp}>`);
            }
          }
        }
      }
    }
  }
  return [...new Set(hits)];
}
