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
    expect(
      save,
      "`isWriteProtected` answers whether a NOTICE stands, not whether THIS " +
        "write landed — the two come apart on an acknowledged refusal",
    ).not.toContain("isWriteProtected(");
    // And the claim sits on the landed side of that branch.
    const at = save.indexOf("if (!receipt.landed)");
    expect(save.indexOf("noteSaveLanded(", at)).toBeGreaterThan(at);
    expect(save.indexOf("dropMirror(", at)).toBeGreaterThan(at);
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
        !["src/lib/emergency-mirror.ts", DOC_HOOK].includes(rel(abs))
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
