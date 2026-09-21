/**
 * An unrecognised `kind` on disk must not take the AI window down (task 682).
 *
 * `ai-requests.json` is the one sidecar with THREE writers, two of them outside
 * the type system: the live hook, the card-flag bridge, and the `/editor/*`
 * Python skills, which read-modify-write it on disk while the paper is open. It
 * is hand-editable besides. So a row's `kind` is a `string`, and the
 * `AiRequestKind` union is a claim about its PROVENANCE, not its contents.
 *
 * Before this task nothing gated the inbound direction. `PANEL_KIND_MAP[r.kind]`
 * resolved `undefined` for an off-union kind, and the next dereference —
 * `KIND_META[req.kind].themeKey` in `themeKeyForVM`, `.label` in `RequestCard` —
 * threw. Not a dropped row: a THROWN RENDER. The whole window died, and with it
 * the user's view of every other request in the paper. One malformed byte on
 * disk, total failure.
 *
 * Every `it` below throws (or fails) against the pre-fix shape.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// AIWindow transitively pulls in `@/lib/storage`, whose `require("@/lib/storage-fsa")`
// vitest's resolver can't alias (the known barrel/storage gotcha). The exports
// under test are pure and never touch it, so a stub keeps the graph loadable.
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(),
  writeSidecar: vi.fn(),
}));

import { render, screen, cleanup } from "@testing-library/react";
import AIWindow, {
  buildRequests,
  aiRequestDotStatus,
  type AIWindowProps,
} from "@/components/AIWindow";
import { AI_REQUEST_KINDS, isAiRequestKind } from "@/lib/ai-request-kind";
import { normalizeAiRequestRows } from "@/lib/ai-requests-store";
import type { AiRequest } from "@/lib/types";

function row(o: Partial<AiRequest> & { kind: string }): AiRequest {
  return {
    id: "r1",
    text: "some request text",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "pending",
    ...o,
  } as AiRequest;
}

/** The real window, mounted over an arbitrary panel queue — the only harness
 *  that reaches `RequestCard`/`themeKeyForVM`, the two sites that threw. */
function props(panelAiRequests: AiRequest[]): AIWindowProps {
  const noop = () => undefined;
  return {
    open: true,
    onClose: noop,
    bibReviewRequests: [],
    bibEntryRequests: [],
    comments: [],
    bibEntries: [],
    panelAiRequests,
    panelAiRequestsLoaded: true,
    panelAiRequestsLoadError: false,
    addPanelAiRequest: (() => ({}) as AiRequest) as AIWindowProps["addPanelAiRequest"],
    deletePanelAiRequest: noop,
    clearLinkedAiRequest: noop,
    cardLinkResolves: () => true, // task 697
    requestBibReview: noop,
    cancelBibReview: noop,
    addEntryRequest: noop,
    removeEntryRequest: noop,
    addComment: () => undefined,
    refreshAll: noop,
  };
}

function build(panelAiRequests: AiRequest[]) {
  return buildRequests({
    bibReviewRequests: [],
    bibEntryRequests: [],
    comments: [],
    panelAiRequests,
    cancelBibReview: () => {},
    removeEntryRequest: () => {},
    deletePanelAiRequest: () => {},
    clearLinkedAiRequest: () => {},
    cardLinkResolves: () => true, // task 697
  });
}

