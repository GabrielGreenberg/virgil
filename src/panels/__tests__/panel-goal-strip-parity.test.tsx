// @vitest-environment jsdom
//
// Task 2026-08-02-286 — the extraction is a REFACTOR, and this is what makes
// that claim checkable.
//
// `CutterGoalStrip` and `RevisionsTrackerStrip` were two hand-maintained
// ~135-line files rendering the same three-state chrome; they are now ~15-line
// adapters over one `PanelGoalStrip`. A DRY extraction whose output drifts is
// not a DRY extraction — it is a silent redesign of two panels nobody asked
// for — so this suite renders the PRE-286 components (embedded verbatim below)
// against the post-286 adapters and demands byte-identical DOM in every state.
//
// **The two sanctioned differences, stated rather than smuggled.** (1) The
// legacy fixtures keep their raw `bg-emerald-500` / `text-emerald-700`; the
// shipped primitive reads `--positive` / `--positive-strong`, whose values are
// pinned to exactly those two emeralds (globals.css). `tokenized()` performs
// that substitution on the legacy HTML before comparing, and the reached-state
// legs assert it actually fired — a normalization that silently matched nothing
// would make every parity leg pass vacuously. (2) `canonical()` sorts each
// class attribute, because class-attribute ORDER is not a rendering fact and
// the primitive composes its inline wrapper in a different order than the twins
// spelled it. Nothing else is normalized: element order, text, `data-hint`,
// `aria-label` and the inline `width:` are compared as they render.
//
// The behavioural half is here for the same reason: the `onCommit(null)` seam
// is the one place the two panels genuinely disagree (Cutter IGNORES an empty
// draft because clearing discards the unrecoverable `initialWords` baseline;
// Revisions CLEARS its target), and an extraction that unified that would be a
// data-semantics change wearing a refactor's clothes.
import { describe, it, expect, vi, afterEach } from "vitest";
import { useEffect, useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Input } from "@/components/field-primitives";
import type { CutterGoal, RevisionsTracker } from "@/lib/types";
import { CutterGoalStrip } from "@/panels/Cutter/CutterGoalStrip";
import { RevisionsTrackerStrip } from "@/panels/Revisions/RevisionsTracker";

afterEach(cleanup);

const fmt = (n: number) => n.toLocaleString();

/* ────────────────────────────────────────────────────────────────────────
   The PRE-286 components, copied verbatim from the files this task replaced
   (a9e86841). They are the reference rendering; nothing imports them but this
   suite. `__tests__` is skipped by the palette census, so their raw emeralds
   are not a new violation of the ban this same task installed.
   ──────────────────────────────────────────────────────────────────────── */

