// Menu live-anchor census (task 747; doctrine: Scroll-anchor stability law,
// `menu/live-anchor.ts`).
//
// The law: *a portaled menu's anchor is LIVE.* `<MenuProvider>` portals to
// `document.body` at `position: fixed` by default, so a rect captured at open
// is a snapshot of where the anchor WAS: scroll the editor and the anchor moves
// while the menu stays behind. The provider already owns the sanctioned
// re-anchor (`useFloatingMenuPosition`'s RAF-coalesced, gesture-parked
// `trackAnchor` re-read); a call site only has to hand it a thunk. Before 747
// five sites did not — the lightning menu's text-color popover, the heading-type
// menu, the spelling menu and both `\ref` popovers — and nothing could see it,
// because each looked correct on the frame it opened.
//
// So: every portaled `<MenuProvider>` call site must pass `trackAnchor` (see
// `live-anchor.ts` for the three anchor shapes), or sit on
// `PERMITTED_FROZEN_ANCHORS` with the reason its rect is already live. A
// docked `portal={false}` menu moves with its host by layout and is exempt.
//
// Stated limit: the census reads the OPEN TAG, so it proves a thunk is PASSED,
// not that it re-reads the right thing — `menu-live-anchor.test.tsx` drives the
// real consumers for that.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { commentsStripped, elementsNamed } from "@/lib/__tests__/_source-scan";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../../library");
const REPO_ROOT = path.resolve(SRC, "..");

/**
 * Portaled menus whose `anchorRect` is already live without `trackAnchor`,
 * keyed by repo-relative file. An entry must say what re-derives the rect.
 * The set may only SHRINK.
 */
const PERMITTED_FROZEN_ANCHORS: Record<string, string> = {
  "src/components/ActionsMenuPanel.tsx":
    "The lightning menu's `triggerRect` is re-derived on EVERY render by its parent `SelectionActionsMenu` from the bolt's own placement, which follows scroll through the viewport-frame channel (RAF-coalesced, gesture-parked). The rect it receives is therefore current each frame the bolt moves; a thunk would re-read the same number. (Its CHILD, the text-color popover, is a separate `<MenuProvider>` in SelectionColorPopover.tsx and does pass `trackAnchor`.)",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "__tests__") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(REPO_ROOT, f);

interface Site {
  file: string;
  tag: string;
}

function portaledSites(): Site[] {
  const out: Site[] = [];
  for (const f of [...walk(SRC), ...walk(LIBRARY)]) {
    const src = commentsStripped(readFileSync(f, "utf8"));
    for (const hit of elementsNamed(src, "MenuProvider")) {
      if (/\bportal=\{false\}/.test(hit.tag)) continue;
      out.push({ file: rel(f), tag: hit.tag });
    }
  }
  return out;
}

describe("menu live-anchor census (task 747)", () => {
  const sites = portaledSites();

  it("finds the population (self-check — a broken scanner must not pass green)", () => {
    // HeadingTypeMenu, SpellSuggestionMenu, SelectionColorPopover, LabelRefPopover,
    // AnchoredMenu, ActionsMenuPanel … — well over a handful today.
    expect(sites.length).toBeGreaterThanOrEqual(8);
    expect(sites.some((s) => s.file.endsWith("HeadingTypeMenu.tsx"))).toBe(true);
  });

  it("every portaled <MenuProvider> passes trackAnchor or is allowlisted", () => {
    const frozen = sites
      .filter((s) => !/\btrackAnchor=/.test(s.tag))
      .filter((s) => !(s.file in PERMITTED_FROZEN_ANCHORS))
      .map((s) => s.file);
    expect(
      frozen,
      "these menus portal at position:fixed from a rect captured at open, so they stay put while their anchor scrolls — pass `trackAnchor` (src/components/menu/live-anchor.ts) or allowlist with the reason the rect is already live",
    ).toEqual([]);
  });

  it("every allowlist entry is still a frozen-anchor site (the set only shrinks)", () => {
    for (const file of Object.keys(PERMITTED_FROZEN_ANCHORS)) {
      const here = sites.filter((s) => s.file === file);
      expect(here.length, `${file} no longer mounts a portaled <MenuProvider>`).toBeGreaterThan(0);
      expect(
        here.some((s) => !/\btrackAnchor=/.test(s.tag)),
        `${file} now passes trackAnchor — drop its PERMITTED_FROZEN_ANCHORS entry`,
      ).toBe(true);
    }
  });
});
