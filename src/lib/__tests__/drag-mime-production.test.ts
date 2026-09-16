/**
 * **Task 590 — a drag MIME's liveness is checked, not asserted in a comment.**
 *
 * A custom `application/x-virgil-*` DataTransfer type is half a contract: a
 * PRODUCER calls `setData(MIME, …)` and a READER calls `getData` or tests
 * `dt.types`. Deleting the producer leaves the reader type-checking, rendering,
 * and passing every behavioural suite in the repo — because no drag ever
 * arrives to exercise it. The only record of which half survived was a comment
 * beside the reader, and comments rot in exactly the direction that matters:
 *
 * > `StackIcon.tsx`: "today the only live HTML5 producer is `MIME_TEXT_INSERT`
 * > (from external paste / selection sources)"
 *
 * — false when written down the way it mattered (an external app cannot set a
 * custom Virgil MIME) and false outright after `ec382103` removed the last
 * `setData` for it. The handler that comment defended kept only `content[0]` of
 * a multi-block payload and never went through `lib/stack/snapshot.ts`, so it
 * would have been WRONG the day it was revived. `MIME_SELECTION_ANCHOR` went
 * one step further: no producer, no reader, an exported string plus a paragraph
 * describing a gesture nobody built.
 *
 * So `DRAG_MIME_PRODUCTION` states each surviving MIME's answer as DATA and
 * this census checks it against the two silos' real `setData` call sites. The
 * legs with teeth are the two that fail on DRIFT rather than on shape:
 *
 *  - a `produced: true` row whose last producer is deleted (the 590 defect,
 *    caught at the deletion instead of by an audit three months later), and
 *  - a `produced: false` row that gains one (the reader's stale comment gets
 *    fixed at the moment it becomes wrong, not after).
 *
 * Plus the law's own half — **a registry earns its name by being read**: every
 * row must have a READER outside the constants module. A MIME nobody writes and
 * nobody reads is litter, and that is a decision to make out loud.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DRAG_MIME_PRODUCTION,
  type DragMimeProduction,
} from "@/lib/marginalia";
import {
  REPO_ROOT,
  codeOnly,
  codeOnlyLines,
  commentsStripped,
  trackedFiles,
} from "@/lib/__tests__/_source-scan";

const MARGINALIA = path.join(REPO_ROOT, "src/lib/marginalia.ts");
const rel = (abs: string) => path.relative(REPO_ROOT, abs);

/** Both silos' shipped sources, minus tests — and minus the constants module,
 *  which declares the MIMEs and so is neither a producer nor a reader of them. */
function productionFiles(): string[] {
  return [
    ...trackedFiles("src", /\.(ts|tsx)$/),
    ...trackedFiles("library", /\.(ts|tsx)$/),
  ].filter(
    (p) => !/__tests__|\.test\.tsx?$/.test(p) && p !== MARGINALIA,
  );
}

/** `file:line` for every `setData(` whose first argument names `row` — either
 *  the exported constant or the raw MIME string (a producer that inlines the
 *  literal is still a producer). */
function producers(row: DragMimeProduction): string[] {
  const needle = new RegExp(
    `setData\\s*\\(\\s*(?:${row.constant}\\b|["'\`]${row.mime}["'\`])`,
  );
  const hits: string[] = [];
  for (const abs of productionFiles()) {
    // `codeOnly` blanks strings, so match the raw-literal form against the
    // unstripped text and the constant form against code. Both views are
    // needed: the constant must not be matched inside a comment, and the
    // literal cannot survive string-stripping at all.
    const raw = readFileSync(abs, "utf8");
    // LINE-ALIGNED (`codeOnlyLines`, not `codeOnly`): the plain stripper drops
    // comment lines outright, so its indices drift from the file's and every
    // `file:line` this census reports would name the wrong line.
    const lines = raw.split("\n");
    const codeLines = codeOnlyLines(raw).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const inCode = needle.test(codeLines[i] ?? "");
      const asLiteral = new RegExp(
        `setData\\s*\\(\\s*["'\`]${row.mime}["'\`]`,
      ).test(lines[i] ?? "");
      if (inCode || asLiteral) hits.push(`${rel(abs)}:${i + 1}`);
    }
  }
  return hits;
}

/**
 * `file:line` for every place `row` is CONSUMED — a `getData`, a
 * `types.includes`, or membership in one of the two recognizer sets.
 *
 * Membership counts because `ANCHOR_DRAG_TYPES` and `EDITOR_INSERT_DRAG_TYPES`
 * live in the constants module but are read from outside it: that is
 * `MIME_MARGINALIA_MOVE`'s entire remaining job. `DRAG_MIME_PRODUCTION`'s own
 * rows deliberately do NOT count — a registry that vouches for its own members
 * makes the leg vacuous, which is the failure mode this whole suite exists to
 * catch one level up.
 */
