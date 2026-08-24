/**
 * CARD-FLOAT-CTX HONESTY CENSUS — a field on the float context bag that no
 * float reads is a capability the bag does not own.
 *
 * Task 436's defect in one line: `PoppedCardDeps` (re-exported to the card
 * spine as `CardFloatCtx`, and described by its own header as *"the public
 * surface of what a popped-out card needs"*) declared five fields —
 * `aiRequests`, `updateAiRequestText`, `deleteAiRequest`,
 * `updateCutterCommentText`, `updateRevisionCommentText` — that `EditorPane`
 * dutifully populated and **no float has ever read**. The live AI-request path
 * is the separate `AiRequestsProvider`; the two `…CommentText` setters are live
 * in their own panels through their own hooks. Neither ever reached a float.
 *
 * It was not only tidiness. Three of the five were the ONLY reason
 * `aiRequestsHook` sat in the `popoutsDeps` memo's dependency array, so every
 * AI-request change — a checkbox toggle, an `/editor/*` skill's sidecar write
 * landing through the watcher — rebuilt the whole bag, re-resolved every popped
 * key through `resolveFloatable`, re-rendered every open float, and tore down
 * and re-registered the `virgil-stack-drop` window listener (deps
 * `[viewPrefs, popoutsDeps]`). All for three values nothing consumed.
 *
 * This is the task-227 dead-context-field law (`AGENTS.md` → "The field half:
 * a context field is a promise that some `run()` consults it") in its
 * CROSS-TREE tense, and that tense is what needed a new instrument:
 *
 *   > **A field on a context bag is an SSOT only if something READS it.
 *   > Construction is not consumption — and where the readers live in a
 *   > different tree from the declaration, the census that proves it must ask
 *   > about the READERS, not about the declaring file.**
 *
 * `dead-panel-prop-guardrail.test.ts` (task 106) exists for exactly this class
 * and structurally cannot see it, for two independent reasons — and the second
 * is the generalizable one:
 *
 *   • its `ROOTS` are `src/panels` and `src/components/editor-layout/panels`,
 *     and `floating-cards.tsx` sits in neither;
 *   • its rule is per FILE — *"every property declared in a `*Props` interface
 *     appears at least once MORE in its own file."* `PoppedCardDeps` is a pure
 *     type declaration whose consumers live in other trees, so that question
 *     has no useful answer here: every field would flag, dead and live alike.
 *     Widening its roots to cover this file was considered and rejected — it
 *     would blunt the guard that keeps `src/panels/**` drained to EMPTY.
 *
 * Fixing a hit means one of two things, and the choice is a real one:
 *   • the capability was intended → WIRE it (make a float read the field);
 *   • the plumbing is vestigial → DELETE the field and its population line.
 * An allowlist entry is neither; `PERMITTED_DEAD_CTX_FIELDS` starts EMPTY.
 *
 * Why a grep and not a type: a builder that ignores a field type-checks exactly
 * like one that honours it. Types say "you may read this"; only source
 * inspection says "somebody has to."
 *
 * ── THREE LIMITS, stated because a guard that overstates its reach is the
 * failure mode this file is about ──
 *
 *   (a) The population is DISCOVERED, not hand-listed: every production `src/`
 *       file whose stripped code references `CardFloatCtx` / `PoppedCardDeps`.
 *       A hand list of consumer trees could only be missing the tree that
 *       drifted. The DECLARING file is excluded — a declaration is not a read.
 *   (b) The read needle is NAME-shaped (`ctx.` / `cardCtx.`, the two parameter
 *       names every consumer uses) with no type resolution. A namesake `ctx`
 *       inside a type-referencing file could still rescue a dead field, which
 *       is why `deps` is deliberately NOT in the alternation: `EditorPane`,
 *       which imports the type to build the bag, holds a `deps.` bag of its own
 *       whose members include `setSelectedExampleId` — a real `PoppedCardDeps`
 *       field name. This is task 227's own soundness correction, met one bag
 *       over.
 *   (c) A read spelled by destructuring, an aliased binding, or bracket access
 *       would report a LIVE field as dead. None exists today — every consumer
 *       names its parameter and none destructures — and that direction fails
 *       LOUD (a false accusation someone must investigate), not silent.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { codeOnly } from "@/lib/__tests__/_source-scan";

const SRC = "src";
const DECL = "src/components/editor-layout/floating-cards.tsx";
const PANE = "src/components/EditorPane.tsx";

/**
 * Declared `PoppedCardDeps` fields with no float-side reader.
 *
 * EMPTY, and it should stay that way: the right answer to a hit is WIRE-it or
 * DELETE-it. Task 436 deleted five.
 */
