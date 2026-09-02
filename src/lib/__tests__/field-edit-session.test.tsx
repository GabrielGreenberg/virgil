// @vitest-environment jsdom
/**
 * TASK 529 — the door's own contract, plus the CENSUS.
 *
 * The leg with teeth here is the CENSUS. The door was never the part that could
 * misbehave; a FIELD that never asks it is — and such a field type-checks
 * perfectly, renders perfectly, and looks correct on screen (the revert flush
 * wins the RENDER even while the commit has already fired with the typed
 * value), so it is invisible to every behavioural test of the door.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { useState } from "react";
import {
  commitLiveValue,
  useFieldEditSession,
} from "@/lib/field-edit-session";
import { strip, tagAround, trackedFiles } from "./_source-scan";

afterEach(cleanup);

const REPO = path.resolve(__dirname, "../../..");

/* ── The mechanism, driven ───────────────────────────────────────── */

function Field({
  log,
  useDoor,
}: {
  log: string[];
  useDoor: boolean;
}) {
  const [draft, setDraft] = useState("40");
  const session = useFieldEditSession();
  const commit = () => log.push(`commit:${draft}`);
  return (
    <input
      data-testid="f"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => (useDoor ? session.commit(commit) : commit())}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        log.push("esc:begin");
        if (useDoor) {
          session.cancel(e.currentTarget, () => setDraft("40"));
        } else {
          setDraft("40");
          (e.currentTarget as HTMLInputElement).blur();
        }
        log.push("esc:end");
      }}
    />
  );
}

function typeThenEscape(useDoor: boolean) {
  const log: string[] = [];
  const { getByTestId } = render(<Field log={log} useDoor={useDoor} />);
  const el = getByTestId("f") as HTMLInputElement;
  el.focus();
  fireEvent.change(el, { target: { value: "80" } });
  fireEvent.keyDown(el, { key: "Escape" });
  return { log, value: el.value };
}

describe("the mechanism this door exists for", () => {
  // The CANARY. Without the door, `.blur()` inside the keydown dispatches
  // `focusout` synchronously and the commit runs BETWEEN the two halves of the
  // cancel branch, reading the TYPED value — while the rendered value is the
  // reverted one. If this ever stops holding, every defect leg in this task
  // becomes unfalsifiable and would pass for the wrong reason.
  it("un-doored: the commit fires INSIDE the keydown with the value being cancelled — and the box still shows the reverted one", () => {
    const { log, value } = typeThenEscape(false);
    expect(log).toEqual(["esc:begin", "commit:80", "esc:end"]);
    expect(value).toBe("40"); // ← why a rendered-value assertion cannot catch this
  });

  it("doored: the cancel is visible to that same synchronous commit, so nothing commits", () => {
    const { log, value } = typeThenEscape(true);
    expect(log).toEqual(["esc:begin", "esc:end"]);
    expect(value).toBe("40");
  });
});

describe("the OTHER ending — one Enter is one commit", () => {
  function EnterField({ log, useDoor }: { log: string[]; useDoor: boolean }) {
    const [draft, setDraft] = useState("40");
    const session = useFieldEditSession();
    const commit = () => log.push(`commit:${draft}`);
    return (
      <input
        data-testid="f"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => (useDoor ? session.commit(commit) : commit())}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          if (useDoor) {
            session.commitAndBlur(e.currentTarget, commit);
          } else {
            commit();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
    );
  }
  function typeThenEnter(useDoor: boolean) {
    const log: string[] = [];
    const { getByTestId } = render(<EnterField log={log} useDoor={useDoor} />);
    const el = getByTestId("f") as HTMLInputElement;
    el.focus();
    fireEvent.change(el, { target: { value: "80" } });
    fireEvent.keyDown(el, { key: "Enter" });
    return log;
  }

  // The second CANARY. `commit(); blur();` runs the commit and then the blur's
  // own `onBlur` runs it AGAIN from the identical stale closure — which is how
  // one Enter dispatched two document transactions at three sites.
  it("un-doored: the explicit commit and the blur's commit BOTH fire", () => {
    expect(typeThenEnter(false)).toEqual(["commit:80", "commit:80"]);
  });

  it("doored: exactly one", () => {
    expect(typeThenEnter(true)).toEqual(["commit:80"]);
  });

  it("commitAndBlur still commits when the element never had focus", () => {
    // `blur()` is a no-op on an unfocused element, so a field whose Enter
    // relied on the blur to commit would silently commit NOTHING there. The
    // door commits explicitly, which is why it takes `run` rather than just
    // blurring.
    const log: string[] = [];
    const { getByTestId } = render(<EnterField log={log} useDoor />);
    const el = getByTestId("f") as HTMLInputElement;
    fireEvent.change(el, { target: { value: "80" } });
    fireEvent.keyDown(el, { key: "Enter" }); // never focused
    expect(log).toEqual(["commit:80"]);
  });
});

