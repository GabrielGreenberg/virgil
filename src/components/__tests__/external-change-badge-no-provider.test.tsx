// @vitest-environment jsdom
//
// Regression guard for the v0.1.59 production crash: the ExternalChangeBadge
// lives in the topbar, which renders even on the no-document LANDING screen —
// where DiskWatcherProviderGate mounts NO DiskWatcherProvider. The badge used
// the THROWING hooks (useExternalChanges / useDiskWatcher), so it threw
// "useDiskWatcher must be used inside DiskWatcherProvider" on the very first
// paint, white-screening the whole app. The dev preview masked it by
// auto-loading a doc (which mounts the provider).
//
// Unlike the sibling chrome test, this one does NOT mock the disk-watcher hooks
// — it renders the REAL badge with NO provider above it and asserts it renders
// nothing and does not throw. That is exactly the boot path that shipped broken.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// The DiskWatcher context module imports the storage backend at module scope
// (used only INSIDE the provider, never on the no-provider path). Its dynamic
// `require("@/lib/storage-fsa")` doesn't resolve under vitest, so stub the
// backend — this leaves the REAL context hooks (useDiskWatcherOrNull /
// useExternalChangesOrNull) intact, which is the whole point of this test.
vi.mock("@/lib/storage", () => ({
  statFiles: async () => [],
  readTextFile: async () => "",
  getTexFilename: () => "main.tex",
  getBibFilename: () => "references.bib",
}));

import ExternalChangeBadge from "../ExternalChangeBadge";

afterEach(() => cleanup());

describe("ExternalChangeBadge — no DiskWatcherProvider (landing screen)", () => {
  it("renders nothing and does not throw when no provider is mounted", () => {
    // Must not throw "useDiskWatcher must be used inside DiskWatcherProvider".
    const { container } = render(<ExternalChangeBadge />);
    expect(container.firstChild).toBeNull();
  });
});
