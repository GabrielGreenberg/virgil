// Menu-surface guardrail — the CHROME-token sibling of `anchored-menu-guardrail`
// (task 295; doctrine: STYLE_GUIDE "Menus", AGENTS.md "A registry earns its name
// by being read").
//
// The law: *the `<Menu>` primitive owns the menu SURFACE.* `MenuProvider` stamps
// `.menu-surface` (bg + border + shadow + radius, off the `--menu-*` tier in
// `globals.css`) on its container; a consumer passes width, padding and
// docked-anchor placement, and nothing else.
//
// Why this census exists, and why it is the guard that catches the ORIGINAL
// shape. The primitive was never the part that could misbehave — it drew a hard
// line at behaviour (positioning / portal / z-tier / dismissal / roving nav) and
// delegated all four surface axes to whoever mounted it. So each of ~12 live
// containers hand-authored its own chrome, and they drifted into SIX
// vocabularies that no test could see, because every test spelled the surface
// the same way the component it tested did:
//
//   - the pod tokens (`--pod-editor` / `--pod-border` / `--pod-shadow` /
//     `--pod-radius`) as inline `containerStyle`, on the grab, lightning,
//     heading-type, colour, tab-plus and the two topbar kebab menus;
//   - `AnchoredMenu`'s exported `MENU_SURFACE_CLASS`
//     (`bg-surface border border-[var(--border)] rounded-lg shadow-lg py-1`) —
//     a DIFFERENT border grey (#e5e2dd vs #c9c5c5) and a much larger shadow;
//   - MenuBar's BlockType and View dropdowns, each carrying a hand-COPY of that
//     string inside its own placement-class array;
//   - `BibEntryPickerMenu`, with a third border grey (`--edge-subtle` #e7e5e4)
//     and a third shadow depth (`shadow-md`).
//
// Task 134 converged the RADIUS axis by walking every site — which is what
// guarantees the next axis drifts the same way, since after it the primitive
// still owned no surface at all. Every menu here floats or portals, so there is
// no inline-vs-floating distinction that would justify one depth on the editor's
// menus and another on the header's: it is vocabulary drift, and it is silent.
//
// Three legs:
//   1. CENSUS (the leg with teeth) — no `<MenuProvider>` / `<AnchoredMenu>` call
//      site in EITHER silo may write chrome through `containerClassName` /
//      `containerStyle` / `menuClassName`.
//   2. OPT-OUT — every `surface="none"` site is on `PERMITTED_UNSURFACED_MENUS`
//      with a stated reason.
//   3. MECHANISM — the CSS the census presupposes: `.menu-surface` states all
//      four axes, each from its own `--menu-*` token, and each token is defined.
//
// ── Legs 4 and 5: the population hole (task 459) ────────────────────────────
// Legs 1-3 discover their population from a MECHANISM — a `<MenuProvider>` /
// `<AnchoredMenu>` mount — and a floating command surface can be one without
// using it. Four were: `SlashCommandPopup` (anchored to a caret rect),
// `NodeEditPopover` (took the positioning primitive and not the surface), and
// two rules that author their chrome entirely in `globals.css`. So:
//
//   4. SHARED POPULATION — every hand-rolled anchored MENU the sibling census
//      finds (`handRolledMenus()` in `./_menu-census.ts`) must paint from the
//      `--menu-*` tier, whatever it is anchored to. One population, two
//      questions: the anchored census asks who POSITIONS by hand, this asks who
//      PAINTS by hand, and a menu on the first list is no longer exempt from
//      the second. Task-404's rule: discover a census's population by the
//      QUESTION, not by the MECHANISM.
//   5. STYLESHEET — the residual leg 1's own note below declines. A CSS rule
//      that paints all four surface axes IS a surface; each must read `--menu-*`
//      or be allowlisted with a reason.
//
// Stated limits, rather than implied. The census reads the OPEN TAG, so chrome
// composed into a variable and passed by name (`containerClassName={cls}`) is
// caught only when the variable's own value is a chrome literal in the same file
// — which is why leg 1 also greps every file that mounts a menu for a
// menu-shaped chrome string, and why the MenuBar dropdowns (whose class arrays
// are exactly that shape) are covered. A surface authored entirely inside a CSS
// class the caller merely names is invisible here, the same residual the
// anchored-menu census records; that shape is now a declared `surface="none"`
// and therefore leg 2's business.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { commentsStripped, elementsNamed, cssRuleBodies, cssCommentsStripped } from "@/lib/__tests__/_source-scan";
import { handRolledMenus } from "./_menu-census";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../../library");
const GLOBALS_CSS = path.join(SRC, "app/globals.css");

