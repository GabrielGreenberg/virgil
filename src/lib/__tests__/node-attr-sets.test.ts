// @vitest-environment jsdom
//
// TASK 343 — the sidecar attr round trip, and the sets that decide it.
//
// The bug this pins: `extractSidecarData` (WRITE) walked the derived
// uuid-bearing set, which includes `exampleBlock`; `mergeSidecarTitles` (READ)
// hand-listed four types. So clicking the title strip above an expex example,
// typing a name and saving wrote the title to `virgil/virgil.json` correctly —
// and the reload refused to look at it, after which the next save serialized
// the now-title-less doc back over the entry. User-typed text destroyed, with
// no warning and no undo. The other four titled kinds behaved, which is what
// made it read as flaky rather than broken.
//
// Three layers, mirroring the fix:
//   1. THE PREMISE (the leg with teeth) — each set equals the set of node types
//      the REAL main-editor schema declares that attr on. The parser and the
//      serializer are TipTap-free by construction and cannot ask the schema, so
//      without this check nothing in the system is entitled to notice that a
//      hand list has gone one member short. A schema addition fails the build.
//   2. THE ROUND TRIP — driven per member OF the set, so the next titled kind
//      cannot be added write-only: it arrives with no fixture and this suite
//      fails before it can ship. The four already-working kinds stay as passing
//      controls, so no leg can pass vacuously.
//   3. THE CENSUS — the `.tex` round-trip layer may not re-hand-list an
//      attr-bearing node-type set. The sets were never the part that could
//      misbehave; a reader that keeps its own copy is.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The extension barrel transitively imports `@/lib/storage` (figure / graphics /
// tex-block NodeViews). Same stub the sibling schema suites use — nothing here
// calls a storage function.
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

import type { JSONContent } from "@tiptap/react";
import { getSchema } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { serializeToLatex, extractSidecarData, assignUuids } from "@/lib/latex-serializer";
import {
  UUID_BEARING_NODE_TYPES,
  TITLED_NODE_TYPES,
  COLLAPSIBLE_NODE_TYPES,
} from "@/lib/node-attr-sets";
// Comments stripped, string literals KEPT — the drift this census hunts lives
// in literals (`new Set(["paragraph", …])`), so blanking them would make the
// leg unfalsifiable (the task-205 mistake).
import { commentsStripped } from "@/lib/__tests__/_source-scan";

const REPO_ROOT = path.resolve(__dirname, "../../..");

// ── Layer 1 · the premise: the sets ARE the schema ─────────────────────────

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

/** Node type names the REAL main-editor schema declares `attr` on. */
function schemaTypesDeclaring(attr: string): string[] {
  const schema = getSchema(buildEditorExtensions(mainCtx()));
  return Object.entries(schema.nodes)
    .filter(([, type]) => attr in (type.spec.attrs ?? {}))
    .map(([name]) => name)
    .sort();
}

const sorted = (s: ReadonlySet<string>) => [...s].sort();

describe("node-attr-sets · the declared sets equal the real schema", () => {
  it.each([
    ["uuid", UUID_BEARING_NODE_TYPES],
    ["parTitle", TITLED_NODE_TYPES],
    ["collapsed", COLLAPSIBLE_NODE_TYPES],
  ] as const)("%s", (attr, declared) => {
    expect(sorted(declared)).toEqual(schemaTypesDeclaring(attr));
  });

  it("the schema really does declare parTitle on more than the four that worked", () => {
    // A canary for the check above: if `schemaTypesDeclaring` ever silently
    // returned [] (a broken ctx, a renamed spec field), every equality leg
    // would demand the sets be emptied rather than proving anything.
    expect(schemaTypesDeclaring("parTitle")).toContain("exampleBlock");
    expect(schemaTypesDeclaring("parTitle").length).toBeGreaterThan(4);
  });
});

// ── Layer 2 · the round trip, per member OF the set ────────────────────────

const TITLE = "USER TITLE";

/** One minimal top-level node per titled kind. Keyed by node type so the
 *  coverage leg below can demand a fixture for every member of the set. */