function readers(row: DragMimeProduction): string[] {
  const mention = new RegExp(`\\b${row.constant}\\b`);
  const hits: string[] = [];
  for (const abs of productionFiles()) {
    const code = codeOnlyLines(readFileSync(abs, "utf8")).split("\n");
    for (let i = 0; i < code.length; i++) {
      if (mention.test(code[i] ?? "")) hits.push(`${rel(abs)}:${i + 1}`);
    }
  }
  for (const set of ["ANCHOR_DRAG_TYPES", "EDITOR_INSERT_DRAG_TYPES"]) {
    const src = codeOnly(readFileSync(MARGINALIA, "utf8"));
    const at = src.indexOf(`export const ${set}`);
    if (at < 0) continue;
    // Anchor on the `=`, not the declaration start: the type annotation
    // (`readonly string[]`) carries a `]` of its own, and slicing to the first
    // one after the name returns the ANNOTATION rather than the array.
    const open = src.indexOf("[", src.indexOf("=", at));
    const body = src.slice(open, src.indexOf("]", open));
    if (mention.test(body)) hits.push(`src/lib/marginalia.ts:${set}`);
  }
  return hits;
}

describe("DRAG_MIME_PRODUCTION (the drag-MIME liveness registry)", () => {
  it("names every exported MIME constant in src/lib/marginalia.ts", () => {
    const exported = [
      ...readFileSync(MARGINALIA, "utf8").matchAll(
        /export const (MIME_[A-Z_]+)\s*=/g,
      ),
    ].map((m) => m[1]);
    // Non-empty, or the extractor broke and every leg below is vacuous.
    expect(exported.length).toBeGreaterThan(3);
    expect(DRAG_MIME_PRODUCTION.map((r) => r.constant).sort()).toEqual(
      exported.sort(),
    );
  });

  it("has a distinct, correctly-namespaced value per row", () => {
    const values = DRAG_MIME_PRODUCTION.map((r) => r.mime);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v).toMatch(/^application\/x-virgil-/);
  });

  it("states a reason for every row it declares unproduced", () => {
    for (const row of DRAG_MIME_PRODUCTION) {
      if (row.produced) continue;
      expect(
        row.retainedBecause.length,
        `${row.constant} must say why its reader is kept`,
      ).toBeGreaterThan(20);
    }
  });
});

describe("the declaration matches the repo's actual setData call sites", () => {
  it("every `produced: true` MIME has at least one producer", () => {
    const orphaned = DRAG_MIME_PRODUCTION.filter(
      (r) => r.produced && producers(r).length === 0,
    ).map((r) => r.constant);
    expect(
      orphaned,
      "these claim a producer but nothing calls setData for them — either " +
        "restore the producer or flip the row to `produced: false` WITH a " +
        "`retainedBecause`, which is also the moment to fix the reader's " +
        "comment",
    ).toEqual([]);
  });

  it("every `produced: false` MIME has none", () => {
    const revived = DRAG_MIME_PRODUCTION.filter(
      (r) => !r.produced && producers(r).length > 0,
    ).map((r) => `${r.constant} @ ${producers(r).join(", ")}`);
    expect(
      revived,
      "a producer returned for a MIME the registry calls unproduced — flip " +
        "the row to `produced: true` and re-read the reader it feeds, which " +
        "has been unexercised since the old producer was deleted",
    ).toEqual([]);
  });

  it("every MIME is READ somewhere outside the constants module", () => {
    const unread = DRAG_MIME_PRODUCTION.filter(
      (r) => readers(r).length === 0,
    ).map((r) => r.constant);
    expect(
      unread,
      "a drag MIME nobody writes and nobody reads is litter, not a residual " +
        "— delete the constant (this is how MIME_SELECTION_ANCHOR survived)",
    ).toEqual([]);
  });
});

describe("the two readers task 590 deleted stay deleted", () => {
  const dead = "application/x-virgil-text-insert";

  it("no MIME_TEXT_INSERT constant, producer, or reader survives", () => {
    expect(DRAG_MIME_PRODUCTION.map((r) => r.mime)).not.toContain(dead);
    const survivors: string[] = [];
    // COMMENTS-stripped, not code-only: a comment may narrate the deletion as
    // history (`bib-carry.ts` does, so the paragraph that once named this door
    // still explains why removing it was costless), but string literals must
    // survive the strip or a resurrected raw-literal producer would be
    // invisible to this leg.
    for (const abs of [MARGINALIA, ...productionFiles()]) {
      const src = commentsStripped(readFileSync(abs, "utf8"));
      if (src.includes("MIME_TEXT_INSERT") || src.includes(dead)) {
        survivors.push(rel(abs));
      }
    }
    expect(survivors).toEqual([]);
  });

  it("StackIcon has no HTML5 drop door at all", () => {
    const src = readFileSync(
      path.join(REPO_ROOT, "src/components/stack/StackIcon.tsx"),
      "utf8",
    );
    // Every Stack producer is an in-app pointer gesture (the float drag's
    // `virgil-stack-drop`, the content lift's terminal). The icon's job is to
    // publish its rect and light its ring — not to accept a native drop whose
    // payload would bypass `lib/stack/snapshot.ts`.
    const code = codeOnly(src);
    expect(code).not.toMatch(/onDrop\s*=/);
    expect(code).not.toMatch(/onDragOver\s*=/);
    expect(code).not.toMatch(/addStackItem/);
  });

  it("the editor's handleDrop has no text-only insert branch", () => {
    const code = codeOnly(
      readFileSync(path.join(REPO_ROOT, "src/components/Editor.tsx"), "utf8"),
    );
    expect(code).not.toMatch(/textInsertData/);
  });
});
