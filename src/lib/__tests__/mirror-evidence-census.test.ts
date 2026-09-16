/**
 * **Task 557 — the leg with teeth.**
 *
 * The receipt and the mirror's model source were never the parts that could
 * misbehave. What can is a CALL SITE: a second module that reaches
 * `noteSaveLanded` directly, a save path that goes back to re-deriving the
 * verdict from `isWriteProtected`, a mirror model source that reaches for
 * `lastSavedRef` again, or a backend exit that forgets to report. Every one of
 * those type-checks, renders, and is invisible to every behavioural test in
 * this cluster — which is exactly how the pre-557 shape shipped and stood for
 * as long as it did.
 *
 * > **Nothing may write, clear, or replace the emergency mirror without
 * > POSITIVE EVIDENCE about the model it is acting on.**
 *
 * Both silos are swept. Allowlists are EMPTY: there is no true statement of the
 * form "this module may claim a landed write without the door's receipt".
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

/** Every production source file in both silos — tests and the built mirrors out. */
function productionFiles(): string[] {
  return [...trackedFiles("src", /\.(ts|tsx)$/), ...trackedFiles("library", /\.(ts|tsx)$/)]
    .filter((p) => !/__tests__|\.test\.tsx?$/.test(p));
}

/**
 * The body of a `function` DECLARATION named by `marker` (which ends at its
 * opening paren). The parameter list is skipped by paren-balancing first —
 * `writeDocBundle`'s `opts?: { … }` puts a brace inside it, so brace-balancing
 * from the marker would return the option type rather than the body.
 */
function fnBody(src: string, marker: string): string {
  const at = src.indexOf(marker);
  if (at < 0) return "";
  let i = at + marker.length - 1; // the opening `(`
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) break;
  }
  const open = src.indexOf("{", i);
  if (open < 0) return "";
  depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(open, j + 1);
  }
  return src.slice(open);
}

