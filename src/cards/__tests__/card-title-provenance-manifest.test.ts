/**
 * The registry → Python card-writer pin (T6/C12 title provenance).
 *
 * `titleAuto` records WHETHER a card's title was machine-supplied, so the
 * shape heuristic `isAutoTitle` (`^<Label> <digits>$`) does not have to guess.
 * That heuristic is DEMOTED — provably ambiguous — and survives only as the
 * one-time legacy fallback inside `resolveLoadedTitle`, for records written
 * before the bit existed. The demotion holds only while every CURRENT writer
 * stamps the bit, and the app is not the only writer: `editor/scripts/*.py`
 * writes the same sidecars.
 *
 * `editor/scripts/card_titles.json` is the PROJECTION of
 * `CARD_REGISTRY[kind].titleLabel` those scripts read (through
 * `_common.title_fields`). This test forbids the two from drifting: a registry
 * edit that adds or removes an auto-titling kind must classify it there —
 * either in `titleField` (naming the record field the bit governs) or in
 * `exempt` (with the reason its record has no such field) — or this fails.
 *
 * Its Python sibling `editor/scripts/tests/test_card_title_provenance.py` runs
 * the real writers and asserts the records they emit carry the bit. Together
 * they close the cross-language contract: what must be stamped, and that it is.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_KINDS } from "@/cards/predicates";

const here = dirname(fileURLToPath(import.meta.url));
// src/cards/__tests__ → repo root → editor/scripts/card_titles.json
const manifestPath = join(here, "../../..", "editor/scripts/card_titles.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  titleField: Record<string, string>;
  exempt: Record<string, string>;
};

const autoTitlingKinds = CARD_KINDS.filter(
  (k) => CARD_REGISTRY[k].titleLabel != null,
).sort();

describe("card_titles.json manifest ↔ CARD_REGISTRY", () => {
  it("classifies exactly the auto-titling kinds the registry declares", () => {
    const classified = [
      ...Object.keys(manifest.titleField),
      ...Object.keys(manifest.exempt),
    ].sort();
    expect(classified).toEqual(autoTitlingKinds);
  });

  it("no kind is both field-bearing and exempt", () => {
    const both = Object.keys(manifest.titleField).filter(
      (k) => k in manifest.exempt,
    );
    expect(both).toEqual([]);
  });

  it("no non-auto-titling kind leaks into the manifest", () => {
    for (const kind of [
      ...Object.keys(manifest.titleField),
      ...Object.keys(manifest.exempt),
    ]) {
      expect(CARD_REGISTRY[kind as keyof typeof CARD_REGISTRY].titleLabel).toBeTruthy();
    }
  });

  it("every exemption states its reason", () => {
    for (const [kind, reason] of Object.entries(manifest.exempt)) {
      expect(typeof reason, kind).toBe("string");
      expect(reason.length, kind).toBeGreaterThan(40);
    }
  });

  it("names the record field the bit governs — `text` for a todo, `title` elsewhere", () => {
    // The one kind whose "title" is its BODY (src/lib/types.ts → TodoItem):
    // getting this wrong is how an agent todo reading "Task 2" lost its body.
    expect(manifest.titleField.todo).toBe("text");
    for (const [kind, field] of Object.entries(manifest.titleField)) {
      if (kind === "todo") continue;
      expect(field, kind).toBe("title");
    }
  });
});
