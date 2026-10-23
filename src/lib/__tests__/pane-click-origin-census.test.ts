/**
 * PANE-CLICK ORIGIN CENSUS (task 1093; widened to the inline-atom clicks,
 * `virgil-footnote-click` / `virgil-citation-click`, by task 1252).
 *
 * `virgil-linked-anchor-click` and `virgil-error-marker-click` carry a click
 * from inside an `EditorPane` up to the shell's ONE bridge, which routes it by
 * the ORIGIN pane's `docId` (`@/lib/pane-click-origin`). Before task 1093 they
 * were spelled as raw `new CustomEvent("virgil-…")` at three dispatch sites
 * with no doc identity, so a Library Reader click selected in the editor's
 * store and docked panels through the editor's persisted prefs.
 *
 * The typed dispatchers REQUIRE `docId`, so the only way to send an id-less
 * click again is to spell the event name by hand. This census forbids that:
 * outside the door module, no source file (tests excluded) may contain either
 * event name as a string literal — dispatch through
 * `dispatchLinkedAnchorClick` / `dispatchErrorMarkerClick`, listen through
 * `LINKED_ANCHOR_CLICK_EVENT` / `ERROR_MARKER_CLICK_EVENT`.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { commentsStripped, walkFiles } from "./_source-scan";

const REPO = path.resolve(__dirname, "../../..");
const DOOR = "src/lib/pane-click-origin.ts";
const EVENT_NAMES = [
  "virgil-linked-anchor-click",
  "virgil-error-marker-click",
  "virgil-footnote-click",
  "virgil-citation-click",
];

/** A quoted occurrence of an event name in code (comments stripped). */
export function spellsEventByHand(source: string): string[] {
  const code = commentsStripped(source);
  return EVENT_NAMES.filter((name) =>
    new RegExp(`["'\`]${name}["'\`]`).test(code),
  );
}

describe("pane-click origin census", () => {
  it("the detector flags a hand-spelled dispatch and ignores prose", () => {
    expect(
      spellsEventByHand(`window.dispatchEvent(new CustomEvent("virgil-linked-anchor-click", { detail }));`),
    ).toEqual(["virgil-linked-anchor-click"]);
    expect(spellsEventByHand(`// dispatches \`virgil-error-marker-click\` up`)).toEqual([]);
    expect(spellsEventByHand(`dispatchLinkedAnchorClick({ docId, entityId, kind });`)).toEqual([]);
  });

  it("no source file outside the door spells either event name", () => {
    const offenders: string[] = [];
    for (const abs of walkFiles(path.join(REPO, "src"))) {
      if (!/\.(ts|tsx)$/.test(abs)) continue;
      const rel = path.relative(REPO, abs).split(path.sep).join("/");
      if (rel === DOOR || /\/__tests__\//.test(rel)) continue;
      const hits = spellsEventByHand(fs.readFileSync(abs, "utf8"));
      for (const h of hits) offenders.push(`${rel}: "${h}"`);
    }
    expect(
      offenders,
      `Dispatch through dispatchLinkedAnchorClick / dispatchErrorMarkerClick / ` +
        `dispatchFootnoteClick / dispatchCitationClick ` +
        `(they require the origin docId) and listen through the exported event ` +
        `constants in ${DOOR}.`,
    ).toEqual([]);
  });
});