function LegacyCutterGoalStrip({
  goal,
  currentWords,
  onSetGoal,
  onClearGoal,
}: {
  goal: CutterGoal | null;
  currentWords: number;
  onSetGoal: (target: number, currentWords: number) => void;
  onClearGoal: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEditing = () => {
    setDraft(goal ? String(goal.target) : "");
    setEditing(true);
  };

  const commit = () => {
    const target = parseInt(draft.trim(), 10);
    if (Number.isFinite(target) && target >= 0) {
      onSetGoal(target, currentWords);
    }
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
    setDraft("");
  };

  if (editing) {
    return (
      <div className="px-3 py-1.5 flex items-center gap-2 text-[11px] border-b border-edge-subtle">
        <span className="text-[var(--muted)]">{fmt(currentWords)} words</span>
        <Input
          ref={inputRef}
          type="number"
          density="dense"
          min={0}
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={commit}
          placeholder="goal"
          ink="strong"
          className="ml-auto w-20 px-1.5 py-0.5 text-[11px]"
        />
      </div>
    );
  }

  if (!goal) {
    return (
      <div className="px-3 py-1.5 flex items-center gap-2 text-[11px] border-b border-edge-subtle">
        <span className="text-[var(--muted)]">{fmt(currentWords)} words</span>
        <button
          type="button"
          onClick={startEditing}
          className="ml-auto text-[var(--muted)] hover:text-ink-strong cursor-pointer rounded px-1.5 py-0.5 hover-on-light"
          data-hint="Set goal"
        >
          + goal
        </button>
      </div>
    );
  }

  const totalToCut = Math.max(0, goal.initialWords - goal.target);
  const cutSoFar = Math.max(0, goal.initialWords - currentWords);
  const leftToCut = Math.max(0, currentWords - goal.target);
  const reached = currentWords <= goal.target;
  const progress = totalToCut === 0 ? 1 : Math.min(1, cutSoFar / totalToCut);
  const pct = Math.round(progress * 100);

  return (
    <div className="px-3 py-1.5 border-b border-edge-subtle">
      <div className="flex items-center gap-2 text-[11px] mb-1">
        <span className={reached ? "text-emerald-700" : "text-ink-body"}>
          {reached ? "goal reached" : `${fmt(leftToCut)} words to cut`}
        </span>
        <button
          type="button"
          onClick={startEditing}
          className="ml-auto text-[var(--muted-light)] hover:text-ink-strong cursor-pointer text-[10px] rounded px-1 py-0.5 hover-on-light"
          data-hint="Edit goal"
        >
          edit
        </button>
        <button
          type="button"
          onClick={onClearGoal}
          className="text-[var(--muted-light)] hover:text-ink-strong cursor-pointer text-[10px] rounded px-1 py-0.5 hover-on-light"
          data-hint="Clear goal"
          aria-label="Clear goal"
        >
          ✕
        </button>
      </div>
      <div className="h-1.5 w-full rounded-full bg-edge-subtle overflow-hidden">
        <div
          className={`h-full ${reached ? "bg-emerald-500" : "bg-[var(--accent)]"} transition-[width] duration-200`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] text-[var(--muted-light)]">
        {fmt(currentWords)} / {fmt(goal.target)}
      </div>
    </div>
  );
}

function LegacyRevisionsTrackerStrip({
  tracker,
  acceptedCount,
  totalCount,
  onSetTarget,
}: {
  tracker: RevisionsTracker | null;
  acceptedCount: number;
  totalCount: number;
  onSetTarget: (target: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEditing = () => {
    setDraft(tracker?.target != null ? String(tracker.target) : "");
    setEditing(true);
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      onSetTarget(null);
    } else {
      const target = parseInt(trimmed, 10);
      if (Number.isFinite(target) && target >= 0) onSetTarget(target);
    }
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
    setDraft("");
  };

  const target = tracker?.target ?? null;
  const summary = `${fmt(acceptedCount)} of ${fmt(totalCount)} accepted`;

  if (editing) {
    return (
      <div className="px-3 py-1.5 flex items-center gap-2 text-[11px] border-b border-edge-subtle">
        <span className="text-[var(--muted)]">{summary}</span>
        <Input
          ref={inputRef}
          type="number"
          density="dense"
          min={0}
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={commit}
          placeholder="goal"
          ink="strong"
          className="ml-auto w-20 px-1.5 py-0.5 text-[11px]"
        />
      </div>
    );
  }

  if (target == null) {
    return (
      <div className="px-3 py-1.5 flex items-center gap-2 text-[11px] border-b border-edge-subtle">
        <span className="text-[var(--muted)]">{summary}</span>
        <button
          type="button"
          onClick={startEditing}
          className="ml-auto text-[var(--muted)] hover:text-ink-strong cursor-pointer rounded px-1.5 py-0.5 hover-on-light"
          data-hint="Set goal"
        >
          + goal
        </button>
      </div>
    );
  }

  const reached = acceptedCount >= target;
  const remaining = Math.max(0, target - acceptedCount);
  const progress = target === 0 ? 1 : Math.min(1, acceptedCount / target);
  const pct = Math.round(progress * 100);

  return (
    <div className="px-3 py-1.5 border-b border-edge-subtle">
      <div className="flex items-center gap-2 text-[11px] mb-1">
        <span className={reached ? "text-emerald-700" : "text-ink-body"}>
          {reached
            ? "goal reached"
            : `${fmt(remaining)} ${remaining === 1 ? "revision" : "revisions"} to go`}
        </span>
        <button
          type="button"
          onClick={startEditing}
          className="ml-auto text-[var(--muted-light)] hover:text-ink-strong cursor-pointer text-[10px] rounded px-1 py-0.5 hover-on-light"
          data-hint="Edit goal"
        >
          edit
        </button>
        <button
          type="button"
          onClick={() => onSetTarget(null)}
          className="text-[var(--muted-light)] hover:text-ink-strong cursor-pointer text-[10px] rounded px-1 py-0.5 hover-on-light"
          data-hint="Clear goal"
          aria-label="Clear goal"
        >
          ✕
        </button>
      </div>
      <div className="h-1.5 w-full rounded-full bg-edge-subtle overflow-hidden">
        <div
          className={`h-full ${reached ? "bg-emerald-500" : "bg-[var(--accent)]"} transition-[width] duration-200`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] text-[var(--muted-light)]">
        {fmt(acceptedCount)} / {fmt(target)} · {fmt(totalCount)} total
      </div>
    </div>
  );
}

/* ──────────────────────────────── harness ─────────────────────────────── */

/** The two emerald literals the `--positive` pair replaced, whose values are
 *  pinned to them in globals.css (and pinned again by
 *  `panel-chrome-palette-guardrail`). The only VALUE difference sanctioned
 *  here; `canonical()` below covers the only ORDER difference. */
const TOKENIZED: ReadonlyArray<readonly [string, string]> = [
  ["bg-emerald-500", "bg-[var(--positive)]"],
  ["text-emerald-700", "text-[var(--positive-strong)]"],
];

function tokenized(html: string): { html: string; substitutions: number } {
  let out = html;
  let substitutions = 0;
  for (const [from, to] of TOKENIZED) {
    const parts = out.split(from);
    substitutions += parts.length - 1;
    out = parts.join(to);
  }
  return { html: out, substitutions };
}

/**
 * Class ATTRIBUTE order is not a rendering fact — CSS resolves by stylesheet
 * order and specificity, never by the order names appear on an element — and
 * the extraction reorders exactly one string: the inline-state wrapper, which
 * the primitive composes as `WRAPPER + " flex …"` where the twins wrote the
 * flex utilities mid-string. Same SET, same pixels. So both sides are compared
 * with each class attribute sorted; every other byte (element order, text,
 * `data-hint`, `aria-label`, the inline `width:` style) is compared as-is.
 */
function canonical(html: string): string {
  return html.replace(
    /class="([^"]*)"/g,
    (_, cls: string) => `class="${cls.trim().split(/\s+/).sort().join(" ")}"`,
  );
}

