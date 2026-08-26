// @vitest-environment jsdom
//
// TASK 478 — a card panel must not DENY its own filter.
//
// Pick *View Archives* with nothing archived and the panel used to render the
// panel's single, view-BLIND `emptyState`: "No tasks yet. Click + to create
// one." — over twelve live cards on the other side of the filter, with the
// header badge suppressed at zero and the ⋮ checkmark visible only while the
// menu is open. So the persistent chrome was IDENTICAL to a genuinely empty
// panel's, and the copy instructed an action whose result the current view
// would immediately hide.
//
// Why NO pre-478 suite could see it: every archive-view fixture in the repo
// drives a panel that HAS something to show in the mode under test
// (`todo-count-semantics`' Archives leg has two archived todos), so the empty
// branch under a non-default view is unrepresentable in all of them. The
// measured pre-fix baseline, REAL `CardListPanel` (kind `todo`), view forced to
// `archived`, three live un-archived items: `cardsRendered 0`, `emptyShown
// true`, `emptyText 'No tasks yet. Click "+" to create one.'`, `headerBadge
// null`.
//
// The leg with teeth is the CENSUS-DERIVED sweep: the rule was never the part
// that could misbehave — a ninth archivable panel that authors its own second
// string is, and so is a panel that stops routing through the shared state. So
// the archivable set is DISCOVERED from the panels' own source (who hands
// `CardListPanel` a `getArchived`), and every member is driven through the REAL
// component at all three view modes × (raw empty / raw non-empty).

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach, type Mock } from "vitest";

// `panel-primitives` pulls the storage barrel transitively; stub it so the
// render needs no FSA. (Same shape `todo-count-semantics` uses.)
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "mutateSidecar", "readTex", "writeTex", "readDocBundle", "writeDocBundle",
    "readBib", "writeBib", "createDocFromPicker", "createDocInFolder",
    "pickProjectFolder", "registerDocInFolder", "openExistingDocFromPicker",
    "listDocs", "renameDoc", "deleteDocFromIndex", "flushDoc", "drainDoc",
    "detectBibPackage", "readPaperFolder", "getTexFilename", "writePdf",
    "readPdf", "getPdfFilename", "pdfFilenameFromTex", "readFigureSource",
    "readFigureRaster", "writeFigureRaster", "deleteFigureRaster",
    "readFigureIndex", "writeFigureIndex", "getDocWriteHandle",
    "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup } from "@testing-library/react";
import { CardListPanel } from "../CardListPanel";
import {
  CardArchiveViewProvider,
  resolveArchiveEmptyReason,
  archiveViewBadgeLabel,
  type CardArchiveView,
  type CardArchiveViewApi,
} from "../card-archive-view";
import type { PanelKind } from "../types";

afterEach(cleanup);

// ── The archivable panel set, DISCOVERED ────────────────────────────────────
//
// A hand list could only be missing the panel that drifted. The population is
// "every panel that hands `CardListPanel` a `getArchived`" — which IS the
// declaration that makes a panel archivable — read off the panels' own source.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANELS_DIR = path.resolve(HERE, "../.."); // src/panels/

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "_shared") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const ARCHIVABLE_PANELS: { file: string; kind: PanelKind }[] = walk(PANELS_DIR)
  .flatMap((f) => {
    const src = readFileSync(f, "utf8");
    if (!/<CardListPanel/.test(src) || !/\bgetArchived=/.test(src)) return [];
    // NOT `[^>]*?`: five of the eight spell the generic form
    // `<CardListPanel<Item>`, whose own `>` truncates such a window and drops
    // exactly those panels out of the population (measured: 4 of 8 found).
    const kind = src.match(/<CardListPanel[\s\S]{0,240}?\bkind="([a-z-]+)"/)?.[1];
    if (!kind) return [];
    return [{ file: path.relative(PANELS_DIR, f), kind: kind as PanelKind }];
  })
  .sort((a, b) => a.kind.localeCompare(b.kind));

interface Row {
  id: string;
  archived?: boolean;
}
const getId = (r: Row) => r.id;
const getArchived = (r: Row) => !!r.archived;
const AUTHORED = "AUTHORED-EMPTY-COPY";

function api(view: CardArchiveView, setView: Mock | (() => void) = vi.fn()): CardArchiveViewApi {
  return {
    getView: () => view,
    setView,
    suppressAtomWarning: false,
    setSuppressAtomWarning: () => {},
  };
}

