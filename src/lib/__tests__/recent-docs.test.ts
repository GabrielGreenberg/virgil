/**
 * The recents derivation is ONE rule read by two surfaces.
 *
 * Task 352 raised the start screen from 8 rows to 10, and found the row
 * count was the ONLY thing the two recents surfaces did not share: the
 * start screen (`RecentPapersList`) and the tab-strip "+" dropdown
 * (`TabPlusMenu`) had each hand-written the same filter → sort → slice.
 * A behavioural test of the selector cannot see a surface that stops
 * asking it — which is precisely the shape that shipped — so the leg
 * with teeth here is the CENSUS.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import type { FsaDocMeta } from "@/lib/doc-index";
import {
  RECENT_PAPERS_MENU_LIMIT,
  RECENT_PAPERS_START_SCREEN_LIMIT,
  selectRecentDocs,
} from "@/lib/recent-docs";

import { codeOnly } from "./_source-scan";

const SRC = join(process.cwd(), "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

function doc(id: string, lastAccessedAt: string): FsaDocMeta {
  return { id, name: id, lastAccessedAt } as unknown as FsaDocMeta;
}

/** 14 docs, most-recently-accessed FIRST when sorted. */
const DOCS: FsaDocMeta[] = Array.from({ length: 14 }, (_, i) =>
  doc(`d${i}`, new Date(Date.UTC(2026, 0, 20 - i)).toISOString()),
);

describe("selectRecentDocs", () => {
  it("orders by lastAccessedAt, most recent first", () => {
    const shuffled = [DOCS[5], DOCS[0], DOCS[9], DOCS[2]];
    expect(
      selectRecentDocs(shuffled, { limit: 10 }).map((d) => d.id),
    ).toEqual(["d0", "d2", "d5", "d9"]);
  });

  it("drops excluded ids BEFORE taking the limit", () => {
    const rows = selectRecentDocs(DOCS, {
      excludeIds: ["d0", "d1"],
      limit: 3,
    });
    expect(rows.map((d) => d.id)).toEqual(["d2", "d3", "d4"]);
  });

  it("caps at the limit and never mutates its input", () => {
    const input = [...DOCS];
    expect(selectRecentDocs(input, { limit: 4 })).toHaveLength(4);
    expect(input.map((d) => d.id)).toEqual(DOCS.map((d) => d.id));
  });

  it("sorts an unreadable timestamp LAST rather than shuffling", () => {
    const rows = selectRecentDocs(
      [doc("bad", "not-a-date"), DOCS[1], DOCS[0]],
      { limit: 3 },
    );
    expect(rows.map((d) => d.id)).toEqual(["d0", "d1", "bad"]);
  });
});

describe("the two surfaces' row counts", () => {
  it("start screen shows ten, the tab menu five", () => {
    expect(RECENT_PAPERS_START_SCREEN_LIMIT).toBe(10);
    expect(RECENT_PAPERS_MENU_LIMIT).toBe(5);
  });

  it("the start screen list defaults to ten rows", () => {
    // Reads the component's own default through its source, since the
    // default lives in the parameter list and is what the ONE consumer
    // (EditorLayout, which passes no `limit`) inherits.
    const src = codeOnly(read("components/RecentPapersList.tsx"));
    expect(src).toMatch(/limit = RECENT_PAPERS_START_SCREEN_LIMIT/);
    expect(codeOnly(read("components/EditorLayout.tsx"))).not.toMatch(
      /<RecentPapersList[^>]*limit=/,
    );
  });
});

describe("census: no surface re-derives the recents rule", () => {
  const SURFACES = [
    "components/RecentPapersList.tsx",
    "components/TabPlusMenu.tsx",
  ];

  it("every recents surface asks selectRecentDocs", () => {
    for (const rel of SURFACES) {
      expect(codeOnly(read(rel))).toContain("selectRecentDocs(");
    }
  });

  it("no surface hand-writes the lastAccessedAt ordering or its own slice", () => {
    for (const rel of SURFACES) {
      const src = codeOnly(read(rel));
      // The comparator: any file sorting on `lastAccessedAt` itself.
      expect(src).not.toMatch(/\.sort\([\s\S]{0,200}lastAccessedAt/);
      // The cap: a bare row-count literal beside the derivation.
      expect(src).not.toMatch(/\.slice\(0,\s*\d+\)/);
    }
  });

  it("the census can see a re-derivation (canary)", () => {
    const forked = codeOnly(`
      const rows = [...docs]
        .sort((a, b) => new Date(b.lastAccessedAt).getTime() -
                        new Date(a.lastAccessedAt).getTime())
        .slice(0, 8);
    `);
    expect(forked).toMatch(/\.sort\([\s\S]{0,200}lastAccessedAt/);
    expect(forked).toMatch(/\.slice\(0,\s*\d+\)/);
  });
});
