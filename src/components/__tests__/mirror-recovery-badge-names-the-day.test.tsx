// @vitest-environment jsdom
/**
 * Task 1340 — emergency mirrors never expire, so the recovery badge must name
 * the DAY of a copy that is not from today, and the restore confirm's age reads
 * in days, never "72h 5m".
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date(2026, 9, 28, 17, 0).getTime();
const SAVED = NOW - (3 * 24 * 60 + 5) * 60_000; // Oct 25, 16:55

const confirmSpy = vi.fn(async (_o: { message: string }) => false);

vi.mock("@/hooks/useMirrorRecovery", () => ({
  useMirrorRecoveryOffer: () => ({ entry: { savedAt: SAVED, reason: null } }),
}));
vi.mock("@/hooks/useBarStatusVisible", () => ({ useBarStatusVisible: () => true }));
vi.mock("@/lib/mirror-recovery", () => ({ getRecoveryActions: () => null }));
vi.mock("../ConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmSpy, dialog: null }),
}));

import { MirrorRecoveryBadge } from "../MirrorRecoveryBadge";

describe("MirrorRecoveryBadge names the day of a days-old copy", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    confirmSpy.mockClear();
  });

  it("label carries the date; the restore confirm reads the age in days", async () => {
    const { container } = render(<MirrorRecoveryBadge docId="doc" />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Unsaved work from Oct 25/);
    await act(async () => {
      fireEvent.click(screen.getByText("Restore"));
    });
    const msg = confirmSpy.mock.calls[0][0].message;
    expect(msg).toMatch(/as it stood at Oct 25/);
    expect(msg).toMatch(/\(3 days ago\)/);
    expect(msg).not.toMatch(/\dh \d+m/);
  });
});
