// @vitest-environment jsdom
//
// THE SAVE-STATE BADGE (task 392) — the surface that answers "is my work on
// disk?", driven against the REAL channel.
//
// The incident's second lesson was not that a mechanism failed; it was that
// nothing on screen changed while a correct guard held every write for seventy
// minutes. So the legs here are about what the user can SEE and what a click
// DOES: the four tiers, the button's presence rules, and the two behaviours a
// blocked click must have (route to the flow that owns the block, and never
// re-attempt into it).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent, waitFor } from "@testing-library/react";

import SaveStateBadge from "../SaveStateBadge";
import {
  clearUnsavedWork,
  noteSaveBlocked,
  noteSaveLanded,
  noteUnsavedEdit,
} from "@/lib/unsaved-work";
import {
  getBlockingFlowRequest,
  registerSaveDoor,
  resetBlockingFlowRequests,
  type SaveAttemptOutcome,
} from "@/lib/save-request";
import { UNSAVED_ESCALATE_MS, UNSAVED_WARN_MS } from "@/lib/save-state";

const DOC = "doc-1";
let disposeDoor: (() => void) | null = null;

function withDoor(fn: () => Promise<SaveAttemptOutcome>) {
  disposeDoor?.();
  disposeDoor = registerSaveDoor(DOC, fn);
}

beforeEach(() => {
  cleanup();
  clearUnsavedWork();
  resetBlockingFlowRequests();
});
afterEach(() => {
  disposeDoor?.();
  disposeDoor = null;
});

const pill = () => document.querySelector("[data-save-state]");
const saveBtn = () => document.querySelector("[data-save-now]");

describe("SaveStateBadge · the tiers", () => {
  it("says nothing at all with no document", () => {
    render(<SaveStateBadge docId={null} />);
    expect(pill()).toBeNull();
  });

  it("says nothing before anything has been saved or typed", () => {
    // Not "Saved" — nothing has been. A reassurance nobody earned is the same
    // class of untruth as a silence.
    render(<SaveStateBadge docId={DOC} />);
    expect(pill()).toBeNull();
  });

  it("CLEAN — states the time of the landed write, with no button", () => {
    act(() => noteSaveLanded(DOC, new Date(2026, 7, 19, 13, 28).getTime()));
    render(<SaveStateBadge docId={DOC} />);
    expect(pill()?.getAttribute("data-save-state")).toBe("clean");
    expect(screen.getByText("Saved · 13:28")).toBeTruthy();
    expect(saveBtn()).toBeNull();
  });

  it("PENDING — quiet, and still no button", () => {
    // A write is armed and will land in 1500 ms; an affordance whose only
    // effect is to do what is already happening is dead chrome, and one that
    // blinks in and out on every typing pause teaches the user to stop looking.
    act(() => noteUnsavedEdit(DOC));
    render(<SaveStateBadge docId={DOC} />);
    expect(pill()?.getAttribute("data-save-state")).toBe("pending");
    expect(saveBtn()).toBeNull();
  });

  it("UNSAVED — amber, AGED, and offers Save now", () => {
    act(() => noteUnsavedEdit(DOC, Date.now() - (UNSAVED_WARN_MS + 5_000)));
    render(<SaveStateBadge docId={DOC} />);
    expect(pill()?.getAttribute("data-save-state")).toBe("unsaved");
    expect(screen.getByRole("status").textContent).toMatch(/Unsaved · /);
    expect(saveBtn()).not.toBeNull();
  });

  it("BLOCKED — names the reason and offers the flow's own verb", () => {
    act(() => noteSaveBlocked(DOC, "conflict"));
    render(<SaveStateBadge docId={DOC} />);
    expect(pill()?.getAttribute("data-save-state")).toBe("blocked");
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/changed on disk/i);
    expect(saveBtn()?.textContent).toMatch(/Resolve/);
  });

  it("BLOCKED by an error — offers a retry, because that reason has no dialog", () => {
    act(() => noteSaveBlocked(DOC, "error"));
    render(<SaveStateBadge docId={DOC} />);
    expect(saveBtn()?.textContent).toMatch(/again/i);
  });

  it("ESCALATES past the threshold — the sentence comes out beside the pill", () => {
    act(() =>
      noteSaveBlocked(DOC, "conflict", Date.now() - (UNSAVED_ESCALATE_MS + 1_000)),
    );
    render(<SaveStateBadge docId={DOC} />);
    expect(pill()?.getAttribute("data-save-escalated")).toBe("true");
    // The whole sentence, not just the pill's short form.
    expect(document.body.textContent).toMatch(/Choose which version to keep/i);
  });
});

describe("SaveStateBadge · the collapse rule", () => {
  it("a REASSURANCE may be collapsed away", () => {
    act(() => noteSaveLanded(DOC));
    render(<SaveStateBadge docId={DOC} collapsed />);
    expect(pill()).toBeNull();
  });

  it("a DATA-INTEGRITY state may NOT be — the task-357 rule", () => {
    act(() => noteSaveBlocked(DOC, "preservation"));
    render(<SaveStateBadge docId={DOC} collapsed />);
    expect(pill()?.getAttribute("data-save-state")).toBe("blocked");
    act(() => {
      clearUnsavedWork();
      noteUnsavedEdit(DOC, Date.now() - (UNSAVED_WARN_MS + 1_000));
    });
    expect(pill()?.getAttribute("data-save-state")).toBe("unsaved");
  });
});

