// @vitest-environment jsdom
//
// Task 1164 — a card edit must not re-identify the hook's mutators. They read
// live state through `stateRef`, so `addReport` (which once carried a stray
// `state.cards` dep it never read) and the lookup-before-write mutators
// (`updateRequestContent`, `cloneReport`, `setRequestAiRequest`) keep their
// identity across an `updateReportContent`. The static half is
// card-hook-stateref-census.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: (...a: unknown[]) => mockRead(...a),
    readSidecarIfExists: (...a: unknown[]) => mockRead(...a),
    writeSidecar: (...a: unknown[]) => mockWrite(...a),
  }),
);

import { useReports } from "../useReports";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

describe("card-hook mutators keep their identity across a card edit (task 1164)", () => {
  it("useReports: addReport / updateRequestContent / cloneReport / setRequestAiRequest", async () => {
    beginDocPipeline("doc-ident");
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "report",
          id: "rep-1",
          author: "human",
          title: "T",
          text: "body",
          content: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          links: [],
        },
      ],
    });
    const { result } = renderHook(() => useReports("doc-ident"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    const before = result.current;
    act(() => {
      result.current.updateReportContent("rep-1", {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "edited" }] }],
      });
    });
    await waitFor(() => expect(result.current.cards[0].text).toBe("edited"));

    // The edit landed (the return re-identified) …
    expect(result.current).not.toBe(before);
    // … but the mutators did not.
    expect(result.current.addReport).toBe(before.addReport);
    expect(result.current.updateRequestContent).toBe(before.updateRequestContent);
    expect(result.current.setRequestAiRequest).toBe(before.setRequestAiRequest);
    expect(result.current.cloneReport).toBe(before.cloneReport);

    // And a ref read still sees the live card.
    let cloneId: string | null = null;
    act(() => {
      cloneId = result.current.cloneReport("rep-1");
    });
    expect(cloneId).toBeTruthy();
    await waitFor(() => expect(result.current.cards.length).toBe(2));
  });
});
