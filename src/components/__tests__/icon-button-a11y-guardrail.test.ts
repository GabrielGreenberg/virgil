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
 *  - **Only `<button>`.** A `role="button"` div or an `<a>` is a different
 *    (and rarer) shape here; neither is censused.
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
  elementsNamed,
  tagEnd,
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
