/**
 * ROLE-BUTTON CENSUS (task 536).
 *
 * > A control is a `<button type="button">`. `role="button"` is spelled
 * > ONCE — by `activatableProps` in `src/lib/activatable-props.ts` — and only
 * > on a CONTAINER that must hold other interactive content.
 *
 * `role="button"` on a `<span>` is a three-part promise (announced operable ⇒
 * focusable ⇒ activates on Enter AND Space), and spelled by hand it is three
 * chances to keep two of the parts. The figure lozenge kept ONE: its `#` and
 * `×` announced `role="button"` — the `#` with an `aria-pressed` state — and
 * were neither focusable nor key-bound, so a keyboard user could number,
 * rename or delete a figure from every surface EXCEPT the figure's own chrome.
 * The heading strip's twin spans carried the identical false promise through
 * `setAttribute("role", "button")`, which is invisible to a JSX grep — which
 * is why this census reads BOTH media.
 *
 * The icon-button census (`icon-button-a11y-guardrail.test.ts`) polices what
 * a `<button>` must carry and stated in its own header that a `role="button"`
 * div "is not censused". This file is that missing half. The two together
 * close the class: a control is either a real button (and lands there) or a
 * container spelling the one helper (and lands here). Allowlist EMPTY — there
 * is no true statement of the form "this control announces itself as a
 * button and should not answer the keyboard".
 *
 * Stated limits: the JSX needle reads a `role` attribute whose value is a
 * literal `"button"` (in a string or inside a `{…}` expression); a role
 * arriving through an opaque spread of some OTHER helper is not seen. The
 * vanilla needle reads the two spellings the DOM API has (`setAttribute` and
 * the `role` property). Both read COMMENTS-STRIPPED source with literals
 * kept, since the needle IS a literal — and a synthetic canary proves each
 * needle bites, so a green leg cannot be a blind one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { commentsStripped, elementsNamed, matchFrom, walkFiles } from "@/lib/__tests__/_source-scan";

const ROOT = join(__dirname, "..", "..", "..");
const LEAF = "src/lib/activatable-props.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const p of walkFiles(dir, { skipDirs: ["__tests__"] })) if (/\.tsx?$/.test(p)) out.push(p);
  return out;
}

const PRODUCTION = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "library"))].map((p) =>
  relative(ROOT, p),
);

/** JSX: `role="button"`, `role='button'`, or `role={ … "button" … }`. */
const JSX_ROLE_BUTTON = /(?<![\w-])role\s*=\s*(?:["']button["']|\{[^}]*["']button["'][^}]*\})/;
/** Vanilla DOM: `.setAttribute("role", "button")` or `.role = "button"`. */
const DOM_ROLE_BUTTON = /\.setAttribute\(\s*["']role["']\s*,\s*["']button["']\s*\)|\.role\s*=\s*["']button["']/;

function roleButtonSpellers(): string[] {
  const out: string[] = [];
  for (const rel of PRODUCTION) {
    if (rel === LEAF) continue;
    const raw = readFileSync(join(ROOT, rel), "utf8");
    const src = commentsStripped(raw);
    for (const needle of [JSX_ROLE_BUTTON, DOM_ROLE_BUTTON]) {
      const m = needle.exec(src);
      if (!m) continue;
      // Line numbers from the RAW file (the stripper drops block comments).
      const at = raw.indexOf(m[0]);
      const line = at >= 0 ? raw.slice(0, at).split("\n").length : 0;
      out.push(`${rel}:${line} ${m[0].trim().slice(0, 60)}`);
    }
  }
  return out;
}

describe("the role is spelled ONCE", () => {
  it("no production file spells role=button by hand, in either medium", () => {
    // Allowlist EMPTY: a hit is MIGRATE-it — a real `<button type="button">`
    // where the element can be one, `{...activatableProps(…)}` where it must
    // stay a container.
    expect(roleButtonSpellers()).toEqual([]);
  });

  it("the leaf is the one speller, and the role it spells is the button role", () => {
    const leaf = commentsStripped(readFileSync(join(ROOT, LEAF), "utf8"));
    expect(/role:\s*"button"/.test(leaf)).toBe(true);
  });

  it("CANARY: both needles bite on the retired shapes (self-check)", () => {
    expect(JSX_ROLE_BUTTON.test('<span role="button" onClick={f}>')).toBe(true);
    expect(JSX_ROLE_BUTTON.test("<span role={readOnly ? undefined : \"button\"}>")).toBe(true);
    expect(JSX_ROLE_BUTTON.test('<div role="dialog">')).toBe(false);
    expect(JSX_ROLE_BUTTON.test("<div role={itemProps.role}>")).toBe(false);
    expect(DOM_ROLE_BUTTON.test('numToggle.setAttribute("role", "button");')).toBe(true);
    expect(DOM_ROLE_BUTTON.test('el.role = "button";')).toBe(true);
    expect(DOM_ROLE_BUTTON.test('el.setAttribute("role", "menu");')).toBe(false);
  });
});

/* ── The consumers: a container, never a button ─────────────────────── */

function helperConsumers(): { file: string; tag: string }[] {
  const out: { file: string; tag: string }[] = [];
  for (const rel of PRODUCTION) {
    if (rel === LEAF) continue;
    const src = commentsStripped(readFileSync(join(ROOT, rel), "utf8"));
    if (!/activatableProps\s*\(/.test(src)) continue;
    // Every JSX element whose open tag spreads the helper.
    for (const name of ["div", "span", "li", "button", "a"]) {
      for (const hit of elementsNamed(src, name)) {
        if (/\{\s*\.\.\.\s*activatableProps\s*\(/.test(hit.tag)) out.push({ file: rel, tag: hit.tag });
      }
    }
  }
  return out;
}

describe("the helper's consumers", () => {
  const consumers = helperConsumers();

  it("exist — a door with no caller is a dead SSOT (task 202)", () => {
    // The three containers that genuinely cannot be buttons: a tab holding
    // its close button, a library row holding its action buttons, a title
    // strip holding its own ×.
    expect(consumers.length).toBeGreaterThanOrEqual(3);
    expect(consumers.map((c) => c.file)).toEqual(
      expect.arrayContaining([
        "src/components/editor-layout/InlineTabLabel.tsx",
        "src/text-objects/floats/float-title-field.tsx",
        "library/components/LeftListRow.tsx",
      ]),
    );
  });

  it("never sit on a real <button> — the role on a button is a contradiction", () => {
    const onButton = consumers.filter((c) => /^<button\b/.test(c.tag)).map((c) => c.file);
    expect(onButton).toEqual([]);
  });

  it("carry no hand-rolled key handler beside the helper", () => {
    // A second `onKeyDown` on the same tag re-derives the contract the helper
    // owns — and React keeps only the LAST prop, so one of the two is dead
    // and which one depends on prop order.
    const forked = consumers.filter((c) => /(?<![\w-])onKeyDown\s*=/.test(c.tag)).map((c) => c.file);
    expect(forked).toEqual([]);
  });
});

/* ── The click-only control (task 956) ──────────────────────────────── */

/*
 * The same defect one step EARLIER: a `<div|span|li>` that does real work on
 * click and carries no role, no tab stop and no key binding at all — the
 * Outline's rows and rename/label triggers, while the rows' fold chevrons were
 * buttons, so Tab walked a column of "Expand section" stops that could fold a
 * section but never reach it. Nothing above sees it: it spells no role.
 *
 * An `onClick` on one of those tags is legitimate in exactly three shapes:
 *  - a pure GUARD — the handler only stops propagation / prevents default
 *    (optionally under an `if`, or `cond ? undefined : guard`): it keeps a
 *    click inside a card's field from reaching the card, and does no work;
 *  - a container spreading `activatableProps` (the census above owns it);
 *  - `data-click-exempt="<reason>"` at the site — a pointer convenience with
 *    its own keyboard path (the panel list's empty-area deselect).
 *
 * `src/panels/**` allowlist EMPTY. `src/components/**` carries pre-existing
 * debt (task 956 scoped the fix to the Outline): a SHRINK-ONLY ratchet, exact
 * per-file counts, so a new offender fails and a fixed one must be removed.
 */
const CLICK_TAGS = ["div", "span", "li"];
const GUARD_STMT = String.raw`(?:if\s*\([^()]*\)\s*)?\w+\.(?:stopPropagation|preventDefault)\(\)\s*;?\s*`;
const GUARD = new RegExp(
  String.raw`^(?:[^?]+\?\s*undefined\s*:\s*)?\(?\s*\w*\s*\)?\s*=>\s*(?:\{\s*(?:${GUARD_STMT})+\}|${GUARD_STMT})$`,
);
const CLICK_EXEMPT = /(?<![\w-])data-click-exempt\s*=\s*"[^"]*\w[^"]*"/;

/** The handler expression of a tag's `onClick={…}`, or null. */
function onClickExpr(tag: string): string | null {
  const m = /(?<![\w-])onClick\s*=\s*\{/.exec(tag);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchFrom(tag, open, "{", "}");
  return close < 0 ? null : tag.slice(open + 1, close).trim();
}

/** Click-only controls in one COMMENT-STRIPPED source. */
function clickOnlyControls(src: string): string[] {
  const out: string[] = [];
  for (const name of CLICK_TAGS) {
    for (const hit of elementsNamed(src, name)) {
      const expr = onClickExpr(hit.tag);
      if (expr == null) continue;
      if (GUARD.test(expr)) continue;
      if (/\{\s*\.\.\.\s*activatableProps\s*\(/.test(hit.tag)) continue;
      if (CLICK_EXEMPT.test(hit.tag)) continue;
      out.push(`<${name} onClick={${expr.replace(/\s+/g, " ").slice(0, 60)}}>`);
    }
  }
  return out;
}

function clickOnlyIn(prefix: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const rel of PRODUCTION) {
    if (!rel.startsWith(prefix) || !rel.endsWith(".tsx")) continue;
    const hits = clickOnlyControls(commentsStripped(readFileSync(join(ROOT, rel), "utf8")));
    if (hits.length) out.set(rel, hits);
  }
  return out;
}

/** Pre-existing `src/components` debt — SHRINK ONLY (exact counts). */
const COMPONENTS_RATCHET: Record<string, number> = {
  "src/components/LabelRefPopover.tsx": 2,
  "src/components/PanelTextSizeRow.tsx": 1,
  "src/components/SourcePodNodeView.tsx": 4,
  "src/components/editor-layout/DocumentFolderTab.tsx": 1,
  "src/components/library/BibEntryPickerMenu.tsx": 1,
  "src/components/library/MyPapersPod.tsx": 1,
  "src/components/menu/AnchoredMenu.tsx": 1,
  "src/components/panel-primitives.tsx": 1,
};

describe("the click-only control", () => {
  it("no panel has a div/span/li that works on click and not on the keyboard", () => {
    // Allowlist EMPTY: a hit is MIGRATE-it — a `<button type="button">`
    // where the element holds only text, `{...activatableProps(…)}` where it
    // holds other controls, or `data-click-exempt="<reason>"` where it is a
    // pointer convenience with its own keyboard path.
    expect(Object.fromEntries(clickOnlyIn("src/panels/"))).toEqual({});
  });

  it("src/components holds no NEW click-only control (shrink-only ratchet)", () => {
    const counts = Object.fromEntries(
      [...clickOnlyIn("src/components/")].map(([f, hits]) => [f, hits.length]),
    );
    // Fixed one? Lower (or delete) its entry. New one? Make it a control.
    expect(counts).toEqual(COMPONENTS_RATCHET);
  });

  it("CANARY: the classifier bites on the retired Outline shapes (self-check)", () => {
    const retired = [
      `<div className="row" onClick={handleRowClick({ uuid: node.heading.uuid, index: 0 })}>x</div>`,
      `<span onClick={() => { setEditText(pod.text); setEditing(true); }} className="t">x</span>`,
      `<div onClick={(e) => { e.stopPropagation(); setEditing(true); }}>x</div>`,
    ];
    for (const shape of retired) expect(clickOnlyControls(shape)).toHaveLength(1);
    const allowed = [
      `<div onClick={(e) => e.stopPropagation()}>x</div>`,
      `<div onClick={(e) => { if (canEdit) e.stopPropagation(); }}>x</div>`,
      `<div onClick={readOnly ? undefined : (e) => e.stopPropagation()}>x</div>`,
      `<div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>x</div>`,
      `<div {...activatableProps(go)}>x</div>`,
      `<div onClick={onClickEmpty} data-click-exempt="empty-area deselect">x</div>`,
      `<button type="button" onClick={go}>x</button>`,
    ];
    for (const shape of allowed) expect(clickOnlyControls(shape)).toEqual([]);
  });
});
