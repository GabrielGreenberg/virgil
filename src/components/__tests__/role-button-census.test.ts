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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { commentsStripped, elementsNamed } from "@/lib/__tests__/_source-scan";

const ROOT = join(__dirname, "..", "..", "..");
const LEAF = "src/lib/activatable-props.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
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