/**
 * Render ONE element, optionally drive it, read its markup, then unmount.
 *
 * The unmount is load-bearing rather than tidy: the editing state focuses its
 * input (`useEffect` on `editing`), so leaving a driven render mounted while
 * the next one mounts and takes focus fires a BLUR on the first — and blur
 * COMMITS, silently returning it to its pre-edit state. The first draft of this
 * suite did exactly that and read three legs as chrome drift.
 */
function renderDriven(
  node: React.ReactElement,
  drive?: (container: HTMLElement) => void,
): string {
  const { container, unmount } = render(node);
  if (drive) drive(container);
  const html = container.innerHTML;
  unmount();
  return html;
}

/** Render legacy + shipped in isolation, drive both identically, and compare. */
function parity(
  legacy: React.ReactElement,
  shipped: React.ReactElement,
  drive?: (container: HTMLElement) => void,
): { legacy: string; shipped: string; substitutions: number } {
  const before = renderDriven(legacy, drive);
  const after = renderDriven(shipped, drive);
  const norm = tokenized(before);
  return {
    legacy: canonical(norm.html),
    shipped: canonical(after),
    substitutions: norm.substitutions,
  };
}

const clickHinted = (hint: string) => (container: HTMLElement) => {
  const btn = container.querySelector<HTMLButtonElement>(`[data-hint="${hint}"]`);
  if (!btn) throw new Error(`no [data-hint="${hint}"] in this render`);
  fireEvent.click(btn);
};

/* ─────────────────────────────── the legs ─────────────────────────────── */

describe("the normalizations cannot hide a real difference", () => {
  it("canonical() reorders classes and nothing else", () => {
    expect(canonical('<i class="b a c">x</i>')).toBe('<i class="a b c">x</i>');
    // A DROPPED or ADDED class still differs — the sort must not be a set-union
    // in disguise, which is the only way this could launder chrome drift.
    expect(canonical('<i class="a b">x</i>')).not.toBe(canonical('<i class="a">x</i>'));
    expect(canonical('<i class="a">x</i>')).not.toBe(canonical('<i class="a z">x</i>'));
    // Everything outside a class attribute is untouched.
    expect(canonical('<i data-hint="b a" style="width: 50%;">b a</i>')).toBe(
      '<i data-hint="b a" style="width: 50%;">b a</i>',
    );
  });

  it("tokenized() reports what it actually substituted", () => {
    expect(tokenized("no colours here").substitutions).toBe(0);
    const r = tokenized('class="bg-emerald-500" class="text-emerald-700"');
    expect(r.substitutions).toBe(2);
    expect(r.html).toBe('class="bg-[var(--positive)]" class="text-[var(--positive-strong)]"');
  });

  it("parity() compares two DIFFERENT renders as different", () => {
    // The harness itself must be falsifiable: an honest chrome change has to
    // fail. Same panel, one extra class on the shipped side.
    const r = parity(
      <div className="px-3 flex" data-hint="x" />,
      <div className="px-3 flex gap-2" data-hint="x" />,
    );
    expect(r.shipped).not.toBe(r.legacy);
  });
});

