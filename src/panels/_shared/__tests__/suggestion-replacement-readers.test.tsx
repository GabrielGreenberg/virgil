// @vitest-environment jsdom
//
// TASK 958 — every "what will land" read goes through `suggestionReplacement`.
//
// Task 713 made `suggestionReplacement` (user_text || suggested_text) the one
// speller of a suggestion's replacement and moved the apply path onto it. Two
// readers were missed: the COLLAPSED card body (shared by Revisions + Cutter)
// branched on `suggested_text`, so a human revision — seeded
// `suggested_text: ""` — painted the author's own rewrite as a red-italic
// "deletion" of the original; and Cutter's search scanned a hand-kept field
// array that dropped `user_text`. This suite pins both, plus a census so a new
// bare `.suggested_text` read cannot quietly reopen the class.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { walkFiles } from "@/lib/__tests__/_source-scan";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup } from "@testing-library/react";
import { RevisionSuggestionCard } from "@/panels/Revisions/RevisionSuggestionCard";
import { CutterSuggestionCard } from "@/panels/Cutter/CutterSuggestionCard";
import { PendingChangeControllerProvider } from "@/links/pending-change-controller";
import { searchComments, searchCutter } from "@/lib/search-sources";
import type {
  CutterSuggestionCard as CutterSuggestionCardData,
  RevisionSuggestionCard as RevisionSuggestionCardData,
} from "@/lib/types";

type Fixture = RevisionSuggestionCardData | CutterSuggestionCardData;

const FAMILIES = [
  { name: "revisions", Card: RevisionSuggestionCard },
  { name: "cutter", Card: CutterSuggestionCard },
] as const;

function makeCard(over: Partial<Fixture> = {}): Fixture {
  return {
    kind: "suggestion",
    id: "s1",
    createdAt: "2026-10-05T00:00:00.000Z",
    author: "human",
    original_text: "the original passage",
    suggested_text: "",
    explanation: "",
    user_text: "",
    instructions: "",
    status: "pending",
    links: [],
    ...over,
  } as Fixture;
}

const controller = {
  canProduce: true,
  canResolve: true,
  keep: vi.fn(),
  dismiss: vi.fn(),
  previewOriginal: vi.fn(),
  previewSuggested: vi.fn(),
  insertBelow: vi.fn(),
  apply: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
};

function renderCompressed(
  Card: (typeof FAMILIES)[number]["Card"],
  card: Fixture,
) {
  const C = Card as unknown as React.ComponentType<Record<string, unknown>>;
  return render(
    <PendingChangeControllerProvider value={controller}>
      <C
        card={card}
        selected={false}
        onUpdateField={() => {}}
        onConvert={() => {}}
        onDelete={() => {}}
        onSelect={() => {}}
      />
    </PendingChangeControllerProvider>,
  );
}

afterEach(cleanup);

describe("collapsed suggestion body shows what would LAND", () => {
  for (const { name, Card } of FAMILIES) {
    it(`${name}: a human's "Your text" renders as the added text, not a red deletion`, () => {
      const { container } = renderCompressed(
        Card,
        makeCard({ user_text: "my own rewrite" }),
      );
      const added = container.querySelector(".text-emerald-700\\/90");
      expect(added?.textContent).toBe("my own rewrite");
      expect(container.querySelector(".text-red-700\\/70")).toBeNull();
    });

    it(`${name}: a refined AI draft shows the human's text, not the superseded draft`, () => {
      const { container } = renderCompressed(
        Card,
        makeCard({ author: "ai", suggested_text: "ai draft", user_text: "refined" }),
      );
      const added = container.querySelector(".text-emerald-700\\/90");
      expect(added?.textContent).toBe("refined");
    });

    it(`${name}: no replacement at all falls to the → original cue`, () => {
      const { container } = renderCompressed(Card, makeCard());
      expect(container.querySelector(".text-emerald-700\\/90")).toBeNull();
      expect(container.querySelector(".text-red-700\\/70")).not.toBeNull();
    });
  }
});

describe("both families search the same suggestion fields", () => {
  const resolve = () => ({ rows: [], anchored: false });
  const re = /needle/gi;

  it("Cutter search finds a term only present in user_text", () => {
    const hits = searchCutter(
      [makeCard({ user_text: "a needle here" }) as CutterSuggestionCardData],
      resolve as never,
      re,
    );
    expect(hits.length).toBe(1);
  });

  it("every field yields the same hits in both families", () => {
    for (const field of [
      "original_text",
      "suggested_text",
      "explanation",
      "user_text",
      "instructions",
    ] as const) {
      const card = makeCard({ [field]: "needle" });
      const cut = searchCutter([card as CutterSuggestionCardData], resolve as never, re);
      const rev = searchComments([card as RevisionSuggestionCardData], resolve as never, re);
      expect(cut.length, field).toBe(1);
      expect(rev.map((h) => h.field), field).toEqual(cut.map((h) => h.field));
    }
  });
});

// ── Census: no bare `.suggested_text` READ outside the sanctioned sites ──────
//
// The family has an SSOT for "what would land" (`suggestionReplacement`); a new
// per-field read of `suggested_text` is how this class reopens. Sanctioned:
//  - the vocabulary module (the speller itself);
//  - the two loaders + clones (`useRevisions` / `useCutter`: field copies, not
//    "what lands" reads);
//  - the morph's superseded-draft line (it needs the AI draft AS the draft).
const ALLOW = new Set([
  "src/panels/_shared/suggestion-field-vocabulary.ts",
  "src/hooks/useRevisions.ts",
  "src/hooks/useCutter.ts",
  "src/cards/morphs/index.ts",
]);

// The race-proof walk door (task 954) — a per-entry statSync races a file
// vanishing mid-walk.
function walk(dir: string): string[] {
  return walkFiles(dir, { skipDirs: ["__tests__", "node_modules"] }).filter(
    (p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p),
  );
}

describe("census: suggested_text reads go through suggestionReplacement", () => {
  it("no bare .suggested_text read outside the allowlist", () => {
    const root = process.cwd();
    const offenders: string[] = [];
    for (const file of walk(join(root, "src"))) {
      const rel = relative(root, file);
      if (ALLOW.has(rel)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          if (/\.suggested_text\b/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders, "route through suggestionReplacement / SUGGESTION_SEARCH_FIELDS").toEqual([]);
  });

  it("every allowlisted file still reads the field (a stale allowlist entry is dead)", () => {
    for (const rel of ALLOW) {
      expect(readFileSync(join(process.cwd(), rel), "utf8"), rel).toMatch(/\.suggested_text\b/);
    }
  });
});