describe("an off-union kind cannot throw the AI window", () => {
  it("builds the list without throwing, and keeps EVERY other row", () => {
    // The whole point: the failure of one malformed byte used to be total.
    const rows = build([
      row({ id: "good", kind: "note" }),
      row({ id: "bad", kind: "totally-not-a-kind" }),
      row({ id: "good2", kind: "todo" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["panel:good", "panel:bad", "panel:good2"]);
  });

  it("gives the unknown row the fallback display kind, RAW kind as the label", () => {
    const [vm] = build([row({ kind: "totally-not-a-kind" })]);
    expect(vm.kind).toBe("panel-unknown");
    expect(vm.label).toBe("totally-not-a-kind");
  });

  it("RENDERS the real window over it — the dereference sites that threw", () => {
    // `RequestCard` reads `KIND_META[req.kind].label`, and through
    // `themeKeyForVM` also `KIND_META[req.kind].themeKey`. Both threw pre-fix,
    // taking the whole window with them — so the assertion that matters is
    // that the GOOD rows are on screen next to the bad one.
    expect(() =>
      render(
        <AIWindow
          {...props([
            row({ id: "good", kind: "note", text: "a real note request" }),
            row({ id: "bad", kind: "totally-not-a-kind" }),
          ])}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText("a real note request")).toBeTruthy();
    // The unresolved row is visible and says what the file actually calls it.
    expect(screen.getByText("Unrecognized")).toBeTruthy();
    expect(screen.getByText("totally-not-a-kind")).toBeTruthy();
    cleanup();
  });

  it("renders a row whose kind is MISSING entirely, through the read gate", () => {
    const [r] = normalizeAiRequestRows([{ id: "x", text: "no kind at all" }]);
    expect(() => render(<AIWindow {...props([r])} />)).not.toThrow();
    expect(screen.getByText("no kind at all")).toBeTruthy();
    cleanup();
  });

  it("counts the unrecognised row as OPEN — the user should go look at it", () => {
    // The worker's call (task 682 "Open decision"): a row the app cannot
    // classify is exactly the one worth a nudge, not one to hide.
    expect(aiRequestDotStatus({
      bibReviewRequests: [],
      bibEntryRequests: [],
      comments: [],
      panelAiRequests: [row({ kind: "totally-not-a-kind" })],
    })).toBe("warn");
    expect(build([row({ kind: "totally-not-a-kind" })])[0].status).toBe("open");
  });

  it("leaves it cancellable — an unlinked row keeps the raw delete", () => {
    const deletePanelAiRequest = vi.fn();
    const [vm] = buildRequests({
      bibReviewRequests: [],
      bibEntryRequests: [],
      comments: [],
      panelAiRequests: [row({ id: "bad", kind: "totally-not-a-kind" })],
      cancelBibReview: () => {},
      removeEntryRequest: () => {},
      deletePanelAiRequest,
      clearLinkedAiRequest: () => {},
      cardLinkResolves: () => true, // task 697
    });
    vm.onCancel?.();
    expect(deletePanelAiRequest).toHaveBeenCalledWith("bad");
  });

  it("resolves every KNOWN kind to a real display kind, and renders it (control)", () => {
    // The vocabulary SSOT is compile-pinned exhaustive over `AiRequestKind`, so
    // this loop grows with the union — a new kind that nobody mapped shows up
    // here as `panel-unknown` instead of shipping as a silent fallback.
    for (const kind of AI_REQUEST_KINDS) {
      const [vm] = build([row({ kind })]);
      expect(vm.kind, kind).not.toBe("panel-unknown");
    }
    const all = AI_REQUEST_KINDS.map((kind, i) => row({ id: `k${i}`, kind }));
    expect(() => render(<AIWindow {...props(all)} />)).not.toThrow();
    expect(screen.queryByText("Unrecognized")).toBeNull();
    cleanup();
  });
});

describe("the store's read gate makes a row renderable without rewriting it", () => {
  it("keeps an off-union kind VERBATIM — the file is the user's only copy", () => {
    // Coercing it would throw away a token some writer meant (a newer build's
    // kind, a skill's typo) — and the window can only SHOW what it can't
    // resolve if the value survives the read.
    const [r] = normalizeAiRequestRows([{ id: "a", kind: "from-the-future" }]);
    expect(r.kind).toBe("from-the-future");
    expect(isAiRequestKind(r.kind)).toBe(false);
  });

  it("fills in a MISSING kind, which has no value to preserve", () => {
    const [r] = normalizeAiRequestRows([{ id: "a" }]);
    expect(r.kind).toBe("unknown");
    expect(() => build([r])).not.toThrow();
    expect(build([r])[0].kind).toBe("panel-unknown");
  });

  it("fills in a missing createdAt — the bucket sort's localeCompare threw on it", () => {
    // The same bug class one field over: `b.createdAt.localeCompare(...)` is a
    // TypeError on an absent field, and the sort runs over the WHOLE list.
    const rows = normalizeAiRequestRows([
      { id: "a", kind: "note" },
      { id: "b", kind: "note", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(typeof rows[0].createdAt).toBe("string");
    expect(() =>
      [...rows].sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
    ).not.toThrow();
  });

  it("gives an id-less row a stable key rather than dropping it", () => {
    const rows = normalizeAiRequestRows([{ kind: "note" }, { kind: "todo" }]);
    expect(rows.map((r) => r.id)).toEqual(["unkeyed:0", "unkeyed:1"]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it("drops a non-object element, which is not a record at all", () => {
    expect(normalizeAiRequestRows(["nope", 7, null, ["x"]])).toEqual([]);
  });

  it("discards a malformed linkedTo instead of handing it to the router", () => {
    const [r] = normalizeAiRequestRows([
      { id: "a", kind: "suggestion", linkedTo: "revisions" },
    ]);
    expect(r.linkedTo).toBeUndefined();
    const [r2] = normalizeAiRequestRows([
      { id: "b", kind: "suggestion", linkedTo: { panel: "revisions", cardId: "c1" } },
    ]);
    expect(r2.linkedTo).toEqual({ panel: "revisions", cardId: "c1" });
  });

  it("leaves a well-formed row byte-identical (control)", () => {
    const good = row({ id: "g", kind: "note", linkedTo: { panel: "notes", cardId: "c" } });
    expect(normalizeAiRequestRows([good])).toEqual([good]);
  });
});
