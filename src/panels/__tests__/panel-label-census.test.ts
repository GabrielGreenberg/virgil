// @vitest-environment node
/**
 * PANEL NAMES HAVE ONE HOME (task 1475).
 *
 * The same panel used to be called by up to five names: the Todo List was
 * "Todo List" (registry), "To-dos" (the Preferences theme + text-size rows),
 * "Todos" (the Search scope chips, the archive "Restore to …" label) and
 * "Todo" (the marginalia hide row); Notes was also "Margin notes", Cutter also
 * "Cutter cards" / "Cuts". Each was a hand table restating `PANEL_REGISTRY`.
 *
 * Now the registry declares `label` (full) and `shortLabel` (in a list), and
 * every table DERIVES. Two legs:
 *  1. the derived tables name each panel with one of ITS two registry names;
 *  2. CENSUS — no source file outside the registry holds a literal table of
 *     panel names (≥3 distinct panel-name string values in `key: "…"` form).
 *     The scanner is proven against the pre-1475 `PANEL_BODY_LABELS` table.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, trackedFiles } from "@/lib/__tests__/_source-scan";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import type { PanelKind } from "@/panels/_shared/types";
import { PANEL_BODY_LABELS, PANEL_KIND_TO_BODY_KEY } from "@/lib/panel-typography";
import { PANEL_THEME_COPY } from "@/lib/panel-theme";
import { SCOPE_LABEL, SCOPE_PANEL } from "@/lib/search-sources";
import {
  ARCHIVE_ORIGIN_PANELS,
  ARCHIVE_ORIGIN_PANEL_KIND,
  ARCHIVE_ORIGIN_PANEL_LABEL,
} from "@/lib/archive-origin";
import { VIEW_PREF_REGISTRY } from "@/lib/view-prefs/registry";
import { HIDEABLE_MARKER_TYPES, panelForMarkerType } from "@/cards/marker-meta";

const namesOf = (p: PanelKind) => [PANEL_REGISTRY[p].label, PANEL_REGISTRY[p].shortLabel];

describe("panel names derive from PANEL_REGISTRY (task 1475)", () => {
  it("the Preferences text-size rows use the panel's shortLabel", () => {
    for (const [panel, key] of Object.entries(PANEL_KIND_TO_BODY_KEY)) {
      expect(PANEL_BODY_LABELS[key!]).toBe(PANEL_REGISTRY[panel as PanelKind].shortLabel);
    }
  });

  it("a panel's theme colour is named by its panel", () => {
    expect(PANEL_THEME_COPY.note.label).toBe(PANEL_REGISTRY.notes.shortLabel);
    expect(PANEL_THEME_COPY.todo.label).toBe(PANEL_REGISTRY.todo.shortLabel);
    expect(PANEL_THEME_COPY.cut.label).toBe(PANEL_REGISTRY.cutter.shortLabel);
    expect(PANEL_THEME_COPY.archive.label).toBe(PANEL_REGISTRY.archive.shortLabel);
  });

  it("the Search scope chips use the scope's panel's shortLabel", () => {
    for (const [scope, panel] of Object.entries(SCOPE_PANEL)) {
      expect(SCOPE_LABEL[scope as keyof typeof SCOPE_LABEL]).toBe(
        PANEL_REGISTRY[panel as PanelKind].shortLabel,
      );
    }
  });

  it("the archive restore target is the panel's full label", () => {
    for (const p of ARCHIVE_ORIGIN_PANELS) {
      expect(ARCHIVE_ORIGIN_PANEL_LABEL[p]).toBe(PANEL_REGISTRY[ARCHIVE_ORIGIN_PANEL_KIND[p]].label);
    }
  });

  it("the marginalia hide rows use the marker's panel's shortLabel", () => {
    const labels = VIEW_PREF_REGISTRY.hiddenMarginaliaTypes.memberLabels as Record<string, string>;
    for (const t of HIDEABLE_MARKER_TYPES) {
      expect(labels[t]).toBe(PANEL_REGISTRY[panelForMarkerType(t)].shortLabel);
    }
  });

  it("the Todo List is called by its two registry names and no other", () => {
    const seen = new Set([
      PANEL_BODY_LABELS.todo,
      PANEL_THEME_COPY.todo.label,
      SCOPE_LABEL.todos,
      ARCHIVE_ORIGIN_PANEL_LABEL.todos,
      (VIEW_PREF_REGISTRY.hiddenMarginaliaTypes.memberLabels as Record<string, string>).todo,
    ]);
    for (const name of seen) expect(namesOf("todo")).toContain(name);
  });
});

/* ── CENSUS ─────────────────────────────────────────────────────────── */

/** Every spelling a panel has been called by: the registry's names plus the
 *  drift spellings task 1475 retired, so a regression to one of THOSE is
 *  caught too. */
const PANEL_NAME_SPELLINGS: ReadonlySet<string> = new Set([
  ...(Object.keys(PANEL_REGISTRY) as PanelKind[]).flatMap(namesOf),
  "Todos",
  "Todo",
  "Margin notes",
  "Cutter cards",
]);

const VALUE_RE = /^\s*["']?[\w-]+["']?\s*:\s*["']([^"'\n]+)["']/gm;
const TABLE_THRESHOLD = 3;

function panelNameValues(src: string): string[] {
  const hits = new Set<string>();
  for (const m of src.matchAll(VALUE_RE)) {
    if (PANEL_NAME_SPELLINGS.has(m[1])) hits.add(m[1]);
  }
  return [...hits].sort();
}

const isLabelTable = (src: string) => panelNameValues(src).length >= TABLE_THRESHOLD;

/** The ONE file allowed to spell panel names. */
const ALLOWED = new Set(["src/panels/panel-registry.ts"]);

describe("CENSUS: no panel-name literal table outside PANEL_REGISTRY (task 1475)", () => {
  it("the scanner flags the pre-1475 PANEL_BODY_LABELS table", () => {
    const old = `export const PANEL_BODY_LABELS: Record<PanelBodyKey, string> = {
  footnote: "Footnotes",
  note:     "Margin notes",
  cut:      "Cutter cards",
  todo:     "To-dos",
};`;
    expect(isLabelTable(old)).toBe(true);
  });

  it("no source file outside the registry holds one", () => {
    const offenders: string[] = [];
    for (const abs of trackedFiles("src", /\.tsx?$/)) {
      const rel = path.relative(REPO_ROOT, abs);
      if (ALLOWED.has(rel) || rel.includes("__tests__") || /\.test\.tsx?$/.test(rel)) continue;
      const names = panelNameValues(readFileSync(abs, "utf8"));
      if (names.length >= TABLE_THRESHOLD) offenders.push(`${rel}: ${names.join(", ")}`);
    }
    expect(
      offenders,
      "A panel-name table restates PANEL_REGISTRY. Derive the names from " +
        "PANEL_REGISTRY[panel].label / .shortLabel instead.",
    ).toEqual([]);
  });
});
