// Task 1327 — CENSUS: the writers of the user's content coalesce through the
// ONE write coalescer (`@/lib/write-coalescer`), never a hand-rolled
// `setTimeout` re-arm. Task 1174's "continuous typing must still write" rule
// (maxWait) was private code in `useDocument`; every other writer kept an
// uncapped trailing timer and silently opted out of it. A writer file here
// may name `setTimeout` only at a declared, non-write site.
//
// Task 1502: the WRITERS record below was the census's whole population, and
// its arm detector matched only `X = setTimeout(` / `window.setTimeout(` — so a
// writer not on the list was never checked, and `lifetime.setTimeout(` (the
// ViewLifetime door every component timer now uses) was invisible even in a
// listed file. The citation card's code field escaped both ways: a pure 250 ms
// trailing debounce writing `citations.json` and the `\cite` atom. The
// population is now DERIVED: every shipped `src/` file whose timer CALLBACK
// reaches a write door is reported unless it is declared below with a reason.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  codeOnly,
  constBindings,
  localFunctions,
  matchFrom,
  trackedFiles,
} from "@/lib/__tests__/_source-scan";

/** Writer file → the timer identifiers it may still arm, each with why it is
 *  not a write coalescer. */
const WRITERS: Record<string, Record<string, string>> = {
  "src/hooks/useDocument.ts": {},
  "src/hooks/usePersistentState.ts": {},
  "src/components/RichTextField.tsx": {},
  "src/hooks/useEditorUIState.ts": {
    cursorTimer:
      "a caret SETTLE sampler — it decides WHICH paragraph to record; the write it triggers rides the coalescer",
  },
  "src/lib/cross-window-storage.ts": {},
  // Task 1502 — the code field's live preview (`citations.json` + `\cite`).
  "src/panels/Citations/CitationCard.tsx": {},
  "src/lib/code-pane-bridge.ts": {
    tipTapTimer:
      "the TipTap→code DISPLAY sync — TipTap is canonical; nothing reaches disk through it",
  },
};