const PERMITTED_DEAD_CTX_FIELDS = new Set<string>([]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.(d\.ts|test\.tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

/** Every production `src/` file, read and stripped ONCE — comments AND string
 *  literals, since a field named in prose or inside a literal is not a read. */
const PROD_SOURCES: ReadonlyArray<readonly [string, string]> = walk(SRC).map(
  (f) => [f, codeOnly(readFileSync(f, "utf8"))] as const,
);

/** Limit (a): only a file that TYPES the bag can read one, and the declaration
 *  itself is not a read. */
const CTX_AWARE = PROD_SOURCES.filter(
  ([f, code]) => f !== DECL && /\b(?:CardFloatCtx|PoppedCardDeps)\b/.test(code),
);

const DECL_CODE = codeOnly(readFileSync(DECL, "utf8"));
const PANE_CODE = codeOnly(readFileSync(PANE, "utf8"));

/** Top-level members of the interface body: the property form (`foo: T` /
 *  `foo?: T`) and the method shorthand (`onFoo(): void`). Nested inline object
 *  and multi-line function types sit deeper than 2 spaces and are skipped. */
function ctxFields(): string[] {
  const m = DECL_CODE.match(/export interface PoppedCardDeps \{([\s\S]*?)\n\}/);
  if (!m) throw new Error("PoppedCardDeps interface not found — census is blind");
  return [...m[1].matchAll(/^ {2}(?:readonly\s+)?(\w+)\??\s*[:(]/gm)].map((x) => x[1]);
}

function readSites(field: string): string[] {
  const needle = new RegExp(`\\b(?:ctx|cardCtx)\\.${field}\\b`);
  return CTX_AWARE.filter(([, code]) => needle.test(code)).map(([f]) => f);
}

/** The `popoutsDeps` memo in `EditorPane` — body and dependency array. */
function popoutsDepsMemo(): string {
  const m = PANE_CODE.match(
    /const popoutsDeps = useMemo<PoppedCardDeps>\(([\s\S]*?)\n {2}\);/,
  );
  if (!m) throw new Error("popoutsDeps memo not found — census is blind");
  return m[1];
}

describe("card-float-ctx honesty — a declared context field no float reads is dead", () => {
  it("the census can see the shapes it governs", () => {
    // A regex that silently matched nothing would make every leg below
    // vacuously green. Anchored on fields that cannot plausibly be retired,
    // NOT on ones the census might flag — task 227 learned that the hard way
    // by anchoring its canary on the very field it should have surfaced.
    const fields = ctxFields();
    expect(fields).toEqual(
      expect.arrayContaining(["editorRef", "notes", "citations", "footnotes"]),
    );
    expect(fields.length).toBeGreaterThanOrEqual(80);
    // The consumer population must be non-trivial and must include the file
    // that holds the per-kind builders.
    const aware = CTX_AWARE.map(([f]) => f);
    expect(aware).toEqual(expect.arrayContaining(["src/cards/floats/index.tsx"]));
    expect(aware.length).toBeGreaterThanOrEqual(3);
    // …and the read needle must actually find something through the real
    // pipeline — a stripper that blanked a file would report zero for all.
    for (const anchor of ["editorRef", "notes", "citations"]) {
      expect(readSites(anchor).length).toBeGreaterThan(0);
    }
  });

  it("every PoppedCardDeps field has at least one float-side read site", () => {
    const dead = ctxFields().filter(
      (f) => readSites(f).length === 0 && !PERMITTED_DEAD_CTX_FIELDS.has(f),
    );
    expect(dead).toEqual([]);
  });

  it("the allowlist has no stale entries (the census can only shrink)", () => {
    const stillDead = new Set(ctxFields().filter((f) => readSites(f).length === 0));
    const stale = [...PERMITTED_DEAD_CTX_FIELDS].filter((e) => !stillDead.has(e));
    expect(stale).toEqual([]);
  });

  it("the five retired fields stay retired (task 436)", () => {
    // Rule 1 would catch a re-add anyway; this leg says WHY in the failure
    // message, because the whole point of the deletion is that the next agent
    // should not re-declare one ahead of a reader.
    for (const f of [
      "aiRequests",
      "updateAiRequestText",
      "deleteAiRequest",
      "updateCutterCommentText",
      "updateRevisionCommentText",
    ]) {
      expect(DECL_CODE).not.toMatch(new RegExp(`^ {2}${f}\\??\\s*[:(]`, "m"));
    }
  });

  it("the popoutsDeps memo does not depend on aiRequestsHook", () => {
    // The measurable half of the deletion, and the leg with teeth: re-adding
    // any of the three AI fields would drag `aiRequestsHook` back into this
    // memo, so every AI-request edit would again rebuild the bag and
    // re-resolve every open float. The LIVE per-footnote flags come from
    // `footnoteAiRequests` (a derivation off a different sidecar) and are
    // unaffected — pinned here so the two are not confused.
    const memo = popoutsDepsMemo();
    expect(memo).not.toMatch(/\baiRequestsHook\b/);
    expect(memo).toMatch(/\bfootnoteAiRequests\b/);
  });

  it("the stripper swallows nothing (task 202b self-check)", () => {
    // The one-pass scanner's known unmodelled construct is the regex literal.
    // If a stray quote ever ate a file, every read site below it would vanish
    // and the census would start ACCUSING live fields — so pin that the
    // declaring file survives stripping intact.
    const raw = readFileSync(DECL, "utf8");
    const D = /^(export )?(function|const|interface|type) /gm;
    expect((DECL_CODE.match(D) ?? []).length).toBe((raw.match(D) ?? []).length);
  });
});
