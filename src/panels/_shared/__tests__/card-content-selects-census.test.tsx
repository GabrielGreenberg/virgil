// @vitest-environment jsdom
//
// Task 1357 — "interacting with a card's content selects it", stated ONCE.
//
// Before: the rule lived per card component. EditableCard kinds selected via an
// `onFocusCapture` that ran the FULL body composition (so focusing the body
// also JUMPED the document) behind an `isPointerInteractingRef` hack that made
// a pointer press into the body select nothing at all; Todo had its own copy;
// highlight / example / suggestion / citation had none — and every field's
// `stopPropagation` swallowed the root `onClick`, the only other select path.
//
// After: PanelCard's root CAPTURE phase fires the host's select-only
// composition (`useAnchoredCardShell().shell.onSelectOnly`) for a pointer-down
// or focus whose target is one of the card's content fields. This suite pins:
//   - BEHAVIOUR, for every CARD_REGISTRY kind: a field press / focus selects
//     with placement suppressed, never toggles expansion, never jumps; an
//     already-selected card is a no-op; non-field targets and read-only bodies
//     stay on the click path; a nested card's field selects the nested card;
//   - WIRING (census): every anchored card component reaches the rule — it
//     spreads the shell bundle, or (a non-shell `useAnchoredCard` twin) passes
//     `onSelectOnly` beside its body activation — and no card component keeps
//     a per-kind `onFocusCapture` copy.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { PanelCard, CARD_THEMES } from "@/components/panel-primitives";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import { CARD_KINDS } from "@/cards/predicates";
import type { CardKind } from "@/cards/types";
import { useAnchoredCardShell } from "../useAnchoredCardShell";
import { walkFiles } from "@/lib/__tests__/_source-scan";

beforeEach(() => {
  cardStore.clearSelection();
  for (const r of [...cardStore.getState().expandedSet]) cardStore.collapse(r);
});
afterEach(cleanup);

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

function Card({
  kind,
  id,
  onSelect,
  onJump,
  children,
}: {
  kind: CardKind;
  id: string;
  onSelect?: () => void;
  onJump?: () => void;
  children?: React.ReactNode;
}) {
  const { ac, shell } = useAnchoredCardShell({ kind, id, onSelect, onJump });
  return (
    <PanelCard {...shell} theme={CARD_THEMES.note} selected={ac.selected} kind={kind}>
      <div data-testid={`pad-${id}`}>
        {/* Every real field stops its own mousedown/click — the capture
            phase must still see it. */}
        <input data-testid={`input-${id}`} onMouseDown={stop} onClick={stop} onPointerDown={stop} />
        <textarea data-testid={`ta-${id}`} onMouseDown={stop} onClick={stop} />
        <div contentEditable="true" suppressContentEditableWarning data-testid={`ce-${id}`} onMouseDown={stop}>
          <span contentEditable="false" data-testid={`atom-${id}`}>atom</span>
        </div>
        <div contentEditable="false" data-testid={`ro-${id}`}>read-only body</div>
        <input type="checkbox" data-testid={`cb-${id}`} onClick={stop} />
      </div>
      {children}
    </PanelCard>
  );
}

describe("PanelCard — content interaction selects (only), for every card kind", () => {
  for (const kind of CARD_KINDS) {
    it(`${kind}: a field press / focus selects with no placement, no expand toggle, no jump`, () => {
      const onJump = vi.fn();
      const onSelect = vi.fn();
      const ref = { kind, id: "c1" };
      const { getByTestId } = render(<Card kind={kind} id="c1" onSelect={onSelect} onJump={onJump} />);

      fireEvent.pointerDown(getByTestId("input-c1"));
      expect(cardStore.isSelected(ref)).toBe(true);
      expect(cardStore.isPlacementSuppressed(ref)).toBe(true);
      expect(cardStore.isExpanded(ref)).toBe(false);
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onJump).not.toHaveBeenCalled();

      // Already selected → no-op (the host slot is not re-run).
      fireEvent.pointerDown(getByTestId("ta-c1"));
      fireEvent.focus(getByTestId("ta-c1"));
      expect(onSelect).toHaveBeenCalledTimes(1);

      // Focus path (keyboard Tab into a field), with the card unselected.
      cardStore.clearSelection();
      fireEvent.focus(getByTestId("ce-c1"));
      expect(cardStore.isSelected(ref)).toBe(true);
      expect(cardStore.isPlacementSuppressed(ref)).toBe(true);
      expect(onJump).not.toHaveBeenCalled();
    });
  }

  it("an atom island inside an editable body counts; a read-only body, a checkbox and body padding do not", () => {
    const ref = { kind: "note" as const, id: "c1" };
    const { getByTestId } = render(<Card kind="note" id="c1" onJump={vi.fn()} />);
    fireEvent.pointerDown(getByTestId("atom-c1"));
    expect(cardStore.isSelected(ref)).toBe(true);

    for (const t of ["ro-c1", "cb-c1", "pad-c1"]) {
      cardStore.clearSelection();
      fireEvent.pointerDown(getByTestId(t));
      fireEvent.focus(getByTestId(t));
      expect(cardStore.isSelected(ref), t).toBe(false);
    }
  });

  it("the body-padding click path is unchanged: select + expand + jump", () => {
    const onJump = vi.fn();
    const ref = { kind: "note" as const, id: "c1" };
    const { getByTestId } = render(<Card kind="note" id="c1" onJump={onJump} />);
    fireEvent.pointerDown(getByTestId("pad-c1"));
    fireEvent.click(getByTestId("pad-c1"));
    expect(cardStore.isSelected(ref)).toBe(true);
    expect(cardStore.isExpanded(ref)).toBe(true);
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("a nested card's field selects the nested card, not its host", () => {
    const { getByTestId } = render(
      <Card kind="archive" id="outer">
        <Card kind="note" id="inner" />
      </Card>,
    );
    fireEvent.pointerDown(getByTestId("input-inner"));
    expect(cardStore.isSelected({ kind: "note", id: "inner" })).toBe(true);
  });
});

// ── Wiring census ──────────────────────────────────────────────────────────

const ROOT = join(__dirname, "..", "..", "..");
const SOURCES = walkFiles(join(ROOT, "panels"), { skipDirs: ["__tests__"] })
  .filter((p) => p.endsWith(".tsx"))
  .map((p) => ({
  file: relative(ROOT, p),
  src: readFileSync(p, "utf8"),
}));

describe("CENSUS — every anchored card reaches the one content-select rule", () => {
  it("a non-shell useAnchoredCard twin passes onSelectOnly beside each body activation", () => {
    const offenders: string[] = [];
    for (const { file, src } of SOURCES) {
      const activations = src.match(/onClick=\{\(\) => ac\.onBodyActivate\(/g)?.length ?? 0;
      const selectOnly = src.match(/onSelectOnly=\{/g)?.length ?? 0;
      if (activations > selectOnly) offenders.push(`${file}: ${activations} body activations, ${selectOnly} onSelectOnly`);
    }
    expect(offenders).toEqual([]);
  });

  it("no card component keeps a per-kind onFocusCapture select copy", () => {
    const offenders = SOURCES.filter(({ src }) => /onFocusCapture=/.test(src)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it("the shell bundle carries onSelectOnly (so every `{...shell}` spread inherits it)", () => {
    const shellSrc = readFileSync(join(ROOT, "panels/_shared/useAnchoredCardShell.ts"), "utf8");
    expect(shellSrc).toMatch(/onSelectOnly: \(\) => ac\.onSelectOnly\(/);
  });
});
