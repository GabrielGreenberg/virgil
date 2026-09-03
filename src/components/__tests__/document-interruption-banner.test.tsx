// @vitest-environment jsdom
//
// Task 545 — the BAND: the one guided surface for every state that stops or
// pauses writing. These legs drive the REAL component over the REAL stores
// (cowork pen, preservation notice, unsaved-work) with the disk-watcher
// context and the confirm dialog mocked, and assert what the user SEES and
// which DOOR a click enters — never the door's own semantics, which stay
// pinned in `conflict-resolution.test.ts`.
//
// The leg with teeth is the CENSUS at the bottom: the vocabulary was never the
// part that could misbehave — a surface that spells its own sentence beside it
// is, and it type-checks perfectly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExternalChangeState } from "@/lib/disk-watcher";
import type { ConflictChoice, ConflictOutcome } from "@/lib/conflict-resolution";

let currentState: ExternalChangeState = { changes: [], severity: null, detectedAt: null, paused: false };
const acknowledge = vi.fn(async () => {});
const reloadFromDisk = vi.fn(async () => {});
const resolveConflict = vi.fn(
  async (choice: ConflictChoice): Promise<ConflictOutcome> => ({
    choice,
    archive: { slot: "s", disk: ["main.tex"], mine: "unsaved-main.tex" },
    applied: true,
  }),
);

vi.mock("@/hooks/useExternalChanges", () => ({
  useExternalChangesOrNull: () => ({ state: currentState, watcher: { acknowledge } }),
}));
vi.mock("@/components/editor-layout/contexts/disk-watcher", () => ({
  useDiskWatcherOrNull: () => ({ activeDocId: "doc-1", reloadFromDisk, resolveConflict }),
}));
const confirmSpy = vi.fn(async () => true);
vi.mock("@/components/ConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmSpy, dialog: null }),
}));
vi.mock("@/lib/storage", () => ({}));

import DocumentInterruptionBanner from "@/components/DocumentInterruptionBanner";
import { clearCoworkPen, noteCoworkPen, noteCoworkPenRelease } from "@/lib/cowork-pen";
import { clearPreservationNotice, recordPreservationRefusal } from "@/lib/preservation-notice";
import { clearUnsavedWork, noteSaveBlocked, noteUnsavedEdit } from "@/lib/unsaved-work";
import { __resetInterruptionLogForTests, interruptionEvents } from "@/lib/interruption-log";
import { getBlockingFlowRequest, resetBlockingFlowRequests } from "@/lib/save-request";

const DOC = "doc-1";
function hold(docId = DOC) {
  noteCoworkPen(docId, { holder: "claude", since: Date.now(), expiresAt: Date.now() + 30_000, source: "pen-context" });
}
const band = () => document.querySelector("[data-doc-interruption-band]:not([data-doc-interruption-band='none'])");

function mount() {
  return render(
    <div className="editor-pane-root">
      <DocumentInterruptionBanner docId={DOC} />
    </div>,
  );
}

