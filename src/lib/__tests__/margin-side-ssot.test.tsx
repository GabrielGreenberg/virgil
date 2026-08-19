// @vitest-environment jsdom
//
// Task 205 — ONE dock-aware authority for "which side does this card's margin
// chrome live on?"
//
// THE LIVE DEFECT this pins (M2, upgraded from "latent" by the 2026-07-22
// re-audit): the marginalia marker resolved its side dock-aware in the grid
// packer (`m.side ?? panelSides[panelId] ?? <row default>`), while the Mode-A
// anchor RAIL read `link.anchor.margin.side` — a value frozen into the sidecar
// at create time by a hardcoded `inferMarginSide` switch, refreshed by nothing.
// Dock Notes / Todo / Revisions / Cutter to the LEFT (or Reports to the RIGHT)
// and hover a paragraph-anchored card of that kind: the marker sat on the dock
// side and the kind-colored rail painted on the OPPOSITE edge, against
// globals.css's own stated intent ("a kind-colored vertical line on the same
// side as the margin marker").
//
// The first `describe` is the defect-catching leg and it drives the REAL
// reconciler against a REAL editor: pre-fix it reports "right" for a
// left-docked Notes panel, because the stored side knew nothing about docks.
// The rest pin the structure that makes a second answer unavailable — the
// deleted copies stay deleted, the default stays derived, and no surface
// re-spells the ladder.
//
// (Storage stub guards the extension-barrel/@/lib/storage gotcha: the
// figure/graphics/tex NodeViews transitively import @/lib/storage.)
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import fs from "node:fs";
import path from "node:path";
// The one-pass comment/literal scanner this census introduced (task 205).
// It now lives in a shared helper: task 227's action-context census is its
// THIRD caller, and a routine whose two prior hand-rolled variants each
// shipped a defect (202b's runaway; this file's own unfalsifiable `orphan`
// leg) gets ONE copy. Behaviour byte-identical; the why-a-scanner doc moved
// with it.
import { codeOnly, commentsStripped } from "./_source-scan";
import { Editor } from "@tiptap/core";
import type { Decoration } from "@tiptap/pm/view";
import { act, renderHook } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { anchorHighlightKey } from "@/lib/tiptap/anchor-highlight-deco";
import { useAnchorHighlightReconciler } from "@/links/_shared/useAnchorHighlightReconciler";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type { EntityCollectionSlots } from "@/cards/entity-collections";
import type { Link } from "@/links/_shared/types";
import {
  defaultMarginSideForPanel,
  marginSideForCardKind,
  marginSideForMarkerType,
  resolveMarginSide,
  type PanelSideMap,
} from "@/lib/margin-side";
import { computeMarkerPositions } from "@/lib/marginalia-grid";
import type { MarginaliaMarker, AnchorNodeMetrics } from "@/lib/marginalia";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import { ALL_MARKER_TYPES, panelForMarkerType } from "@/cards/marker-meta";
import type { CardKind, MarkerType } from "@/cards/types";

const REPO = path.resolve(__dirname, "../../..");
const SRC = path.join(REPO, "src");
const LIB = path.join(REPO, "library");

function walkAny(dir: string, ext: RegExp, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkAny(p, ext, out);
    else if (ext.test(e.name)) out.push(p);
  }
  return out;
}
const walk = (dir: string) => walkAny(dir, /\.(ts|tsx)$/);
// This file is excluded from its own censuses: `codeOnly` deliberately leaves
// REGEX literals alone (a stripper that eats them eats whole files — task
// 202b), so the census's own needles would count as hits.
const SELF = path.join(__dirname, "margin-side-ssot.test.tsx");
const ALL_FILES = [...walk(SRC), ...walk(LIB)].filter((f) => f !== SELF);
const rel = (p: string) => path.relative(REPO, p);
const isTest = (p: string) => /__tests__|\.test\.tsx?$/.test(p);
/** Every censused file, minus the suites — a fixture that mirrors a LEGACY
 *  on-disk sidecar legitimately still carries a `margin` key, and every one of
 *  these names appears in prose explaining its own removal. */
const PROD_FILES = ALL_FILES.filter((f) => !isTest(f));

/** The AGENT silo — `editor/`'s Python writers and the skill markdown that
 *  drives them. It is a THIRD producer of the sidecar shapes `src/` reads, and
 *  the `src/`+`library/` census structurally cannot see it: different root,
 *  different extensions. That blind spot is exactly how a fifth `anchor.margin`
 *  writer survived the first cut of this task. */