describe("the cancel window is bounded by the blur", () => {
  it("a cancel whose blur never lands cannot swallow a LATER commit", () => {
    const log: string[] = [];
    function Probe() {
      const s = useFieldEditSession();
      return (
        <>
          {/* cancel with no element at all — the blur cannot happen */}
          <button data-testid="c" onClick={() => s.cancel(null)} />
          <button data-testid="k" onClick={() => s.commit(() => log.push("ran"))} />
          <span data-testid="flag">{String(s.isEnding())}</span>
        </>
      );
    }
    const { getByTestId } = render(<Probe />);
    fireEvent.click(getByTestId("c"));
    expect(getByTestId("flag").textContent).toBe("false");
    fireEvent.click(getByTestId("k"));
    expect(log).toEqual(["ran"]); // not swallowed
  });

  it("the flag is cleared even when the revert throws", () => {
    const s: { current: ReturnType<typeof useFieldEditSession> | null } = { current: null };
    function Probe() {
      s.current = useFieldEditSession();
      return null;
    }
    render(<Probe />);
    expect(() =>
      s.current!.cancel(null, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(s.current!.isEnding()).toBe(false);
    expect(s.current!.commit(() => {})).toBe(true);
  });
});

describe("commit REPORTS whether it ran", () => {
  it("true when it ran, false when a cancel is in flight", () => {
    const seen: boolean[] = [];
    function Probe() {
      const s = useFieldEditSession();
      return (
        <>
          <button
            data-testid="plain"
            onClick={() => seen.push(s.commit(() => {}))}
          />
          <button
            data-testid="during"
            onClick={() =>
              s.cancel(null, () => seen.push(s.commit(() => {})))
            }
          />
        </>
      );
    }
    const { getByTestId } = render(<Probe />);
    fireEvent.click(getByTestId("plain"));
    fireEvent.click(getByTestId("during"));
    expect(seen).toEqual([true, false]);
  });
});

describe("commitLiveValue — the liveness half", () => {
  it("REFUSES on a dead element rather than writing a default", () => {
    const apply = vi.fn();
    expect(commitLiveValue(null, apply)).toBe(false);
    expect(commitLiveValue(undefined, apply)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("runs with the element's LIVE value", () => {
    const el = document.createElement("input");
    el.value = "hello";
    const apply = vi.fn();
    expect(commitLiveValue(el, apply)).toBe(true);
    expect(apply).toHaveBeenCalledWith("hello");
  });

  it("reads the value at CALL time, not at capture time", () => {
    const el = document.createElement("input");
    el.value = "before";
    let seen = "";
    commitLiveValue(el, (v) => { seen = v; });
    expect(seen).toBe("before");
    el.value = "after";
    commitLiveValue(el, (v) => { seen = v; });
    expect(seen).toBe("after");
  });
});

/* ── CENSUS ──────────────────────────────────────────────────────── */

/** The region of a JSX element that carries an `onKeyDown={...}` — from the
 *  attribute to that handler's balanced close. Deliberately per HANDLER, not
 *  per FILE: `panel-primitives.tsx` holds several fields, so a file-scoped
 *  question lets one compliant field excuse a drifting sibling (the
 *  per-handle granularity `pane-drag-guardrail` earned). */
function keydownHandlers(src: string): { body: string; index: number }[] {
  const out: { body: string; index: number }[] = [];
  const re = /onKeyDown=\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
    }
    out.push({ body: src.slice(m.index, i), index: m.index });
  }
  return out;
}

const HAS_BLUR_COMMIT = /onBlur=/;
/** Ends the session by taking focus off the field — a bare blur, or the door,
 *  which blurs for you. Keyed on the QUESTION ("does this branch end the
 *  session?") rather than on the pre-fix MECHANISM (`.blur()`): keying it on
 *  the mechanism means every site DROPS OUT of the population the moment it is
 *  fixed, so the census would go green by emptying itself (task 404's rule). */
const ENDS_SESSION = /\.blur\(\)|session\.(?:cancel|commitAndBlur)\(/;
const TAKES_DOOR = /session\.(?:cancel|commitAndBlur)\(/;

/** Does this keydown treat Escape as its OWN branch?
 *
 *  A handler whose only mention of Escape is `e.key === "Enter" || e.key ===
 *  "Escape"` is not promising a revert — it is saying the two keys mean the
 *  same thing, which for a field that already committed on every keystroke
 *  (`SizeStepper`, `PanelTextSizeRow`) is true and leaves nothing to cancel.
 *  This is the honest discriminator: Escape needs a door only where it means
 *  something DIFFERENT from Enter. */
function hasDistinctCancel(body: string): boolean {
  const withoutAlias = body
    .replace(/["']Enter["'][^;{]*?["']Escape["']/g, "")
    .replace(/["']Escape["'][^;{]*?["']Enter["']/g, "");
  return /["']Escape["']/.test(withoutAlias);
}

/** Every production site where a keydown's CANCEL branch blurs an element that
 *  also commits on blur. EMPTY — a hit is TAKE-THE-DOOR, never an entry. */
const PERMITTED_UNDOORED_CANCELS: Record<string, string> = {};

function productionSources(): { rel: string; src: string }[] {
  return [...trackedFiles("src", /\.tsx?$/), ...trackedFiles("library", /\.tsx?$/)]
    .filter((abs) => !abs.includes("__tests__") && !abs.includes(".test."))
    .map((abs) => ({
      rel: path.relative(REPO, abs),
      // Comments stripped, string LITERALS kept: the needles (`"Escape"`,
      // `onBlur=`) are quoted text inside JSX attributes, so blanking strings
      // would erase the very thing being grepped — the trap `_source-scan`'s
      // own header records.
      src: strip(readFileSync(abs, "utf8"), true),
    }));
}

function cancellingFields(): { rel: string; doored: boolean }[] {
  const hits: { rel: string; doored: boolean }[] = [];
  for (const { rel, src } of productionSources()) {
    if (!src.includes("onKeyDown={")) continue;
    for (const h of keydownHandlers(src)) {
      if (!hasDistinctCancel(h.body) || !ENDS_SESSION.test(h.body)) continue;
      const tag = tagAround(src, h.index);
      if (!tag || !HAS_BLUR_COMMIT.test(tag)) continue;
      hits.push({ rel, doored: TAKES_DOOR.test(h.body) });
    }
  }
  return hits;
}

describe("CENSUS — a cancelling field takes the door", () => {
  it("no production field cancels with a bare blur beside an onBlur commit", () => {
    const bare = cancellingFields()
      .filter((h) => !h.doored)
      .map((h) => h.rel)
      .filter((rel) => !(rel in PERMITTED_UNDOORED_CANCELS));
    expect([...new Set(bare)]).toEqual([]);
  });

  it("the allowlist is EMPTY — there is no true statement of 'this field cancels but may not say so'", () => {
    expect(Object.keys(PERMITTED_UNDOORED_CANCELS)).toEqual([]);
  });

  it("every member of the population is accounted for, and it is not empty", () => {
    // A census whose population collapsed to zero passes leg 1 for the wrong
    // reason. These five are the whole class, across both silos, and every one
    // takes the door — so leg 1's empty answer is a fact about compliance, not
    // about an empty scan.
    const found = cancellingFields();
    const rels = [...new Set(found.map((h) => h.rel))].sort();
    expect(rels).toEqual([
      "library/components/PagePicker.tsx",
      "src/components/FigureBlockNodeView.tsx",
      "src/components/SourcePodNodeView.tsx",
      "src/components/panel-primitives.tsx",
      "src/panels/Citations/CitationCard.tsx",
    ]);
    expect(found.every((h) => h.doored)).toBe(true);
  });

  // CAN-SEE canary, on a SYNTHETIC fixture rather than on a real line: a canary
  // standing on the defect evaporates the moment the defect is drained.
  it("the scan can see the shape it is looking for", () => {
    const fixture = [
      "<input",
      "  value={draft}",
      "  onChange={(e) => setDraft(e.target.value)}",
      "  onBlur={commitDraft}",
      "  onKeyDown={(e) => {",
      '    if (e.key === "Enter") { commitDraft(); e.currentTarget.blur(); }',
      '    else if (e.key === "Escape") { setDraft(prev); e.currentTarget.blur(); }',
      "  }}",
      "/>",
    ].join("\n");
    const hs = keydownHandlers(fixture);
    expect(hs).toHaveLength(1);
    expect(hasDistinctCancel(hs[0].body)).toBe(true);
    expect(ENDS_SESSION.test(hs[0].body)).toBe(true);
    expect(HAS_BLUR_COMMIT.test(tagAround(fixture, hs[0].index) ?? "")).toBe(true);
    expect(TAKES_DOOR.test(hs[0].body)).toBe(false); // ← would be flagged
  });

  // The NON-MEMBERS, pinned with their reasons so a later sweep does not
  // "unify" them in and a later tightening does not indict them.
  it("a field with NO cancel branch is out of the population by construction", () => {
    // The hex-color field — Enter blurs, and that is the whole keymap, so there
    // is no cancel to make visible. Byte-unchanged by task 529.
    //
    // RENEGOTIATED IN PLACE (task 532): this leg used to read
    // `PreferenceTree.tsx`, which is where the control lived when 529 shipped.
    // `SmartPreferences` hand-rolled a SECOND copy of the same swatch+hex pair
    // with no draft at all, so the control became a primitive
    // (`HexColorField.tsx`) that both preference surfaces render — and the
    // keydown moved with it. The CLAIM is unchanged and so is the field's
    // behaviour; what moved is the file that hosts it, and a census that kept
    // reading the old one would report zero blurring handlers, i.e. pass its
    // sibling assertion vacuously while pinning nothing.
    const src = strip(
      readFileSync(path.join(REPO, "src/components/HexColorField.tsx"), "utf8"),
      true,
    );
    const blurring = keydownHandlers(src).filter((x) => ENDS_SESSION.test(x.body));
    expect(blurring.length).toBeGreaterThan(0);
    expect(blurring.every((x) => !hasDistinctCancel(x.body))).toBe(true);
  });

  it("a field that commits on EVERY keystroke has nothing left to cancel", () => {
    // SizeStepper / PanelTextSizeRow DO name Escape and DO blur — they are out
    // of the population only because their `onChange` already committed, so
    // Escape is deliberately synonymous with Enter and there is no promise to
    // break. Whether such a field should OFFER a cancel is a product question,
    // not this door's.
    for (const rel of [
      "src/components/SizeStepper.tsx",
      "src/components/PanelTextSizeRow.tsx",
    ]) {
      const src = strip(readFileSync(path.join(REPO, rel), "utf8"), true);
      const h = keydownHandlers(src);
      // They DO name Escape and they DO blur…
      expect(h.some((x) => /["']Escape["']/.test(x.body))).toBe(true);
      expect(h.some((x) => ENDS_SESSION.test(x.body))).toBe(true);
      // …but always in the same statement as Enter, which is the tell, and the
      // REASON is that `onChange` has already committed every keystroke.
      expect(h.every((x) => !hasDistinctCancel(x.body))).toBe(true);
      expect(/onChange=\{[\s\S]{0,400}?commit/.test(src)).toBe(true);
    }
  });
});
