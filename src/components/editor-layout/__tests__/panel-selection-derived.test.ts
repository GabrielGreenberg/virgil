// @vitest-environment jsdom
// Task 1172 — "which card is selected in panel P, and where is it in the DOM"
// is DERIVED from the store's one `selected {kind,id}` + the registry SSOT
// (`panelForCardKind`), not from a hand switch. The switch it replaced covered
// five panels and silently skipped Reports, Cutter, Revisions, Examples and a
// selected Highlight, so a strip-icon click opened those panels unscrolled.

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPanelSelection, cardEntrySelector } from "../panel-selection";
import { CARD_KINDS, panelForCardKind } from "@/cards/predicates";
import { cardPopKey } from "@/panels/panel-registry";
import type { CardKind } from "@/panels/_shared/types";
import type { PanelId } from "@/hooks/useViewPrefs";

afterEach(() => {
  document.body.innerHTML = "";
});

/** What every shell card stamps on its root (`useAnchoredCardShell` →
 *  `cardPopKey(kind, id)` → `PanelCard`'s `data-card-key`). */
function mountShellCard(kind: CardKind, id: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-card-key", cardPopKey(kind, id));
  document.body.appendChild(el);
  return el;
}

const PANELED_KINDS = CARD_KINDS.filter((k) => panelForCardKind(k) != null);

describe("getPanelSelection derives from the store selection (task 1172)", () => {
  // The five the audit named, spelled out so a registry change that drops one
  // is loud here rather than silently re-narrowing coverage.
  it.each([
    ["report", "reports"],
    ["report-request", "reports"],
    ["cutter-comment", "cutter"],
    ["cutter-suggestion", "cutter"],
    ["revision-comment", "revisions"],
    ["revision-suggestion", "revisions"],
    ["example", "examples"],
    ["highlight", "notes"],
  ] as const)("a selected %s resolves in the %s panel", (kind, panel) => {
    const el = mountShellCard(kind, "ab12");
    const sel = getPanelSelection(panel, { selected: { kind, id: "ab12" } });
    expect(sel).not.toBeNull();
    expect(sel!.selectedId).toBe("ab12");
    expect(document.querySelector(sel!.selector)).toBe(el);
  });

  it("every kind that owns a panel resolves there, and only there", () => {
    const panels = new Set(PANELED_KINDS.map((k) => panelForCardKind(k) as PanelId));
    for (const kind of PANELED_KINDS) {
      const home = panelForCardKind(kind) as PanelId;
      const el = mountShellCard(kind, "cd34");
      for (const panel of panels) {
        const sel = getPanelSelection(panel, { selected: { kind, id: "cd34" } });
        if (panel === home) {
          expect(sel, `${kind} in ${panel}`).not.toBeNull();
          expect(document.querySelector(sel!.selector), `${kind} in ${panel}`).toBe(el);
        } else {
          expect(sel, `${kind} must not resolve in ${panel}`).toBeNull();
        }
      }
      el.remove();
    }
  });

  it("nothing selected → null", () => {
    expect(getPanelSelection("notes", { selected: null })).toBeNull();
  });

  it("footnote / citation still resolve at the in-text link-card address", () => {
    const fn = document.createElement("div");
    fn.setAttribute("data-footnote-entry", "f1");
    document.body.appendChild(fn);
    expect(document.querySelector(cardEntrySelector("footnote", "f1"))).toBe(fn);
  });
});

describe("CENSUS: panel-selection.ts keeps no per-panel hand list (task 1172)", () => {
  it("contains no `case` literal and no `selected<Kind>Id` slot read", () => {
    const src = readFileSync(join(__dirname, "..", "panel-selection.ts"), "utf8");
    expect(src).not.toMatch(/\bcase\s+["']/);
    expect(src).not.toMatch(/\.selected[A-Z]\w*Id\b/);
  });

  it("marker-clicks.ts keeps no second per-kind entry-address table", () => {
    const src = readFileSync(
      join(__dirname, "..", "event-bridges", "marker-clicks.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/ENTRY_SELECTOR_BASE_OVERRIDE|entrySelectorBase/);
    expect(src).not.toMatch(/data-[a-z-]+-entry/);
  });
});