const AGENT_FILES = walkAny(path.join(REPO, "editor"), /\.(py|md)$/);

/** Files whose CODE (comments + literals stripped) matches `re`. */
function codeHits(files: string[], re: RegExp): string[] {
  return files
    .filter((f) => re.test(codeOnly(fs.readFileSync(f, "utf8"))))
    .map(rel);
}

/** Files whose code-with-literals-intact (comments stripped) matches `re`. */
function literalHits(files: string[], re: RegExp): string[] {
  return files
    .filter((f) => re.test(commentsStripped(fs.readFileSync(f, "utf8"))))
    .map(rel);
}

const DECL_RE = /^[ \t]*(export[ \t]+)?(default[ \t]+)?(async[ \t]+)?(function|class|interface|type|const|let)[ \t]+[A-Za-z_$]/gm;
const countDecls = (s: string) => (s.match(DECL_RE) ?? []).length;

// ───────────────────────────────────────────────────────────────────────────
// LEG 1 — the defect-catching leg: the REAL reconciler, a REAL editor, a
// left-docked Notes panel.
// ───────────────────────────────────────────────────────────────────────────

const PARA_UUID = "p00001";
const NOTE_ID = "note-1";

function mainCtx(anchored: Set<string>): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: anchored },
    host: null,
  };
}

function mountEditor(): { editor: Editor; element: HTMLElement } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx(new Set([PARA_UUID]))),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: PARA_UUID },
          content: [{ type: "text", text: "a plain paragraph here." }],
        },
      ],
    },
  });
  return { editor, element };
}

/** A `note` collection carrying ONE Mode-A (paragraph) anchor link — the shape
 *  `findEntity`/`resolveLink` read, and the one that reaches the reconciler's
 *  `resolved.kind === "paragraph"` branch where the rail side is decided.
 *  Note it carries NO stored margin side: that field is gone. */
