// @vitest-environment jsdom
/**
 * **The Stack's ONE add door, and the census that keeps it one (task 235).**
 *
 * The bib question — "what bibliography does this payload reference, and does
 * it travel?" — is answered at `addStackItem`, once, for every payload family.
 * That placement is the whole fix: a per-helper `CardSnapshotCtx` (the pre-235
 * shape) is answered only by producers that go through `lib/stack/snapshot.ts`,
 * and `StackIcon`'s HTML5 `MIME_TEXT_INSERT` drop hand-builds its payload and
 * never does. The original defect was not a wrong snapshot helper; it was a
 * producer that never asked.
 *
 * So the leg with teeth here is the CENSUS: the door was never the part that
 * could misbehave — a second write door that bypasses it is. `addStackItem`'s
 * REQUIRED second argument closes the realistic route (a producer can't land an
 * item without answering), and the census closes the one types cannot see: a
 * caller that writes the envelope itself spells neither function while doing it.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { addStackItem, readStackItem } from "../useStack";
import { STACK_STORAGE_KEY, type StackItem } from "@/lib/stack/types";
import type { StackBibCtx } from "@/lib/stack/bib-carry";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import type { BibEntry } from "@/lib/types";

const SMITH: BibEntry = {
  uid: "uid-smith",
  key: "smith2020",
  type: "article",
  fields: { title: "On Annotation" },
  raw: "@article{smith2020}",
};

const SOURCE_BIB: StackBibCtx = {
  getBibEntry: (k) => (k === "smith2020" ? SMITH : undefined),
  getAnnotation: (k) => (k === "smith2020" ? "<p>Note.</p>" : ""),
};

function citingItem(id: string): StackItem {
  return {
    id,
    capturedAt: "2026-07-26T00:00:00.000Z",
    source: { docId: "docA" },
    payload: {
      kind: "paragraph",
      node: {
        type: "paragraph",
        content: [
          { type: "citation", attrs: { citationId: "c1", command: "\\citep{smith2020}" } },
        ],
      },
    } as unknown as StackItem["payload"],
  };
}

describe("addStackItem — the bib question is answered at the door", () => {
  beforeEach(() => localStorage.clear());

  it("persists the referenced bibliography alongside a CONTENT payload", () => {
    addStackItem(citingItem("item-1"), SOURCE_BIB);

    const stored = readStackItem("item-1");
    expect(stored?.bib?.entries.map((e) => e.key)).toEqual(["smith2020"]);
    expect(stored?.bib?.annotations).toEqual({ smith2020: "<p>Note.</p>" });
  });

  it("carries nothing for a payload that references nothing", () => {
    const plain = {
      ...citingItem("item-2"),
      payload: {
        kind: "paragraph",
        node: { type: "paragraph", content: [{ type: "text", text: "plain" }] },
      } as unknown as StackItem["payload"],
    };
    addStackItem(plain, SOURCE_BIB);
    expect(readStackItem("item-2")?.bib).toBeUndefined();
  });

  it("a doc with no bibliography ANSWERS (resolvers that resolve nothing)", () => {
    // There is no default to omit: "this doc has no bibliography" and "someone
    // forgot to wire it" must not look the same at the call site.
    addStackItem(citingItem("item-3"), {
      getBibEntry: () => undefined,
      getAnnotation: () => undefined,
    });
    expect(readStackItem("item-3")?.bib).toBeUndefined();
  });

  it("the read door normalizes a blob PERSISTED BY AN OLDER BUILD", () => {
    localStorage.setItem(
      STACK_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        items: [
          {
            id: "legacy-1",
            capturedAt: "2026-07-06T00:00:00.000Z",
            source: { docId: "docA" },
            payload: {
              kind: "card",
              card: {
                cardKind: "bibliography",
                data: SMITH,
                annotation: "<p>Key source.</p>",
              },
            },
          },
        ],
      }),
    );
    expect(readStackItem("legacy-1")?.bib?.annotations).toEqual({
      smith2020: "<p>Key source.</p>",
    });
  });
});

// ── The census ───────────────────────────────────────────────────────
const SRC_ROOTS = ["src", "library"];

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Production sources in both silos — suites and their fixtures excluded, since
 *  a test that plants an envelope is not a producer bypassing the door. */
function productionFiles(): string[] {
  const files: string[] = [];
  for (const root of SRC_ROOTS) {
    try {
      walk(root, files);
    } catch {
      /* a silo that isn't present in this checkout */
    }
  }
  return files.filter((f) => !/__tests__|\.test\.tsx?$/.test(f));
}

describe("census — nothing writes the Stack envelope but the door", () => {
  it("only useStack.ts sets STACK_STORAGE_KEY", () => {
    const offenders = productionFiles().filter((f) => {
      if (f.replace(/\\/g, "/").endsWith("src/hooks/useStack.ts")) return false;
      const src = commentsStripped(readFileSync(f, "utf8"));
      return /setItem\(\s*STACK_STORAGE_KEY/.test(src) || /setItem\(\s*["'`]virgil-stack-v1/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("the census can SEE a write (canary)", () => {
    // Anchored on the door itself, not on the defect: if this stops matching,
    // the needle has drifted and the leg above is passing vacuously.
    const src = commentsStripped(readFileSync("src/hooks/useStack.ts", "utf8"));
    expect(/setItem\(\s*STACK_STORAGE_KEY/.test(src)).toBe(true);
  });

  it("the bib argument is REQUIRED, in the signature as well as the arity", () => {
    // `bib?: StackBibCtx` erases at emit and reports the same `Function.length`
    // while making the obligation optional again — the clampStack lesson
    // (task 273), one door over.
    expect(addStackItem.length).toBe(2);
    const src = readFileSync("src/hooks/useStack.ts", "utf8");
    expect(src).toMatch(/export function addStackItem\(\s*item: StackItem,\s*bib: StackBibCtx,?\s*\)/);
  });
});
