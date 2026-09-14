/**
 * TASK 568 — the preamble stash is consumed by a LANDED write, never by an
 * attempt: the CENSUS.
 *
 * `useDocument.pendingDelimitersRef` is the only durable copy of a code-pane
 * preamble edit until a write lands. The behavioural suite
 * (`useDocument.delimiters-stash.test.ts`) drives the REAL hook over a door that
 * refuses, throws and drops; what it structurally cannot see is the NEXT save
 * path someone adds that spends the stash up front — `takeDelimitersOpts` was
 * exactly that shape, called from eight call sites, and every one of them
 * type-checked while the payload died on the first refused write. So this file
 * reads `useDocument.ts` and pins the lifecycle as source facts:
 *
 * - the stash has ONE writer (`saveWithDelimiters`, first statement, before any
 *   branch can decline the attempt) and ONE consumer (`save`'s landed branch,
 *   identity-guarded);
 * - the only other clears are the out-of-band DISK-WINS paths (`refetch`, the
 *   tex-delimiters-changed listener), where replaying a stale stash would
 *   clobber the preamble those paths just wrote;
 * - `save` composes the `delimiters` write option itself; no caller may hand it
 *   one, which is what makes "the stash is the only copy" true by construction
 *   rather than by eight call sites agreeing;
 * - the retired spend door stays retired in both silos.
 *
 * Allowlists EMPTY. A hit is MIGRATE-it onto the lifecycle above.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  codeOnly,
  commentsStripped,
  trackedFiles,
  swallowedLines,
} from "@/lib/__tests__/_source-scan";

const read = (abs: string) => readFileSync(abs, "utf8");
const rel = (abs: string) => path.relative(REPO_ROOT, abs);
const DOC_HOOK = "src/hooks/useDocument.ts";

function productionFiles(): string[] {
  return [...trackedFiles("src", /\.(ts|tsx)$/), ...trackedFiles("library", /\.(ts|tsx)$/)]
    .filter((p) => !/__tests__|\.test\.tsx?$/.test(p));
}

/**
 * The body of an ARROW declaration (`const x = useCallback(`), anchored on the
 * `=> {` rather than the first `{` after the marker — `save`'s parameter list
 * declares a type with a brace in it, so the naive anchor answers about the
 * wrong text (the trap `mirror-evidence-census` records).
 */
function declBody(src: string, marker: string): string {
  const at = src.indexOf(marker);
  if (at < 0) return "";
  const arrow = src.indexOf("=> {", at);
  if (arrow < 0) return "";
  const i = arrow + 3;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
  }
  return src.slice(i);
}