/**
 * Menus that author their own surface, keyed `<repo-relative file>::<reason>`.
 *
 * An entry must say why the look is that menu's IDENTITY rather than the drift
 * the shared surface exists to end. "It looked like that before" is not a
 * reason — every one of the six vocabularies above could have said it.
 *
 * The set may only SHRINK.
 */
const PERMITTED_UNSURFACED_MENUS: Record<string, string> = {
  "src/components/LabelRefPopover.tsx":
    "IDENTITY, not drift. `.label-ref-popover` is a 2px `--amber-highlight-edge` border plus a matching amber halo, which binds the popover to the amber `\\ref` highlight in the text it points at — the same token, so a ref recolour moves both together. Its radius is `--radius-md` (the CONTROL tier) rather than the menu tier for the same reason: it reads as an inline editing affordance over the text, not as a dropdown off a trigger. Giving it the menu surface would break a deliberate binding; the census's job is to make that a stated decision instead of a seventh accident.",
};

/**
 * CSS rules that paint all four surface axes and are NOT menus, keyed by
 * selector (task 459, leg 5).
 *
 * Same bar as the mount allowlist above: an entry says why the look is that
 * surface's IDENTITY, not the drift the shared tier exists to end. The set may
 * only SHRINK.
 */
const PERMITTED_NON_MENU_CSS_SURFACES: Record<string, string> = {
  ".menu-surface":
    "IT IS THE TIER. The rule the other four axes are defined for — leg 3 above asserts each of its declarations reads its own `--menu-*` token, which is a stronger statement than this leg makes, so exempting it here is not a hole: it is the leg that would fail first.",
  ".lifted-text-overlay":
    "NOT A MENU — the drag GHOST of lifted text (AGENTS.md \"The tag half\"). It is the moving preview of a document block, so its surface must read as a lifted PAGE rather than as a dropdown: a menu-tier retone would make a dragged paragraph look like a popup, and its elevation is deliberately the lift shadow rather than the menu halo. Its header parity with the float chrome is pinned separately by `lift-ghost-header-parity`.",
  ".label-ref-popover":
    "IDENTITY, not drift — the CSS half of the one entry on `PERMITTED_UNSURFACED_MENUS` above, and the same reason: a 2px `--amber-highlight-edge` border plus a matching amber halo binds the popover to the amber `\\ref` highlight in the text it points at, so a ref recolour moves both together. Its INNER dropdown list is a different surface and took the menu tier in task 459; this outer shell is the deliberate binding.",
};

/** Parse `css` into rules that paint ALL FOUR surface axes.
 *
 *  Exported shape rather than a regex at the call site so the swallow
 *  self-check can drive the same function over a synthetic fixture — a
 *  detector proved on the production tree the allowlist exists to drain proves
 *  nothing once the tree is drained. */
function parseFourAxisRules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const RULE = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = RULE.exec(css))) {
    // The last line of the prelude: a comma-separated group or an at-rule
    // preamble would otherwise report a selector nobody can key an entry on.
    const selector = m[1].trim().split("\n").pop()!.trim();
    const body = m[2];
    const hasBg = /(?:^|[;{\s])background(?:-color)?\s*:/.test(body);
    const hasBorder =
      /(?:^|[;\s])border\s*:/.test(body) ||
      /border-(?:top|right|bottom|left)?-?(?:width|color)\s*:/.test(body);
    const hasRadius = /border-radius\s*:/.test(body);
    const hasShadow = /box-shadow\s*:/.test(body);
    if (hasBg && hasBorder && hasRadius && hasShadow) out.push({ selector, body });
  }
  return out;
}

