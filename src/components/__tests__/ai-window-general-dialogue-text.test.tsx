// @vitest-environment jsdom
//
// Task 627 — the AI window's "General dialogue" Submit must actually carry the
// user's question.
//
// The defect was a PLACEHOLDER THAT TYPE-CHECKS. The composer speaks `string`;
// the revisions store's `addComment` speaks `JSONContent`; no plain→rich
// constructor was published, so the host wiring papered the mismatch over with
//
//     addComment={(opts) => revisionsHook.addComment(null, opts.text ? undefined : undefined)}
//
// — a ternary whose two arms are the same value. `tsc` is happy, lint is happy,
// no test could see it, and the only witness was the runtime: the composer
// cleared and closed as if the request had been filed, while `content ===
// undefined` sent the store down BOTH empty branches at once —
// `pristine.markNew` (so the blank card is discarded on click-away) and a
// skipped `bridgeComment` (so no row ever reached `ai-requests.json` and no
// skill could serve the request). The one composer kind that is nothing BUT
// free prose was the one whose prose was dropped on the floor.
//
// The fix is three-legged and this suite has one describe per leg:
//   1. `richFromPlainText` — the missing constructor, now published beside its
//      inverse `richJsonToPlainText`;
//   2. the AIWindow prop is a required positional `string`, so a handler that
//      ignores the text can no longer be written (the old one no longer even
//      type-checks: `opts` is the string);
//   3. the store commits + bridges a text-seeded comment at birth, and the
//      inbox row shows the user's own words.
//
// Plus a census for the BUG CLASS itself: an identical-arm conditional
// anywhere in `src/`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import type { JSONContent } from "@tiptap/react";
import type { AiRequest, AiRequestsState } from "@/lib/types";

/* ── storage stub: an in-memory sidecar disk that records every write ──── */
const DISK: Record<string, unknown> = {};
const writes: Array<{ file: string; data: unknown }> = [];

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async (_docId: string, file: string, dflt: unknown) =>
    file in DISK ? DISK[file] : dflt,
  ),
  readSidecarIfExists: vi.fn(async (_docId: string, file: string) =>
    file in DISK ? DISK[file] : undefined,
  ),
  writeSidecar: vi.fn(async (_handle: unknown, file: string, data: unknown) => {
    DISK[file] = data;
    writes.push({ file, data });
  }),
  mutateSidecar: vi.fn(
    async (
      _handle: unknown,
      file: string,
      dflt: unknown,
      mutate: (current: unknown) => unknown,
    ) => {
      const next = mutate(file in DISK ? DISK[file] : dflt);
      if (next === null) return null;
      DISK[file] = next;
      writes.push({ file, data: next });
      return next;
    },
  ),
}));

import AIWindow, { buildRequests, type AIWindowProps } from "@/components/AIWindow";
import {
  richFromPlainText,
  richJsonToPlainText,
  emptyRichContent,
  normalizeRichContent,
} from "@/lib/footnote-content";
import { useRevisions } from "@/hooks/useRevisions";
import { usePristineCardManager } from "@/hooks/usePristineCardManager";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";
import { trackedFiles, codeOnlyLines, REPO_ROOT } from "@/lib/__tests__/_source-scan";

const QUESTION = "why does §3 contradict §1?";

beforeEach(() => {
  __resetForTests();
  for (const k of Object.keys(DISK)) delete DISK[k];
  writes.length = 0;
});
afterEach(() => cleanup());

function lastAiRequests(): AiRequestsState | undefined {
  return [...writes].reverse().find((w) => w.file === "ai-requests.json")
    ?.data as AiRequestsState | undefined;
}

/* ─────────────────────────────────────────────────────────────────────────
   LEG 1 — the missing constructor
   ───────────────────────────────────────────────────────────────────────── */