const FIXTURES: Record<string, () => JSONContent> = {
  paragraph: () => ({
    type: "paragraph",
    content: [{ type: "text", text: "Alpha body prose." }],
  }),
  bulletList: () => ({
    type: "bulletList",
    content: [
      {
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Bullet one." }] }],
      },
    ],
  }),
  orderedList: () => ({
    type: "orderedList",
    content: [
      {
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Number one." }] }],
      },
    ],
  }),
  texBlock: () => ({
    type: "texBlock",
    attrs: { code: "\\draw (0,0) -- (1,1);" },
  }),
  exampleBlock: () => ({
    type: "exampleBlock",
    attrs: { kind: "single" },
    content: [{ type: "paragraph", content: [{ type: "text", text: "Example body." }] }],
  }),
};

function findByType(node: JSONContent, type: string): JSONContent | null {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const hit = findByType(child, type);
    if (hit) return hit;
  }
  return null;
}

/** One save→reload cycle through the REAL pipeline: the doc is serialized to
 *  `.tex` + a sidecar exactly as `writeDocBundle` does, then re-parsed exactly
 *  as the loader does. Returns the node of `type` as it comes back. */
function saveAndReload(doc: JSONContent, type: string): JSONContent | null {
  assignUuids(doc);
  const tex = serializeToLatex(doc);
  const sidecar = extractSidecarData(doc);
  return findByType(parseLatex(tex, sidecar), type);
}

describe("node-attr-sets · a title survives save → reload → save, per titled kind", () => {
  it("every titled node type has a fixture (a new member cannot ship untested)", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(sorted(TITLED_NODE_TYPES));
  });

  it.each(sorted(TITLED_NODE_TYPES))("%s", (type) => {
    const doc: JSONContent = { type: "doc", content: [FIXTURES[type]()] };
    const seed = findByType(doc, type)!;
    seed.attrs = { ...(seed.attrs ?? {}), parTitle: TITLE };

    // Cycle 1 — the reload. Pre-fix, `exampleBlock` came back with parTitle
    // null here while the other four came back with the title.
    const first = saveAndReload(doc, type);
    expect(first, `${type} vanished from the document entirely`).not.toBeNull();
    expect(first!.attrs?.uuid, `${type} lost its uuid`).toBeTruthy();
    expect(first!.attrs?.parTitle).toBe(TITLE);

    // Cycle 2 — the DESTRUCTION half. The app re-serializes whatever the
    // reload produced, so a title the read dropped is gone from disk on the
    // very next save with nothing left to restore it from.
    const secondDoc: JSONContent = { type: "doc", content: [first!] };
    assignUuids(secondDoc);
    const secondSidecar = extractSidecarData(secondDoc);
    const uuid = first!.attrs!.uuid as string;
    expect(secondSidecar.paragraphs[uuid]?.title).toBe(TITLE);
    expect(saveAndReload(secondDoc, type)!.attrs?.parTitle).toBe(TITLE);
  });
});

describe("node-attr-sets · collapsed survives the same cycle, per collapsible kind", () => {
  it("every collapsible node type has a fixture", () => {
    for (const type of COLLAPSIBLE_NODE_TYPES) {
      expect(FIXTURES[type], `no fixture for collapsible kind ${type}`).toBeTruthy();
    }
  });

  it.each(sorted(COLLAPSIBLE_NODE_TYPES))("%s", (type) => {
    const doc: JSONContent = { type: "doc", content: [FIXTURES[type]()] };
    const seed = findByType(doc, type)!;
    seed.attrs = { ...(seed.attrs ?? {}), collapsed: true, parTitle: TITLE };

    const back = saveAndReload(doc, type);
    expect(back!.attrs?.collapsed).toBe(true);
    expect(back!.attrs?.parTitle).toBe(TITLE);
  });
});

describe("node-attr-sets · a non-titled type is not stamped", () => {
  it("a stale sidecar title keyed to a heading's uuid is ignored on restore", () => {
    // The symmetry rule read the other way: the write side no longer emits a
    // title for a type that cannot declare one, and the read side no longer
    // stamps one. A blob written by an older build (or hand-edited) must not
    // put an undeclared attr onto a heading.
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A section" }] },
      ],
    };
    assignUuids(doc);
    const heading = findByType(doc, "heading")!;
    const uuid = heading.attrs!.uuid as string;
    const tex = serializeToLatex(doc);

    const back = parseLatex(tex, { paragraphs: { [uuid]: { title: "STALE" } } });
    expect(findByType(back, "heading")!.attrs?.parTitle).toBeUndefined();
  });
});

// ── The same class, one branch over: assignUuids mints by DEFAULT ──────────

