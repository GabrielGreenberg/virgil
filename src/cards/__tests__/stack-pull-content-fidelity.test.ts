// @vitest-environment jsdom
/**
 * Task 330 — a pull delivers the user's writing, and the HOST cannot quietly
 * stop delivering it.
 *
 * Two legs, at the two places the pre-330 loss lived. The chain is
 * snapshot → spec → host → hook, and it was complete at the first two links and
 * lossy at the last two: `snapshotCard` deep-clones the whole record, three of
 * the spec's arms passed it whole — and then the spec's OTHER arms narrowed it
 * (`{ title, content }`, `{ text }`) and the ONE host implementation hand-copied
 * a few names out of whatever reached it.
 *
 *   • THE SPEC LEG drives the REAL `applyDrop` against a recording
 *     `StackPullApi` and asserts the SEED each factory receives already carries
 *     every field the registry calls content. This is what a narrowing arm
 *     fails.
 *
 *   • THE CENSUS is the leg with teeth, and it is aimed at the host — because
 *     the factories were never the part that could misbehave; a call site that
 *     picks fields out of the seed instead of forwarding it is. No type can see
 *     that: `notesHook.addNote(paragraphId, seed.content)` type-checks
 *     perfectly, and it IS the defect. The hook doors' own behaviour is pinned
 *     separately, against the real hooks, in
 *     `hooks/__tests__/stack-pull-seed-doors.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { readStackItemMock } = vi.hoisted(() => ({ readStackItemMock: vi.fn() }));
vi.mock("@/hooks/useStack", () => ({ readStackItem: readStackItemMock }));

import { CARD_REGISTRY } from "../card-registry";
import {
  CARD_KIND_BY_STACK_CARD_KIND,
  STACK_CARD_KINDS,
  type StackCardKind,
  type StackItem,
} from "@/lib/stack/types";
import {
  POPULATED_SNAPSHOT_DATA,
  UNCARRIABLE_CONTENT_FIELDS,
  asRecord,
  declaredContentFields,
} from "@/lib/stack/__tests__/_pull-fixtures";
import { stackPullDropSpec } from "@/components/drop-mode/specs/stack-pull";
import type { DropCtx, Placement, StackPullApi } from "@/components/drop-mode/types";

const SRC = join(process.cwd(), "src");

function demandedFields(kind: StackCardKind): string[] {
  const exempt = new Set(UNCARRIABLE_CONTENT_FIELDS[kind] ?? []);
  return declaredContentFields(
    CARD_REGISTRY[CARD_KIND_BY_STACK_CARD_KIND[kind]].content,
  ).filter((f) => !exempt.has(f));
}

// ── The spec leg ──────────────────────────────────────────────────────
describe("the seed reaching each factory is the whole surviving record", () => {
  /** The last argument every factory received, keyed by method. */
  const seenSeed = new Map<string, Record<string, unknown>>();
  const mainEditor = {} as unknown as import("@tiptap/react").Editor;
  const rec =
    (method: string) =>
    (...args: unknown[]) => {
      seenSeed.set(method, args[args.length - 1] as Record<string, unknown>);
      return { id: "new" } as never;
    };
  const stack: StackPullApi = {
    addNote: rec("addNote"),
    addHighlight: rec("addHighlight"),
    addTodo: rec("addTodo"),
    addArchive: rec("addArchive"),
    addRevisionComment: rec("addRevisionComment"),
    addRevisionSuggestion: rec("addRevisionSuggestion"),
    addCutterComment: rec("addCutterComment"),
    addCutterSuggestion: rec("addCutterSuggestion"),
    addFootnote: rec("addFootnote"),
    addCitation: rec("addCitation"),
    upsertBibEntry: rec("upsertBibEntry"),
    getAnnotation: () => "",
    setAnnotation: rec("setAnnotation"),
  };
  const ctx = { mainEditor, stack } as unknown as DropCtx;
  const placement = {
    kind: "between-blocks",
    editor: mainEditor,
    insertPos: 0,
  } as unknown as Placement;

  beforeEach(() => {
    seenSeed.clear();
  });

  it.each([...STACK_CARD_KINDS])(
    "%s: the factory is handed every declared content field",
    (cardKind) => {
      readStackItemMock.mockReturnValue({
        id: "item-1",
        capturedAt: "2026-08-15T00:00:00.000Z",
        source: { docId: null },
        payload: {
          kind: "card",
          card: { cardKind, data: POPULATED_SNAPSHOT_DATA[cardKind] },
        },
      } as unknown as StackItem);

      stackPullDropSpec.applyDrop(placement, "stack-pull:item-1", ctx);

      const seeds = [...seenSeed.entries()].filter(([m]) => m !== "setAnnotation");
      expect(seeds, `${cardKind}: no factory ran`).not.toHaveLength(0);
      const seed = seeds[0][1];
      const source = asRecord(POPULATED_SNAPSHOT_DATA[cardKind]);
      for (const f of demandedFields(cardKind)) {
        expect(
          seed[f],
          `${cardKind}: the spec narrowed the seed and dropped "${f}"`,
        ).toEqual(source[f]);
      }
    },
  );

  it("the seed is still stripped of the source doc's state", () => {
    // The spec must pass the record WHOLE and STRIPPED, not raw: a factory
    // handed `links` or an `applied` status could file the new card against a
    // paragraph uuid — or a `.tex` splice — that belongs to another document.
    readStackItemMock.mockReturnValue({
      id: "item-1",
      capturedAt: "2026-08-15T00:00:00.000Z",
      source: { docId: null },
      payload: {
        kind: "card",
        card: {
          cardKind: "revision-suggestion",
          data: POPULATED_SNAPSHOT_DATA["revision-suggestion"],
        },
      },
    } as unknown as StackItem);

    stackPullDropSpec.applyDrop(placement, "stack-pull:item-1", ctx);

    const seed = seenSeed.get("addRevisionSuggestion")!;
    expect(seed.id).toBeUndefined();
    expect(seed.links).toBeUndefined();
    expect(seed.status).toBeUndefined();
    expect(seed.appliedChange).toBeUndefined();
  });
});