describe("SaveStateBadge · what the button DOES", () => {
  it("lands the write, and the pill goes quiet", async () => {
    withDoor(async () => {
      noteSaveLanded(DOC);
      return { landed: true };
    });
    act(() => noteUnsavedEdit(DOC, Date.now() - (UNSAVED_WARN_MS + 1_000)));
    render(<SaveStateBadge docId={DOC} />);

    await act(async () => {
      fireEvent.click(saveBtn() as Element);
    });
    await waitFor(() =>
      expect(pill()?.getAttribute("data-save-state")).toBe("clean"),
    );
    expect(saveBtn()).toBeNull();
  });

  it("a BLOCKED click ROUTES to the flow that owns the block", async () => {
    // The whole reason "Save now" is not a flush: a Save that silently
    // re-refuses is this incident's silence with a button on it. The button
    // asks the surface that owns the decision to open itself.
    withDoor(async () => ({ landed: false, reason: "conflict" }));
    act(() => noteSaveBlocked(DOC, "conflict"));
    render(<SaveStateBadge docId={DOC} />);

    expect(getBlockingFlowRequest()).toBeNull();
    await act(async () => {
      fireEvent.click(saveBtn() as Element);
    });
    await waitFor(() => expect(getBlockingFlowRequest()).not.toBeNull());
    expect(getBlockingFlowRequest()).toMatchObject({
      docId: DOC,
      flow: "external-change",
    });
    // …and the pill still says what is true: the write did not land.
    expect(pill()?.getAttribute("data-save-state")).toBe("blocked");
  });

  it("a preservation block routes to the PRESERVATION surface, not the conflict one", async () => {
    withDoor(async () => ({ landed: false, reason: "preservation" }));
    act(() => noteSaveBlocked(DOC, "preservation"));
    render(<SaveStateBadge docId={DOC} />);
    await act(async () => {
      fireEvent.click(saveBtn() as Element);
    });
    await waitFor(() =>
      expect(getBlockingFlowRequest()?.flow).toBe("preservation"),
    );
  });

  it("an ERROR block routes nowhere — there is no dialog, only a next attempt", async () => {
    const door = vi.fn(async (): Promise<SaveAttemptOutcome> => ({
      landed: false,
      reason: "error",
    }));
    withDoor(door);
    act(() => noteSaveBlocked(DOC, "error"));
    render(<SaveStateBadge docId={DOC} />);
    await act(async () => {
      fireEvent.click(saveBtn() as Element);
    });
    await waitFor(() => expect(door).toHaveBeenCalled());
    expect(getBlockingFlowRequest()).toBeNull();
  });

  it("with no door registered, the click cannot claim success", async () => {
    act(() => noteUnsavedEdit(DOC, Date.now() - (UNSAVED_WARN_MS + 1_000)));
    render(<SaveStateBadge docId={DOC} />);
    await act(async () => {
      fireEvent.click(saveBtn() as Element);
    });
    // `no-door` names no flow and clears nothing — the state stands.
    expect(getBlockingFlowRequest()).toBeNull();
    expect(pill()?.getAttribute("data-save-state")).toBe("unsaved");
  });
});

describe("useSaveState · the ticker", () => {
  it("arms NO timer while the document is clean", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useSaveState } = await import("@/hooks/useSaveState");
    vi.useFakeTimers();
    try {
      act(() => noteSaveLanded(DOC));
      renderHook(() => useSaveState(DOC));
      // The store is EDGE-driven and a clean document has no age to display,
      // so there is nothing for a clock to do. A badge that polled anyway
      // would re-render every open paper forever.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("schedules the next TIER BOUNDARY rather than polling", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useSaveState } = await import("@/hooks/useSaveState");
    vi.useFakeTimers();
    try {
      act(() => noteUnsavedEdit(DOC));
      const { result } = renderHook(() => useSaveState(DOC));
      expect(result.current.tier).toBe("pending");
      expect(vi.getTimerCount()).toBe(1);
      // One fire, at the boundary — not a fixed-interval poll.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(UNSAVED_WARN_MS + 50);
      });
      expect(result.current.tier).toBe("unsaved");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useBlockingFlowRequest · the routing seam", () => {
  it("opens ONCE per request, and only for its own flow and document", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useBlockingFlowRequest } = await import("@/hooks/useSaveState");
    const { requestBlockingFlow } = await import("@/lib/save-request");
    const open = vi.fn();
    const { rerender } = renderHook(() =>
      useBlockingFlowRequest(DOC, "external-change", open),
    );

    // A request for the OTHER surface's flow is not this one's business.
    act(() => void requestBlockingFlow(DOC, "preservation"));
    rerender();
    expect(open).not.toHaveBeenCalled();

    // A request for another DOCUMENT likewise.
    act(() => void requestBlockingFlow("doc-other", "conflict"));
    rerender();
    expect(open).not.toHaveBeenCalled();

    act(() => void requestBlockingFlow(DOC, "conflict"));
    rerender();
    expect(open).toHaveBeenCalledTimes(1);
    // A re-render does not re-open — the token is answered.
    rerender();
    expect(open).toHaveBeenCalledTimes(1);
    // …but a second ASK does.
    act(() => void requestBlockingFlow(DOC, "conflict"));
    rerender();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("a reason with no flow requests nothing at all", async () => {
    const { requestBlockingFlow } = await import("@/lib/save-request");
    expect(requestBlockingFlow(DOC, "error")).toBe(false);
    expect(getBlockingFlowRequest()).toBeNull();
  });
});