describe("richFromPlainText — the plain→rich door the seam was missing", () => {
  it("wraps a line of prose as a paragraph whose text is the string verbatim", () => {
    expect(richFromPlainText(QUESTION)).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: QUESTION }] },
      ],
    });
  });

  it("round-trips through its inverse, richJsonToPlainText", () => {
    for (const s of [QUESTION, "one\ntwo\nthree", "a single line"]) {
      expect(richJsonToPlainText(richFromPlainText(s))).toBe(s);
    }
  });

  it("makes newlines sibling paragraphs (the shape the inverse joins with \\n)", () => {
    const doc = richFromPlainText("first\n\nthird");
    expect(doc.content).toHaveLength(3);
    expect(doc.content?.[1]).toEqual({ type: "paragraph" }); // the blank line
    // The blank paragraph is REAL in the stored body (it is what the card
    // editor renders). The inverse is a lossy PROJECTION — it collapses runs of
    // newlines — so the round trip is exact for prose without blank lines and
    // blank-line-collapsing otherwise. Stated, not assumed.
    expect(richJsonToPlainText(doc)).toBe("first\nthird");
  });

  it("an empty / whitespace-only string yields emptyRichContent (the pristine shape)", () => {
    expect(richFromPlainText("")).toEqual(emptyRichContent());
    expect(richFromPlainText("   \n  ")).toEqual(emptyRichContent());
  });

  it("does NOT sniff the string as HTML — angle brackets a human typed survive", () => {
    // The distinction from `normalizeRichContent`, which is right for a STORED
    // value of unknown provenance and wrong for text just typed: `a<b>c` is a
    // comparison, and the HTML walker eats it.
    const typed = "is a<b>c on this reading?";
    expect(richJsonToPlainText(richFromPlainText(typed))).toBe(typed);
    expect(richJsonToPlainText(normalizeRichContent(typed))).not.toBe(typed);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   LEG 2 — the composer really hands the text over
   ───────────────────────────────────────────────────────────────────────── */

function props(over: Partial<AIWindowProps> = {}): AIWindowProps {
  const noop = () => undefined;
  return {
    open: true,
    onClose: noop,
    bibReviewRequests: [],
    bibEntryRequests: [],
    comments: [],
    bibEntries: [],
    panelAiRequests: [],
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
    addComment: noop,
    refreshAll: noop,
    ...over,
  };
}

/** Open the "+" composer and type `text` into its textarea. */
function openComposerAndType(text: string): HTMLTextAreaElement {
  fireEvent.click(screen.getByText("New request"));
  const ta = document.querySelector("textarea") as HTMLTextAreaElement;
  expect(ta).toBeTruthy();
  fireEvent.change(ta, { target: { value: text } });
  return ta;
}

/* ─────────────────────────────────────────────────────────────────────────
   LEG 3 — an empty list is not an empty INBOX (task 679)
   ───────────────────────────────────────────────────────────────────────── */

describe("the request list distinguishes 'empty' from 'not read'", () => {
  const EMPTY_COPY = /No requests yet/;

  it("a resolved, successful read with nothing in it says so", () => {
    render(<AIWindow {...props()} />);
    expect(screen.getByText(EMPTY_COPY)).toBeTruthy();
  });

  it("an UNRESOLVED read does not claim the inbox is empty", () => {
    // `panelAiRequests` is the pre-load default here, not the file.
    render(<AIWindow {...props({ panelAiRequestsLoaded: false })} />);
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it("a FAILED read does not invite a duplicate filing", () => {
    // The defect: the inbox file three writers share could hold a queue, and the
    // window was telling the user "No requests yet. Use the form above to start
    // one." — an invitation to re-file a request that already exists on disk.
    render(
      <AIWindow
        {...props({
          panelAiRequestsLoaded: true,
          panelAiRequestsLoadError: true,
        })}
      />,
    );
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(screen.getByText(/couldn't read this paper's request list/)).toBeTruthy();
  });
});

describe("the General dialogue composer hands its text to the store", () => {
  it("Submit calls addComment with the typed string ITSELF", () => {
    const addComment = vi.fn();
    render(<AIWindow {...props({ addComment })} />);
    openComposerAndType(QUESTION);
    fireEvent.click(screen.getByText("Submit"));

    expect(addComment).toHaveBeenCalledTimes(1);
    // The whole defect in one assertion: the argument IS the question. The old
    // `(opts: { text?: string })` bag is what let the host drop it.
    expect(addComment).toHaveBeenCalledWith(QUESTION);
  });

  it("Cmd/Ctrl+Enter files the same string", () => {
    const addComment = vi.fn();
    render(<AIWindow {...props({ addComment })} />);
    const ta = openComposerAndType(QUESTION);
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    expect(addComment).toHaveBeenCalledWith(QUESTION);
  });

  it("trims the text it hands over", () => {
    const addComment = vi.fn();
    render(<AIWindow {...props({ addComment })} />);
    openComposerAndType(`  ${QUESTION}  `);
    fireEvent.click(screen.getByText("Submit"));
    expect(addComment).toHaveBeenCalledWith(QUESTION);
  });

  it("files nothing for whitespace only", () => {
    const addComment = vi.fn();
    render(<AIWindow {...props({ addComment })} />);
    const ta = openComposerAndType("   ");
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    expect(addComment).not.toHaveBeenCalled();
  });

  it("the composer closes and clears only AFTER the text has been handed over", () => {
    const seen: string[] = [];
    render(<AIWindow {...props({ addComment: (t) => seen.push(t) })} />);
    openComposerAndType(QUESTION);
    fireEvent.click(screen.getByText("Submit"));
    // Composer is back to its collapsed affordance…
    expect(screen.getByText("New request")).toBeTruthy();
    // …and the prose is not lost with it.
    expect(seen).toEqual([QUESTION]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   LEG 3 — the store commits + bridges it, and the inbox shows the words
   ───────────────────────────────────────────────────────────────────────── */

describe("a text-seeded general comment is committed at birth and servable", () => {
  it("round-trips the text, carries the rich twin, is NOT pristine, and bridges", async () => {
    const DOC = "doc-627";
    beginDocPipeline(DOC);
    const mgr = renderHook(() => usePristineCardManager());
    const pristine = mgr.result.current.forKind("revisions");
    const { result } = renderHook(() => useRevisions(DOC, pristine));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    // Exactly EditorPane's wiring (EditorPane.tsx:3849) — the manager holds the
    // Set, the hook owns the removal.
    pristine.registerDiscard((cid) => result.current.deleteCard(cid));

    let id = "";
    await act(async () => {
      // Exactly what the host now passes.
      id = result.current.addComment(null, richFromPlainText(QUESTION)).id;
    });

    const card = result.current.cards.find((c) => c.id === id) as {
      text: string;
      content: JSONContent;
      aiRequest?: boolean;
    };
    expect(card.text).toBe(QUESTION);
    expect(richJsonToPlainText(card.content)).toBe(QUESTION);
    expect(card.aiRequest).toBe(true);

    // Committed at birth → survives a click-away.
    expect(pristine.isPristine(id)).toBe(false);
    await act(async () => {
      result.current.discardPristineCards();
    });
    expect(result.current.cards.some((c) => c.id === id)).toBe(true);

    // …and the request really reached `ai-requests.json`, so a skill can serve it.
    await waitFor(() => expect(lastAiRequests()?.requests ?? []).toHaveLength(1));
    expect(lastAiRequests()!.requests[0].text).toContain(QUESTION);
  });

  it("the OLD behaviour is the control: an undefined body is pristine AND unbridged", async () => {
    const DOC = "doc-627-control";
    beginDocPipeline(DOC);
    const mgr = renderHook(() => usePristineCardManager());
    const pristine = mgr.result.current.forKind("revisions");
    const { result } = renderHook(() => useRevisions(DOC, pristine));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    // Exactly EditorPane's wiring (EditorPane.tsx:3849) — the manager holds the
    // Set, the hook owns the removal.
    pristine.registerDiscard((cid) => result.current.deleteCard(cid));

    let id = "";
    await act(async () => {
      id = result.current.addComment(null, undefined).id; // what the ternary produced
    });
    expect(pristine.isPristine(id)).toBe(true);
    expect(lastAiRequests()).toBeUndefined();
    await act(async () => {
      result.current.discardPristineCards();
    });
    expect(result.current.cards.some((c) => c.id === id)).toBe(false);
  });

  it("the inbox row carries the user's own words (hasUserText, Open bucket)", () => {
    const rows = buildRequests({
      bibReviewRequests: [],
      bibEntryRequests: [],
      comments: [
        {
          kind: "comment",
          id: "c1",
          createdAt: "2026-01-01T00:00:00.000Z",
          text: QUESTION,
          content: richFromPlainText(QUESTION),
          aiRequest: true,
          links: [],
        },
      ],
      panelAiRequests: [],
      cancelBibReview: () => {},
      removeEntryRequest: () => {},
      deletePanelAiRequest: () => {},
      clearLinkedAiRequest: () => {},
      cardLinkResolves: () => true, // task 697
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("revision-general");
    expect(rows[0].hasUserText).toBe(true);
    expect(rows[0].snippet).toBe(QUESTION);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   THE BUG CLASS — an identical-arm conditional is invisible to every tool
   but this one
   ───────────────────────────────────────────────────────────────────────── */

/** `cond ? X : X` for a simple X (identifier / member path / literal) — the
 *  shape that compiles, lints and tests clean while meaning "ignore cond".
 *
 *  The leading guards keep the `?` a TERNARY: never the second `?` of `??`,
 *  never a `?.` optional chain. Without them the scan reads
 *  `card ? getTextAnchor(card)?.anchorId ?? null : null` as an identical-arm
 *  hit — the nullish default and the ternary's else arm are both `null`, while
 *  the arms themselves differ. Four such lines in `src/links` were this
 *  census's first-draft false positives. */
const IDENTICAL_ARM =
  /(?<![?.])\?(?![?.])\s*(undefined|null|true|false|-?\d+(?:\.\d+)?|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*:\s*\1\s*(?=[,;)\]}\n]|$)/;

function offendingLines(src: string): number[] {
  const out: number[] = [];
  codeOnlyLines(src)
    .split("\n")
    .forEach((line, i) => {
      if (IDENTICAL_ARM.test(line)) out.push(i + 1);
    });
  return out;
}

describe("census: no conditional in src/ has two identical arms", () => {
  it("the detector sees the exact shape the defect wore (canary)", () => {
    expect(
      offendingLines("addComment(null, opts.text ? undefined : undefined)"),
    ).toEqual([1]);
    expect(offendingLines("x ? a.b : a.b;")).toEqual([1]);
    // …and does not fire on an honest ternary.
    expect(offendingLines("addComment(null, opts.text ? rich(opts.text) : undefined)")).toEqual([]);
    expect(offendingLines("const v = flag ? left : right;")).toEqual([]);
    // `??` is not a ternary `?`, and `?.` is not one either — the shape four
    // real `src/links` lines wear.
    expect(offendingLines("return card ? getTextAnchor(card)?.anchorId ?? null : null;")).toEqual([]);
    expect(offendingLines("x ?? null")).toEqual([]);
    // Comments are stripped before the scan, so prose describing the shape
    // (this file's own header, for one) is out of population.
    expect(offendingLines("// was `opts.text ? undefined : undefined`")).toEqual([]);
  });

  it("has an allowlist that is EMPTY", () => {
    const offenders: string[] = [];
    for (const abs of trackedFiles("src", /\.(ts|tsx)$/)) {
      const rel = path.relative(REPO_ROOT, abs);
      if (rel.includes("__tests__")) continue; // this file's own canary strings
      for (const line of offendingLines(fs.readFileSync(abs, "utf8"))) {
        offenders.push(
          `${rel}:${line} — both arms of this conditional are the same value, so the condition is dead. If a value is genuinely missing, write the constructor (see richFromPlainText, task 627) rather than a placeholder that type-checks.`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   THE WIRING — the host really passes the composer's string through
   ───────────────────────────────────────────────────────────────────────── */

describe("the host wiring converts rather than discards", () => {
  it("EditorPane's AIWindow addComment prop routes the text through richFromPlainText", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "src/components/EditorPane.tsx"),
      "utf8",
    );
    const m = src.match(/addComment=\{([\s\S]*?)\n\s*\}\n/);
    expect(m, "EditorPane still wires an addComment prop into AIWindow").toBeTruthy();
    expect(m![1]).toContain("richFromPlainText");
    expect(offendingLines(m![1])).toEqual([]);
  });
});