/**
 * The body of an ARROW declaration (`const x = useCallback(`). Anchored on the
 * `=> {` rather than the first `{` after the marker: `save`'s parameter list
 * declares an `opts?: { … }` type, so the naive anchor returns that type and
 * every needle aimed at the body answers about the wrong text.
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

const DOC_HOOK = "src/hooks/useDocument.ts";
const MIRROR_HOOK = "src/hooks/useEmergencyMirror.ts";
const CHANNEL = "src/lib/unsaved-work.ts";

describe("census · a landed write is CLAIMED in exactly one place", () => {
  it("the scanner is not swallowing the file whose NEGATIVE needles matter", () => {
    // Scoped to `useDocument.ts`, which is where every `.not.toContain` needle
    // below points: a swallow there would blank the rest of the file and make
    // them pass for the wrong reason. The two BACKENDS are deliberately not
    // asked — every needle aimed at them is POSITIVE (`toContain`, an exit-count
    // of zero over a body `fnBody` must first find), so a swallow there fails
    // CLOSED. It would also be a false alarm: `swallowedLines` reads the `"`
    // inside `storage-fsa`'s `/[\\/:*?"<>|]/` character class as a string
    // opening, which is a limitation of the shared scanner and predates 557.
    expect(
      swallowedLines(read(path.join(REPO_ROOT, DOC_HOOK))),
      `${DOC_HOOK}: an unterminated string literal would blank the rest of the ` +
        `file and make every negative needle below pass vacuously`,
    ).toEqual([]);
  });

  it("only `useDocument` claims a landed write, and only its `save` does", () => {
    const offenders: string[] = [];
    for (const abs of productionFiles()) {
      const src = codeOnly(read(abs));
      if (!/\bnoteSaveLanded\s*\(/.test(src)) continue;
      if (rel(abs) === CHANNEL) continue; // its declaration site
      if (rel(abs) !== DOC_HOOK) {
        offenders.push(`${rel(abs)} · claims a landed write outside the save path`);
        continue;
      }
      // …and inside it, only `save`.
      const outside = src.split(/\bnoteSaveLanded\s*\(/).length - 1;
      const inside =
        declBody(src, "const save = useCallback(").split(/\bnoteSaveLanded\s*\(/).length - 1;
      if (outside !== inside)
        offenders.push(`${DOC_HOOK} · ${outside - inside} claim(s) outside \`save\``);
    }
    expect(
      offenders,
      "`noteSaveLanded` is the one thing that clears the dirty state; it may be " +
        "reached only from the branch that read a LANDED receipt",
    ).toEqual([]);
  });

  it("the landed verdict comes from the door's receipt, never from a flag", () => {
    const src = codeOnly(read(path.join(REPO_ROOT, DOC_HOOK)));
    const save = declBody(src, "const save = useCallback(");
    expect(save).toContain("const receipt = await writeDocBundle(");
    expect(save).toContain("if (!receipt.landed)");
    // WIDENED (task 567): the needle used to be scoped to `save` alone, and
    // `restoreFromMirror` read the flag after `save()` returned — a THROWN
    // write is swallowed into the channel and leaves the flag false, so the
    // restore refetched and deleted the mirror and the offer for a write that
    // never landed. No declaration in the hook has a reason to read it now:
    // `save` RETURNS its receipt and every verdict door reads that.
    expect(
      src,
      "`isWriteProtected` answers whether a NOTICE stands, not whether a " +
        "write landed — the two come apart on an acknowledged refusal and on " +
        "a thrown write; no save caller in the hook may read it",
    ).not.toContain("isWriteProtected(");
    // And the claim sits on the landed side of that branch.
    const at = save.indexOf("if (!receipt.landed)");
    expect(save.indexOf("noteSaveLanded(", at)).toBeGreaterThan(at);
    expect(save.indexOf("dropMirror(", at)).toBeGreaterThan(at);
  });

  it("`save` RETURNS its receipt, and every door that states a verdict reads it", () => {
    // Task 567. The three doors that REPORT (`keepMineOverDisk` to the
    // conflict badge, `restoreFromMirror` to the recovery badge,
    // `saveNowRequested` to the Save button and Cmd+S) each used to read a
    // proxy after the await — `!hasUnlandedWork`, `isWriteProtected`,
    // `getUnsavedWork(…)?.reason` — and each proxy answers a different
    // question from "did THIS write land". A verdict door assigns the receipt
    // and reads `.landed`; a channel read may survive only BEFORE the attempt
    // (the no-model arm of the manual door, which has no receipt to read).
    const src = codeOnly(read(path.join(REPO_ROOT, DOC_HOOK)));
    const save = declBody(src, "const save = useCallback(");
    // The receipt's reason is QUOTED text, so that one needle reads the view
    // that keeps string literals (`codeOnly` blanks them — the trap this
    // file's mirror-drop leg already records).
    const saveQuoted = declBody(
      commentsStripped(read(path.join(REPO_ROOT, DOC_HOOK))),
      "const save = useCallback(",
    );
    expect(saveQuoted, "the catch arm is an `error` receipt, not a silence").toContain(
      'return { landed: false, reason: "error" }',
    );
    expect(save).toContain("return receipt;");
    for (const door of ["keepMineOverDisk", "restoreFromMirror", "saveNowRequested"]) {
      const body = declBody(src, `const ${door} = useCallback(`);
      expect(body, `${door} must exist`).not.toBe("");
      const attempt = body.indexOf("const receipt = await save(");
      expect(attempt, `${door} reads the receipt of the save it asks for`).toBeGreaterThan(-1);
      expect(body.indexOf("receipt.landed", attempt)).toBeGreaterThan(attempt);
      for (const proxy of ["hasUnlandedWork(", "getUnsavedWork(", "isWriteProtected("]) {
        expect(
          body.indexOf(proxy, attempt),
          `${door} reads the channel proxy \`${proxy}\` AFTER the attempt — a verdict from a proxy`,
        ).toBe(-1);
      }
    }
  });

  it("the \"Save anyway\" acknowledgment is recorded on the LANDED receipt, and nowhere else", () => {
    // Task 567. `acknowledgePreservationNotice` is the one WRITER of the flag
    // that steps the write gate aside. Recorded at the gesture (as the badge
    // did until 567) it was a decision about a write that had not been asked
    // for; recorded in `save` it rests on the receipt. So the store's own
    // declaration and `save`'s landed branch are its only production sites,
    // and the call is guarded by the claim the caller made.
    const offenders: string[] = [];
    for (const abs of productionFiles()) {
      const src = codeOnly(read(abs));
      if (!/\backnowledgePreservationNotice\s*\(/.test(src)) continue;
      if (rel(abs) === "src/lib/preservation-notice.ts") continue; // its declaration
      if (rel(abs) !== DOC_HOOK) {
        offenders.push(`${rel(abs)} · acknowledges a notice at a gesture, not on a receipt`);
        continue;
      }
      const outside = src.split(/\backnowledgePreservationNotice\s*\(/).length - 1;
      const save = declBody(src, "const save = useCallback(");
      const inside = save.split(/\backnowledgePreservationNotice\s*\(/).length - 1;
      if (outside !== inside)
        offenders.push(`${DOC_HOOK} · ${outside - inside} acknowledgment(s) outside \`save\``);
      const at = save.indexOf("if (!receipt.landed)");
      const ack = save.indexOf("acknowledgePreservationNotice(");
      if (ack < at) offenders.push(`${DOC_HOOK} · the acknowledgment precedes the landed branch`);
      if (!/if\s*\(opts\?\.acknowledgePreservation\)\s*\{?\s*acknowledgePreservationNotice\(/.test(save))
        offenders.push(`${DOC_HOOK} · the acknowledgment is not guarded by the caller's claim`);
    }
    expect(
      offenders,
      "an acknowledgment is the user's choice to overwrite the file with the " +
        "version they see; a write that did not land has not honoured it",
    ).toEqual([]);
    // …and the badge asks the door with the claim rather than flipping the flag.
    const badge = codeOnly(read(path.join(REPO_ROOT, "src/components/PreservationNoticeBadge.tsx")));
    expect(badge).toContain("acknowledgePreservation: true");
    expect(badge).toContain("requestSaveNow(");
    // The claim steps the gate aside in BOTH backends, beside the 364 claim.
    for (const f of ["src/lib/storage-fsa.ts", "src/lib/storage-dev.ts"]) {
      const body = fnBody(codeOnly(read(path.join(REPO_ROOT, f))), "export async function writeDocBundle(");
      expect(body, `${f}: the write gate steps aside for the acknowledgment claim`).toMatch(
        /opts\?\.userResolvedConflict \|\| opts\?\.acknowledgePreservation/,
      );
    }
  });

  it("the mirror is dropped through ONE door, and every caller states its evidence", () => {
    // The needles here are QUOTED text, so the view keeps string literals and
    // drops only comments — `codeOnly` blanks the very literals being counted.
    const offenders: string[] = [];
    for (const abs of productionFiles()) {
      if (rel(abs) === MIRROR_HOOK) continue; // the door's own declaration
      const src = commentsStripped(read(abs));
      if (
        /\bclearMirror\s*\(/.test(src) &&
        !["src/lib/emergency-mirror.ts", DOC_HOOK, "src/lib/doc-index.ts"].includes(
          rel(abs),
        )
      )
        offenders.push(`${rel(abs)} · clears the mirror outside the door`);
      for (const m of src.matchAll(/\bdropMirror\s*\(([\s\S]*?)\)/g)) {
        if (!/"(landed|discarded)"/.test(m[1]))
          offenders.push(`${rel(abs)} · dropMirror( … ) states no evidence`);
      }
    }
    expect(
      offenders,
      "a mirror drop rests on evidence, and the caller names which it holds",
    ).toEqual([]);

    // The one door BELOW the hook: `purgeDoc` retires a doc id (delete, or the
    // example's reset — task 604). Its evidence is that the IDENTITY is gone,
    // so the clear may sit in that function and nowhere else in the file.
    const docIndex = commentsStripped(read(path.join(REPO_ROOT, "src/lib/doc-index.ts")));
    const clears = [...docIndex.matchAll(/\bclearMirror\s*\(/g)];
    expect(clears, "doc-index clears the mirror once, in purgeDoc").toHaveLength(1);
    const purgeAt = docIndex.indexOf("export async function purgeDoc(");
    expect(purgeAt, "purgeDoc must exist").toBeGreaterThanOrEqual(0);
    const purge = docIndex.slice(purgeAt, docIndex.indexOf("\n}\n", purgeAt));
    expect(purge).toMatch(/\bclearMirror\s*\(/);

    // `landed` is the STRONG claim — this model reached disk — so only the
    // branch that read a landed receipt may make it.
    const src = commentsStripped(read(path.join(REPO_ROOT, DOC_HOOK)));
    const landedDrops = [...src.matchAll(/dropMirror\([\s\S]*?"landed"[\s\S]*?\)/g)];
    expect(landedDrops, "exactly one site may say a write LANDED").toHaveLength(1);
    const save = declBody(src, "const save = useCallback(");
    expect(save, "…and it is the one holding a landed receipt").toContain('"landed"');

    // The retired name may not come back: it was doing double duty, and one of
    // its two callers was on a path where nothing had landed at all.
    for (const abs of productionFiles())
      expect(codeOnly(read(abs))).not.toContain("dropMirrorAfterLandedSave");

    // …and the door still REQUIRES the evidence rather than defaulting it.
    const door = codeOnly(read(path.join(REPO_ROOT, MIRROR_HOOK)));
    expect(door).toContain("reason: MirrorDropReason");
    expect(door, "a defaulted reason would be a decision nobody made").not.toMatch(
      /reason:\s*MirrorDropReason\s*=/,
    );
  });

  it("the mirror's model source may not spell `lastSavedRef`", () => {
    const src = codeOnly(read(path.join(REPO_ROOT, DOC_HOOK)));
    const body = declBody(src, "const currentModel = useCallback(");
    expect(body, "the one memory-side model source must exist").toContain(
      "latestContentRef.current",
    );
    expect(
      body,
      "`lastSavedRef` is BY DEFINITION already on disk, so it is never an " +
        "answer to 'what is in memory that may not be'. As a rung it also made " +
        "`null` unreachable, which defeated the `no-model` bail outright.",
    ).not.toContain("lastSavedRef");
  });
});

describe("census · the write door REPORTS, in both backends", () => {
  const BACKENDS = ["src/lib/storage-fsa.ts", "src/lib/storage-dev.ts"];

  it("`writeDocBundle` has exactly ONE production call site", () => {
    const sites: string[] = [];
    for (const abs of productionFiles()) {
      if (BACKENDS.includes(rel(abs)) || rel(abs) === "src/lib/storage.ts") continue;
      const src = codeOnly(read(abs));
      for (const _ of src.matchAll(/\bwriteDocBundle\s*\(/g)) sites.push(rel(abs));
    }
    expect(
      sites,
      "a second bundle writer would have to re-derive the landed verdict, and " +
        "no census in this cluster scans outside `useDocument`",
    ).toEqual([DOC_HOOK]);
  });

  it("both backends declare the receipt and report on EVERY exit", () => {
    for (const f of BACKENDS) {
      const raw = read(path.join(REPO_ROOT, f));
      // Two views: the REASON needles are quoted text (comments stripped,
      // literals kept); the bare-return count wants literals blanked too, so a
      // `return;` inside a string could not be counted as an exit.
      const quoted = fnBody(commentsStripped(raw), "export async function writeDocBundle(");
      const symbols = fnBody(codeOnly(raw), "export async function writeDocBundle(");
      expect(symbols, `${f}: the door body must resolve`).not.toBe("");
      expect(codeOnly(raw), `${f}: the door's return type is the receipt`).toContain(
        "): Promise<DocWriteReceipt> {",
      );
      // Not one bare `return;` — every exit says what it did.
      expect(
        [...symbols.matchAll(/(^|[^\w.])return\s*;/g)].length,
        `${f}: a bare \`return;\` is the pre-557 shape — the caller cannot see it`,
      ).toBe(0);
      expect(quoted, `${f}: the read-only answer is given EXPLICITLY`).toContain(
        'reason: "read-only"',
      );
      expect(quoted, `${f}: a gate refusal is reported`).toContain(
        'reason: "preservation"',
      );
      expect(symbols, `${f}: the success path reports too`).toContain("DOC_WRITE_LANDED");
    }
  });

  it("the read-only answer precedes the funnel, which resolves `undefined as T`", () => {
    // `enqueueDocWrite` short-circuits a library-paper write by resolving
    // `undefined as T` — a cast, so TypeScript cannot catch a receipt-shaped
    // door returning it. The answer is given BEFORE the funnel or `save` reads
    // `.landed` off `undefined`.
    const fsa = commentsStripped(read(path.join(REPO_ROOT, "src/lib/storage-fsa.ts")));
    const body = fnBody(fsa, "export async function writeDocBundle(");
    const readOnlyAt = body.indexOf('reason: "read-only"');
    const funnelAt = body.indexOf("enqueueDocWrite(");
    expect(readOnlyAt).toBeGreaterThan(-1);
    expect(funnelAt).toBeGreaterThan(-1);
    expect(
      readOnlyAt,
      "the library-paper answer must be returned before the funnel can swallow it",
    ).toBeLessThan(funnelAt);
  });
});
