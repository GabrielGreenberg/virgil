/**
 * The app SSOTs → Python card-table pin (task 885).
 *
 * `editor/scripts/*.py` writes the same sidecars the app does, and used to
 * hand-list four tables that restate app knowledge: which sidecar file + list
 * key each card panel lives in, which panels archive-card admits, which record
 * field(s) `--body` edits per kind, and how a (panel, record) resolves to a
 * card kind. Each matched the app on the day it was typed; nothing noticed when
 * one side moved. (The class bit once: notes was mapped to list-key `notes`
 * while the app reads `cards`, so agent notes landed under a dead key.)
 *
 * Python now LOADS `editor/scripts/card_tables.json`, and this suite pins that
 * file to the app's own tables — so an edit to either side alone fails here.
 * The kind resolution is pinned row-for-row through a corpus both languages
 * run (`editor/scripts/tests/card_kind_cases.json`; the Python leg is
 * `test_self_link_kind.py`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_KINDS, cardKindFromRecord } from "@/cards/predicates";
import type { CardKind } from "@/cards/types";
import type { PanelKind } from "@/panels/_shared/types";
import { ARCHIVE_ORIGIN_PANELS } from "@/lib/archive-origin";
import { SIDECAR_COLLECTIONS } from "@/lib/sidecar-merge";
import { CARD_KIND_SIDECAR } from "@/lib/host-writability";
import { LEGACY_SIDECAR_FILENAMES } from "@/lib/sidecar-value";
import {
  FAMILY_MEANS_DELETION,
  SUGGESTION_BLOCK_TEXT,
} from "@/links/pending-change-actions";

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, "../../..", "editor/scripts");

interface SidecarRow {
  file: string;
  listKey: string;
  writeback: boolean;
  tsPanel: PanelKind;
}
const tables = JSON.parse(
  readFileSync(join(scripts, "card_tables.json"), "utf8"),
) as {
  cardSidecars: Record<string, SidecarRow>;
  archiveOriginPanels: string[];
  bodyFields: { plain: string[]; richOnly: string[]; richMirror: string[] };
  sidecarCollections: Record<string, { key: string; idFields: string[] }[]>;
};
const corpus = JSON.parse(
  readFileSync(join(scripts, "tests/card_kind_cases.json"), "utf8"),
) as {
  cases: {
    panel: string;
    record: { kind?: string };
    cardKind: string;
    spineKind: CardKind;
    tsSkip?: string;
  }[];
};

const rows = Object.entries(tables.cardSidecars);
const panelByFile = new Map(rows.map(([panel, r]) => [r.file, panel]));

/** card_by_id.card_kind keeps the legacy `comment` token for a revisions
 *  comment; every other Python kind token IS the spine kind. */
const pyKind = (k: CardKind): string => (k === "revision-comment" ? "comment" : k);

describe("card_tables.json cardSidecars ↔ the app's sidecar tables", () => {
  it("each row's list key is a record collection the app merges on that file", () => {
    for (const [panel, r] of rows) {
      if (LEGACY_SIDECAR_FILENAMES.includes(r.file)) continue; // retired: no app reader
      const keys = (SIDECAR_COLLECTIONS[r.file] ?? []).map((c) => c.key);
      expect(keys, `${panel} → ${r.file}`).toContain(r.listKey);
    }
  });

  it("covers exactly the files the app's card kinds live in (plus retired ones)", () => {
    const appFiles = new Set(
      Object.values(CARD_KIND_SIDECAR).filter((f): f is string => f != null),
    );
    const live = rows
      .map(([, r]) => r.file)
      .filter((f) => !LEGACY_SIDECAR_FILENAMES.includes(f));
    expect(new Set(live)).toEqual(appFiles);
  });

  it("tsPanel is the panel that owns each kind stored in the file", () => {
    for (const k of CARD_KINDS) {
      const file = CARD_KIND_SIDECAR[k];
      if (file == null) continue;
      const row = tables.cardSidecars[panelByFile.get(file)!];
      expect(row.tsPanel, k).toBe(CARD_REGISTRY[k].panel);
    }
  });

  it("only non-writeback rows may name a retired file", () => {
    for (const [panel, r] of rows) {
      if (LEGACY_SIDECAR_FILENAMES.includes(r.file)) expect(r.writeback, panel).toBe(false);
    }
  });
});

