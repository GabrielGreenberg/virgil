// @vitest-environment jsdom
/**
 * Theme-key FREEZE pin (test-hardening chip, Session-17 handoff).
 *
 * `panel-theme.defaults.json` is rewritten by the personal-prefs promotion
 * pipeline (`tools/promote-defaults.mjs` / `sync-defaults.sh`) — NOT by a
 * human editing TS. The 2026-06-09 release incident nearly shipped a stale
 * prefs snapshot; a silently DROPPED key here would propagate as
 * `DEFAULT_PANEL_COLORS[key] === undefined` → `hexToRgb` error-paths →
 * a black palette for that whole card kind.
 *
 * The expected key set below is a FROZEN LITERAL on purpose. Do NOT derive
 * it from the JSON, from `PanelThemeKey`, or from `CARD_REGISTRY` — the
 * entire point is that a dropped/renamed/added key fails THIS test even when
 * every derived structure agrees with the (wrong) source. If you are adding
 * a real new panel theme, extend the literal list here in the same commit.
 */
import { describe, it, expect, vi } from "vitest";

// `@/components/panel-primitives` transitively pulls `@/lib/storage`, whose
// `require("@/lib/storage-fsa")` vitest's resolver can't alias (the known
// barrel/storage gotcha). Stub every export — we only read CARD_THEMES.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

import defaultPanelColorsJson from "@/lib/panel-theme.defaults.json";
import {
  DEFAULT_PANEL_COLORS,
  SYSTEM_THEME_KEYS,
  type PanelThemeKey,
} from "@/lib/panel-theme";
import { CARD_THEMES } from "@/components/panel-primitives";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_KINDS } from "@/cards/predicates";

/** THE frozen key set — 13 keys, hand-written, never derived. */
const FROZEN_THEME_KEYS = [
  "citation",
  "bib",
  "footnote",
  "note",
  "highlight",
  "archive",
  "todo",
  "cut",
  "revision",
  "report",
  "example",
  "aiRequest",
  "error",
] as const;

/** Every palette field `deriveCardPalette`/`themeFromAccent` must produce —
 *  the fields card headers / badges / titles read. Frozen literal too. */
const REQUIRED_PALETTE_FIELDS = [
  "accent",
  "headerDefault",
  "headerSelected",
  "separatorSelected",
  "borderSelected",
  "badgeBg",
  "badgeColor",
  "badgeBorder",
  "titleColor",
] as const;

const HEX6 = /^#[0-9a-f]{6}$/i;

describe("panel-theme key freeze (13 frozen keys)", () => {
  it("panel-theme.defaults.json carries EXACTLY the frozen key set", () => {
    expect(Object.keys(defaultPanelColorsJson).sort()).toEqual(
      [...FROZEN_THEME_KEYS].sort(),
    );
  });

  it("every JSON value is a full 6-digit hex (no shorthand, no css names)", () => {
    for (const key of FROZEN_THEME_KEYS) {
      const v = (defaultPanelColorsJson as Record<string, unknown>)[key];
      expect(typeof v, `${key} must be a string`).toBe("string");
      expect(v, `${key} must be #rrggbb (got ${String(v)})`).toMatch(HEX6);
    }
  });

  it("DEFAULT_PANEL_COLORS exposes the same frozen key set (loader didn't filter)", () => {
    expect(Object.keys(DEFAULT_PANEL_COLORS).sort()).toEqual(
      [...FROZEN_THEME_KEYS].sort(),
    );
  });

  it("CARD_THEMES (the consumption side) has EXACTLY the frozen keys — no drops, no extras", () => {
    expect(Object.keys(CARD_THEMES).sort()).toEqual(
      [...FROZEN_THEME_KEYS].sort(),
    );
  });

  it("every CARD_THEMES entry carries all palette-derivation fields, each a solid hex", () => {
    for (const key of FROZEN_THEME_KEYS) {
      const theme = CARD_THEMES[key as PanelThemeKey] as Record<string, unknown>;
      expect(theme, `CARD_THEMES.${key} missing`).toBeTruthy();
      for (const field of REQUIRED_PALETTE_FIELDS) {
        expect(
          theme[field],
          `CARD_THEMES.${key}.${field} must be a #rrggbb hex`,
        ).toMatch(HEX6);
      }
    }
  });

  it("each frozen theme accent is the JSON value verbatim (no transform between file and theme)", () => {
    for (const key of FROZEN_THEME_KEYS) {
      expect(CARD_THEMES[key as PanelThemeKey].accent).toBe(
        (defaultPanelColorsJson as Record<string, string>)[key],
      );
    }
  });

  it("every CARD_REGISTRY themeKey resolves to a frozen key (no kind points at a hole)", () => {
    const frozen = new Set<string>(FROZEN_THEME_KEYS);
    for (const kind of CARD_KINDS) {
      const tk = CARD_REGISTRY[kind].themeKey;
      expect(frozen.has(tk), `CARD_REGISTRY.${kind}.themeKey "${tk}" not frozen`).toBe(true);
    }
  });

  it("the non-overridable system keys stay exactly {aiRequest, error}", () => {
    expect([...SYSTEM_THEME_KEYS].sort()).toEqual(["aiRequest", "error"]);
  });
});
