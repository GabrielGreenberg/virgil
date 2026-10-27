// @vitest-environment jsdom
// CENSUS (task 1317): every View-pref registry row that names a `menu` group
// RENDERS in that group of the View menu — not only Display's. Before 1317
// only the Display block rendered from the registry; Marginalia / Highlights /
// Dividers named their keys by hand, so a new `menu: "marginalia"` toggle
// passed every census (they filtered to `menu === "display"`) and never
// rendered. The menu is opened with every group expanded, every master toggle
// on, and every narrowed set fully available, so each declared row must exist
// inside its group's `[data-view-menu-group]` wrapper.
//
// Also pins the ONE polarity rule: a set row's checkmark follows
// `SetDef.polarity` (`isMemberChecked`), so flipping a row's polarity flips
// the checkmark.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ViewMenu } from "../MenuBar";
import {
  REGISTRY_DEFAULTS,
  VIEW_MENU_GROUPS,
  VIEW_MENU_GROUP_ORDER,
  VIEW_PREF_KEYS,
  VIEW_PREF_REGISTRY,
  isMemberChecked,
  menuEntriesInGroup,
  type RegistryPrefs,
  type ViewPrefDef,
} from "@/lib/view-prefs/registry";
import type { DividerLevel } from "@/hooks/useViewPrefs";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  Number(setTimeout(() => cb(0), 0))) as typeof requestAnimationFrame;
(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame ??= ((id: number) =>
  clearTimeout(id)) as typeof cancelAnimationFrame;

afterEach(cleanup);

const domId = (rowId: string) => `view-menu-item-${rowId}`;

function openAllExpanded(prefs: Partial<RegistryPrefs> = {}) {
  // Every master toggle ON, so gated set rows render.
  const allOn: Record<string, unknown> = {};
  for (const key of VIEW_PREF_KEYS) {
    if ((VIEW_PREF_REGISTRY[key] as ViewPrefDef).kind === "toggle") allOn[key] = true;
  }
  const utils = render(
    <ViewMenu
      viewPrefs={{ ...REGISTRY_DEFAULTS, ...allOn, ...prefs } as RegistryPrefs}
      availableDividerLevels={new Set(VIEW_PREF_REGISTRY.dividerLevels.members as readonly DividerLevel[])}
      onToggleViewPref={vi.fn()}
      onSetViewPref={vi.fn()}
      onToggleViewPrefMember={vi.fn()}
    />,
  );
  fireEvent.click(utils.container.querySelector("button")!);
  // Expand every group, then every enum subgroup inside it.
  const expanders = [
    ...VIEW_MENU_GROUP_ORDER.flatMap((g) => VIEW_MENU_GROUPS[g].groupRowId ?? []),
    ...VIEW_MENU_GROUP_ORDER.flatMap((g) => menuEntriesInGroup(g).flatMap((e) => (e.kind === "enum" ? [e.id] : []))),
  ];
  for (const id of expanders) {
    const el = document.getElementById(domId(id));
    expect(el, `expander ${id}`).toBeTruthy();
    if (el!.getAttribute("aria-expanded") !== "true") fireEvent.click(el!);
  }
}

describe("CENSUS: every menu-bearing registry row renders in its group", () => {
  it("each toggle, set member and enum option sits inside its group's block", () => {
    openAllExpanded();
    const missing: string[] = [];
    for (const key of VIEW_PREF_KEYS) {
      const def = VIEW_PREF_REGISTRY[key] as ViewPrefDef;
      if (!def.menu) continue;
      const block = document.querySelector(`[data-view-menu-group="${def.menu}"]`);
      const ids =
        def.kind === "toggle"
          ? [def.menuRowId]
          : def.kind === "set"
            ? def.members.map((m) => `${def.memberRowIdPrefix}${m}`)
            : [def.menuRowId!, ...def.values.map((v) => `${def.optionRowIdPrefix}${v}`)];
      for (const id of ids) {
        const el = document.getElementById(domId(id));
        if (!el || !block?.contains(el)) missing.push(`${key} → ${id} (group ${def.menu})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every declared row id is unique across the whole menu", () => {
    const ids = VIEW_MENU_GROUP_ORDER.flatMap((g) => [
      ...(VIEW_MENU_GROUPS[g].groupRowId ? [VIEW_MENU_GROUPS[g].groupRowId!] : []),
      ...menuEntriesInGroup(g).flatMap((e) =>
        e.kind === "set" ? e.members.map((m) => m.id) : [e.id],
      ),
    ]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each group renders its registry header", () => {
    openAllExpanded();
    for (const g of VIEW_MENU_GROUP_ORDER) {
      const block = document.querySelector(`[data-view-menu-group="${g}"]`);
      expect(block?.textContent ?? "", g).toContain(VIEW_MENU_GROUPS[g].header);
    }
  });
});

describe("the ONE polarity rule (isMemberChecked)", () => {
  it("`hidden` checks the unlisted members; `present` checks the listed ones", () => {
    expect(VIEW_PREF_REGISTRY.hiddenMarginaliaTypes.polarity).toBe("hidden");
    expect(isMemberChecked("hiddenMarginaliaTypes", ["note"], "note")).toBe(false);
    expect(isMemberChecked("hiddenMarginaliaTypes", ["note"], "todo")).toBe(true);
    expect(VIEW_PREF_REGISTRY.dividerLevels.polarity).toBe("present");
    expect(isMemberChecked("dividerLevels", [2], 2)).toBe(true);
    expect(isMemberChecked("dividerLevels", [2], 1)).toBe(false);
  });

  it("flipping a set's declared polarity flips the rendered checkmark", () => {
    const def = VIEW_PREF_REGISTRY.dividerLevels as unknown as { polarity: string };
    const checked = () =>
      document.getElementById(domId("divider-level-2"))!.getAttribute("aria-checked");
    openAllExpanded({ dividerLevels: [2] });
    expect(checked()).toBe("true");
    cleanup();
    const saved = def.polarity;
    def.polarity = "hidden";
    try {
      openAllExpanded({ dividerLevels: [2] });
      expect(checked()).toBe("false");
    } finally {
      def.polarity = saved;
    }
  });
});
