// @vitest-environment jsdom
//
// Task 357 hole 4 — the banner half. The gates' finding is only useful if the
// one person who can act on it sees it, so this drives the REAL badge against
// the REAL notice store: a refusal published from a storage backend must raise
// the pill in the topbar, live, with no doc reload and no editor subscription.
//
// The acknowledgment leg matters as much as the appearance leg: "Save anyway"
// is the ONLY way out, and once taken the pill must go and stay gone.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";

// The badge's chrome imports reach `@/lib/storage`, whose dynamic
// `require("@/lib/storage-fsa")` doesn't resolve under vitest (the same stub
// the sibling external-change badge suite takes). Nothing here touches disk.
vi.mock("@/lib/storage", () => ({}));

import PreservationNoticeBadge from "../PreservationNoticeBadge";
import {
  recordPreservationRefusal,
  acknowledgePreservationNotice,
  clearPreservationNotice,
} from "@/lib/preservation-notice";

const DOC = "doc-1";
const DETAIL = {
  source: "load",
  region: "body",
  before: 400,
  after: 120,
  lost: 280,
  allowed: 4,
} as const;

afterEach(() => {
  cleanup();
  clearPreservationNotice();
});

const pill = () => document.querySelector("[data-preservation-notice]");

describe("PreservationNoticeBadge", () => {
  it("renders nothing with no doc and nothing with a clean doc", () => {
    render(<PreservationNoticeBadge docId={null} />);
    expect(pill()).toBeNull();
    cleanup();
    render(<PreservationNoticeBadge docId={DOC} />);
    expect(pill()).toBeNull();
  });

  it("rises when a gate publishes a refusal, without a remount", () => {
    render(<PreservationNoticeBadge docId={DOC} />);
    expect(pill()).toBeNull();
    act(() => {
      recordPreservationRefusal(DOC, DETAIL);
    });
    expect(pill()).not.toBeNull();
    // The two facts that matter, in the order they matter: not saving, and
    // (in the menu detail) the file on disk is unchanged.
    expect(screen.getByLabelText(/not saving/i)).toBeTruthy();
  });

  it("ignores a refusal published for a DIFFERENT document", () => {
    render(<PreservationNoticeBadge docId={DOC} />);
    act(() => {
      recordPreservationRefusal("some-other-doc", DETAIL);
    });
    expect(pill()).toBeNull();
  });

  it("goes away on acknowledgment and does not come back on a later refusal", () => {
    render(<PreservationNoticeBadge docId={DOC} />);
    act(() => {
      recordPreservationRefusal(DOC, DETAIL);
    });
    expect(pill()).not.toBeNull();
    act(() => {
      acknowledgePreservationNotice(DOC);
    });
    expect(pill()).toBeNull();
    // The user decided. A later refusal for the same doc must not re-raise a
    // banner over a choice they already made.
    act(() => {
      recordPreservationRefusal(DOC, DETAIL);
    });
    expect(pill()).toBeNull();
  });

  it("a SERIALIZE refusal reads differently and offers no way to save", () => {
    // Task 357's serializer gate. The other three refusals have a version to
    // save — a shorter document the user may knowingly accept. This one does
    // not: the serializer produced no bytes at all, so "Save anyway" would
    // promise what the commit cannot do and refuse again one gesture later.
    render(<PreservationNoticeBadge docId={DOC} />);
    act(() => {
      recordPreservationRefusal(DOC, {
        ...DETAIL,
        source: "serialize",
        after: 0,
        lost: DETAIL.before,
        allowed: 0,
        reason: "Unknown node type: sideNoteBlock",
      });
    });
    const el = pill();
    expect(el).not.toBeNull();
    expect(el?.getAttribute("data-preservation-notice")).toBe("serialize");
    // The pill says the right thing — "can't write", not "didn't load".
    expect(el?.textContent ?? "").toMatch(/can't write/i);
    // …and the one action row is withheld. Open the menu and look.
    act(() => {
      (el?.querySelector("button[aria-haspopup='menu']") as HTMLElement)?.click();
    });
    expect(screen.queryByText(/save anyway/i)).toBeNull();
    // The explanation is still there — withholding the action must not mean
    // withholding the account of what happened.
    expect(document.body.textContent ?? "").toMatch(/sideNoteBlock/);
  });
});
