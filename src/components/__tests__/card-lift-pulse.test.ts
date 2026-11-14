// TASK 1619 — a card lift's outline pulse is the STORE's to fade, and the
// fade clears by IDENTITY.
//
// The lift used to schedule `window.setTimeout(() => setCardLiftTarget(null),
// 150)` from the card's gesture handler: identity-blind (a second lift inside
// 150 ms lost its outline to the first lift's timer) and unowned. The owner
// is the store, not the card: the lift pops the card out, which unmounts the
// docked card, so a card-lifetime timer would be disposed before it fired and
// the outline would stick.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  CARD_LIFT_PULSE_MS,
  clearCardLiftTarget,
  getCardLiftTarget,
  pulseCardLiftTarget,
  setCardLiftTarget,
  type CardLiftTarget,
} from "@/components/card-lift";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const target = (cardKey: string, left = 0): CardLiftTarget => ({
  cardKey,
  rect: { left, top: 0, width: 100, height: 40 },
});

beforeEach(() => {
  vi.useFakeTimers();
  setCardLiftTarget(null);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("card-lift pulse (task 1619)", () => {
  it("fades a lone lift after the pulse", () => {
    pulseCardLiftTarget(target("note:a"));
    expect(getCardLiftTarget()?.cardKey).toBe("note:a");
    vi.advanceTimersByTime(CARD_LIFT_PULSE_MS);
    expect(getCardLiftTarget()).toBeNull();
  });

  it("a second lift inside the pulse keeps ITS outline for a full pulse", () => {
    pulseCardLiftTarget(target("note:a"));
    vi.advanceTimersByTime(CARD_LIFT_PULSE_MS - 50);
    pulseCardLiftTarget(target("note:b"));
    vi.advanceTimersByTime(50);
    expect(getCardLiftTarget()?.cardKey).toBe("note:b");
    vi.advanceTimersByTime(CARD_LIFT_PULSE_MS - 50);
    expect(getCardLiftTarget()).toBeNull();
  });

  it("the fade never clears a target someone else set meanwhile", () => {
    pulseCardLiftTarget(target("note:a"));
    const other = target("note:c", 10);
    setCardLiftTarget(other);
    vi.advanceTimersByTime(CARD_LIFT_PULSE_MS);
    expect(getCardLiftTarget()).toBe(other);
  });

  it("clearCardLiftTarget is identity-guarded", () => {
    const a = target("note:a");
    setCardLiftTarget(a);
    clearCardLiftTarget(target("note:a", 5));
    expect(getCardLiftTarget()).toBe(a);
    clearCardLiftTarget(a);
    expect(getCardLiftTarget()).toBeNull();
  });

  it("CENSUS: the lift gesture writes the target only through the pulse door", () => {
    const src = readFileSync(path.join(ROOT, "src/components/panel-primitives.tsx"), "utf8");
    expect(src).toContain("pulseCardLiftTarget(");
    expect(src).not.toMatch(/setCardLiftTarget\(/);
  });
});