function renderPanel(opts: {
  kind: PanelKind;
  view: CardArchiveView;
  items: Row[];
  setView?: Mock;
  onAdd?: (rect?: DOMRect) => void;
}) {
  return render(
    <CardArchiveViewProvider value={api(opts.view, opts.setView)}>
      <CardListPanel<Row>
        kind={opts.kind}
        items={opts.items}
        getId={getId}
        getArchived={getArchived}
        selectedId={null}
        onSelect={vi.fn()}
        onAdd={opts.onAdd}
        emptyState={<div>{AUTHORED}</div>}
        renderCard={(r) => <div data-testid="card">{r.id}</div>}
      />
    </CardArchiveViewProvider>,
  );
}

const text = (c: HTMLElement) => c.textContent ?? "";

// A live card, and an archived one — the two raw-list shapes every mode is
// driven against.
const ACTIVE_ROWS: Row[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
const ARCHIVED_ROWS: Row[] = [{ id: "x", archived: true }];

describe("the archivable panel census", () => {
  it("finds the panels (a census that finds nothing proves nothing)", () => {
    // Floor, not an exact count: a ninth archivable panel must inherit the
    // sweep by shipping, never by editing this guard. Zero here means the
    // extractor broke, not that the panels stopped being archivable.
    expect(ARCHIVABLE_PANELS.length).toBeGreaterThanOrEqual(8);
    expect(ARCHIVABLE_PANELS.map((p) => p.kind)).toContain("todo");
    expect(ARCHIVABLE_PANELS.map((p) => p.kind)).toContain("notes");
  });

  it("no archivable panel authors a SECOND, view-aware empty string", () => {
    // The surgicalFix this task rejected: eight panels each grow a conditional
    // `emptyState`. Eight strings to keep in step, and the ninth panel repeats
    // the bug. A panel that reads the view at all is doing the shared rule's
    // job — the panel supplies its genuinely-empty copy and nothing else.
    const offenders = ARCHIVABLE_PANELS.filter((p) => {
      const src = readFileSync(path.join(PANELS_DIR, p.file), "utf8");
      return /\bView Archives\b|\bView Active\b|useCardArchiveView\s*\(/.test(
        src.replace(/<CardViewModeMenuItems[^>]*\/>/g, ""),
      );
    }).map((p) => p.file);
    expect(
      offenders,
      "the view-aware empty state lives ONCE, in card-archive-view.tsx",
    ).toEqual([]);
  });
});

// ── The sweep: 3 view modes × (raw empty / raw non-empty), per panel ────────

describe.each(ARCHIVABLE_PANELS.map((p) => [p.kind, p] as const))(
  "%s",
  (_kind, panel) => {
    it("Archives view, nothing archived, live cards behind the filter → names the VIEW, not the panel", () => {
      const { container } = renderPanel({
        kind: panel.kind,
        view: "archived",
        items: ACTIVE_ROWS,
      });
      // The defect: the authored create-your-first-card copy over three live cards.
      expect(text(container)).not.toContain(AUTHORED);
      expect(text(container)).toContain("Nothing archived yet");
      // …and it says where the cards went, rather than implying they are gone.
      expect(text(container)).toContain("3 cards are hidden by this view");
      // The way forward is the way OUT of the view — never an action it hides.
      expect(text(container)).toContain("View Active");
      expect(container.querySelectorAll('[data-testid="card"]').length).toBe(0);
    });

    it("Archives view with an EMPTY panel still names the view (creating here would be hidden too)", () => {
      const { container } = renderPanel({
        kind: panel.kind,
        view: "archived",
        items: [],
      });
      expect(text(container)).not.toContain(AUTHORED);
      expect(text(container)).toContain("Nothing archived yet");
      expect(text(container)).not.toContain("hidden by this view");
    });

    it("Active view with EVERY card archived → says the work is present and invisible", () => {
      const { container } = renderPanel({
        kind: panel.kind,
        view: "active",
        items: ARCHIVED_ROWS,
      });
      expect(text(container)).not.toContain(AUTHORED);
      expect(text(container)).toContain("Every card here is archived");
      expect(text(container)).toContain("View Archives");
    });

    it("Active view, genuinely empty → the panel's OWN authored copy, verbatim", () => {
      const { container } = renderPanel({
        kind: panel.kind,
        view: "active",
        items: [],
      });
      expect(text(container)).toContain(AUTHORED);
      expect(text(container)).not.toContain("Nothing archived");
      expect(text(container)).not.toContain("Every card here is archived");
    });

    it("All view, genuinely empty → the panel's OWN authored copy (nothing is filtered out)", () => {
      const { container } = renderPanel({
        kind: panel.kind,
        view: "all",
        items: [],
      });
      expect(text(container)).toContain(AUTHORED);
      expect(text(container)).not.toContain("Nothing archived");
    });

    it("All view with cards → no empty state at all", () => {
      const { container } = renderPanel({
        kind: panel.kind,
        view: "all",
        items: [...ACTIVE_ROWS, ...ARCHIVED_ROWS],
      });
      expect(container.querySelectorAll('[data-testid="card"]').length).toBe(4);
      expect(text(container)).not.toContain(AUTHORED);
      expect(text(container)).not.toContain("Nothing archived");
    });

    it("the header announces a non-default view, and un-suppresses its zero", () => {
      const archived = renderPanel({
        kind: panel.kind,
        view: "archived",
        items: ACTIVE_ROWS,
      });
      expect(
        archived.container.querySelector(".panel-header-view")?.textContent,
      ).toBe("ARCHIVES");
      // The one place a mode could have shown used to read exactly like an
      // empty panel: `count > 0` suppressed the badge at zero.
      expect(
        archived.container.querySelector(".panel-header-count")?.textContent,
      ).toBe("0");
      cleanup();

      const all = renderPanel({
        kind: panel.kind,
        view: "all",
        items: ACTIVE_ROWS,
      });
      expect(
        all.container.querySelector(".panel-header-view")?.textContent,
      ).toBe("ALL");
      cleanup();

      // NON-REGRESSION: the default view's header is untouched — no mode chip,
      // and a zero count stays suppressed.
      const active = renderPanel({
        kind: panel.kind,
        view: "active",
        items: ARCHIVED_ROWS,
      });
      expect(active.container.querySelector(".panel-header-view")).toBeNull();
      expect(active.container.querySelector(".panel-header-count")).toBeNull();
    });

    it('"+" in the Archives view leaves it, so the created card is not born invisible', () => {
      const setView = vi.fn();
      const onAdd = vi.fn();
      const { container } = renderPanel({
        kind: panel.kind,
        view: "archived",
        items: ACTIVE_ROWS,
        setView,
        onAdd,
      });
      const add = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Add"]',
      );
      expect(add).toBeTruthy();
      add!.click();
      expect(setView).toHaveBeenCalledWith(panel.kind, "active");
      expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('"+" in the default view changes nothing about the view', () => {
      const setView = vi.fn();
      const onAdd = vi.fn();
      const { container } = renderPanel({
        kind: panel.kind,
        view: "active",
        items: [],
        setView,
        onAdd,
      });
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Add"]')!
        .click();
      expect(setView).not.toHaveBeenCalled();
      expect(onAdd).toHaveBeenCalledTimes(1);
    });
  },
);

// ── The rule itself ─────────────────────────────────────────────────────────

describe("resolveArchiveEmptyReason", () => {
  it("is null when the list is not empty at all", () => {
    expect(
      resolveArchiveEmptyReason({
        view: "archived",
        archivable: true,
        rawCount: 5,
        visibleCount: 2,
      }),
    ).toBeNull();
  });

  it("a NON-archivable panel always gets its own copy (no filter exists to name)", () => {
    for (const view of ["active", "archived", "all"] as CardArchiveView[]) {
      expect(
        resolveArchiveEmptyReason({
          view,
          archivable: false,
          rawCount: 3,
          visibleCount: 0,
        }),
      ).toEqual({ kind: "panel-empty" });
    }
  });

  it('"all" can never reach a view-aware reason — all ⇒ visible === items', () => {
    // Stated as a leg rather than a comment: an empty visible list under "all"
    // IS an empty raw list, so the only honest answer is the panel's own copy.
    expect(
      resolveArchiveEmptyReason({
        view: "all",
        archivable: true,
        rawCount: 0,
        visibleCount: 0,
      }),
    ).toEqual({ kind: "panel-empty" });
  });

  it("carries the hidden count, which is the reassurance", () => {
    expect(
      resolveArchiveEmptyReason({
        view: "archived",
        archivable: true,
        rawCount: 12,
        visibleCount: 0,
      }),
    ).toEqual({ kind: "nothing-archived", hidden: 12 });
    expect(
      resolveArchiveEmptyReason({
        view: "active",
        archivable: true,
        rawCount: 12,
        visibleCount: 0,
      }),
    ).toEqual({ kind: "all-archived", hidden: 12 });
  });

  it("the default view names no mode; the other two do", () => {
    expect(archiveViewBadgeLabel("active")).toBeUndefined();
    expect(archiveViewBadgeLabel("archived")).toBe("ARCHIVES");
    expect(archiveViewBadgeLabel("all")).toBe("ALL");
  });
});