describe("card_tables.json sidecarCollections ↔ SIDECAR_COLLECTIONS", () => {
  // task 941: the writeback's in-pen three-way merge (_common.json_merge3)
  // identity-merges exactly the arrays the app declares — never a shape guess.
  it("is the app's declared record-collection table, verbatim", () => {
    expect(tables.sidecarCollections).toEqual(
      JSON.parse(JSON.stringify(SIDECAR_COLLECTIONS)),
    );
  });
});

describe("card_tables.json archiveOriginPanels ↔ ARCHIVE_ORIGIN_PANELS", () => {
  it("archive-card admits exactly the panels the app can restore into", () => {
    expect([...tables.archiveOriginPanels].sort()).toEqual([...ARCHIVE_ORIGIN_PANELS].sort());
  });

  it("every admitted panel is a writeback sidecar", () => {
    for (const p of tables.archiveOriginPanels) {
      expect(tables.cardSidecars[p]?.writeback, p).toBe(true);
    }
  });
});

describe("card_tables.json bodyFields ↔ CARD_REGISTRY[kind].content", () => {
  // The bucket the registry's content model implies for a kind, or null when
  // the kind has no single plain body (`--body` is refused for it).
  const bucketOf = (k: CardKind): keyof typeof tables.bodyFields | null => {
    const c = CARD_REGISTRY[k].content;
    if (!c) return null;
    if (c.bodyField === "content") return c.textFields.includes("text") ? "richMirror" : "richOnly";
    if (c.bodyField == null && c.textFields[0] === "text") return "plain";
    return null;
  };
  // The panels `update` (edit-card) may write: apply_response's update policy
  // is `_ANCHORED_PANEL_CARDS | {"footnotes"}` — archiveOriginPanels + footnotes.
  const editablePanels = new Set([...tables.archiveOriginPanels, "footnotes"]);
  const pyKindsInBuckets = new Map<string, string>(
    Object.entries(tables.bodyFields).flatMap(([b, ks]) => ks.map((k) => [k, b] as [string, string])),
  );

  it("every Python bucket member is the bucket its registry content model implies", () => {
    for (const k of CARD_KINDS) {
      const bucket = pyKindsInBuckets.get(pyKind(k));
      if (bucket) expect(bucketOf(k), k).toBe(bucket);
    }
    const known = new Set(CARD_KINDS.map(pyKind));
    for (const k of pyKindsInBuckets.keys()) expect(known.has(k), k).toBe(true);
  });

  it("every edit-card-writable kind with a body is in its bucket", () => {
    for (const k of CARD_KINDS) {
      const file = CARD_KIND_SIDECAR[k];
      const panel = file ? panelByFile.get(file) : undefined;
      if (!panel || !editablePanels.has(panel)) continue;
      const want = bucketOf(k);
      if (want) expect(pyKindsInBuckets.get(pyKind(k)), k).toBe(want);
    }
  });
});

describe("card_kind_cases.json ↔ cardKindFromRecord", () => {
  it("the TS resolver agrees with every corpus row it answers", () => {
    let checked = 0;
    for (const row of corpus.cases) {
      if (row.tsSkip) continue;
      const tsPanel = tables.cardSidecars[row.panel]!.tsPanel;
      expect(cardKindFromRecord(row.record, tsPanel), `${row.panel} ${JSON.stringify(row.record)}`).toBe(row.spineKind);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(15);
  });

  it("every row's legacy cardKind is the Python spelling of its spine kind", () => {
    for (const row of corpus.cases) expect(row.cardKind).toBe(pyKind(row.spineKind));
  });

  it("covers every card sidecar panel", () => {
    expect(new Set(corpus.cases.map((r) => r.panel))).toEqual(new Set(Object.keys(tables.cardSidecars)));
  });
});

// Task 957 — the agent's `accept` op refuses an empty replacement for a family
// where empty does not mean a cut. It reads that rule (and the sentence it
// says) from card_tables.json, pinned here to the app's own table.
describe("card_tables.json suggestionLanding ↔ FAMILY_MEANS_DELETION", () => {
  const landing = (
    JSON.parse(readFileSync(join(scripts, "card_tables.json"), "utf8")) as {
      suggestionLanding: {
        familyMeansDeletion: Record<string, boolean>;
        noReplacementText: string;
      };
    }
  ).suggestionLanding;

  it("the family table is FAMILY_MEANS_DELETION, verbatim", () => {
    expect(landing.familyMeansDeletion).toEqual({ ...FAMILY_MEANS_DELETION });
  });

  it("the refusal sentence is the app's no-replacement text", () => {
    expect(landing.noReplacementText).toBe(
      SUGGESTION_BLOCK_TEXT["no-replacement"],
    );
  });
});