const CLEAR = /pendingDelimitersRef\.current\s*=\s*null\b/g;
const FILL = /pendingDelimitersRef\.current\s*=\s*(?!null\b)(?!==)\w/g;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("census · the preamble stash has one writer, one consumer, and two disk-wins clears", () => {
  const hookSrc = read(path.join(REPO_ROOT, DOC_HOOK));
  const code = codeOnly(hookSrc);

  it("the scanner is not swallowing the hook (every negative needle below rests on it)", () => {
    expect(swallowedLines(hookSrc)).toEqual([]);
    // can-see canaries: the three regions the legs resolve exist under the
    // markers they are resolved by, so an empty body can never pass a leg.
    expect(declBody(code, "const save = useCallback(")).toContain("writeDocBundle(");
    expect(declBody(code, "const saveWithDelimiters = useCallback(")).toContain("autosavePauseReason(");
    expect(declBody(code, "const refetch = useCallback(")).toContain("readDocBundle(");
    expect(declBody(code, "const onDelimitersChanged = ")).toContain("docId");
  });

  it("the stash is FILLED in exactly one place — `saveWithDelimiters`, before any branch can decline the attempt", () => {
    expect(count(code, FILL)).toBe(1);
    const body = declBody(code, "const saveWithDelimiters = useCallback(");
    expect(count(body, FILL)).toBe(1);
    // FIRST, on every branch: the fill precedes the pause guard, the editor
    // probe and every `return`. Until 568 the unpaused branch NULLED the stash
    // and handed the payload to `save` — the payload then lived only in a
    // pending write, and a refused one took it with it.
    const fillAt = body.search(FILL);
    expect(fillAt).toBeGreaterThan(-1);
    expect(fillAt).toBeLessThan(body.indexOf("autosavePauseReason("));
    expect(fillAt).toBeLessThan(body.indexOf("return"));
    expect(count(body, CLEAR)).toBe(0);
    // …and it arms the unsaved-work channel on the gesture: a stash that
    // outlives a refused, thrown or paused write is unlanded work from the
    // moment it exists, not from the moment an attempt happens to report.
    expect(body).toContain("noteUnsavedEdit(docId)");
  });

  it("the stash is CONSUMED in exactly one place — `save`'s LANDED branch, identity-guarded", () => {
    const save = declBody(code, "const save = useCallback(");
    expect(count(save, CLEAR)).toBe(1);
    // After the receipt is read, after the `!receipt.landed` return, before the
    // landed report — i.e. reachable only by a write that reached disk.
    const clearAt = save.search(CLEAR);
    expect(clearAt).toBeGreaterThan(save.indexOf("if (!receipt.landed)"));
    expect(clearAt).toBeLessThan(save.indexOf("noteSaveLanded("));
    // Identity, not presence: a fresher payload stashed while this write was in
    // flight must survive this write's landing. A bare `= null` here would
    // drop it — the 568 defect one write later.
    expect(save).toMatch(/pendingDelimitersRef\.current === delimiters/);
    // No clear on the refused arm and none in the catch: those are the
    // outcomes the stash exists to outlive.
    const refused = save.slice(save.indexOf("if (!receipt.landed)"), clearAt);
    expect(count(refused, CLEAR)).toBe(0);
    const catchArm = save.slice(save.indexOf("} catch (err)"));
    expect(count(catchArm, CLEAR)).toBe(0);
  });

  it("the ONLY other clears are the two DISK-WINS paths: `refetch` and the tex-delimiters-changed listener", () => {
    const total = count(code, CLEAR);
    const inSave = count(declBody(code, "const save = useCallback("), CLEAR);
    const inRefetch = count(declBody(code, "const refetch = useCallback("), CLEAR);
    const inListener = count(declBody(code, "const onDelimitersChanged = "), CLEAR);
    expect({ inSave, inRefetch, inListener }).toEqual({ inSave: 1, inRefetch: 1, inListener: 1 });
    expect(total).toBe(3);
  });

  it("`save` composes the `delimiters` write option ITSELF, from the stash; no caller can hand it one", () => {
    const save = declBody(code, "const save = useCallback(");
    expect(save).toMatch(/const delimiters = pendingDelimitersRef\.current/);
    expect(save).toMatch(/writeDocBundle\(handle, doc, writeOpts\)/);
    // The caller-facing option type OMITS `delimiters`: a call site that spells
    // `save(doc, { delimiters })` is a compile error, not a convention. Read
    // with literals KEPT — the needle IS a quoted key (the `_source-scan` trap).
    const lit = commentsStripped(hookSrc);
    expect(lit).toMatch(/type SaveOpts = Omit<DocWriteOptions, "delimiters">/);
    expect(lit).toMatch(/opts\?: SaveOpts\): Promise<SaveReceipt>/);
    // …and no call site in the hook spells the option anyway (the type is the
    // mechanism; this is the leg that would name a `writeDocBundle` call added
    // beside `save` with a hand-built option bag). An option-bag member is
    // `delimiters: <expr>` or the `{ delimiters }` shorthand;
    // `saveWithDelimiters`' own PARAMETER (`delimiters: { preamble …`) is a
    // type annotation whose value opens a brace, and is not one. The optional
    // whitespace lives INSIDE the lookahead: written `\s*(?!\{)`, the `\s*`
    // backtracks to zero and the lookahead then sees the space, so the
    // annotation matches after all (measured — that was this leg's first cut).
    const outsideSave = code.replace(save, "");
    expect(outsideSave).not.toMatch(/\bdelimiters\s*:(?!\s*\{)/);
    expect(outsideSave).not.toMatch(/\{\s*delimiters\s*\}/);
    expect(outsideSave).not.toMatch(/\.\.\.\w*[Dd]elimiters/);
  });

  it("`hasWorkToWrite` reads the stash as its third rung", () => {
    // The predicate is an expression arrow (`() => a || b || c`), so declBody's
    // `=> {` anchor would find the NEXT block; read the declaration's own slice.
    const at = code.indexOf("const hasWorkToWrite = useCallback(");
    expect(at).toBeGreaterThan(-1);
    const slice = code.slice(at, code.indexOf("[docId],", at));
    expect(slice).toContain("saveTimerRef.current !== null");
    expect(slice).toContain("hasUnlandedWork(docId)");
    expect(slice).toContain("pendingDelimitersRef.current !== null");
  });

  it("the retired spend door stays retired in both silos", () => {
    const offenders: string[] = [];
    for (const abs of productionFiles()) {
      const src = commentsStripped(read(abs));
      if (/\btakeDelimitersOpts\b/.test(src)) offenders.push(rel(abs));
    }
    expect(offenders).toEqual([]);
    // can-see canary — the scan reads code, so a planted spend door is named.
    expect(/\btakeDelimitersOpts\b/.test(commentsStripped("const x = takeDelimitersOpts();"))).toBe(true);
  });
});
