// @vitest-environment jsdom
//
// Task 363 — the surface, and the scan that feeds it.
//
// The badge was never the part that could misbehave. What could — and what a
// test of the grammar structurally cannot see — is a scan that is never WIRED,
// a report that is published but not read, or a badge that raises a permanent
// banner over a folder the user cannot clean from inside the app.
//
// Legs:
//   1. SCAN     — the real `scanSyncConflicts` lists, classifies and publishes,
//                 and a scan that throws reports nothing rather than surfacing
//                 a document error.
//   2. CLEARING — a later clean scan RETIRES a standing notice, so the pill can
//                 go away by itself once the user tidies the folder.
//   3. RENDER   — the pill states the count and the content split; a swap-only
//                 folder raises nothing.
//   4. DISMISS  — session-scoped, because the reporting folder holds four
//                 months of forks and a permanent banner is furniture.
//   5. WIRING   — the production doc-open path actually calls the scan (a
//                 SOURCE leg: the defect this closes is silence, and an unwired
//                 scan is silent in exactly the same way).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, act } from "@testing-library/react";

const mockList = vi.fn();
vi.mock("@/lib/storage", () => ({
  listSidecarNames: (...a: unknown[]) => mockList(...a),
}));

import SyncConflictBadge from "../SyncConflictBadge";
import { scanSyncConflicts } from "@/lib/sync-conflict-scan";
import {
  clearSyncConflictNotices,
  dismissSyncConflictNotice,
  getSyncConflictNotice,
} from "@/lib/sync-conflict-notice";

const FORKED = [
  "notes.json",
  "notes (Gabriel Greenberg's conflicted copy 2026-06-09).json",
  "notes (Gabriel Greenberg's conflicted copy 2026-06-09 5).json",
  "editor-state.json",
  "editor-state (Gabriel Greenberg's conflicted copy 2026-08-18).json",
  "archive.json.1.crswap",
];

beforeEach(() => {
  mockList.mockReset();
  clearSyncConflictNotices();
});
afterEach(() => clearSyncConflictNotices());

describe("sync-conflict scan", () => {
  it("lists, classifies and publishes", async () => {
    mockList.mockResolvedValue(FORKED);
    await scanSyncConflicts("doc-1");
    const n = getSyncConflictNotice("doc-1");
    expect(n).not.toBeNull();
    expect(n!.total).toBe(3);
    expect(n!.contentTotal).toBe(2);
    expect(n!.swapFiles).toEqual(["archive.json.1.crswap"]);
  });

  it("reports NOTHING when the listing throws — a diagnostic never becomes a document error", async () => {
    mockList.mockRejectedValue(new Error("permission lost"));
    await expect(scanSyncConflicts("doc-1")).resolves.toBeUndefined();
    expect(getSyncConflictNotice("doc-1")).toBeNull();
  });

  it("a later CLEAN scan retires a standing notice", async () => {
    mockList.mockResolvedValue(FORKED);
    await scanSyncConflicts("doc-1");
    expect(getSyncConflictNotice("doc-1")).not.toBeNull();
    mockList.mockResolvedValue(["notes.json", "editor-state.json"]);
    await scanSyncConflicts("doc-1");
    expect(getSyncConflictNotice("doc-1")).toBeNull();
  });
});

describe("sync-conflict badge", () => {
  it("renders nothing with no report", () => {
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    expect(container.innerHTML).toBe("");
  });

  it("states the count and the content split", async () => {
    mockList.mockResolvedValue(FORKED);
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    const pill = container.querySelector("[data-sync-conflict-notice]");
    expect(pill).not.toBeNull();
    expect(pill!.getAttribute("data-sync-conflict-notice")).toBe("3");
    expect(pill!.textContent).toContain("3 conflicted copies · 2 with content");
  });

  it("raises NOTHING for swap debris alone", async () => {
    mockList.mockResolvedValue(["notes.json", "notes.json.2.crswap"]);
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    expect(container.innerHTML).toBe("");
  });

  it("dismisses for the session", async () => {
    mockList.mockResolvedValue(FORKED);
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    expect(container.innerHTML).not.toBe("");
    act(() => dismissSyncConflictNotice("doc-1"));
    expect(container.innerHTML).toBe("");
    // A re-scan does NOT re-raise it — the user has seen this folder.
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    expect(container.innerHTML).toBe("");
  });
});

describe("sync-conflict wiring", () => {
  const REPO = path.resolve(__dirname, "../../..");

  it("the doc-open path calls the scan, and the badge is mounted", () => {
    // A source leg on purpose: the defect this whole task closes is SILENCE,
    // and a scan nobody calls (or a badge nobody renders) is silent in exactly
    // the same way, with every behavioural leg above still green.
    const useFiles = fs.readFileSync(
      path.join(REPO, "src/hooks/useFiles.ts"),
      "utf8",
    );
    expect(useFiles).toContain("scanSyncConflicts(meta.id)");
    const cluster = fs.readFileSync(
      path.join(REPO, "src/components/editor-layout/StatusCluster.tsx"),
      "utf8",
    );
    expect(cluster).toContain("<SyncConflictBadge docId={currentDocId} />");
  });

  it("both storage backends can list the sidecar directory", () => {
    // The scan is only as portable as its listing; a backend without one would
    // make the whole surface silently inert there.
    for (const rel of ["src/lib/storage-fsa.ts", "src/lib/storage-dev.ts"]) {
      const src = fs.readFileSync(path.join(REPO, rel), "utf8");
      expect(src, rel).toMatch(/export async function listSidecarNames/);
    }
  });
});