// ── The census ────────────────────────────────────────────────────────
describe("the host FORWARDS the seed — it never picks fields out of it", () => {
  /**
   * `dropStackApi` is the ONE `StackPullApi` implementation in the app, and it
   * is where every one of the reported losses actually happened. The needle is
   * a MEMBER READ on the seed, because that is the shape of the defect: a copy
   * list omits silently, and an omitted field is indistinguishable from one
   * that does not exist.
   *
   * Exemptions are per LINE (a marker on the read or the line above it), never
   * per file — a file-scoped one would excuse the next factory written beside
   * the two that legitimately carry it.
   */
  const MARKER = "stack-pull-seed-exempt:";
  const READ = /\bseed\.\w+/;

  function dropStackApiRegion(): string[] {
    const src = readFileSync(join(SRC, "components/EditorPane.tsx"), "utf8");
    const start = src.indexOf("const dropStackApi");
    expect(start, "dropStackApi was renamed or moved — retarget this census").toBeGreaterThan(0);
    const end = src.indexOf("\n  }, [", start);
    expect(end, "could not find the end of the dropStackApi useMemo").toBeGreaterThan(start);
    return src.slice(start, end).split("\n");
  }

  /** Lines that are wholly comment (the region is heavily commented prose). */
  const isComment = (line: string) => /^\s*(\/\/|\/?\*)/.test(line);

  it("no factory reads a field off its seed, except the two exempt lines", () => {
    const lines = dropStackApiRegion();
    const offenders: string[] = [];
    lines.forEach((line, i) => {
      if (isComment(line) || !READ.test(line)) return;
      const exempted =
        line.includes(MARKER) || (i > 0 && lines[i - 1].includes(MARKER));
      if (!exempted) offenders.push(line.trim());
    });
    expect(
      offenders,
      "a stack-pull factory hand-picks fields out of its seed — forward the " +
        "seed whole to the hook's `…FromSeed` door instead (task 330)",
    ).toEqual([]);
  });

  it("the census can SEE a hand-picked read", () => {
    // A census that matched nothing would pass for the wrong reason forever.
    // The canary is synthetic rather than one of the live exempt lines: a
    // canary standing on the very thing the allowlist drains evaporates the
    // moment that line is retired, and keeps passing vacuously.
    const fixture = [
      "      addNote: (paragraphId, seed) =>",
      "        notesHook.addNote(paragraphId, seed.content),",
    ];
    const hits = fixture.filter((l) => !isComment(l) && READ.test(l));
    expect(hits).toHaveLength(1);
  });

  it("the two exemptions are the ones this task justified, and no more", () => {
    const lines = dropStackApiRegion();
    const marked = lines.filter((l) => l.includes(MARKER)).length;
    expect(
      marked,
      "a third `stack-pull-seed-exempt:` appeared — a kind whose record has " +
        "more than one travelling field cannot be exempt, and the reason has " +
        "to be written at the line",
    ).toBe(2);
  });
});