describe("node-attr-sets · assignUuids mints for every uuid-bearing type", () => {
  it.each(sorted(UUID_BEARING_NODE_TYPES).filter((t) => FIXTURES[t]))(
    "%s reaching the save path uuid-less is HEALED, not destroyed",
    (type) => {
      // Pre-fix, `assignUuids` minted from a hand list of seven that omitted
      // `texBlock` and `exampleItem`. A uuid-less texBlock then serialized as
      // `%!vtex:begin ` with an empty id, which the parser cannot match: the
      // block came back as a latexComment plus a paragraph whose raw LaTeX had
      // been run through smart typography (`--` → `–`). Silent destruction of
      // the user's own passthrough source.
      const doc: JSONContent = { type: "doc", content: [FIXTURES[type]()] };
      assignUuids(doc);
      expect(findByType(doc, type)?.attrs?.uuid, `${type} was minted no uuid`).toBeTruthy();

      const back = saveAndReload(doc, type);
      expect(back, `${type} did not survive the round trip`).not.toBeNull();
    },
  );

  it("the mint set is DERIVED — no uuid-bearing type is hand-skipped", () => {
    // Every uuid-bearing type except `paragraph` (whose identity is
    // conditional: non-empty, not inside a container) must mint unconditionally.
    // Driven per type through the real function, so a future hand list re-added
    // here fails whichever member it forgets.
    const POLICY = new Set(["paragraph"]);
    for (const type of UUID_BEARING_NODE_TYPES) {
      if (POLICY.has(type)) continue;
      const node: JSONContent = { type, content: [{ type: "paragraph" }] };
      assignUuids({ type: "doc", content: [node] });
      expect(node.attrs?.uuid, `assignUuids skipped ${type}`).toBeTruthy();
    }
  });
});

// ── Layer 3 · the census: the .tex layer keeps no second copy ──────────────

describe("node-attr-sets · the round-trip layer holds no second hand list", () => {
  // Scope: the two TipTap-free files that own the sidecar `paragraphs`
  // vocabulary — `mergeSidecarTitles` is the only reader of a sidecar title in
  // `src/`, and `extractSidecarData` / `recoverOrphanedUuids` the only writers,
  // so this is exactly the surface where a re-derived list can do the damage.
  const FILES = ["src/lib/latex-parser.ts", "src/lib/latex-serializer.ts"];

  /** Bracketed literal lists naming >= 3 distinct titled node types. That is
   *  what an alternation / array / Set of attr-bearing kinds looks like; the
   *  legitimate `CONTAINER_TYPES` sets (bulletList, orderedList, blockquote)
   *  name two and answer a different question, so they are below the needle
   *  rather than allowlisted out of it. */
  function handListsIn(rel: string): string[] {
    const src = commentsStripped(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
    const hits: string[] = [];
    // No `s` flag needed (and the tsconfig target forbids it): the negated
    // class already spans newlines.
    for (const m of src.matchAll(/\[[^[\]]{0,600}\]/g)) {
      const seg = m[0];
      const named = [...TITLED_NODE_TYPES].filter((t) => seg.includes(`"${t}"`));
      // The stripper removes comment bytes rather than blanking them, so a line
      // number computed here would drift; report the literal itself instead.
      if (named.length >= 3) hits.push(`${rel} → ${seg.replace(/\s+/g, " ").slice(0, 120)}`);
    }
    return hits;
  }

  it("neither file re-lists the titled node types", () => {
    expect(FILES.flatMap(handListsIn)).toEqual([]);
  });

  it("the census can see such a list when there is one (canary)", () => {
    // Against a synthetic fixture, never a production line: a canary standing
    // on the defect evaporates the moment the defect is drained.
    const fixture = commentsStripped(
      'const TITLED = new Set(["paragraph", "bulletList", "orderedList", "texBlock"]);',
    );
    const named = [...TITLED_NODE_TYPES].filter((t) => fixture.includes(`"${t}"`));
    expect(named.length).toBeGreaterThanOrEqual(3);
  });

  it("both readers import the SSOT", () => {
    for (const rel of FILES) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      expect(src, `${rel} does not read @/lib/node-attr-sets`).toContain(
        '@/lib/node-attr-sets',
      );
    }
  });

  it("the leaf stays import-free", () => {
    // The placement rule `latex-markers.ts` earned: a facet the layer that
    // needs it cannot import will be re-copied. An import here is the first
    // step back toward a module the parser cannot take.
    const src = commentsStripped(
      fs.readFileSync(path.join(REPO_ROOT, "src/lib/node-attr-sets.ts"), "utf8"),
    );
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
