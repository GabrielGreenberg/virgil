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
import { emptyRichContent } from "@/lib/footnote-content";
import { serializeToLatex, extractSidecarData, assignUuids } from "@/lib/latex-serializer";
import {
  UUID_BEARING_NODE_TYPES,
  TITLED_NODE_TYPES,
  COLLAPSIBLE_NODE_TYPES,
  DEFERRING_PARENTS,
  deferringParent,
  EMPTY_WRAPPER_NODE_TYPES,
  jsonCarriesContent,
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

describe("node-attr-sets · DEFERRING_PARENTS is checked against the schema too", () => {
  // Task 346 moved this set here from `anchor-uuid.ts` because the `.tex` layer
  // could not import that module and re-typed the rule three times instead.
  // "Does my inner paragraph defer?" is a POLICY, not an attr, so it cannot be
  // derived from the schema the way the three sets above are — but two things
  // about it can be checked, and both are failures this fork would have shown.
  it("every member is a node type the real schema declares", () => {
    const schema = getSchema(buildEditorExtensions(mainCtx()));
    const unknown = sorted(DEFERRING_PARENTS).filter((n) => !(n in schema.nodes));
    expect(unknown, "a member the schema has never heard of").toEqual([]);
  });

  it("every member that can hold a paragraph is one the editor really defers", () => {
    // The predicate and the set must agree — `deferringParent` is what all
    // three `.tex` walks and every editor surface now ask.
    for (const name of DEFERRING_PARENTS) {
      expect(deferringParent(name), name).toBe(true);
    }
    // …and a container that is NOT a member must not be swept in. `bulletList`
    // is the one worth pinning: it is a DESCEND kind, and conflating the two
    // roles is exactly the taxonomy merge `anchor-resolution.ts` warns against
    // (a list's own child is a `listItem`, and it is the ITEM that absorbs the
    // paragraph).
    for (const name of ["bulletList", "orderedList", "figureBlock", "doc"]) {
      expect(deferringParent(name), name).toBe(false);
    }
    expect(deferringParent(null)).toBe(false);
    expect(deferringParent(undefined)).toBe(false);
  });

  it("`codeBlock` is inert here, and that is recorded rather than asserted away", () => {
    // A `codeBlock`'s content is TEXT, not paragraphs, so this member can never
    // fire. It is pre-existing, harmless, and left alone — but stating it stops
    // a future reader from inferring that every member is load-bearing, and
    // stops a "tidy-up" from deleting a member on the theory that it must be.
    const schema = getSchema(buildEditorExtensions(mainCtx()));
    expect(schema.nodes.codeBlock.spec.content ?? "").not.toContain("paragraph");
  });
});

describe("node-attr-sets · EMPTY_WRAPPER_NODE_TYPES is checked against the schema", () => {
  // Task 401. The blind-set inversion: everything carries content EXCEPT the
  // empty structural wrappers a blank document is made of. An allowlist can be
  // checked; the denylist it replaces could only ever be missing the tenth atom.
  // Two things about the members are derivable and both are failures the
  // pre-401 walker would have shown.

  it("every member is a node type the real schema declares", () => {
    const schema = getSchema(buildEditorExtensions(mainCtx()));
    const unknown = sorted(EMPTY_WRAPPER_NODE_TYPES).filter((n) => !(n in schema.nodes));
    expect(unknown, "a wrapper the schema has never heard of").toEqual([]);
  });

  it("the set IS the node types a BLANK body is made of", () => {
    // The definition, checked against the shipped constructor rather than
    // restated. `emptyRichContent()` is what every card body and every new
    // footnote starts as, so if its shape ever changes the wrapper set must
    // move with it — otherwise the four delete doors begin confirming on every
    // blank card and no pristine card is ever reaped again.
    const names = new Set<string>();
    const walk = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      const node = n as { type?: string; content?: unknown[] };
      if (node.type) names.add(node.type);
      for (const c of node.content ?? []) walk(c);
    };
    walk(emptyRichContent());
    expect([...names].sort()).toEqual(sorted(EMPTY_WRAPPER_NODE_TYPES));
  });

  it("every member is a CONTAINER, never an atom or a leaf", () => {
    // A wrapper carries nothing by ITSELF, which for the schema means it is a
    // node whose meaning is entirely its children. An atom or a leaf is the
    // opposite — its payload is its attrs — so naming one here is the category
    // error that would make the walker blind to exactly the class task 401 is
    // about. (`doc` is `block+`, so "can be empty" is NOT the property: it
    // cannot be, and it is still a pure container.)
    const schema = getSchema(buildEditorExtensions(mainCtx()));
    for (const name of EMPTY_WRAPPER_NODE_TYPES) {
      const type = schema.nodes[name];
      expect(type.isAtom, `${name} is an atom — its payload is its attrs`).toBe(false);
      expect(type.isLeaf, `${name} is a leaf — it has no children to carry meaning`).toBe(false);
    }
  });

  it("every NON-member of the live schema is reported as content", () => {
    // The direction with the consequences. A node type the walker does not
    // recognize must default to CONTENT, because the four card-delete doors and
    // the footnote pristine reap read this answer before destroying the only
    // copy of the user's writing. Swept over the whole live vocabulary, so a
    // new node kind is covered by shipping rather than by a fixture.
    const schema = getSchema(buildEditorExtensions(mainCtx()));
    const missed = Object.keys(schema.nodes).filter((name) => {
      if (EMPTY_WRAPPER_NODE_TYPES.has(name)) return false;
      if (name === "text") return false; // answered by its own `text` field
      return !jsonCarriesContent({ type: "doc", content: [{ type: name }] });
    });
    expect(missed, "a schema node type the content gate cannot see").toEqual([]);
  });

  it("a wrapper carrying a parTitle is NOT empty (the same disease, one level in)", () => {
    // Derived from TITLED_NODE_TYPES rather than re-listed: `paragraph` is both
    // a wrapper and a titled type, and a title is user-authored content that
    // lives in an attr — exactly what the walker exists to see.
    expect(EMPTY_WRAPPER_NODE_TYPES.has("paragraph")).toBe(true);
    expect(TITLED_NODE_TYPES.has("paragraph")).toBe(true);
    expect(
      jsonCarriesContent({ type: "doc", content: [{ type: "paragraph", attrs: { parTitle: "Intro" } }] }),
    ).toBe(true);
    // …while identity and view state on a wrapper are NOT content.
    expect(
      jsonCarriesContent({
        type: "doc",
        content: [{ type: "paragraph", attrs: { uuid: "abcd", parTitle: null } }],
      }),
    ).toBe(false);
  });
});

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
  forestBlock: () => ({
    type: "forestBlock",
    attrs: { source: "\\begin{forest}\n[S\n  [NP]\n  [VP]\n]\n\\end{forest}" },
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
  /** Every production `.ts`/`.tsx` in either silo. */
  function productionFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === "__tests__") continue;
          walk(rel);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          out.push(rel);
        }
      }
    };
    walk("src");
    walk("library");
    return out;
  }

  /**
   * The scope is DISCOVERED, not hand-listed: every file that touches a sidecar
   * `paragraphs` map is asked the question. A hand list would have been the
   * defect one level up — it could only speak for the files someone remembered,
   * which is exactly how the read set went one member short in the first place.
   * Today this resolves to the parser and the serializer; a third reader is
   * censused the day it appears rather than the day someone updates a list.
   */
  const readers = productionFiles().filter((rel) =>
    /\.paragraphs\b|paragraphs\[/.test(
      commentsStripped(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")),
    ),
  );

  /**
   * Statement-shaped segments naming >= 3 distinct titled node types.
   *
   * Splitting on `;{}` is what makes this see a `||` CHAIN and a `case` run,
   * not just a bracketed array — and that matters because the two hand lists
   * this task deleted had different SHAPES: the read set was
   * `new Set([...])` and `assignUuids`' was `a === "x" || a === "y" || …`.
   * A needle that only matched brackets would have been blind to the second
   * defect in the very commit that fixed it. A membership test lives inside one
   * expression (no `;` or brace); a dispatch `switch` puts statements between
   * its cases, so it splits and falls below the threshold.
   *
   * The legitimate `CONTAINER_TYPES` sets (bulletList / orderedList /
   * blockquote) name two titled types and answer a different question, so they
   * sit below the needle rather than in an allowlist.
   */
  function handListsIn(rel: string): string[] {
    const src = commentsStripped(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
    const hits: string[] = [];
    for (const seg of src.split(/[;{}]/)) {
      const named = [...TITLED_NODE_TYPES].filter((t) => seg.includes(`"${t}"`));
      if (named.length < 3) continue;
      const flat = seg.replace(/\s+/g, " ").trim();
      if (PERMITTED_TYPE_LISTS.some((frag) => flat.includes(frag))) continue;
      // The stripper removes comment bytes rather than blanking them, so a line
      // number computed here would drift; report the segment itself instead.
      hits.push(`${rel} → ${flat.slice(0, 140)}`);
    }
    return hits;
  }

  /**
   * Allowlisted per SEGMENT CONTENT, never per file — a file-scoped entry would
   * excuse the next hand list added beside it, which is the shape task 204
   * names. One entry, and it is not a membership test at all: it classifies
   * which parsed children an expex EXAMPLE BODY may hold, so its answer has
   * nothing to do with which types carry an attr.
   *
   * Task 350 C moved that classifier from an inline `||` chain to the
   * `EXAMPLE_BODY_ACCEPTS` table (three targets, read off the expex schemas),
   * so the entry follows it. The justification is unchanged and the old
   * fragment is GONE from source rather than kept alongside — a stale
   * allowlist entry is an exemption nobody is watching.
   */
  const PERMITTED_TYPE_LISTS = [
    'block: new Set([ "paragraph", "exampleGloss", "bulletList", "orderedList", "graphicsBlock", "displayMath", ])',
  ];

  it("the discovered reader set is non-empty (the census can see anything at all)", () => {
    // Without this, a broken walk or a renamed accessor would empty the scope
    // and every leg below would pass by looking at nothing.
    expect(readers).toContain("src/lib/latex-parser.ts");
    expect(readers).toContain("src/lib/latex-serializer.ts");
  });

  it("no sidecar-paragraph reader re-lists the titled node types", () => {
    expect(readers.flatMap(handListsIn)).toEqual([]);
  });

  it("the census sees BOTH hand-list shapes this task deleted (canary)", () => {
    // Synthetic fixtures, never a production line: a canary standing on the
    // defect evaporates the moment the defect is drained.
    const asArray = 'const TITLED = new Set(["paragraph", "bulletList", "orderedList", "texBlock"]);';
    const asChain =
      'if (node.type === "paragraph" || node.type === "bulletList" || node.type === "orderedList") return;';
    for (const fixture of [asArray, asChain]) {
      const flagged = commentsStripped(fixture)
        .split(/[;{}]/)
        .some(
          (seg) => [...TITLED_NODE_TYPES].filter((t) => seg.includes(`"${t}"`)).length >= 3,
        );
      expect(flagged, `census blind to: ${fixture}`).toBe(true);
    }
  });

  it("every reader IMPORTS the SSOT (not merely mentions its path)", () => {
    // A `toContain("@/lib/node-attr-sets")` over raw source is satisfied by a
    // comment saying "mirrors @/lib/node-attr-sets — keep in sync", which is
    // the fork this whole task exists to prevent. So: comments stripped, and a
    // real import statement binding at least one of the three names.
    for (const rel of readers) {
      const src = commentsStripped(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
      const importsSsot = /import\s*(type\s*)?\{[^}]*\}\s*from\s*["']@\/lib\/node-attr-sets["']/.test(
        src,
      );
      expect(importsSsot, `${rel} does not import @/lib/node-attr-sets`).toBe(true);
      const binds = ["UUID_BEARING_NODE_TYPES", "TITLED_NODE_TYPES", "COLLAPSIBLE_NODE_TYPES"].some(
        (n) => src.includes(n),
      );
      expect(binds, `${rel} imports the SSOT but binds none of its names`).toBe(true);
    }
  });

  it("the leaf stays import-free", () => {
    // The placement rule `latex-markers.ts` earned: a facet the layer that
    // needs it cannot import will be re-copied. Three shapes, because two of
    // them defeat the obvious `^\s*import\s` needle while creating exactly the
    // edge this forbids: a re-export is a static dependency edge that starts
    // with `export`, and `await import("…")` has no space after `import` — and
    // the second, aimed back at the serializer, would be a cycle into the very
    // layer the leaf exists to stay below.
    const src = commentsStripped(
      fs.readFileSync(path.join(REPO_ROOT, "src/lib/node-attr-sets.ts"), "utf8"),
    );
    expect(src, "static import").not.toMatch(/^\s*import\s/m);
    expect(src, "re-export edge").not.toMatch(/^\s*export\s[^;]*\bfrom\s*["']/m);
    expect(src, "dynamic import").not.toMatch(/\bimport\s*\(/);
  });

  it("the MINT question is covered behaviourally, where a grep cannot reach", () => {
    // Stated rather than implied. `assignUuids`' hand list named only ONE
    // titled type (`exampleBlock`), so the census above is structurally blind
    // to it — a titled-name needle cannot see a uuid-bearing-name list, and
    // widening it to all sixteen names flags every legitimate content
    // classifier in these two files (measured: seven sites).
    //
    // So that half is guarded by BEHAVIOUR instead, in the sibling suite: the
    // predicate/mutator equivalence is swept per uuid-bearing type, driven from
    // this same SSOT. That catches a re-derived list in EITHER function, which
    // is strictly stronger than a grep — and it is what caught the real one
    // (`needsUuidWork`, the save-path gate, still on the pre-343 list).
    const sibling = fs.readFileSync(
      path.join(REPO_ROOT, "src/lib/__tests__/latex-serializer-needs-uuid-work.test.ts"),
      "utf8",
    );
    expect(sibling).toContain("UUID_BEARING_NODE_TYPES");
    expect(sibling).toContain("@/lib/node-attr-sets");
  });
});
