// @vitest-environment jsdom
//
// Task 1452 — the float window-drag CURSOR is derived from the same predicate
// as the window-drag GESTURE. FloatingPanel's body wrapper arms the drag on
// mousedown except where `pressFromInteractiveControl(…,
// WINDOW_DRAG_BLOCK_SELECTOR)` refuses; the grab hand used to be an inline
// style over the WHOLE body, so a popped card's surface promised a drag that
// never came. globals.css now paints `grab` on `[data-float-drag-surface]` and
// lifts it off a `:where(<that selector>)` list. We pin:
//   1. the CSS exemption list IS WINDOW_DRAG_BLOCK_SELECTOR (no drift);
//   2. the rules sit in `@layer components` behind `:where()` (weakest cursor
//      statement, so a control's own cursor utility still wins);
//   3. the wrapper carries the attribute and no inline cursor;
//   4. behavioural parity: for every target, "press arms the drag" ⇔ "the
//      CSS exemption does NOT match" — the hand shows exactly where it drags.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postcss from "postcss";
import { WINDOW_DRAG_BLOCK_SELECTOR } from "@/lib/drag-blocklist";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(path.resolve(HERE, "../../app/globals.css"), "utf8");
const SURFACE = "[data-float-drag-surface]";

const norm = (list: string) =>
  list
    .split(",")
    .map((s) => s.trim().replace(/"/g, "'"))
    .filter(Boolean)
    .sort();

function surfaceRules() {
  const out: { selector: string; cursor: string | undefined; layer: string | null }[] = [];
  postcss.parse(CSS).walkRules((rule) => {
    if (!rule.selector.includes(SURFACE)) return;
    let cursor: string | undefined;
    rule.walkDecls("cursor", (d) => {
      cursor = d.value;
    });
    const parent = rule.parent;
    const layer =
      parent && parent.type === "atrule" && (parent as postcss.AtRule).name === "layer"
        ? (parent as postcss.AtRule).params
        : null;
    out.push({ selector: rule.selector, cursor, layer });
  });
  return out;
}

function exemptionSelector(): string {
  const rule = surfaceRules().find((r) => r.selector.includes(":where("));
  expect(rule, "globals.css must carry the float-drag cursor exemption rule").toBeTruthy();
  return rule!.selector;
}

describe("float drag cursor ⇔ float drag predicate (task 1452)", () => {
  it("the CSS exemption list equals WINDOW_DRAG_BLOCK_SELECTOR", () => {
    const m = exemptionSelector().match(/:where\(([\s\S]*)\)\s*$/);
    expect(m).toBeTruthy();
    expect(norm(m![1])).toEqual(norm(WINDOW_DRAG_BLOCK_SELECTOR));
  });

  it("grab on the surface, auto on the exemptions — both in @layer components", () => {
    const rules = surfaceRules();
    const base = rules.find((r) => r.selector.trim() === SURFACE);
    const exempt = rules.find((r) => r.selector.includes(":where("));
    expect(base?.cursor).toBe("grab");
    expect(exempt?.cursor).toBe("auto");
    expect(base?.layer).toBe("components");
    expect(exempt?.layer).toBe("components");
  });

  it("FloatingPanel states the surface by attribute, never an inline cursor", () => {
    const src = readFileSync(path.resolve(HERE, "../FloatingPanel.tsx"), "utf8");
    expect(src).toContain('data-float-drag-surface=""');
    expect(src).not.toMatch(/cursor:\s*"grab"/);
  });

  it("every press arms the window drag exactly where the grab cursor is NOT lifted", async () => {
    const { render, fireEvent } = await import("@testing-library/react");
    const { default: FloatingPanel } = await import("@/components/FloatingPanel");
    render(
      <FloatingPanel
        cardKey="note:n1"
        mode="floating"
        surface="card"
        initialX={100}
        initialY={100}
        initialWidth={300}
        initialHeight={200}
        zIndex={1200}
        onChange={vi.fn()}
      >
        <div data-testid="bg">
          <span data-testid="bg-text">gap</span>
          <button data-testid="plain-btn">
            <span data-testid="btn-inner">x</span>
          </button>
          <a href="#x" data-testid="link">l</a>
          <input data-testid="input" />
          <div data-no-window-drag="" data-testid="opt-out">o</div>
          <div data-card="1" data-card-key="note:n1">
            <div data-testid="card-body">card body</div>
          </div>
        </div>
      </FloatingPanel>,
    );
    const surface = document.querySelector(SURFACE);
    expect(surface).toBeTruthy();
    const exempt = exemptionSelector();
    const ids = ["bg", "bg-text", "plain-btn", "btn-inner", "link", "input", "opt-out", "card-body"];
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`)!;
      const cursorLifted = !!el.closest(exempt);
      const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
      el.dispatchEvent(ev);
      expect(ev.defaultPrevented, `${id}: drag armed ⇔ grab cursor shown`).toBe(!cursorLifted);
      fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
    }
    // Sanity: both outcomes are exercised.
    expect(document.querySelector('[data-testid="bg"]')!.closest(exempt)).toBeNull();
    expect(document.querySelector('[data-testid="card-body"]')!.closest(exempt)).not.toBeNull();
  });
});