function fourAxisSurfaceRules(): Array<{ selector: string; body: string }> {
  return parseFourAxisRules(cssCommentsStripped(readFileSync(GLOBALS_CSS, "utf8")));
}

/** The four chrome axes, in every dialect this repo writes them.
 *
 *  Split by SHAPE rather than by axis because the two dialects fail
 *  differently: an inline `containerStyle` key beats any class by specificity
 *  (so it silently defeats `.menu-surface` rather than merely duplicating it),
 *  while a Tailwind utility ties with it and resolves by stylesheet order —
 *  which is a coin flip nobody authored. */
const CHROME_STYLE_KEY =
  /\b(?:background|backgroundColor|backgroundImage|border|borderColor|borderWidth|borderStyle|borderRadius|boxShadow)\s*:/;
/** Tailwind + arbitrary-value chrome utilities. `bg-`/`border`/`shadow-`/
 *  `rounded` cover the whole family including `shadow-[var(--pod-shadow)]` and
 *  `border-[var(--border)]`; `border` alone is listed as a WORD so the bare
 *  `border` utility (which is what `border border-[…]` opens with) is caught. */
const CHROME_CLASS =
  /\b(?:bg-[A-Za-z0-9[\]()_,./#%-]+|border(?:-[A-Za-z0-9[\]()_,./#%-]+)?|shadow(?:-[A-Za-z0-9[\]()_,./#%-]+)?|rounded(?:-[A-Za-z0-9[\]()_,./#%-]+)?)\b/;

/** The props through which a caller can reach the menu CONTAINER. Trigger and
 *  wrapper props are deliberately absent: `PanelThemePicker`'s trigger IS a
 *  bordered colour swatch, and indicting it would be a false positive on the
 *  one thing a trigger legitimately owns. */
const CONTAINER_PROPS = [
  "containerClassName",
  "containerStyle",
  "menuClassName",
] as const;

/** The value of `prop` in an open tag, or null. Brace-balanced + quote-aware,
 *  so an arrow function or a nested object inside a neighbouring prop cannot
 *  truncate the read (the `tagEnd` lesson, one level in). */
function propValue(tag: string, prop: string): string | null {
  const at = tag.indexOf(`${prop}=`);
  if (at < 0) return null;
  let i = at + prop.length + 1;
  const open = tag[i];
  if (open === '"' || open === "'") {
    const end = tag.indexOf(open, i + 1);
    return end < 0 ? tag.slice(i) : tag.slice(i + 1, end);
  }
  if (open !== "{") return null;
  let depth = 0;
  for (let j = i; j < tag.length; j++) {
    const c = tag[j];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      j++;
      while (j < tag.length && tag[j] !== q) {
        if (tag[j] === "\\") j++;
        j++;
      }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return tag.slice(i + 1, j);
    }
  }
  return tag.slice(i);
}

/**
 * The initializer of `const|let <name> = …` in `source`, up to the statement's
 * terminating `;` at depth 0, or null.
 *
 * Brace/bracket/quote-aware for the same reason `tagEnd` is: the shape this
 * exists to read is an ARRAY of placement strings joined at the end
 * (`[…].join(" ")`), and a line-scoped or `[^;]*` read stops at the first
 * newline or at a `;` inside a template literal.
 */
function declarationInitializer(source: string, name: string): string | null {
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`).exec(source);
  if (!decl) return null;
  let i = decl.index + decl[0].length;
  let depth = 0;
  for (let j = i; j < source.length; j++) {
    const c = source[j];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      j++;
      while (j < source.length && source[j] !== q) {
        if (source[j] === "\\") j++;
        j++;
      }
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === ";" && depth <= 0) return source.slice(i, j);
  }
  return source.slice(i);
}

function declaresChrome(prop: string, value: string): boolean {
  // A style object is read by KEY (an inline `background:` is chrome whatever
  // its value); a className is read by TOKEN.
  return prop === "containerStyle"
    ? CHROME_STYLE_KEY.test(value)
    : CHROME_CLASS.test(value);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "__tests__") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const REPO_ROOT = path.resolve(SRC, "..");
const rel = (f: string) => path.relative(REPO_ROOT, f);

const FILES = [...walk(SRC), ...walk(LIBRARY)];

interface MenuMount {
  file: string;
  tag: string;
  source: string;
}

/** Every `<MenuProvider …>` / `<AnchoredMenu …>` mount in either silo. */
function menuMounts(): MenuMount[] {
  const out: MenuMount[] = [];
  for (const file of FILES) {
    const raw = readFileSync(file, "utf8");
    if (!/<(?:MenuProvider|AnchoredMenu)\b/.test(raw)) continue;
    const source = commentsStripped(raw);
    for (const name of ["MenuProvider", "AnchoredMenu"]) {
      for (const hit of elementsNamed(source, name)) {
        out.push({ file, tag: hit.tag, source });
      }
    }
  }
  return out;
}

const MOUNTS = menuMounts();

describe("menu surface — the primitive owns the container chrome", () => {
  it("sees the menu mounts it is meant to police (canary)", () => {
    // Anchored on the primitive's own consumers rather than on any site the
    // census exists to drain: a canary standing on the defect evaporates the
    // moment the defect is fixed, and then passes vacuously forever.
    const files = new Set(MOUNTS.map((m) => rel(m.file)));
    expect(files).toContain("src/components/DragHandleMenu.tsx");
    expect(files).toContain("src/components/MenuBar.tsx");
    expect(files).toContain("src/components/menu/AnchoredMenu.tsx");
    expect(MOUNTS.length).toBeGreaterThanOrEqual(10);
  });

  // ── LEG 1: the census ──────────────────────────────────────────────────
  it("no menu mount writes chrome through a container prop", () => {
    const offenders: string[] = [];
    for (const { file, tag } of MOUNTS) {
      for (const prop of CONTAINER_PROPS) {
        const value = propValue(tag, prop);
        if (value && declaresChrome(prop, value)) {
          offenders.push(`${rel(file)} — ${prop}: ${value.trim().slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("a container prop passed BY NAME resolves to a chrome-free value", () => {
    // The indirect dialect, and the one that actually shipped: MenuBar built
    // `bg-surface border border-[var(--border)] rounded-lg shadow-lg py-1` into
    // a local `const dropdownClassName = [...]` and passed the IDENTIFIER, so a
    // tag-scoped census reads a bare name and reports clean.
    //
    // Resolved by looking the identifier's own declaration up in the same file
    // rather than by sweeping every string literal in it — measured, the sweep
    // form indicts `OmniViewPanel`'s sticky filter strip, which is a bordered,
    // shadowed, rounded surface that is not a menu at all. An allowlist of
    // non-menus is a filing cabinet, not a guard (the anchored-menu census's
    // own rule); resolving the binding asks the question that was meant.
    const offenders: string[] = [];
    for (const { file, tag, source } of MOUNTS) {
      for (const prop of CONTAINER_PROPS) {
        const value = propValue(tag, prop)?.trim();
        if (!value || !/^[A-Za-z_$][\w$]*$/.test(value)) continue;
        const init = declarationInitializer(source, value);
        if (init && declaresChrome(prop === "containerStyle" ? prop : "className", init)) {
          offenders.push(`${rel(file)} — ${prop}={${value}} = ${init.trim().slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the retired MENU_SURFACE_CLASS export is gone from both silos", () => {
    // A published class string is a second surface author with a different
    // vocabulary — and the one whose two hand-copies this task retired. Deleted
    // rather than re-pointed: an exported chrome literal is an invitation to
    // copy it, which is precisely what MenuBar did twice.
    const live = FILES.filter((f) =>
      /\bMENU_SURFACE_CLASS\b/.test(commentsStripped(readFileSync(f, "utf8"))),
    ).map(rel);
    expect(live).toEqual([]);
  });

  // ── LEG 2: the opt-out ─────────────────────────────────────────────────
  it("every surface=\"none\" menu is allowlisted with a reason", () => {
    const optedOut = new Set<string>();
    for (const { file, tag } of MOUNTS) {
      if (/surface=(?:"none"|\{"none"\}|'none')/.test(tag)) optedOut.add(rel(file));
    }
    expect([...optedOut].sort()).toEqual(
      Object.keys(PERMITTED_UNSURFACED_MENUS).sort(),
    );
    for (const [site, why] of Object.entries(PERMITTED_UNSURFACED_MENUS)) {
      expect(why.length, `${site} needs a real justification`).toBeGreaterThan(60);
    }
  });

  // ── LEG 3: the mechanism the census presupposes ────────────────────────
  it(".menu-surface states all four axes, each from its own --menu-* token", () => {
    const css = cssCommentsStripped(readFileSync(GLOBALS_CSS, "utf8"));
    const rule = /\.menu-surface\s*\{([^}]*)\}/.exec(css);
    expect(rule, ".menu-surface rule is missing").not.toBeNull();
    const body = rule![1];
    for (const [decl, token] of [
      ["background", "--menu-bg"],
      ["border", "--menu-border"],
      ["border-radius", "--menu-radius"],
      ["box-shadow", "--menu-shadow"],
    ] as const) {
      expect(body, `.menu-surface must set ${decl} from var(${token})`).toMatch(
        new RegExp(`${decl}\\s*:\\s*var\\(${token}\\)`),
      );
    }
    // No layout in the surface: padding/overflow/width belong to the caller and
    // to the positioner's `maxHeight` write, and a surface that owned them
    // would silently fight both.
    expect(body).not.toMatch(/\b(?:padding|overflow|width|height)\s*:/);
  });

  it("every --menu-* surface token is defined in :root", () => {
    const raw = readFileSync(GLOBALS_CSS, "utf8");
    // Definitions live in the token home, which `cssRuleBodies` blanks — so ask
    // the inverse: the token must NOT be defined only inside a rule body.
    const inRules = cssRuleBodies(cssCommentsStripped(raw));
    for (const token of ["--menu-bg", "--menu-border", "--menu-radius", "--menu-shadow"]) {
      expect(raw, `${token} is never defined`).toMatch(
        new RegExp(`^\\s*${token}\\s*:`, "m"),
      );
      expect(inRules).not.toMatch(new RegExp(`^\\s*${token}\\s*:`, "m"));
    }
  });

  // ── LEG 4: the shared population ───────────────────────────────────────
  it("every hand-rolled anchored MENU paints from the --menu-* tier", () => {
    // The leg with teeth, and the one the pre-459 census structurally could not
    // have: its population came from a `<MenuProvider>` mount, so a menu that
    // hand-rolled BOTH its placement and its chrome was answered on the first
    // axis by the sibling census and unowned on the second by everything.
    // Three sat there for a release — `FontPicker` (`shadow-lg` +
    // `--edge-subtle`), `StatusClusterImpl` (two surfaces, `shadow-md`), and
    // `MyPapersPod` (the pod tokens NAMED directly, which STYLE_GUIDE "Menus"
    // forbids) — plus `SlashCommandPopup`, which no census saw at all.
    //
    // Compliance is EITHER spelling of the same tier: the shared class, or the
    // four tokens read directly (the Library-silo pod writes inline styles and
    // has no class to stamp). Anything else is a vocabulary of its own.
    const offenders: string[] = [];
    for (const { key, block } of handRolledMenus()) {
      if (PERMITTED_UNSURFACED_MENUS[key.split("::")[0]]) continue;
      const flat = block.replace(/\s*\n\s*/g, " ");
      const stamped = /\bmenu-surface\b/.test(flat);
      const tokened = /var\(--menu-(?:bg|border|radius|shadow)\)/.test(flat);
      if (stamped || tokened) continue;
      offenders.push(key);
    }
    expect(offenders).toEqual([]);
  });

  it("leg 4's population is the sibling census's, not a second idea of a menu", () => {
    // Guards the ordering the whole task rests on: `handRolledMenus()` is the
    // anchored census MINUS the entries whose own justification classifies them
    // away as non-menus. If that classification is deleted or the population is
    // narrowed back to `<MenuProvider>` mounts, this leg names it rather than
    // letting leg 4 pass on an empty set.
    const keys = handRolledMenus().map((h) => h.key);
    expect(keys).toContain("src/components/SlashCommandPopup.tsx::SlashCommandPopup");
    expect(keys).toContain("src/components/FontPicker.tsx::FontPicker");
    // …and the non-menus really are excluded, or leg 4 would be demanding menu
    // chrome from a pane divider.
    expect(keys).not.toContain("src/components/editor-layout/split-with-code.tsx::SplitWithCode");
    expect(keys).not.toContain("src/components/FloatingPanel.tsx::FloatingPanelInner");
  });

  // ── LEG 5: the stylesheet ──────────────────────────────────────────────
  it("every four-axis surface rule in globals.css reads --menu-* or is allowlisted", () => {
    // The residual leg 1's note declines and this closes: a surface whose
    // chrome lives entirely in a CSS class leaves nothing in the TSX to grep.
    // `.math-popover` / `.figure-popover` / `.label-ref-popover-dropdown` were
    // exactly that, and `.footnote-editor-popup` was a FOURTH spelling with no
    // consumer at all — which is worse than tidy-up, because a dead rule is the
    // vocabulary the next author copies (the `.figure-popover` comment said in
    // as many words that it was copied from `.math-popover`).
    //
    // The detector is the SHAPE of a surface, not a name: a rule that states
    // background AND border AND radius AND shadow is painting one. Measured on
    // the pre-459 tree that is SEVEN rules repo-wide, which is what makes an
    // allowlist a guard here rather than a filing cabinet — a looser detector
    // (any shadowed rule) would sweep in every card, pod and tooltip and prove
    // nothing about menus.
    const offenders: string[] = [];
    for (const { selector, body } of fourAxisSurfaceRules()) {
      if (PERMITTED_NON_MENU_CSS_SURFACES[selector]) continue;
      if (/var\(--menu-(?:bg|border|radius|shadow)\)/.test(body)) continue;
      offenders.push(selector);
    }
    expect(offenders).toEqual([]);
  });

  it("every allowlisted CSS surface still exists and still states a reason", () => {
    const live = new Set(fourAxisSurfaceRules().map((r) => r.selector));
    for (const [sel, why] of Object.entries(PERMITTED_NON_MENU_CSS_SURFACES)) {
      expect(live.has(sel), `${sel} is no longer a four-axis surface — drop its entry`).toBe(true);
      expect(why.length, `${sel} needs a real justification`).toBeGreaterThan(60);
    }
  });

  it("the retired .footnote-editor-* family is gone from the stylesheet", () => {
    // Deleted rather than re-toned, per the dead-SSOT rule: the name does not
    // stay behind. Its input siblings went with it — they had no consumer
    // either, and half a dead family is an invitation to revive the other half.
    const css = readFileSync(GLOBALS_CSS, "utf8");
    expect(css).not.toMatch(/\.footnote-editor-/);
  });

  it("leg 5 flags .math-popover exactly as it shipped (defect fixture)", () => {
    // Verbatim the rule task 459 retoned — the shape that took the POSITIONING
    // primitive and not the SURFACE, so `anchored-menu-guardrail` read the
    // component compliant while its chrome lived in a CSS class no census
    // opened. `--panel-bg`, `--border`, a literal `0 4px 16px` elevation, and
    // `--pod-radius` NAMED directly, which STYLE_GUIDE "Menus" forbids: a menu
    // reaches that value through `--menu-radius`.
    const shipped = `
      .math-popover {
        background: var(--panel-bg, #ffffff);
        border: 1px solid var(--border, #d9d3c8);
        border-radius: var(--pod-radius);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
        padding: 0.5rem;
      }
    `;
    const rules = parseFourAxisRules(shipped);
    expect(rules.map((r) => r.selector)).toEqual([".math-popover"]);
    expect(rules[0].body).not.toMatch(/var\(--menu-(?:bg|border|radius|shadow)\)/);
    // …and the retoned form the same detector reads as compliant, so the leg
    // cannot pass by flagging everything.
    const retoned = shipped.replace(/background:[^;]*;/, "background: var(--menu-bg);")
      .replace(/border:[^;]*;/, "border: var(--menu-border);")
      .replace(/border-radius:[^;]*;/, "border-radius: var(--menu-radius);")
      .replace(/box-shadow:[^;]*;/, "box-shadow: var(--menu-shadow);");
    expect(parseFourAxisRules(retoned)[0].body).toMatch(/var\(--menu-bg\)/);
  });

  it("the stylesheet detector sees a four-axis surface and not a three-axis one", () => {
    // Synthetic, both directions. The accepting control matters as much as the
    // flagging one: a detector that fired on any shadowed rule would indict the
    // cards and pods, and the allowlist would become the filing cabinet this
    // repo's own rule forbids.
    const fixture = `
      .fake-popover { background: #fff; border: 1px solid #ccc; border-radius: var(--radius-sm); box-shadow: 0 4px 12px rgba(0,0,0,.1); }
      .fake-card { background: #fff; border-radius: var(--radius-sm); box-shadow: 0 1px 2px rgba(0,0,0,.1); }
    `;
    const found = parseFourAxisRules(fixture).map((r) => r.selector);
    expect(found).toEqual([".fake-popover"]);
  });

  it("the census can see a chrome-writing mount (swallow self-check)", () => {
    // Synthetic, not a live line: proving the detector works from a production
    // site the allowlist exists to drain makes the proof evaporate with the
    // defect. Both dialects, both prop shapes.
    const fixture = `
      <MenuProvider
        id="x"
        onClick={(e) => { e.stopPropagation(); }}
        containerStyle={{ width: 200, boxShadow: "var(--pod-shadow)" }}
      >
      <AnchoredMenu ariaLabel="y" menuClassName="w-44 shadow-lg rounded-lg" />
    `;
    const hits: string[] = [];
    for (const name of ["MenuProvider", "AnchoredMenu"]) {
      for (const hit of elementsNamed(fixture, name)) {
        for (const prop of CONTAINER_PROPS) {
          const v = propValue(hit.tag, prop);
          if (v && declaresChrome(prop, v)) hits.push(`${name}:${prop}`);
        }
      }
    }
    expect(hits.sort()).toEqual(["AnchoredMenu:menuClassName", "MenuProvider:containerStyle"]);
  });

  it("the by-name resolver sees the pre-295 MenuBar shape (defect fixture)", () => {
    // Verbatim the string this task retired, in the multi-line array-join form
    // it actually shipped in — the one a tag-scoped or line-scoped read misses.
    const fixture = `
      const dropdownClassName = [
        "absolute bg-surface border border-[var(--border)] rounded-lg shadow-lg py-1 min-w-[160px]",
        placement.v === "below" ? "top-full mt-1" : "bottom-full mb-1",
      ].join(" ");
      const layoutOnly = ["absolute py-1 min-w-[160px]"].join(" ");
    `;
    const chrome = declarationInitializer(fixture, "dropdownClassName");
    expect(chrome).not.toBeNull();
    expect(declaresChrome("className", chrome!)).toBe(true);
    // …and reads the WHOLE statement, not the first line: the placement ternary
    // below the chrome literal must be inside what it returned.
    expect(chrome).toContain("bottom-full");
    // The accepting control, so the resolver can't pass by matching anything.
    const clean = declarationInitializer(fixture, "layoutOnly");
    expect(declaresChrome("className", clean!)).toBe(false);
  });

  it("the census does not indict a legitimate layout-only container", () => {
    // The accepting control: width, padding and docked-anchor placement — the
    // three things a caller still owns — must all read clean, or leg 1 passes
    // for the wrong reason the moment someone tightens the needle.
    const fixture = `
      <MenuProvider
        id="x"
        containerClassName="absolute top-full mt-1 min-w-[160px] py-1 left-0"
        containerStyle={{ width: 240, padding: "4px 0", display: "flex" }}
      >
    `;
    const hits: string[] = [];
    for (const hit of elementsNamed(fixture, "MenuProvider")) {
      for (const prop of CONTAINER_PROPS) {
        const v = propValue(hit.tag, prop);
        if (v && declaresChrome(prop, v)) hits.push(prop);
      }
    }
    expect(hits).toEqual([]);
  });
});
