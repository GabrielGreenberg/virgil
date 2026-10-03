/**
 * The AI window's request-list read error offers a RETRY that reaches the
 * read (task 906).
 *
 * Before: the copy said "Reopen the paper to try again" under a header Refresh
 * whose `refreshAll` reached only the bib hooks — so neither surface could retry
 * the inbox read. Now `refreshAll` carries `useAiRequests().refresh` (EditorPane)
 * and the error copy's own "Try again" goes through it.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(),
  writeSidecar: vi.fn(),
}));

import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import AIWindow, { type AIWindowProps } from "@/components/AIWindow";
import type { AiRequest } from "@/lib/types";

afterEach(cleanup);

function props(refreshAll: () => void): AIWindowProps {
  const noop = () => undefined;
  return {
    open: true,
    onClose: noop,
    bibReviewRequests: [],
    bibEntryRequests: [],
    comments: [],
    bibEntries: [],
    panelAiRequests: [],
    panelAiRequestsLoaded: true,
    panelAiRequestsLoadError: true,
    addPanelAiRequest: (() => ({}) as AiRequest) as AIWindowProps["addPanelAiRequest"],
    withdrawPanelAiRequest: noop,
    clearLinkedAiRequest: noop,
    cardLinkResolves: () => true,
    requestBibReview: noop,
    cancelBibReview: noop,
    addEntryRequest: noop,
    removeEntryRequest: noop,
    addComment: () => undefined,
    refreshAll,
  };
}

describe("AIWindow — a failed request-list read", () => {
  it("offers Try again (not 'Reopen the paper'), and it calls refreshAll", () => {
    const refreshAll = vi.fn();
    render(<AIWindow {...props(refreshAll)} />);
    // The refresh-on-open fires once on mount.
    expect(refreshAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Reopen the paper/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refreshAll).toHaveBeenCalledTimes(2);
  });
});