describe("CutterGoalStrip renders identically to its pre-286 self", () => {
  const noop = () => undefined;

  it("no-goal state", () => {
    const r = parity(
      <LegacyCutterGoalStrip goal={null} currentWords={1240} onSetGoal={noop} onClearGoal={noop} />,
      <CutterGoalStrip goal={null} currentWords={1240} onSetGoal={noop} onClearGoal={noop} />,
    );
    expect(r.shipped).toBe(r.legacy);
    expect(r.shipped).toContain("1,240 words");
  });

  it("progress state, goal not reached", () => {
    const goal: CutterGoal = { target: 800, initialWords: 1400, setAt: "2026-08-01T00:00:00.000Z" };
    const r = parity(
      <LegacyCutterGoalStrip goal={goal} currentWords={1100} onSetGoal={noop} onClearGoal={noop} />,
      <CutterGoalStrip goal={goal} currentWords={1100} onSetGoal={noop} onClearGoal={noop} />,
    );
    expect(r.shipped).toBe(r.legacy);
    expect(r.shipped).toContain("300 words to cut");
    // 300 of 600 cut ⇒ the bar is half full, and the width is part of the DOM
    // the equality above already compares. Named here so a silently-changed
    // progress formula reads as a failure about ARITHMETIC, not about markup.
    expect(r.shipped).toContain("width: 50%");
  });

  it("progress state, goal REACHED — the one tokenized difference", () => {
    const goal: CutterGoal = { target: 800, initialWords: 1400, setAt: "2026-08-01T00:00:00.000Z" };
    const r = parity(
      <LegacyCutterGoalStrip goal={goal} currentWords={780} onSetGoal={noop} onClearGoal={noop} />,
      <CutterGoalStrip goal={goal} currentWords={780} onSetGoal={noop} onClearGoal={noop} />,
    );
    expect(r.shipped).toBe(r.legacy);
    // Both emerald spellings were really there — otherwise `tokenized()` is a
    // no-op and every leg in this file passes for free.
    expect(r.substitutions).toBe(2);
    expect(r.shipped).toContain("bg-[var(--positive)]");
    expect(r.shipped).toContain("text-[var(--positive-strong)]");
  });

  it("editing state, opened from + goal", () => {
    const r = parity(
      <LegacyCutterGoalStrip goal={null} currentWords={1240} onSetGoal={noop} onClearGoal={noop} />,
      <CutterGoalStrip goal={null} currentWords={1240} onSetGoal={noop} onClearGoal={noop} />,
      clickHinted("Set goal"),
    );
    expect(r.shipped).toBe(r.legacy);
    expect(r.shipped).toContain('placeholder="goal"');
  });

  it("editing state, opened from edit — seeded with the current target", () => {
    const goal: CutterGoal = { target: 800, initialWords: 1400, setAt: "2026-08-01T00:00:00.000Z" };
    const r = parity(
      <LegacyCutterGoalStrip goal={goal} currentWords={1100} onSetGoal={noop} onClearGoal={noop} />,
      <CutterGoalStrip goal={goal} currentWords={1100} onSetGoal={noop} onClearGoal={noop} />,
      clickHinted("Edit goal"),
    );
    expect(r.shipped).toBe(r.legacy);
    expect(r.shipped).toContain('value="800"');
  });
});

describe("RevisionsTrackerStrip renders identically to its pre-286 self", () => {
  const noop = () => undefined;

  it("no-goal state", () => {
    const r = parity(
      <LegacyRevisionsTrackerStrip tracker={null} acceptedCount={3} totalCount={12} onSetTarget={noop} />,
      <RevisionsTrackerStrip tracker={null} acceptedCount={3} totalCount={12} onSetTarget={noop} />,
    );
    expect(r.shipped).toBe(r.legacy);
    expect(r.shipped).toContain("3 of 12 accepted");
  });

  it("progress state, target not reached (and the singular label)", () => {
    const tracker: RevisionsTracker = { target: 8 };
    const r = parity(
      <LegacyRevisionsTrackerStrip tracker={tracker} acceptedCount={7} totalCount={12} onSetTarget={noop} />,
      <RevisionsTrackerStrip tracker={tracker} acceptedCount={7} totalCount={12} onSetTarget={noop} />,
    );
    expect(r.shipped).toBe(r.legacy);
    expect(r.shipped).toContain("1 revision to go");
    expect(r.shipped).toContain("7 / 8 · 12 total");
  });

  it("progress state, target REACHED — the one tokenized difference", () => {
    const tracker: RevisionsTracker = { target: 3 };
    const r = parity(
      <LegacyRevisionsTrackerStrip tracker={tracker} acceptedCount={5} totalCount={12} onSetTarget={noop} />,
      <RevisionsTrackerStrip tracker={tracker} acceptedCount={5} totalCount={12} onSetTarget={noop} />,
    );
    expect(r.shipped).toBe(r.legacy);
    expect(r.substitutions).toBe(2);
  });

  it("editing state, opened from edit", () => {
    const tracker: RevisionsTracker = { target: 8 };
    const r = parity(
      <LegacyRevisionsTrackerStrip tracker={tracker} acceptedCount={3} totalCount={12} onSetTarget={noop} />,
      <RevisionsTrackerStrip tracker={tracker} acceptedCount={3} totalCount={12} onSetTarget={noop} />,
      clickHinted("Edit goal"),
    );
    expect(r.shipped).toBe(r.legacy);
    expect(r.shipped).toContain('value="8"');
  });
});

