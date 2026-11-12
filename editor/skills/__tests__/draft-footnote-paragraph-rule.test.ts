// @vitest-environment node
//
// draft-footnote states ONE rule for "where is this footnote" (task 1585).
//
// The drain's `paragraphIds` names the paragraph holding a footnote's `\vfid{}`
// marker (task 1418). The skill used to say three things at once: step 0a
// halted on an empty `paragraphIds`, E2 read its context uuid from it, and the
// Safety section said the act-on-existing branch did NOT need it — while the
// `update` the branch lands dies when the marker is gone. It also had no halt
// template for that case, and its missing-bibkey todo asked for a `\citet`
// splice no door performs (find-citation lands an UNANCHORED card) in a
// natbib-only spelling.

import { describe, it, expect } from "vitest";

import { readRepo as read } from "./_review-routes";

const skill = read("editor/skills/draft-footnote.md");
const flat = skill.replace(/\s+/g, " ");

describe("draft-footnote paragraph rule (task 1585)", () => {
  it("never says the act-on-existing branch does without paragraphIds", () => {
    expect(flat).not.toMatch(/does NOT need `paragraphIds`/);
    expect(flat).toContain("Both branches need `paragraphIds`");
  });

  it("has a halt template for a deleted marker, and E1 routes to it", () => {
    expect(flat).toContain(
      "Halted: footnote <cardId> for request <requestId> has no marker in the text",
    );
    const e1 = skill.slice(skill.indexOf("E1."), skill.indexOf("E2."));
    expect(e1).toMatch(/deleted-marker template/);
  });

  it("the missing-bibkey todo names no citation command and promises no splice", () => {
    const step3 = skill.slice(
      skill.indexOf("**Missing-bibkey follow-up"),
      skill.indexOf("4. **Reply.**"),
    );
    expect(step3).not.toMatch(/splice \\cite/);
    expect(step3).not.toMatch(/\\citet\{</);
    expect(step3).not.toMatch(/loop actually closes/);
    expect(step3).toMatch(/unanchored/);
  });
});
