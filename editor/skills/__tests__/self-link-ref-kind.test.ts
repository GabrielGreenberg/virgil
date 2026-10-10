// @vitest-environment node
//
// A card link's `target.ref.kind` is a spine `CardKind` (task 783).
//
// Four responder skills told the agent to write a suggestion card's self-link
// as `"ref": {"kind": "suggestion", …}` — the panel-local RECORD discriminant
// (`CutterSuggestionCard.kind`), not a `CardKind`. The anchor finds its card by
// `linkCardSelector(ref.kind, id)`, so every AI-drafted suggestion's anchor →
// card jump silently matched nothing. `"suggestion"` cannot be crosswalked
// globally (it is ambiguous between the two panels), so the fix is layered:
//   • the write door `apply_response._Txn.append_card` stamps the self-link's
//     spine kind from (panel, record kind) —
//     `editor/scripts/tests/test_self_link_kind.py`;
//   • the read side heals a non-CardKind SELF-link to the loading hook's kind —
//     `src/links/__tests__/migrate-card.test.ts`;
//   • and THIS census: no skill markdown may spell a `ref.kind` that is not a
//     CardKind, so the next hand-restated token cannot drift in again.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CARD_KINDS } from "@/cards/predicates";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillFiles = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"));

/** `"ref": {"kind": "<x>"` in a JSON example, and `target.ref.kind: "<x>"` /
 *  `target.ref.kind` to `"<x>"` in prose. */
const REF_KIND_PATTERNS = [
  /"ref"\s*:\s*\{\s*"kind"\s*:\s*"([^"]+)"/g,
  /ref\.kind`?\s*(?::|to)\s*`?"([^"]+)"/g,
];

function refKinds(): { file: string; kind: string }[] {
  const out: { file: string; kind: string }[] = [];
  for (const file of skillFiles) {
    const src = readFileSync(join(SKILLS_DIR, file), "utf8");
    for (const re of REF_KIND_PATTERNS) {
      for (const m of src.matchAll(re)) out.push({ file, kind: m[1] });
    }
  }
  return out;
}

describe("skill markdown — every link ref.kind is a spine CardKind (task 783)", () => {
  const found = refKinds();

  it("the census patterns still SEE a ref.kind (not vacuous)", () => {
    // Since task 1044 no skill hand-builds a card or its self-link — the
    // proposal family lands through `create_card.py --kind=suggestion|comment`
    // (proposal-builder-door.test.ts forbids the JSON block), so the live
    // population is legitimately empty. Prove the patterns would still catch
    // the next hand-restated token rather than passing over nothing.
    const sample = '"target": { "type": "card", "ref": {"kind": "suggestion", "id": "x"} }';
    const hits = REF_KIND_PATTERNS.flatMap((re) => [...sample.matchAll(re)].map((m) => m[1]));
    expect(hits).toContain("suggestion");
  });

  it("no skill spells a non-CardKind ref.kind token", () => {
    const kinds = new Set<string>(CARD_KINDS);
    const bad = found.filter((f) => !kinds.has(f.kind) && !f.kind.startsWith("<"));
    expect(bad).toEqual([]);
  });
});