describe("the commit contract survives the extraction", () => {
  /** Open the edit field through the same affordance a user would press, then
   *  type. `hint` names which one — `+ goal` when there is no goal yet, `edit`
   *  when there is; both are the `data-hint` the chrome already carries. */
  const openAndType = (value: string, hint: "Set goal" | "Edit goal" = "Set goal") => {
    const opener = document.querySelector<HTMLButtonElement>(`[data-hint="${hint}"]`);
    if (!opener) throw new Error(`no [data-hint="${hint}"] rendered`);
    fireEvent.click(opener);
    const input = screen.getByPlaceholderText("goal");
    fireEvent.change(input, { target: { value } });
    return input;
  };

  it("Cutter: Enter commits the target WITH the live word count as the baseline", () => {
    const onSetGoal = vi.fn();
    render(<CutterGoalStrip goal={null} currentWords={1240} onSetGoal={onSetGoal} onClearGoal={() => undefined} />);
    const input = openAndType("800");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSetGoal).toHaveBeenCalledWith(800, 1240);
  });

  it("Cutter: an EMPTY draft commits nothing — the baseline is unrecoverable", () => {
    // The `onCommit(null)` seam, answered the Cutter's way. A shared primitive
    // that unified this would silently discard `initialWords` on a stray blur.
    const onSetGoal = vi.fn();
    const onClearGoal = vi.fn();
    render(<CutterGoalStrip goal={{ target: 800, initialWords: 1400, setAt: "2026-08-01T00:00:00.000Z" }} currentWords={1100} onSetGoal={onSetGoal} onClearGoal={onClearGoal} />);
    const input = openAndType("", "Edit goal");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSetGoal).not.toHaveBeenCalled();
    expect(onClearGoal).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("goal")).toBeNull();
  });

  it("Revisions: an EMPTY draft CLEARS the target — the same seam, answered the other way", () => {
    const onSetTarget = vi.fn();
    render(<RevisionsTrackerStrip tracker={{ target: 8 }} acceptedCount={3} totalCount={12} onSetTarget={onSetTarget} />);
    const input = openAndType("", "Edit goal");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSetTarget).toHaveBeenCalledWith(null);
  });

  it("Escape cancels without committing; blur commits", () => {
    const onSetTarget = vi.fn();
    const { unmount } = render(
      <RevisionsTrackerStrip tracker={null} acceptedCount={3} totalCount={12} onSetTarget={onSetTarget} />,
    );
    const input = openAndType("5");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSetTarget).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("goal")).toBeNull();
    unmount();

    render(<RevisionsTrackerStrip tracker={null} acceptedCount={3} totalCount={12} onSetTarget={onSetTarget} />);
    const second = openAndType("5");
    fireEvent.blur(second);
    expect(onSetTarget).toHaveBeenCalledWith(5);
  });

  it("the ✕ clears, on both panels", () => {
    const onClearGoal = vi.fn();
    const { unmount } = render(
      <CutterGoalStrip goal={{ target: 800, initialWords: 1400, setAt: "2026-08-01T00:00:00.000Z" }} currentWords={1100} onSetGoal={() => undefined} onClearGoal={onClearGoal} />,
    );
    fireEvent.click(screen.getByLabelText("Clear goal"));
    expect(onClearGoal).toHaveBeenCalledTimes(1);
    unmount();

    const onSetTarget = vi.fn();
    render(<RevisionsTrackerStrip tracker={{ target: 8 }} acceptedCount={3} totalCount={12} onSetTarget={onSetTarget} />);
    fireEvent.click(screen.getByLabelText("Clear goal"));
    expect(onSetTarget).toHaveBeenCalledWith(null);
  });
});
