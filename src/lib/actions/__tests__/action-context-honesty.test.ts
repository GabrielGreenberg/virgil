/**
 * ACTION-CONTEXT HONESTY CENSUS — a context field nothing reads is a
 * capability the registry does not own.
 *
 * Task 227's defect in one line: `ActionContext.position` (`ActionPosition =
 * "cursor" | "passage-end"`) was declared with a JSDoc stating a real
 * placement policy ("slash/typed ⇒ cursor; grab footnote/citation ⇒
 * passage-end"), threaded through `EditorActionsHandle.runAction`'s seed,
 * forwarded by the bridge at `EditorPane`, and mirrored by FOUR test
 * harnesses — and **no production caller ever set it and no `run()` ever read
 * it.** Not one site in `src/`, production or test, ever passed a VALUE. The
 * policy it named actually lived hardcoded in the legacy dispatcher
 * (`drag-handle-actions.ts`, the footnote/citation collapse to `range.to`).
 * So the registry advertised itself as the SSOT for placement while placement
 * was decided somewhere else, and the four suites locked in the forwarding of
 * a value nothing produced or consumed — which is exactly what made it read
 * as load-bearing.
 *
 * This is the "dead SSOT" law of AGENTS.md ("A registry earns its name by
 * being read") in its FIELD tense rather than its export tense: the
 * `link-surface-honesty` census asks whether a published symbol is CALLED,
 * and structurally cannot see a declared field that is written but never read.
 *
 * THE RULE, in two halves:
 *
 *   1. Every field declared on `ActionContext` must have at least one
 *      production READ — a `ctx.<field>` / `context.<field>` member access in
 *      non-test `src/` source. A field only ever WRITTEN (built into a ctx
 *      literal, forwarded by the bridge) is dead however many callers
 *      construct it: construction is not consumption, and TypeScript proves
 *      only that it was passed.
 *   2. Every member of `runAction`'s `seed` must NAME an `ActionContext`
 *      field. The seed exists solely to feed the context, so a seed member
 *      with no context counterpart is threading a value into nothing — the
 *      seed can only carry what the context can hold, and rule 1 keeps the
 *      context to what something consumes.
 *
 * Fixing a hit means one of two things, and the choice is a real one:
 *   • the capability was intended → WIRE it (make a `run()` read the field,
 *     and retire whatever hardcoded twin currently decides it);
 *   • the plumbing is vestigial → DELETE the field and its pass-throughs.
 * An allowlist entry is neither; see `PERMITTED_DEAD_CONTEXT_FIELDS`.
 *
 * Why a grep and not a type: a `run()` that ignores a field type-checks
 * exactly like one that honours it. Types say "you may read this"; only
 * source inspection says "somebody has to."
 *
 * ── TWO LIMITS, stated because a guard that overstates its reach is the
 * failure mode this file is about ──
 *
 *   (a) The read needle is NAME-shaped (`ctx.` / `context.`) with no type
 *       resolution, so it is confinable but not exact. Its first version
 *       scoped the search to all of `src/` and was UNSOUND in the permissive
 *       direction: `ActionContext.surface` reported alive off
 *       `editor-extensions.ts`'s `ctx.surface === "float"`, where `ctx` is an
 *       `EditorExtensionsCtx` and the file does not mention `ActionContext` at
 *       all. `readSites` therefore only counts files that REFERENCE
 *       `ActionContext` — a file that reads one is one that types one. A
 *       namesake `ctx` inside such a file can still rescue a dead field
 *       (action-registry.ts already has two: `collectBlockUuids` /
 *       `relocateBlock` take a `ctx: { state }`), which is why field names
 *       here should stay distinctive.
 *   (b) A read spelled by destructuring (`const { payload } = ctx`), through
 *       an aliased binding, or by bracket access would report a LIVE field as
 *       dead. None exists today — every one of the ~30 functions receiving an
 *       `ActionContext` names its parameter `ctx` and none destructures it —
 *       and this direction fails LOUD (a false accusation someone must
 *       investigate), not silent, which is the right way round.
 *
 * `library/` is deliberately not searched: no file under it references
 * `ActionContext`, `action-registry`, or the bridge — verified, and pinned by
 * a leg below so the omission cannot silently become wrong.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { codeOnly } from "@/lib/__tests__/_source-scan";

const REGISTRY = "src/lib/actions/action-registry.ts";
const SRC = "src";
const LIBRARY = "library";

/**
 * Declared `ActionContext` fields with no production reader.
 *
 * The right answer to a hit is WIRE-it or DELETE-it — task 227 deleted two
 * (`position`, `cardLifecycle`). This one entry is a PRE-EXISTING hit the same
 * census surfaced, recorded honestly rather than swept, because retiring it is
 * a materially bigger decision than the two that were: it is the only
 * REQUIRED field in the census, ten production sites write it, and it is a
 * member of the plugin-land `runAction` seed — a documented entrypoint. It is
 * pinned so the set can only SHRINK: a newly-dead field anywhere fails.
 *
 *   `surface` — "which surface invoked this action", so a `run()` can branch
 *   by origin. Its JSDoc names the consumer: `command-input.ts`, a file the
 *   registry's own header records as DELETED through CHIP 7a. The reader was
 *   removed and the field was not. Nothing in the action system has read it
 *   since; the ten writers (EditorLayout, MenuBar, ActionsMenuPanel ×4, the
 *   three block NodeViews, commands.ts, and the bridge's `surface:
 *   seed.surface`) all feed a value nobody consults.
 */
