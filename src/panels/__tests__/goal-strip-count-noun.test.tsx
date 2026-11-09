// @vitest-environment jsdom
//
// Task 1540 — both goal strips count their nouns through ONE `countNoun`, so
// the Cutter no longer says "1 words" / "1 words to cut" while its Revisions
// twin says "1 revision to go".

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { countNoun } from "@/lib/count-noun";
import { CutterGoalStrip } from "@/panels/Cutter/CutterGoalStrip";
import { RevisionsTrackerStrip } from "@/panels/Revisions/RevisionsTracker";

afterEach(cleanup);

const noop = () => undefined;
const GOAL = { target: 1, initialWords: 10, setAt: "2026-08-01T00:00:00.000Z" };

describe("countNoun (task 1540)", () => {
  it("is singular at exactly one, plural otherwise, locale-formatted", () => {
    expect(countNoun(1, "word")).toBe("1 word");
    expect(countNoun(0, "word")).toBe("0 words");
    expect(countNoun(2, "word")).toBe("2 words");
    expect(countNoun(1240, "word")).toBe((1240).toLocaleString() + " words");
    expect(countNoun(2, "child", "children")).toBe("2 children");
  });
});

describe("goal strips pluralize their counts (task 1540)", () => {
  it("Cutter: one word reads '1 word' and '1 word to cut'", () => {
    const { container } = render(
      <CutterGoalStrip goal={GOAL} currentWords={2} onSetGoal={noop} onClearGoal={noop} />,
    );
    expect(container.textContent).toContain("1 word to cut");
    expect(container.textContent).not.toContain("1 words");
    cleanup();
    const { container: c2 } = render(
      <CutterGoalStrip goal={null} currentWords={1} onSetGoal={noop} onClearGoal={noop} />,
    );
    expect(c2.textContent).toContain("1 word");
    expect(c2.textContent).not.toContain("1 words");
  });

  it("Cutter: two words to cut stays plural", () => {
    const { container } = render(
      <CutterGoalStrip goal={GOAL} currentWords={3} onSetGoal={noop} onClearGoal={noop} />,
    );
    expect(container.textContent).toContain("2 words to cut");
  });

  it("Revisions: unchanged — '1 revision to go' / '2 revisions to go'", () => {
    const { container } = render(
      <RevisionsTrackerStrip tracker={{ target: 4 }} acceptedCount={3} totalCount={9} onSetTarget={noop} />,
    );
    expect(container.textContent).toContain("1 revision to go");
    cleanup();
    const { container: c2 } = render(
      <RevisionsTrackerStrip tracker={{ target: 5 }} acceptedCount={3} totalCount={9} onSetTarget={noop} />,
    );
    expect(c2.textContent).toContain("2 revisions to go");
  });
});
