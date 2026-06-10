/**
 * A6/R17 pin tests — registry-derived marker metadata.
 *
 * `MARKER_META`'s panel + accent now derive from `CARD_REGISTRY` via
 * `src/cards/marker-meta.ts`. These tables FREEZE the derived values so a
 * registry edit that silently re-routes or re-tints a gutter marker trips a
 * test instead of shipping. The one intentional keyspace bridge (registry
 * themeKey `"comment"` → PanelThemeKey `"revision"`) and the one intentional
 * accent identity (error ≡ footnote rust) are pinned explicitly.
 */
import { describe, it, expect } from "vitest";
import { CARD_REGISTRY } from "@/cards/card-registry";
import {
  ALL_MARKER_TYPES,
  cardKindsForMarkerType,
  panelForMarkerType,
  panelThemeKeyForMarkerType,
} from "@/cards/marker-meta";
import type { CardKind, MarkerType } from "@/cards/types";
import type { MarginItemKind } from "@/cards/delete-margin-item";
import { MARKER_META } from "@/lib/marginalia";
import {
  DEFAULT_PANEL_COLORS,
  deriveMarkerPalette,
  type PanelThemeKey,
} from "@/lib/panel-theme";

/** Bidirectional type-equality assert (compile-time pin). */
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("marker-meta derivation (A6/R17)", () => {
  it("registry distinct markerTypes ≡ MARKER_META keys ≡ ALL_MARKER_TYPES", () => {
    const declared = new Set<MarkerType>();
    for (const kind of Object.keys(CARD_REGISTRY) as CardKind[]) {
      const t = CARD_REGISTRY[kind].markerType;
      if (t != null) declared.add(t);
    }
    expect([...declared].sort()).toEqual([...ALL_MARKER_TYPES].sort());
    expect(Object.keys(MARKER_META).sort()).toEqual([...ALL_MARKER_TYPES].sort());
  });

  it("per-type card kinds match the frozen table", () => {
    const frozen: Record<MarkerType, CardKind[]> = {
      note: ["note"],
      archive: ["archive"],
      revision: ["revision-comment", "revision-suggestion"],
      cut: ["cutter-comment", "cutter-suggestion"],
      todo: ["todo"],
      report: ["report", "report-request"],
      error: ["error"],
    };
    for (const t of ALL_MARKER_TYPES) {
      expect(cardKindsForMarkerType(t).sort()).toEqual(frozen[t].sort());
    }
  });

  it("per-type panel matches the frozen table (and MARKER_META.panelId agrees)", () => {
    const frozen: Record<MarkerType, string> = {
      note: "notes",
      archive: "archive",
      revision: "revisions",
      cut: "cutter",
      todo: "todo",
      report: "reports",
      error: "errors",
    };
    for (const t of ALL_MARKER_TYPES) {
      expect(panelForMarkerType(t)).toBe(frozen[t]);
      expect(MARKER_META[t].panelId).toBe(frozen[t]);
    }
  });

  it("per-type theme key matches the frozen table (comment→revision crosswalked)", () => {
    const frozen: Record<MarkerType, PanelThemeKey> = {
      note: "note",
      archive: "archive",
      // The ONE divergent token: the revision pair declares registry
      // themeKey "comment"; the user-overridable slot is "revision".
      revision: "revision",
      cut: "cut",
      todo: "todo",
      report: "report",
      error: "error",
    };
    for (const t of ALL_MARKER_TYPES) {
      expect(panelThemeKeyForMarkerType(t)).toBe(frozen[t]);
    }
    // The crosswalk's precondition, pinned: the registry really does say
    // "comment" for both revision kinds (if A10 unifies the keyspaces this
    // expectation flips to "revision" and the crosswalk constant dies).
    expect(CARD_REGISTRY["revision-comment"].themeKey).toBe("comment");
    expect(CARD_REGISTRY["revision-suggestion"].themeKey).toBe("comment");
  });

  it("derived error palette is byte-identical to the old footnote-accent literal", () => {
    // The old MARKER_META.error row hand-pointed at the footnote accent.
    // Deriving from the registry themeKey ("error") must not shift a single
    // byte: the two defaults are the same rust hex.
    expect(DEFAULT_PANEL_COLORS.error).toBe("#b45757");
    expect(DEFAULT_PANEL_COLORS.footnote).toBe("#b45757");
    const legacy = deriveMarkerPalette(DEFAULT_PANEL_COLORS.footnote);
    expect({
      color: MARKER_META.error.color,
      bg: MARKER_META.error.bg,
      border: MARKER_META.error.border,
    }).toEqual(legacy);
  });

  it("MarginItemKind ≡ Exclude<MarkerType, 'error'> (compile-time pin)", () => {
    const pinned: AssertEqual<MarginItemKind, Exclude<MarkerType, "error">> = true;
    expect(pinned).toBe(true);
  });
});