function modeANoteCollections(): EntityCollectionSlots {
  const link: Link = {
    id: `${NOTE_ID}@${PARA_UUID}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: [PARA_UUID],
    },
    target: { type: "card", ref: { kind: "note", id: NOTE_ID } },
    createdAt: "",
  };
  return {
    notes: [{ id: NOTE_ID, links: [link] }],
    highlights: [],
    cutterCards: [],
    comments: [],
    todoItems: [],
    archiveSnippets: [],
    reportCards: [],
    examples: [],
  };
}

async function waitForEditorInit(editor: Editor): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  if (!editor.isInitialized) throw new Error("editor never initialized");
}

/** The `data-margin-side` the plugin currently paints, or null. */
function liveMarginSide(editor: Editor): string | null {
  const set = anchorHighlightKey.getState(editor.state);
  if (!set) return null;
  const found = set.find();
  if (found.length === 0) return null;
  const spec = found[0] as Decoration & {
    type?: { attrs?: Record<string, string> };
  };
  return spec.type?.attrs?.["data-margin-side"] ?? null;
}

/** The side the marginalia GRID gives a `note` marker under the same dock —
 *  the other half of the pair that must agree. */
function markerSideUnderDock(panelSides: PanelSideMap): "left" | "right" {
  const marker: MarginaliaMarker = {
    id: `${NOTE_ID}:${PARA_UUID}`,
    entityId: NOTE_ID,
    entityKind: "note",
    type: "note",
    textObjectId: PARA_UUID,
    // Orphan so the grid needs no live block metrics to place it — it still
    // runs the identical side resolution first (that is the whole point of
    // resolving the side BEFORE the metrics gate).
    unanchored: true,
  };
  const res = computeMarkerPositions(
    () => null as AnchorNodeMetrics | null,
    [marker],
    panelSides,
    // Both lanes host their full column count: this suite is about which SIDE
    // the marker resolves to, not how much of that side's margin the lane gets
    // (the cramped regime, pinned in `marginalia-lane-regime.test.ts`).
    { left: 1, right: 2 },
  );
  return res.orphans[0].side;
}

describe("margin side — the rail follows the DOCK, not a value frozen at create time", () => {
  afterEach(() => {
    act(() => {
      cardStore.setHover(null);
      cardStore.clearSelection();
    });
  });

  it.each([
    ["left-docked Notes", { notes: "left" } as PanelSideMap, "left"],
    ["right-docked Notes", { notes: "right" } as PanelSideMap, "right"],
    ["undocked Notes (registry default)", {} as PanelSideMap, "right"],
  ])(
    "%s → rail and marker agree",
    async (_label, panelSides, expected) => {
      const { editor, element } = mountEditor();
      const collections = modeANoteCollections();
      const recon = renderHook(() =>
        useAnchorHighlightReconciler({
          editor,
          collections,
          store: cardStore,
          panelSides,
        }),
      );
      await waitForEditorInit(editor);
      act(() => {
        cardStore.setHover({ id: NOTE_ID, kind: "note" });
      });
      recon.rerender();

      // The RAIL. Pre-fix this read `link.anchor.margin.side` — always "right"
      // for a note, whatever the dock said — so the left-docked case failed.
      expect(liveMarginSide(editor)).toBe(expected);
      // The MARKER, under the identical dock map. The pair is the contract:
      // one authority means these can never be read apart.
      expect(markerSideUnderDock(panelSides)).toBe(expected);

      recon.unmount();
      editor.destroy();
      element.remove();
    },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// LEG 2 — marker and rail agree for EVERY marker-bearing kind, both docks.
// ───────────────────────────────────────────────────────────────────────────

describe("margin side — one authority, total over the kinds that have chrome", () => {
  const markerBearingKinds = (Object.keys(CARD_REGISTRY) as CardKind[])
    .map((k) => [k, CARD_REGISTRY[k].markerType] as const)
    .filter((pair): pair is readonly [CardKind, MarkerType] => pair[1] != null);

  it("every marker-bearing kind's rail side equals its marker's side, under either dock", () => {
    expect(markerBearingKinds.length).toBeGreaterThan(0);
    for (const [kind, markerType] of markerBearingKinds) {
      const panel = panelForMarkerType(markerType);
      for (const dock of ["left", "right"] as const) {
        const map: PanelSideMap = { [panel]: dock };
        expect(marginSideForCardKind(kind, map)).toBe(dock);
        expect(marginSideForMarkerType(markerType, map)).toBe(dock);
      }
      // Undocked: both fall to the SAME registry default.
      expect(marginSideForCardKind(kind, {})).toBe(
        marginSideForMarkerType(markerType, {}),
      );
    }
  });

  it("the ladder is override > live dock > registry default", () => {
    // A dock the override beats.
    expect(resolveMarginSide("notes", { notes: "left" }, "right")).toBe("right");
    // A dock with no override.
    expect(resolveMarginSide("notes", { notes: "left" })).toBe("left");
    // An explicit `null` dock entry ("not docked") falls through, it does not
    // resolve to a side — the map's own vocabulary allows null.
    expect(resolveMarginSide("notes", { notes: null })).toBe(
      defaultMarginSideForPanel("notes"),
    );
    // Reports defaults RIGHT since task 381 (Gabriel's call). The pinned value
    // moves with the decision, and this is the leg that would catch a registry
    // flip made without the matching defaults-JSON placement.
    expect(resolveMarginSide("reports", {})).toBe("right");
  });

  it("every CardKind resolves to a panel with a NON-NULL registry strip side", () => {
    // This is what makes `defaultMarginSideForPanel`'s `?? \"right\"` an honest
    // documented fallback rather than a silent guess: nothing can reach it.
    // The only registry entry with a null strip side is `omni` (a backdrop, not
    // a strip), and no card kind names it. A future kind that does will fail
    // HERE rather than being quietly railed right while its panel sits left.
    for (const kind of Object.keys(CARD_REGISTRY) as CardKind[]) {
      const panel = CARD_REGISTRY[kind].panel;
      expect(panel, `CardKind "${kind}" declares no panel`).not.toBeNull();
      expect(
        PANEL_REGISTRY[panel!].defaultStripSide,
        `panel "${panel}" (CardKind "${kind}") has a null defaultStripSide`,
      ).not.toBeNull();
    }
    for (const t of ALL_MARKER_TYPES) {
      expect(
        PANEL_REGISTRY[panelForMarkerType(t)].defaultStripSide,
        `markerType "${t}" resolves to a null-strip-side panel`,
      ).not.toBeNull();
    }
  });

  it("the per-kind default table is what ships (a registry move is a visible edit)", () => {
    // Frozen so a `defaultStripSide` flip in PANEL_REGISTRY shows up as a
    // deliberate two-line diff rather than silently relocating every marker and
    // rail of that kind. Derived-ness is the point; unnoticed derived-ness is
    // not.
    const frozen: Record<MarkerType, "left" | "right"> = {
      note: "right",
      archive: "right",
      revision: "right",
      cut: "right",
      todo: "right",
      // RIGHT since task 381 — Gabriel's call, and exactly the deliberate
      // two-line diff this frozen table exists to force.
      report: "right",
      error: "right",
    };
    for (const t of ALL_MARKER_TYPES) {
      expect(marginSideForMarkerType(t, {}), `markerType ${t}`).toBe(frozen[t]);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LEG 3 — the deleted copies stay deleted, and nothing re-spells the ladder.
// ───────────────────────────────────────────────────────────────────────────

describe("margin side — no second speller", () => {
  it("no production code WRITES or READS a stored `anchor.margin`", () => {
    // WIRE-it-or-DELETE-it: the field's one consumer now resolves live, so
    // re-introducing a frozen copy would recreate the exact drift this task
    // removed. Scope is production code, stated honestly: a suite fixture that
    // mirrors a LEGACY on-disk sidecar legitimately still carries the key (and
    // `migrate-card.ts` still DESCRIBES it in its legacy input type, which the
    // optional-key exclusion below allows) — what must not come back is a
    // canonical anchor built with it, or anything reading it.
    const offenders: string[] = [];
    for (const re of [/(?<![?])margin:\s*\{\s*side/, /anchor\.margin\b/]) {
      for (const h of codeHits(PROD_FILES, re)) offenders.push(`${h} — ${re}`);
    }
    expect(offenders).toEqual([]);
  });

  it("`inferMarginSide` is gone", () => {
    expect(codeHits(PROD_FILES, /\binferMarginSide\s*\(/)).toEqual([]);
  });

  it("`MarkerMeta.defaultSide` is gone — the row default lives once, on PANEL_REGISTRY", () => {
    expect(
      codeHits(ALL_FILES, /\.defaultSide\b|^\s*defaultSide[?:]/m),
    ).toEqual([]);
  });

  it("`defaultStripSide` is read only by the margin-side SSOT and the STRIP-placement sites", () => {
    // Since task 381 the column has ONE derived reader — `@/lib/panel-side`,
    // the ladder every side-answering surface enters (the strip icon, the
    // margin marker and rail through `margin-side`, and the omni COLUMN). What
    // remains beside it are sites answering a DIFFERENT question with their own
    // null-handling: "where does this panel's POD open?" — `sideForKind` maps
    // null to "this is a pod, not a strip", `resolveSide` opens a pod on the
    // left. They are allowlisted BY NAME so a future MARGIN surface reading the
    // column directly fails here instead of quietly becoming a fourth copy.
    // The five strip sites do NOT agree on their own last-resort fallback —
    // three answer "left", two "right", for the one panel (`omni`) whose strip
    // side is genuinely null. That is a real latent fork in the SAME policy
    // family, deliberately left alone here: it decides where a POD opens, not
    // where margin chrome paints, and folding it would change omni's open side
    // on a task that has no mandate to. Filed as its own queue item.
    const PERMITTED = new Set([
      // The LADDER — the one derived reader, which `margin-side` (and the strip
      // filter, and the omni column) now delegate to.
      "src/lib/panel-side.ts",
      // Declaration + the table.
      "src/panels/panel-registry.ts",
      // POD filter: a `null` strip side means "presentation pod, never on a
      // strip" — a question about the column's null case, not about a side.
      "src/components/EditorPane.tsx",
      // STRIP placement: which side an OPENED panel docks to.
      "src/hooks/useViewPrefs.ts",
      // STRIP placement: which side a jump-to-card target docks on.
      "src/components/editor-layout/jump-docks.ts",
      // STRIP placement: the open-for-card bridge's home-side fallback.
      "src/components/editor-layout/event-bridges/open-for-card.ts",
    ]);
    const hits = codeHits(PROD_FILES, /\bdefaultStripSide\b/);
    expect(hits.filter((h) => !PERMITTED.has(h))).toEqual([]);
    // BOTH halves. An entry that stops reading the column would otherwise sit
    // there pre-authorizing any future margin-side reader in that file — the
    // silent-exemption shape the task-202 census fixed by checking both
    // directions.
    expect([...PERMITTED].filter((f) => !hits.includes(f))).toEqual([]);
  });


  it("the AGENT silo writes no `margin` key and teaches no `--margin` flag", () => {
    // `editor/scripts/*.py` writes the same sidecar JSON `src/` reads, and the
    // skill markdown tells agents what to pass. Both are outside the src/ +
    // library/ walk above — which is how `create_card.py` kept emitting the
    // field, and four skills kept teaching a `--margin` flag, through the first
    // cut of this task. Raw text, no stripping: Python and Markdown have their
    // own comment grammars and the shapes below don't occur in prose.
    expect(AGENT_FILES.length).toBeGreaterThan(5);
    // Same scope rule as the TS census above: a suite fixture standing in for
    // an EXISTING on-disk sidecar legitimately still carries the legacy key
    // (`editor/scripts/tests/*` build those), so the census is on the writers.
    const writers = AGENT_FILES.filter(
      (f) =>
        !f.includes(`${path.sep}tests${path.sep}`) &&
        /["']margin["']\s*:\s*\{/.test(fs.readFileSync(f, "utf8")),
    ).map(rel);
    expect(writers).toEqual([]);

    // The flag itself survives ONLY where its deprecation is documented: the
    // argparse row that still accepts it (so a stale bundle doesn't crash) and
    // the two docs that say it does nothing. No skill may pass it.
    const FLAG_OK = new Set([
      "editor/scripts/create_card.py",
      "editor/skills/create-card.md",
      "editor/skills/answer-note-request.md",
    ]);
    const teaches = AGENT_FILES.filter((f) =>
      /--margin/.test(fs.readFileSync(f, "utf8")),
    ).map(rel);
    expect(teaches.filter((h) => !FLAG_OK.has(h))).toEqual([]);
  });

  it("every `useAnchorHighlightReconciler` call site passes a LIVE dock map", () => {
    // The type makes `panelSides` required; only a grep can say the production
    // site passes the real map rather than an empty literal. Dropping the map
    // there is the one edit that silently restores the dock-blind rail, and
    // leg 1 could not catch it — it constructs its own args.
    const callers = PROD_FILES.filter((f) => {
      const code = codeOnly(fs.readFileSync(f, "utf8"));
      return (
        /useAnchorHighlightReconciler\s*\(\s*\{/.test(code) &&
        !f.endsWith("useAnchorHighlightReconciler.ts")
      );
    });
    expect(callers.map(rel)).toEqual(["src/components/EditorPane.tsx"]);
    for (const f of callers) {
      const code = codeOnly(fs.readFileSync(f, "utf8"));
      // Slice from the CALL form, not the first mention — the import line
      // comes first and would make this leg read the wrong text entirely.
      const callIdx = code.search(/useAnchorHighlightReconciler\s*\(\s*\{/);
      expect(callIdx, `${rel(f)}: no call form found`).toBeGreaterThan(-1);
      const call = code.slice(callIdx);
      const args = call.slice(0, call.indexOf("});") + 1);
      expect(args, `${rel(f)} passes no panelSides`).toMatch(/panelSides:\s*\w/);
      expect(args, `${rel(f)} passes an EMPTY panelSides`).not.toMatch(
        /panelSides:\s*\{\s*\}/,
      );
    }
  });

  it("the census scans a real file set, and the stripper swallows nothing", () => {
    // A census that silently scans nothing is compliance-shaped and worthless
    // — the same guard `link-surface-honesty.test.ts` carries. And the stripper
    // needs its own leg because a runaway does not FAIL anything: it just
    // shrinks what every other leg looks at (task 202b's regex-literal bug lost
    // 22 files without a single red test).
    expect(ALL_FILES.length).toBeGreaterThan(500);
    // Scoped to production files: a guardrail SUITE legitimately carries
    // declaration-shaped text inside its own needles and allowlists, which the
    // raw count sees and the stripped count (correctly) does not.
    const swallowed: string[] = [];
    for (const f of PROD_FILES) {
      const raw = fs.readFileSync(f, "utf8");
      const before = countDecls(raw);
      const after = countDecls(codeOnly(raw));
      if (after < before) swallowed.push(`${rel(f)} ${before}→${after}`);
    }
    expect(swallowed).toEqual([]);
  });

  it("NOTHING compares an anchor resolution's `source` to \"orphan\"", () => {
    // M1: the marginalia builder used to decide its re-pin-dock flag with a
    // second formula (`resolveCardAnchor(...).source === "orphan"`) beside the
    // `resolveAnchorState` SSOT — a parallel path that, unlike the SSOT, could
    // never see a card's declared intent. `resolve-card-anchor.ts` PRODUCES the
    // rung name and is the only file that may spell it at all; every consumer
    // asks `resolveAnchorState` what "anchored" means, so the comparison form
    // should appear nowhere, producer included.
    // `literalHits`, not `codeHits`: this needle requires the word `orphan`
    // to survive INSIDE its quotes, and the code-only stripper blanks every
    // string. Run against the stripped source the first draft of this leg was
    // green unconditionally — it could not have failed against the very line
    // it was written to catch.
    expect(
      literalHits(PROD_FILES, /(source|rung)\s*===\s*["']orphan["']/),
    ).toEqual([]);
  });
});
