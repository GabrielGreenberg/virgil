// The DECLARED-menu ARIA census (task 997) — the item + trigger questions asked
// of every `role="menu"` an author wrote OUTSIDE the primitive.
//
// Task 819 widened the SURFACE census to every declared `role="menu"`
// (`roleMenuDeclarations()` in `_menu-census.ts`), on the rule "discover a
// census's population by the QUESTION, not by the MECHANISM". The ARIA censuses
// did not follow it: `menu-trigger-census` discovers its population from
// `<MenuProvider>` mounts and `menu-radio-census` from `<MenuToggleRow>` tags, so
// a menu that declared `role="menu"` by hand was answered on its chrome and on
// nothing else. `Marginalia`'s "+K" `OverflowPill` was exactly that: a
// `role="menu"` whose children were bare `MarkerButton`s — a screen reader
// heard a menu with ZERO items — behind a trigger that spelled
// `aria-haspopup="true"`.
//
// So this census reads the SAME population the surface census reads (one idea
// of "a hand-declared menu", not a third) and asks the two ARIA questions of it:
//
//   A. ITEMS — its rows carry a `menuitem*` role. A declared menu with no items
//      is an announcement of a list that is not there.
//   B. TRIGGER — its trigger states `aria-haspopup`/`aria-expanded` through the
//      one contract (`menu/menu-trigger.ts`).
//
// The third question — a pick-ONE set routed through `MenuRadioGroup` — is not
// population-scoped at all, so it lives with its siblings in
// `menu-radio-census.test.ts` (leg "no hand-spelled menuitemradio"); and the
// hand-spelled-`aria-haspopup` ban is `menu-trigger-census.test.ts` leg C,
// widened from `="menu"` to any value in the same task.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIBRARY,
  SRC,
  roleMenuDeclarations,
  splitDeclarations,
  stripComments,
} from "./_menu-census";

/** A row that names itself an item, in JSX or in a `useMenuItem`-style
 *  options object — or one built on the primitive's row doors, which always
 *  carry the role. */
const ITEM_ROLE =
  /\brole(?:=\{?|\s*:\s*)["']menuitem(?:checkbox|radio)?["']|\b(?:useMenuItem|getItemProps|MenuActionRow|MenuToggleRow|MenuRadioGroup|MenuItemsFromRegistry)\b/;

const CONTRACT = /\b(?:useMenuTrigger|menuTriggerAria|paintMenuTriggerAria)\b/;

function fileOf(key: string): string {
  const rel = key.split("::")[0];
  const [prefix, ...rest] = rel.split("/");
  return path.join(prefix === "library" ? LIBRARY : SRC, ...rest);
}

/**
 * Does `block` reach an item role — itself, or through a component it renders
 * that is declared in the SAME file (depth 2)? The rows of every shipped
 * hand-declared menu are authored beside it (`MyPapersPod`'s add rows, the
 * catalog `RowMenu`'s items), and the defect this exists for was one too:
 * `OverflowPill` → `MarkerButton`, both in `Marginalia.tsx`, neither naming a
 * role.
 */
export function reachesItemRole(block: string, siblings: Map<string, string>, depth = 2): boolean {
  if (ITEM_ROLE.test(block)) return true;
  if (depth <= 0) return false;
  for (const m of new Set([...block.matchAll(/<([A-Z][A-Za-z0-9_]*)/g)].map((x) => x[1]))) {
    const child = siblings.get(m);
    if (child && child !== block && reachesItemRole(child, siblings, depth - 1)) return true;
  }
  return false;
}

function siblingsOf(file: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const { name, block } of splitDeclarations(stripComments(readFileSync(file, "utf8")))) {
    out.set(name, block);
  }
  return out;
}

describe("declared-menu ARIA census (task 997)", () => {
  const population = roleMenuDeclarations();

  it("finds the population (vacuity floor)", () => {
    const keys = population.map((h) => h.key);
    for (const k of [
      "src/components/library/MyPapersPod.tsx::MyPapersPod",
      // The Library silo's two (`RowMenu`, `PaperAiRequestsMenu`) left this
      // population in task 1011 — they mount `AnchoredMenu` now — so the pod's
      // "+ Add paper" menu is the one hand-declared menu left to answer.
    ]) {
      expect(keys, k).toContain(k);
    }
  });

  it("A: every declared role=\"menu\" gives its rows a menuitem role", () => {
    const offenders = population
      .filter(({ key, block }) => !reachesItemRole(block, siblingsOf(fileOf(key))))
      .map((h) => h.key);
    expect(
      offenders,
      'A role="menu" with no menuitem rows: register each row (`useMenuItem` / ' +
        "`MenuActionRow` — wrap a compound control in a registered row, see " +
        "`Marginalia`'s `MarkerMenuRow`), or move the menu onto `AnchoredMenu`.",
    ).toEqual([]);
  });

  it("B: every declared role=\"menu\" states its trigger ARIA through menu/menu-trigger.ts", () => {
    const offenders = population
      .filter(({ key }) => !CONTRACT.test(stripComments(readFileSync(fileOf(key), "utf8"))))
      .map((h) => h.key);
    expect(
      offenders,
      "Spread `menuTriggerAria(\"menu\", open)` (or use `useMenuTrigger`) on the " +
        "element that opens this menu.",
    ).toEqual([]);
  });

  it("A/B are red on OverflowPill exactly as it shipped (defect fixture)", () => {
    const preFixFile = `
function MarkerButton({ m }) {
  return <button type="button" className="marginalia-marker" onClick={go} />;
}
function OverflowPill({ group }) {
  const [open, setOpen] = useState(false);
  useMenuDismiss({ containerRef: rootRef, onClose: close, open });
  return (
    <div ref={rootRef}>
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>+{count}</button>
      {open && (
        <div className="menu-surface" role="menu" aria-label={label}>
          {group.hidden.map((m) => <MarkerButton key={m.id} m={m} />)}
        </div>
      )}
    </div>
  );
}`;
    const sibs = new Map(splitDeclarations(preFixFile).map((d) => [d.name, d.block]));
    const pill = sibs.get("OverflowPill")!;
    expect(reachesItemRole(pill, sibs)).toBe(false);
    expect(CONTRACT.test(preFixFile)).toBe(false);
    // …and the registered-row shape is green: the row lives in a sibling the
    // menu renders, which is what the depth walk is for.
    const fixed = `${preFixFile}
function MarkerMenuRow({ m }) {
  const { getItemProps } = useMenuItem({ id: m.id, run });
  return <div {...getItemProps()}><MarkerButton m={m} /></div>;
}`.replace("<MarkerButton key={m.id} m={m} />)", "<MarkerMenuRow key={m.id} m={m} />)");
    const sibs2 = new Map(splitDeclarations(fixed).map((d) => [d.name, d.block]));
    expect(reachesItemRole(sibs2.get("OverflowPill")!, sibs2)).toBe(true);
  });
});
