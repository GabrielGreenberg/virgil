// @vitest-environment jsdom
//
// The Keep / Dismiss pair is ONE component, mounted by BOTH call sites
// (task 2026-08-31-501).
//
// ## Why this suite renders two surfaces
//
// `CommitActions` was extracted from two byte-identical private copies — the
// margin `PendingChangePill`'s portal body and the applied suggestion card's
// header row. A test of the extracted component alone structurally CANNOT see a
// call site that kept its private copy: the copy renders the same buttons with
// the same labels, so every assertion about `CommitActions` passes while one
// surface quietly drifts. So the contract asserted here is AGREEMENT between
// two real renders, plus a source census for the half no render can see.
//
// The pill's placement is RAF-gated against real editor geometry, which jsdom
// has none of — mounting `PendingChangePill` reaches its portal JSX never. That
// is why the portal BODY is exported (`PendingChangePillBody`, the
// `resolveTargetKey` precedent): it makes the pill's actual content renderable
// without driving a geometry pipeline that cannot run here.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// panel-primitives transitively pulls `@/lib/storage` (the known barrel/storage
// gotcha) — stub it; nothing here touches a sidecar.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});
vi.mock("@/components/RichTextField", () => ({ default: () => <div data-testid="rtf" /> }));
vi.mock("@/components/StaticBorrowedText", () => ({
  StaticBorrowedText: () => <div data-testid="borrowed" />,
  default: () => <div data-testid="borrowed" />,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PendingChangePillBody } from "@/components/PendingChangePill";
import { RevisionSuggestionCard } from "@/panels/Revisions/RevisionSuggestionCard";
import { PendingChangeControllerProvider } from "@/links/pending-change-controller";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import { setPendingChangesFlag } from "@/lib/pending-changes-flag";
import type { RevisionSuggestionCard as RevisionSuggestionCardData } from "@/lib/types";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

beforeEach(() => setPendingChangesFlag(true));
afterEach(() => {
  cleanup();
  setPendingChangesFlag(undefined);
  cardStore.collapse({ kind: "revision-suggestion", id: "rs1" });
});

function makeApplied(): RevisionSuggestionCardData {
  return {
    kind: "suggestion",
    id: "rs1",
    createdAt: "2026-08-31T00:00:00.000Z",
    author: "ai",
    original_text: "The original sentence.",
    suggested_text: "The revised sentence.",
    explanation: "",
    user_text: "",
    instructions: "",
    status: "applied",
    appliedChange: {
      anchorId: "a1",
      anchorUuid: "u1",
      originalText: "The pre-splice original.",
      replacement: "The revised sentence.",
      mode: "replace",
      appliedAt: "2026-08-31T00:00:00.000Z",
    },
    links: [],
  };
}

function makeController() {
  return {
    isOn: true,
    keep: vi.fn(),
    dismiss: vi.fn(),
    previewOriginal: vi.fn(),
    previewSuggested: vi.fn(),
    insertBelow: vi.fn(),
  };
}

/** Everything a user can PERCEIVE about the pair, plus the glyph's own shape. */
function signature(root: HTMLElement) {
  const buttons = [...root.querySelectorAll("button")].filter((b) =>
    ["Keep change", "Dismiss change"].includes(b.getAttribute("aria-label") ?? ""),
  );
  return buttons.map((b) => ({
    label: b.getAttribute("aria-label"),
    title: b.getAttribute("title"),
    className: b.className,
    // The glyph: viewBox, stroke width and the drawn primitives. A re-forked
    // copy that drifted by one attribute shows up here rather than as a
    // pixel nobody looks at.
    glyph: [...b.querySelectorAll("svg")].map((svg) => ({
      viewBox: svg.getAttribute("viewBox"),
      width: svg.getAttribute("width"),
      strokeWidth: svg.getAttribute("stroke-width"),
      shapes: [...svg.children].map((c) => `${c.tagName}:${[...c.attributes]
        .map((a) => `${a.name}=${a.value}`)
        .sort()
        .join(",")}`),
    })),
  }));
}

function renderPill() {
  const onKeep = vi.fn();
  const onDismiss = vi.fn();
  const { container } = render(
    <PendingChangePillBody
      target={{ anchorId: "a1", onKeep, onDismiss }}
      targetKey="revision-suggestion:rs1"
      right={100}
      top={200}
    />,
  );
  return { container, onKeep, onDismiss };
}

function renderCard(controller = makeController()) {
  const { container } = render(
    <PendingChangeControllerProvider value={controller}>
      <RevisionSuggestionCard
        card={makeApplied()}
        selected={false}
        onUpdateField={() => {}}
        onAccept={() => {}}
        onReject={() => {}}
        onConvert={() => {}}
        onDelete={() => {}}
        onSelect={() => {}}
      />
    </PendingChangeControllerProvider>,
  );
  return { container, controller };
}

describe("the Keep / Dismiss pair renders identically on both surfaces", () => {
  it("announces and paints the same from the pill and from the card", () => {
    const pill = renderPill();
    const pillSig = signature(pill.container);
    cleanup();

    const card = renderCard();
    const cardSig = signature(card.container);

    // Both surfaces render the pair at all…
    expect(pillSig).toHaveLength(2);
    expect(cardSig).toHaveLength(2);
    // …and they are the same pair.
    expect(pillSig).toEqual(cardSig);
  });

  it("paints the affirmative half from the --positive family, not a raw palette", () => {
    const { container } = renderPill();
    const keep = container.querySelector('button[aria-label="Keep change"]')!;
    expect(keep.className).toContain("text-positive-ink");
    expect(keep.className).toContain("hover:bg-positive-soft");
    expect(keep.className).not.toMatch(/emerald/);
  });

  it("paints the destructive half from the --danger family, as it always did", () => {
    // The non-regression control: the half that was already right must not have
    // moved, or "the pair agrees" could be satisfied by breaking both.
    const { container } = renderPill();
    const dismiss = container.querySelector('button[aria-label="Dismiss change"]')!;
    expect(dismiss.className).toContain("hover:bg-danger-soft");
    expect(dismiss.className).toContain("hover:text-danger");
  });
});

describe("each call site keeps its own POINTER POLICY", () => {
  it("the pill's container guards the editor selection on mousedown", () => {
    // A fixed portal over the editor: a mousedown must not blur the editor
    // before the click lands. The guard is on the CONTAINER so it covers the
    // pill's padding and gap too, which a per-button handler would not.
    const { container } = renderPill();
    const group = container.querySelector('[role="group"]')!;
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    group.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("the card's buttons stop mousedown from reaching the lifting header", () => {
    // Observed through a REACT ancestor handler, not a native listener: the
    // component calls `stopPropagation` on the SYNTHETIC event, which cannot
    // stop the native event from reaching an `addEventListener` on the root —
    // a native probe reports "reached" for a correct implementation, and the
    // leg would be unfalsifiable in the other direction.
    const ancestor = vi.fn();
    const { container } = render(
      <div onMouseDown={ancestor}>
        <PendingChangeControllerProvider value={makeController()}>
          <RevisionSuggestionCard
            card={makeApplied()}
            selected={false}
            onUpdateField={() => {}}
            onAccept={() => {}}
            onReject={() => {}}
            onConvert={() => {}}
            onDelete={() => {}}
            onSelect={() => {}}
          />
        </PendingChangeControllerProvider>
      </div>,
    );
    fireEvent.mouseDown(container.querySelector('button[aria-label="Keep change"]')!);
    expect(ancestor).not.toHaveBeenCalled();
  });

  it("the pill does NOT stop mousedown at the button (its container owns it)", () => {
    // The two policies are opposite, so a component that guessed one would be
    // wrong on the other surface. This leg pins that they were not merged.
    const ancestor = vi.fn();
    const { container } = render(
      <div onMouseDown={ancestor}>
        <PendingChangePillBody
          target={{ anchorId: "a1", onKeep: () => {}, onDismiss: () => {} }}
          targetKey="revision-suggestion:rs1"
          right={100}
          top={200}
        />
      </div>,
    );
    fireEvent.mouseDown(container.querySelector('button[aria-label="Keep change"]')!);
    expect(ancestor).toHaveBeenCalledTimes(1);
  });
});

describe("both surfaces route their clicks", () => {
  it("the pill calls its own target's closures", () => {
    const { container, onKeep, onDismiss } = renderPill();
    fireEvent.click(container.querySelector('button[aria-label="Keep change"]')!);
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('button[aria-label="Dismiss change"]')!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("the card routes through the pending-change controller", () => {
    const { controller } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Keep change" }));
    expect(controller.keep).toHaveBeenCalledWith("revision-suggestion", "rs1");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss change" }));
    expect(controller.dismiss).toHaveBeenCalledWith("revision-suggestion", "rs1");
  });
});

/* ── The leg with teeth: the census ──────────────────────────────── */

/**
 * The extracted component was never the part that could misbehave — a call site
 * that keeps (or re-grows) a private copy is, and that copy type-checks, renders
 * and announces identically. So neither call site may declare its own
 * Keep/Dismiss button or its own check/cross glyph, and both must mount the
 * shared one.
 *
 * Allowlist: EMPTY. A hit is MOUNT-it.
 */
const CALL_SITES = [
  "src/components/PendingChangePill.tsx",
  "src/panels/_shared/suggestion-fields.tsx",
] as const;

describe("neither call site keeps a private copy", () => {
  it.each(CALL_SITES)("%s mounts the shared component", (rel) => {
    expect(read(rel)).toContain("<CommitActions");
  });

  it.each(CALL_SITES)("%s declares no Keep/Dismiss button of its own", (rel) => {
    const src = read(rel);
    // The announced strings live on the shared component now. A call site that
    // spells one is declaring its own button.
    expect(src, `${rel} re-declares a commit button`).not.toContain('aria-label="Keep change"');
    expect(src, `${rel} re-declares a commit button`).not.toContain('aria-label="Dismiss change"');
  });

  it.each(["PillGlyph", "CommitGlyph"])("the retired glyph %s stays retired", (name) => {
    // The two private copies had NAMES; a re-fork under either is the literal
    // shape this task retired. Deliberately narrower than "no file draws the
    // check polyline": a check mark is a universal primitive and
    // `suggestion-fields`' own copy-confirm button legitimately draws the same
    // one at a different size. What identifies THIS glyph is not the path — it
    // is the pair it belongs to, which the button leg above and the rendered
    // SIGNATURE comparison at the top of this file both cover.
    for (const rel of [...CALL_SITES, "src/components/CommitActions.tsx"]) {
      const src = read(rel);
      if (rel === "src/components/CommitActions.tsx") continue;
      expect(src, `${rel} re-declares ${name}`).not.toContain(`function ${name}(`);
    }
  });

  it("the shared component owns the glyph", () => {
    expect(read("src/components/CommitActions.tsx")).toContain('points="20 6 9 17 4 12"');
  });
});