const PERMITTED_DEAD_CONTEXT_FIELDS = new Set<string>(["surface"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.(d\.ts|test\.tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

/** Every production `src/` file, read and stripped ONCE (comments AND string
 *  literals — a field named in prose or inside a literal is not a read; the
 *  sibling `link-surface-honesty` census learned that from a dead export whose
 *  own throw message was otherwise its only "caller"). */
const PROD_SOURCES: ReadonlyArray<readonly [string, string]> = walk(SRC).map(
  (f) => [f, codeOnly(readFileSync(f, "utf8"))] as const,
);

/** Limit (a): only files that reference `ActionContext` can read one. */
const CONTEXT_AWARE = PROD_SOURCES.filter(([, code]) => code.includes("ActionContext"));

/** Top-level members of a brace block at a given indent: the property form
 *  (`foo: T` / `foo?: T`) and the method shorthand (`onFoo(): void`). */
function membersOf(body: string, indent: number): string[] {
  const re = new RegExp(`^ {${indent}}(?:readonly\\s+)?(\\w+)\\??\\s*[:(]`, "gm");
  return [...body.matchAll(re)].map((m) => m[1]);
}

const REGISTRY_CODE = codeOnly(readFileSync(REGISTRY, "utf8"));

function actionContextFields(): string[] {
  const m = REGISTRY_CODE.match(/export interface ActionContext \{([\s\S]*?)\n\}/);
  if (!m) throw new Error("ActionContext interface not found — census is blind");
  return membersOf(m[1], 2);
}

/** The inline `seed: { … }` object type on `EditorActionsHandle.runAction`. */
function runActionSeedFields(): string[] {
  const m = REGISTRY_CODE.match(/runAction\(\s*\n\s*id: ActionId,\s*\n\s*seed: \{([\s\S]*?)\n {4}\},/);
  if (!m) throw new Error("runAction seed type not found — census is blind");
  return membersOf(m[1], 6);
}

function readSites(field: string): string[] {
  const needle = new RegExp(`\\b(?:ctx|context)\\.${field}\\b`);
  return CONTEXT_AWARE.filter(([, code]) => needle.test(code)).map(([f]) => f);
}

describe("action-context honesty — a declared context field nobody reads is dead", () => {
  it("the census can see the two shapes it governs", () => {
    // A regex that silently matched nothing would make every leg below
    // vacuously green. Anchored on fields that cannot plausibly be retired
    // (they are the editor itself), NOT on one the census might flag.
    const fields = actionContextFields();
    expect(fields).toEqual(expect.arrayContaining(["editor", "view", "ref"]));
    expect(fields.length).toBeGreaterThanOrEqual(10);
    expect(runActionSeedFields()).toEqual(["surface", "payload"]);
    // And the read needle must actually find something through the real
    // pipeline — a stripper that blanked the file would report zero for all.
    expect(readSites("cardCreation").length).toBeGreaterThan(0);
  });

  it("every ActionContext field has at least one production read site", () => {
    const dead = actionContextFields().filter(
      (f) => readSites(f).length === 0 && !PERMITTED_DEAD_CONTEXT_FIELDS.has(f),
    );
    expect(dead).toEqual([]);
  });

  it("the allowlist has no stale entries (the census can only shrink)", () => {
    const stillDead = new Set(actionContextFields().filter((f) => readSites(f).length === 0));
    const stale = [...PERMITTED_DEAD_CONTEXT_FIELDS].filter((e) => !stillDead.has(e));
    expect(stale).toEqual([]);
  });

  it("every runAction seed member names an ActionContext field", () => {
    const ctxFields = new Set(actionContextFields());
    const orphaned = runActionSeedFields().filter((f) => !ctxFields.has(f));
    expect(orphaned).toEqual([]);
  });

  it("the two retired fields stay retired (task 227)", () => {
    // Rule 1 would catch a re-add anyway; this leg says WHY in the failure
    // message, because the whole point of the deletion is that the next agent
    // should not re-declare either field ahead of a reader.
    expect(REGISTRY_CODE).not.toMatch(/\bActionPosition\b/);
    expect(REGISTRY_CODE).not.toMatch(/^ {2}position\??\s*:/m);
    expect(REGISTRY_CODE).not.toMatch(/^ {2}cardLifecycle\??\s*:/m);
  });

  it("the library silo has no ActionContext consumer (so skipping it is sound)", () => {
    const hits = walk(LIBRARY).filter((f) => {
      const code = codeOnly(readFileSync(f, "utf8"));
      return /\bActionContext\b/.test(code) || /action-registry/.test(code);
    });
    expect(hits).toEqual([]);
  });

  it("the stripper swallows nothing (task 202b self-check)", () => {
    // The one-pass scanner is shared with the task-205 census, and its known
    // unmodelled construct is the regex literal. If a stray quote ever ate a
    // file, every read site below it would vanish and the census would start
    // ACCUSING live fields — so pin that the registry survives stripping.
    const raw = readFileSync(REGISTRY, "utf8");
    const DECL = /^(export )?(function|const|interface|type) /gm;
    const declsRaw = (raw.match(DECL) ?? []).length;
    const declsCode = (REGISTRY_CODE.match(DECL) ?? []).length;
    expect(declsCode).toBe(declsRaw);
    // A raw byte-ratio would be meaningless here (this file is ~77% JSDoc by
    // design). What models the 202b failure is CONTENT BELOW THE RUNAWAY
    // vanishing, so pin that the LAST declaration in the raw file is still the
    // last one after stripping — a swallow anywhere would truncate the tail.
    const lastRaw = [...raw.matchAll(/^(?:export )?(?:function|const) (\w+)/gm)].pop();
    const lastCode = [...REGISTRY_CODE.matchAll(/^(?:export )?(?:function|const) (\w+)/gm)].pop();
    expect(lastCode?.[1]).toBe(lastRaw?.[1]);
  });
});
