// @vitest-environment jsdom
//
// Task 822 — the per-card ARCHIVE button is the card SHELL's, not a per-component
// opt-in. The contract (`hasArchiveButton`, cards/predicates.ts): the button
// renders iff the card shows a trash button AND `hasArchiveButton(kind)` — every
// archivable kind minus the ONE declared exemption set (the suggestion pair,
// task 020's ruling). Before 822 only `EditableCard` wired it, so todo and
// citation cards — PanelCard-direct — showed a trash with no archive beside it,
// and the Citations panel's Archives view could never fill from the UI.
//
// Three legs:
//   1. SHELL census — `PanelCard` itself, over every CardKind: archive button
//      present iff `hasArchiveButton(kind)`, given a trash + an id + a provider.
//   2. SOURCE census — every production `<PanelCard` that passes `onTrashClick`
//      also passes `cardId`, so no call site can drop the identity the shell
//      derives the button from.
//   3. The two kinds the audit found (todo, citation) render it for real and
//      route the click to `archive(kind, id)`; a draft citation (no stored
//      identity) does not.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("@/hooks/useLibrary", () => ({
  useLibraryItems: () => ({ items: [], loading: false }),
  useLibraryMasterBib: () => ({ entries: [], loading: false }),
  useLibraryMemberships: () => ({ memberships: new Map(), loading: false }),
  useLibraryEntryLookup: () => () => undefined,
}));
vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
vi.mock("@/components/BorrowedMainText", () => ({
  BorrowedMainText: () => <div data-testid="borrowed" />,
  default: () => <div data-testid="borrowed" />,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { PanelCard } from "@/components/panel-primitives";
import {
  CARD_KINDS,
  ARCHIVE_BUTTON_EXEMPT_KINDS,
  hasArchiveButton,
  isArchivable,
} from "@/cards/predicates";
import type { CardKind } from "@/cards/types";
import {
  CardArchiveActionsProvider,
  type CardArchiveActionsApi,
} from "@/panels/_shared/card-archive-actions";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import { TodoRow } from "@/panels/Todo/TodoRow";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type { CitationRef, TodoItem } from "@/lib/types";
import { walkFiles } from "../../lib/__tests__/_source-scan";

afterEach(cleanup);

function makeApi(archived: ReadonlySet<string> = new Set()): CardArchiveActionsApi {
  return {
    enabled: true,
    isArchived: (id) => archived.has(id),
    archive: vi.fn(),
  };
}

function withProvider(api: CardArchiveActionsApi, node: ReactNode) {
  return <CardArchiveActionsProvider value={api}>{node}</CardArchiveActionsProvider>;
}

function BareCard({ kind, cardId }: { kind: CardKind; cardId?: string }) {
  const theme = useCardKindTheme(kind);
  return (
    <PanelCard theme={theme} selected={false} kind={kind} cardId={cardId} onTrashClick={() => {}}>
      <div />
    </PanelCard>
  );
}

describe("archive button — shell census over every CardKind (task 822)", () => {
  it.each(CARD_KINDS)("%s: archive button iff hasArchiveButton(kind)", (kind) => {
    render(withProvider(makeApi(), <BareCard kind={kind} cardId="c1" />));
    expect(screen.queryByLabelText("Archive") != null).toBe(hasArchiveButton(kind));
  });

  it("the exemption set is exactly the suggestion pair, and each is archivable (else the exemption is dead)", () => {
    expect([...ARCHIVE_BUTTON_EXEMPT_KINDS].sort()).toEqual(
      ["cutter-suggestion", "revision-suggestion"],
    );
    for (const k of ARCHIVE_BUTTON_EXEMPT_KINDS) expect(isArchivable(k)).toBe(true);
  });

  it("no id → no archive button (a draft has no identity to archive)", () => {
    render(withProvider(makeApi(), <BareCard kind="todo" />));
    expect(screen.queryByLabelText("Archive")).toBeNull();
    expect(screen.getByLabelText("Delete")).toBeTruthy();
  });

  it("no provider → no archive button (tests / Reader)", () => {
    render(<BareCard kind="todo" cardId="c1" />);
    expect(screen.queryByLabelText("Archive")).toBeNull();
  });

  it("an archived card reads Unarchive", () => {
    render(withProvider(makeApi(new Set(["c1"])), <BareCard kind="note" cardId="c1" />));
    expect(screen.getByLabelText("Unarchive")).toBeTruthy();
  });
});

describe("archive button — source census: a trash-bearing PanelCard passes cardId", () => {
  const SRC = join(process.cwd(), "src");
  function walk(dir: string, out: string[] = []): string[] {
    for (const p of walkFiles(dir, { skipDirs: ["__tests__"] })) {
      if (p.endsWith(".tsx")) out.push(p);
    }
    return out;
  }
  // The JSX opening tag of each `<PanelCard …>` — up to the first line that is
  // a bare `>` (every production call site is written that way).
  function openingTags(src: string): string[] {
    const tags: string[] = [];
    for (const m of src.matchAll(/<PanelCard\b/g)) {
      const rest = src.slice(m.index!);
      const end = rest.search(/\n\s*>\s*\n/);
      tags.push(end < 0 ? rest : rest.slice(0, end));
    }
    return tags;
  }

  it("every production <PanelCard onTrashClick=…> also passes cardId", () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const f of walk(SRC)) {
      for (const tag of openingTags(readFileSync(f, "utf8"))) {
        if (!/\bonTrashClick=/.test(tag)) continue;
        seen++;
        if (!/\bcardId=/.test(tag)) offenders.push(relative(SRC, f));
      }
    }
    expect(seen).toBeGreaterThanOrEqual(6); // canary: the scan sees the call sites
    expect(offenders).toEqual([]);
  });
});

describe("archive button — the kinds the audit found (todo, citation)", () => {
  it("TodoRow renders it and routes the click to archive('todo', id)", () => {
    const item = {
      id: "t1",
      text: "x",
      titleAuto: true,
      notes: "",
      done: false,
      aiRequest: false,
      createdAt: "2026-09-28T00:00:00.000Z",
      links: [],
    } as TodoItem;
    cardStore.expand({ kind: "todo", id: "t1" });
    const api = makeApi();
    render(
      withProvider(
        api,
        <TodoRow
          item={item}
          selected={false}
          onToggle={vi.fn()}
          onUpdate={vi.fn()}
          onUpdateNotes={vi.fn()}
          onSetAiRequest={vi.fn()}
          onDelete={vi.fn()}
          onSelect={vi.fn()}
          isAnchored={false}
        />,
      ),
    );
    fireEvent.click(screen.getByLabelText("Archive"));
    expect(api.archive).toHaveBeenCalledWith("todo", "t1");
  });

  const CIT: CitationRef = {
    id: "cit1",
    command: "\\citep{xenakis2020}",
    keys: ["xenakis2020"],
    createdAt: "2026-09-28T00:00:00.000Z",
  };
  function renderCitation(api: CardArchiveActionsApi, isDraft = false) {
    cardStore.expand({ kind: "citation", id: CIT.id });
    render(
      withProvider(
        api,
        <CitationCard
          citation={CIT}
          isSelected={false}
          isDraft={isDraft}
          bibEntries={[]}
          bibPackage="natbib"
          getDisplayText={() => "Xenakis 2020"}
          onSelect={vi.fn()}
          onJump={vi.fn()}
          onUpdateCitation={vi.fn()}
          onDelete={vi.fn()}
        />,
      ),
    );
  }

  it("CitationCard renders it and routes the click to archive('citation', id)", () => {
    const api = makeApi();
    renderCitation(api);
    fireEvent.click(screen.getByLabelText("Archive"));
    expect(api.archive).toHaveBeenCalledWith("citation", "cit1");
  });

  it("an archived citation offers Unarchive (the Archives view's way back)", () => {
    renderCitation(makeApi(new Set(["cit1"])));
    expect(screen.getByLabelText("Unarchive")).toBeTruthy();
  });

  it("a DRAFT citation shows the trash but no archive button", () => {
    renderCitation(makeApi(), true);
    expect(screen.getByLabelText("Delete")).toBeTruthy();
    expect(screen.queryByLabelText("Archive")).toBeNull();
  });
});
