/**
 * CENSUS (task 1163): the panel-kebab colour row has ONE spelling.
 *
 * Every docked panel's header kebab opens with a colour-picker row. It used to
 * be hand-rolled in ten panels — the same `px-3 py-1.5 … gap-2` `<div>` around a
 * `<PanelThemePicker>` with a hand-spelled `label` ("Cutter color", "Todo
 * color", "Revisions color"…) that drifted from the one label table
 * Preferences reads (`PANEL_THEME_COPY`: "Cuts", "To-dos", "Revisions").
 *
 * Now `PanelThemeMenuRow({ keys })` owns the row chrome and `PanelThemePicker`
 * derives its name from `panelThemeColorLabel(key)`. This census pins both
 * halves:
 *   1. no file under `src/panels/` renders `<PanelThemePicker` directly — only
 *      through the row primitive;
 *   2. the picker takes no `label` prop anywhere (so no call site can re-spell
 *      the name), and the derived label reads the shared table.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PANEL_THEME_COPY, panelThemeColorLabel, type PanelThemeKey } from "@/lib/panel-theme";
import { commentsStripped, REPO_ROOT, walkFiles } from "@/lib/__tests__/_source-scan";

const ROOT = REPO_ROOT;

const walk = (dir: string): string[] =>
  walkFiles(dir, { skipDirs: ["__tests__"] }).filter((f) => /\.tsx?$/.test(f));

const source = (f: string) => commentsStripped(readFileSync(f, "utf8"));

describe("panel-kebab colour row census (task 1163)", () => {
  it("no panel renders <PanelThemePicker directly — only via PanelThemeMenuRow", () => {
    const offenders = walk(join(ROOT, "src/panels"))
      .filter((f) => /<PanelThemePicker\b/.test(source(f)))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("every panel kebab mounts the row primitive", () => {
    const users = walk(join(ROOT, "src/panels")).filter((f) =>
      /<PanelThemeMenuRow\b/.test(source(f)),
    );
    // Ten panels carry a colour row today; a panel dropping it should be a
    // deliberate edit to this floor, not a silent regression.
    expect(users.length).toBeGreaterThanOrEqual(10);
  });

  it("no source passes a hand-spelled label to the picker", () => {
    const offenders = walk(join(ROOT, "src"))
      .filter((f) => /<PanelThemePicker\b[^>]*\blabel=/.test(source(f)))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("the picker's label is derived from PANEL_THEME_COPY", () => {
    for (const key of Object.keys(PANEL_THEME_COPY) as PanelThemeKey[]) {
      expect(panelThemeColorLabel(key)).toBe(`${PANEL_THEME_COPY[key].label} color`);
    }
  });
});
