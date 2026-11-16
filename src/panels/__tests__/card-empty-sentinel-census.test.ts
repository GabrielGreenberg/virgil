// @vitest-environment node
//
// Task 1655: the COLLAPSED empty-card sentinel is the twin of the expanded
// placeholder task 825 derived (`cardBodyPlaceholder`). `CardEmptyText` had
// unified its STYLE but took its WORDS as a free `label`, so callers spelled
// them by hand ("empty highlight", "Empty example", "empty suggestion", bare
// "empty") and a collapsed empty note read "empty" beside an "empty
// highlight". The words now derive from the kind's one noun
// (`cardEmptySentinel` → `cardKindNoun`), and this CENSUS pins both halves:
// the derivation for every `CardKind`, and that no source file hands
// `CardEmptyText` a wording of its own.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { cardEmptySentinel, cardKindNoun } from "@/panels/panel-registry";
import type { CardKind } from "@/panels/_shared/types";
import { commentsStripped, walkFiles } from "@/lib/__tests__/_source-scan";

const ROOT = path.resolve(__dirname, "../../..");
const KINDS = Object.keys(CARD_REGISTRY) as CardKind[];

describe("collapsed empty-card sentinel CENSUS (task 1655)", () => {
  it("every kind's sentinel is `empty <noun>` from the one noun", () => {
    for (const k of KINDS) {
      expect(cardEmptySentinel(k), k).toBe(`empty ${cardKindNoun(k, 1)}`);
    }
  });

  it("no caller hands CardEmptyText a wording (only `kind`)", () => {
    const offenders: string[] = [];
    for (const file of walkFiles(path.join(ROOT, "src"), { skipDirs: ["__tests__"] })) {
      if (!/\.tsx?$/.test(file)) continue;
      const src = commentsStripped(readFileSync(file, "utf8"));
      for (const m of src.matchAll(/<CardEmptyText\b([^>]*)\/?>/g)) {
        const attrs = m[1].replace(/\/$/, "").trim();
        if (attrs === "" || /^kind=(?:"[^"]+"|\{[^}]+\})$/.test(attrs)) continue;
        offenders.push(`${path.relative(ROOT, file)}: <CardEmptyText ${attrs}> — pass \`kind\`, never a label`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
