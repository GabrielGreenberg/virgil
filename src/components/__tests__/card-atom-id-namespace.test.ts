// @vitest-environment node
//
// Task 1112 — Card-bearing atom ids are ONE namespace across kinds.
//
// A footnote's `footnoteId` and a citation's `citationId` are both 4-hex card
// ids, and the skill executors resolve a card by id ALONE across every sidecar
// (`editor/scripts/card_by_id.py`). The two gesture mints seeded from their own
// kind only — the footnote from the doc's footnote ids, the cite from
// `getCitationIds()` — so a new footnote could take the id a citation already
// held, and every id-only lookup then named two cards. Both now seed from
// `collectAtomIds` (every Card-bearing atom id, footnote-nested cites
// included — task 1074), the same union the paste/pull remint already uses.
//
// The Python half (resolution refuses an ambiguous id; create_card mints in
// the shared namespace) is pinned by editor/scripts/tests/test_card_id_namespace.py.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("card-atom ids — the gesture mints seed from the cross-kind union", () => {
  const editor = read("src/components/Editor.tsx");
  const layout = read("src/components/EditorLayout.tsx");

  it("createEmptyFootnote mints against collectAtomIds, not footnote ids alone", () => {
    const body = editor.slice(editor.indexOf("createEmptyFootnote(opts)"));
    const mint = body.slice(0, body.indexOf("generateShortId(") + 80);
    expect(mint).toContain("generateShortId(collectAtomIds(editor.state.doc))");
  });

  it("the handle's id set IS collectAtomIds (no kind-only getCitationIds)", () => {
    expect(editor).not.toMatch(/getCitationIds/);
    expect(editor).toMatch(/getCardAtomIds\(\): Set<string> \{[\s\S]{0,80}return collectAtomIds\(editor\.state\.doc\);/);
  });

  it("the citation create mints against getCardAtomIds()", () => {
    expect(layout).toContain("generateShortId(handle.getCardAtomIds())");
    expect(layout).not.toMatch(/getCitationIds/);
  });
});
