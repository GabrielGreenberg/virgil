// The ROW census (task 477) — the leg with TEETH for the `ItemMenu` row
// migration.
//
// The rows were never the part that could misbehave. A NINTH hand-rolled
// `<button>` dropped into a kebab is: it type-checks, it renders, it looks
// exactly like the eight that shipped, and it is invisible to every behavioural
// test of every row primitive — while the enclosing provider's window-CAPTURE
// keyboard controller keeps consuming Enter / Space / every arrow on its
// behalf and activating nothing.
//
// So the question is asked of the CHILDREN a menu shell is handed, transitively
// through the components those children name — which is the only way to see a
// row authored in `panel-primitives.tsx` and mounted in `ArchivePanel.tsx`.
// Population and reach live in `_menu-census.ts` beside the two sibling
// censuses; the allowlist is EMPTY and stays that way. A hit is MIGRATE-it:
// `<MenuActionRow>` for a command, `<MenuToggleRow>` for a checkbox or a radio,
// or `useMenuItem` + `getItemProps()` on whatever the row already renders.

import { describe, it, expect } from "vitest";
import {
  censusBareMenuRows,
  isWindowSourceShell,
  menuBodyRegions,
} from "./_menu-census";

/** EMPTY, and a hit is a migration rather than an entry. Kept as a named
 *  constant so the intent is legible from the failure message. */
const PERMITTED_BARE_MENU_ROWS: Record<string, string> = {};

describe("menu rows are registered (task 477)", () => {
  it("no window-source menu body renders a bare <button>/<label> row", () => {
    const offenders = censusBareMenuRows().filter(
      (h) => !(h.where in PERMITTED_BARE_MENU_ROWS),
    );
    expect(
      offenders.map((h) => `${h.where} :: ${h.tag}`),
      "A row inside a `role=\"menu\"` shell must register with the enclosing " +
        "provider — otherwise the shared controller swallows Enter/Space/arrows " +
        "on its behalf and activates nothing. Use <MenuActionRow> / " +
        "<MenuToggleRow>, or useMenuItem + getItemProps().",
    ).toEqual([]);
  });

  // ── the census can SEE ──────────────────────────────────────────────────
  //
  // A green result from a walker that finds nothing is indistinguishable from a
  // green result from a walker that IS nothing. These pin each half of the
  // machinery against synthetic fixtures (never against a live line the fix
  // just drained — a canary must not stand on the defect).

  it("finds the body of a shell and skips its brace-y props", () => {
    const regions = menuBodyRegions(`
      const X = () => (
        <AnchoredMenu ariaLabel="x" trigger={() => (<span>{">"}</span>)}>
          <button onClick={() => 1}>Row</button>
        </AnchoredMenu>
      );
    `);
    expect(regions).toHaveLength(1);
    expect(regions[0].body).toContain("<button");
    // The trigger prop's own `<span>` is part of the OPEN TAG, not the body.
    expect(regions[0].body).not.toContain("<span");
  });

  it("excludes a combobox provider by MECHANISM, not by allowlist", () => {
    // An input-source provider installs no window listener, so a stray control
    // inside it degrades to Tab+Enter rather than to silence.
    expect(isWindowSourceShell(`<MenuProvider keyboardSource="input"`)).toBe(false);
    expect(isWindowSourceShell(`<MenuProvider role="listbox"`)).toBe(false);
    expect(isWindowSourceShell(`<ItemMenu align="left"`)).toBe(true);
  });

  it("is non-empty over the real tree — the walk reaches real menus", () => {
    // If this ever reports zero, the census below is passing vacuously.
    const bodies = menuBodyRegions(
      `<ItemMenu align="left"><Row /></ItemMenu>` +
        `<MenuProvider id="a" onClose={() => {}}><Row /></MenuProvider>`,
    );
    expect(bodies.map((b) => b.shell)).toEqual(["ItemMenu", "MenuProvider"]);
  });
});