describe("write-coalescer CENSUS — one primitive owns trailing debounce + maxWait", () => {
  for (const [file, allowed] of Object.entries(WRITERS)) {
    it(`${file} coalesces through the write coalescer`, () => {
      const src = codeOnly(readFileSync(path.join(REPO_ROOT, file), "utf8"));
      expect(src, "can-see canary: the writer names the primitive").toMatch(
        /\b(?:create|use)WriteCoalescer\(/,
      );
      // Every `X = setTimeout(` / `setTimeout(` assignment target must be a
      // declared non-write timer.
      // Any spelling arms a timer: bare, `window.`, `lifetime.`, `x.y.`.
      const arms = [
        ...src.matchAll(/(\w+)(?:\.current)?\s*=\s*(?:[\w$]+\.)*setTimeout\(/g),
      ].map((m) => m[1]);
      const bare = (src.match(/(?:[\w$]+\.)*setTimeout\(/g) ?? []).length;
      expect(
        bare,
        `${file}: a setTimeout that is not assigned to a declared timer`,
      ).toBe(arms.length);
      const undeclared = arms.filter((id) => !(id in allowed));
      expect(
        undeclared,
        `${file}: a hand-rolled write debounce — arm it through useWriteCoalescer / createWriteCoalescer`,
      ).toEqual([]);
    });
  }

  it("the derived population: no timer callback in src/ reaches a write door uncoalesced", () => {
    const files = shippedSources();
    expect(files.length, "can-see canary: the walk found the source tree").toBeGreaterThan(200);
    const armers = files.filter((f) => TIMER.test(f.code));
    expect(armers.length, "can-see canary: timer arms are visible").toBeGreaterThan(20);
    const escapees = armers.flatMap((f) =>
      timerWrites(f.code)
        .filter((door) => !(f.rel in DECLARED_TIMER_WRITERS))
        .map((door) => `${f.rel}: a timer callback calls ${door}( — coalesce it through useWriteCoalescer / createWriteCoalescer`),
    );
    expect(escapees).toEqual([]);
    for (const rel of Object.keys(DECLARED_TIMER_WRITERS)) {
      const f = files.find((x) => x.rel === rel);
      expect(f && timerWrites(f.code).length > 0, `${rel}: declared but no longer a timer writer — delete the entry`).toBe(true);
    }
  });

  it("the detector has teeth on every timer spelling (task 1502's escapee shape)", () => {
    const escapee = codeOnly(`
      codeDebounceRef.current = lifetime.setTimeout(() => {
        lastWrittenRef.current = v;
        onUpdateCitation(cit.id, v);
      }, 250);`);
    expect(timerWrites(escapee)).toEqual(["onUpdateCitation"]);
    expect(timerWrites("t = window.setTimeout(() => mutateSidecar(a, b), 400);")).toEqual([
      "mutateSidecar",
    ]);
    expect(timerWrites("setTimeout(flush, 400); function flush() { persist(next); }")).toEqual([
      "persist",
    ]);
    expect(
      timerWrites("const go = () => { void writeTex(h, s); }; this.t = view.setTimeout(go, 9);"),
    ).toEqual(["writeTex"]);
    // A timer that writes nothing is not a writer.
    expect(timerWrites("lifetime.setTimeout(() => setCopied(false), 1200);")).toEqual([]);
  });

  it("the primitive is the ONE place a burst start is stamped", () => {
    const src = codeOnly(
      readFileSync(path.join(REPO_ROOT, "src/hooks/useDocument.ts"), "utf8"),
    );
    expect(src).not.toMatch(/burstStart/);
  });
});

/** A timer arm, in any spelling (bare, `window.`, `lifetime.`, `a.b.`). */
const TIMER = /(?:^|[^\w$])(?:[\w$]+\.)*setTimeout\(/;

/** The calls that write the user's content: a card/citation update callback,
 *  the sidecar doors, the `.tex` doors, `usePersistentState`'s `persist`. */
const WRITE_DOOR =
  /\b(onUpdate\w*|mutateSidecar\w*|writeSidecar\w*|writeTex|rewriteTex\w*|writeDocBundle|saveDoc\w*|persist|onSave\w*)\(/g;

/** A file whose timer callback reaches a write door for a reason that is not a
 *  coalescable debounce — each entry states why. Empty today. */
const DECLARED_TIMER_WRITERS: Record<string, string> = {};

function shippedSources(): { rel: string; code: string }[] {
  return trackedFiles("src", /\.tsx?$/)
    .map((abs) => path.relative(REPO_ROOT, abs))
    .filter((rel) => !/(?:^|\/)__tests__\/|\.test\.tsx?$/.test(rel))
    .map((rel) => ({ rel, code: codeOnly(readFileSync(path.join(REPO_ROOT, rel), "utf8")) }));
}

/** The write doors each timer CALLBACK in `code` calls — its inline body, or,
 *  when the callback is a bare identifier, that name's same-file function or
 *  `const` initializer. Narrow by design: a door reached only through a second
 *  hop is not seen. */
function timerWrites(code: string): string[] {
  const fns = localFunctions(code);
  const consts = constBindings(code);
  const doors: string[] = [];
  for (const m of code.matchAll(/(?:[\w$]+\.)*setTimeout\(/g)) {
    const open = m.index! + m[0].length - 1;
    const close = matchFrom(code, open, "(", ")");
    if (close < 0) continue;
    const args = code.slice(open + 1, close);
    const ident = /^\s*([A-Za-z_$][\w$]*)\s*,/.exec(args)?.[1];
    const body = ident ? (fns.get(ident) ?? consts.get(ident) ?? "") : args;
    for (const d of body.matchAll(WRITE_DOOR)) doors.push(d[1]);
  }
  return doors;
}