beforeEach(() => {
  currentState = { changes: [], severity: null, detectedAt: null, paused: false };
  acknowledge.mockClear();
  reloadFromDisk.mockClear();
  resolveConflict.mockClear();
  confirmSpy.mockClear();
  __resetInterruptionLogForTests();
  resetBlockingFlowRequests();
});
afterEach(() => {
  cleanup();
  clearCoworkPen();
  clearPreservationNotice();
  clearUnsavedWork();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("DocumentInterruptionBanner", () => {
  it("paints NOTHING for a clean document", () => {
    mount();
    expect(band()).toBeNull();
    expect(document.querySelector(".editor-pane-root")?.hasAttribute("data-doc-interruption")).toBe(false);
  });

  it("the cowork hold: loud, its own identity, veils the prose, clears on release", () => {
    mount();
    act(() => hold());
    const el = band()!;
    expect(el.getAttribute("data-doc-interruption-band")).toBe("cowork-hold");
    expect(el.getAttribute("role")).toBe("status");
    expect(screen.getByText("Virgil is editing this paper")).toBeTruthy();
    expect(el.textContent!.toLowerCase()).not.toContain("collaborator");
    // The breathing glyph — the "happening right now" distinction.
    expect(el.querySelector(".cowork-pen-pulse")).not.toBeNull();
    // No buttons: the honest answer is to wait.
    expect(el.querySelector("button")).toBeNull();
    // The veil stamp on the pane root, from the SAME view.
    const root = document.querySelector(".editor-pane-root")!;
    expect(root.getAttribute("data-doc-interruption")).toBe("cowork-hold");
    act(() => noteCoworkPen(DOC, null));
    expect(band()).toBeNull();
    expect(root.hasAttribute("data-doc-interruption")).toBe(false);
  });

  it("an AI-attributed conflict names Virgil's AI and its recommended button enters the conflict door", async () => {
    currentState = {
      changes: [{ relPath: "main.tex", role: "tex", kind: "modified" }],
      severity: "conflict",
      detectedAt: Date.now() - 2_000,
      paused: false,
    };
    noteCoworkPenRelease(DOC, Date.now() - 3_000);
    noteUnsavedEdit(DOC, Date.now() - 4_000);
    noteSaveBlocked(DOC, "conflict");
    mount();
    const el = band()!;
    expect(el.getAttribute("data-doc-interruption-writer")).toBe("virgil-ai");
    expect(screen.getByText(/Virgil's AI edited this paper while you had unsaved changes/)).toBeTruthy();
    expect(el.textContent).not.toMatch(/another app/i);
    const primary = el.querySelector("[data-interruption-recommended]")!;
    expect(primary.textContent).toBe("Use Virgil's edits");
    fireEvent.click(primary);
    await flush();
    expect(resolveConflict).toHaveBeenCalledWith("take-disk");
    // Everything went through: no dialog.
    expect(confirmSpy).not.toHaveBeenCalled();
    // The alternative is one click behind, phrased as an outcome.
    fireEvent.click(screen.getByText("Keep my version"));
    await flush();
    expect(resolveConflict).toHaveBeenCalledWith("keep-mine");
    // Provenance: the presentation was logged with its verdict and both times.
    const ev = interruptionEvents().at(-1)!;
    expect(ev.kind).toBe("conflict");
    expect(ev.writer).toBe("virgil-ai");
    expect(ev.penLastReleasedAt).not.toBeNull();
  });

  it("an unknown-writer change recommends loading it and DISMISS enters acknowledge", async () => {
    currentState = {
      changes: [{ relPath: "main.tex", role: "tex", kind: "modified" }],
      severity: "change",
      detectedAt: Date.now() - 2_000,
      paused: false,
    };
    mount();
    const el = band()!;
    expect(el.getAttribute("data-doc-interruption-writer")).toBe("unknown");
    expect(screen.getByText("This paper was changed outside Virgil")).toBeTruthy();
    fireEvent.click(el.querySelector("[data-interruption-recommended]")!);
    await flush();
    expect(reloadFromDisk).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Keep what's in Virgil"));
    await flush();
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  it("a preservation refusal is an ALERT whose recommended action ROUTES to the badge's own flow", () => {
    mount();
    act(() => {
      recordPreservationRefusal(DOC, { source: "load", region: "body", before: 400, after: 120, lost: 280, allowed: 4 });
    });
    const el = band()!;
    expect(el.getAttribute("role")).toBe("alert");
    expect(el.textContent).toMatch(/not saving/i);
    fireEvent.click(el.querySelector("[data-interruption-recommended]")!);
    const req = getBlockingFlowRequest();
    expect(req?.docId).toBe(DOC);
    expect(req?.flow).toBe("preservation");
  });

  it("a conflict door that could not take its net is REPORTED, not inferred", async () => {
    resolveConflict.mockResolvedValueOnce({ choice: "keep-mine", archive: null, applied: true });
    currentState = {
      changes: [{ relPath: "main.tex", role: "tex", kind: "modified" }],
      severity: "conflict",
      detectedAt: Date.now(),
      paused: false,
    };
    noteUnsavedEdit(DOC, Date.now() - 90_000);
    noteSaveBlocked(DOC, "conflict");
    mount();
    fireEvent.click(band()!.querySelector("[data-interruption-recommended]")!);
    await flush();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect((confirmSpy.mock.calls[0] as unknown as [{ title: string }])[0].title).toMatch(/no history copy/);
  });

  it("is per-DOCUMENT: a hold on another paper says nothing here", () => {
    mount();
    act(() => hold("other-doc"));
    expect(band()).toBeNull();
  });
});

/* ── The census ─────────────────────────────────────────────────────── */

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("census · one vocabulary, one band", () => {
  it("the band is mounted in the editor pane, under the chrome header and above the prose pod", () => {
    const src = read("src/components/EditorPane.tsx");
    const header = src.indexOf('data-tool-strip="text"');
    const bandAt = src.indexOf("<DocumentInterruptionBanner");
    const pod = src.indexOf('className="editor-pane-pod"');
    expect(header).toBeGreaterThan(0);
    expect(bandAt).toBeGreaterThan(header);
    expect(pod).toBeGreaterThan(bandAt);
  });

  it("the two topbar pills for the same events read the vocabulary rather than spelling their own", () => {
    for (const rel of ["src/components/ExternalChangeBadge.tsx", "src/components/CoworkPenBadge.tsx"]) {
      const code = stripComments(read(rel));
      expect(code, rel).toContain("interruptionPillLabel(");
    }
    // The conflict outcome is reported in one voice from both surfaces.
    expect(stripComments(read("src/components/ExternalChangeBadge.tsx"))).toContain("conflictOutcomeNotice(");
    expect(stripComments(read("src/components/DocumentInterruptionBanner.tsx"))).toContain("conflictOutcomeNotice(");
  });

  it("the cowork hold's copy never says 'collaborator', anywhere the vocabulary or the band speaks", () => {
    for (const rel of [
      "src/lib/document-interruption.ts",
      "src/components/DocumentInterruptionBanner.tsx",
      "src/components/CoworkPenBadge.tsx",
    ]) {
      const code = stripComments(read(rel)).toLowerCase();
      expect(code, rel).not.toContain("collaborator");
    }
  });

  it("the veil is keyed on the band's stamp, and the band hides in print", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain('.editor-pane-root[data-doc-interruption="cowork-hold"] .editor-pane-pod .ProseMirror');
    expect(css).toMatch(/@media print \{\s*\.doc-interruption-band \{\s*display: none;/);
  });

  it("the band routes a review through the ONE flow table and a retry through the save door", () => {
    const code = stripComments(read("src/components/DocumentInterruptionBanner.tsx"));
    expect(code).toContain("requestBlockingFlow(");
    expect(code).toContain("requestSaveNow(");
    // …and never spells a flow literal of its own.
    expect(code).not.toContain('"external-' + 'change"');
  });
});
