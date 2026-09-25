// The pick-ONE census (task 770) — a mutually-exclusive row set is a RADIO by
// construction, never by memory.
//
// `<MenuToggleRow>` defaults to `menuitemcheckbox`, and a pick-one set used to
// become `menuitemradio` only when its author remembered to spell the role. Two
// MenuBar sets did not (the ¶ block-type rows and the divider-width rows), so a
// screen reader announced "Body text / Chapter / Section" as independent
// checkboxes. The door is now `<MenuRadioGroup>`, which DERIVES the role from
// its single `value`. This census holds the door shut from the other side:
//
//   (a) a `<MenuToggleRow>` whose `checked` is an EQUALITY against one value
//       (`checked={x === y}`) is a pick-one row authored outside the door;
//   (b) a `<MenuToggleRow>` that spells `role=` is choosing a role by hand —
//       only `MenuRadioGroup.tsx` may.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SRC, LIBRARY, stripComments, walkSource } from "./_menu-census";

/** Each `<MenuToggleRow …>` opening tag's attribute text, brace-aware so an
 *  arrow function's `>` or a JSX-valued prop cannot end the tag early. */
export function toggleRowTags(source: string): string[] {
  const out: string[] = [];
  const re = /<MenuToggleRow\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(source.slice(m.index + m[0].length, i));
  }
  return out;
}

/** The `checked={…}` expression of a tag, or null. */
function checkedExpr(tag: string): string | null {
  const at = tag.search(/\bchecked=\{/);
  if (at < 0) return null;
  let depth = 0;
  const start = tag.indexOf("{", at);
  for (let i = start; i < tag.length; i++) {
    if (tag[i] === "{") depth++;
    else if (tag[i] === "}" && --depth === 0) return tag.slice(start + 1, i);
  }
  return null;
}

export function pickOneOffences(source: string): string[] {
  const hits: string[] = [];
  for (const tag of toggleRowTags(stripComments(source))) {
    const expr = checkedExpr(tag);
    if (expr && /(^|[^!=])===?(?!=)/.test(expr)) hits.push(`checked={${expr.trim()}}`);
    if (/\srole=/.test(tag)) hits.push("role=");
  }
  return hits;
}

const DOOR = path.join(SRC, "components/menu/MenuRadioGroup.tsx");

describe("pick-one menu rows go through MenuRadioGroup (task 770)", () => {
  it("no <MenuToggleRow> outside the door is an equality-checked or role-spelled row", () => {
    const offenders: string[] = [];
    for (const file of [...walkSource(SRC), ...walkSource(LIBRARY)]) {
      if (file === DOOR) continue;
      for (const hit of pickOneOffences(readFileSync(file, "utf8")))
        offenders.push(`${path.relative(path.dirname(SRC), file)} :: ${hit}`);
    }
    expect(
      offenders,
      "A pick-ONE row set must render through <MenuRadioGroup> (which makes " +
        "every row `menuitemradio`), not as <MenuToggleRow>s checked by equality " +
        "or given a role by hand.",
    ).toEqual([]);
  });

  // ── the census can SEE (synthetic fixtures, never a drained live line) ──
  it("flags an equality-checked row and a role-spelled row", () => {
    expect(
      pickOneOffences(`<MenuToggleRow id="a" checked={mode === "x"} onToggle={() => set("x")} />`),
    ).toEqual([`checked={mode === "x"}`]);
    expect(
      pickOneOffences(`<MenuToggleRow id="a" role="menuitemradio" checked={on} onToggle={t} />`),
    ).toEqual(["role="]);
  });

  it("passes an independent toggle, a negation and a set-membership check", () => {
    expect(
      pickOneOffences(`
        <MenuToggleRow id="a" checked={on} onToggle={() => { if (a > b) t(); }} leading={<span />} />
        <MenuToggleRow id="b" checked={x !== y} onToggle={t} />
        <MenuToggleRow id="c" checked={levels.includes(l)} onToggle={t} />
      `),
    ).toEqual([]);
  });

  it("reads past an arrow function's `>` to the checked prop", () => {
    expect(toggleRowTags(`<MenuToggleRow onToggle={() => go()} checked={a === b} />`)[0]).toContain(
      "checked={a === b}",
    );
  });
});
