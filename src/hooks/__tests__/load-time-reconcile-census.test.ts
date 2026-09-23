/**
 * TASK 570 — the load-time reconcile door: the CENSUS.
 *
 * The behavioural suite (`load-time-reconcile-door.test.tsx`) drives the REAL
 * door and the REAL `useCitations` over a read that resolves late. What it
 * structurally cannot see is the NEXT editor-derived reconcile someone writes
 * through bare `update()` / `persist()` / `setState()` — which type-checks,
 * renders, and loses the sidecar only when the disk is slow. Two such
 * reconciles (`useExamples` / `useFootnotes`) sat exported with no production
 * caller and no `loaded` gate of their own, one mount effect away from the
 * citations defect; they are DELETED (WIRE-it-or-DELETE-it). Task 726 finished
 * the `useExamples` half: 570 took the reconcile and left the HOOK standing,
 * still caller-less, so the whole file is deleted now and the retired-reconcile
 * leg below reads only its surviving sibling. (The rule that keeps the next one
 * from accumulating is `sidecar-hook-caller-census.test.ts`.) So this file reads
 * source and pins:
 *
 * 1. every production `syncFromEditor` DECLARATION enters `updateWhenLoaded`
 *    and spells no bare write door — an EXACT set, so a retired reconcile and
 *    a new one are both decisions;
 * 2. the retired reconciles stay retired;
 * 3. the door has ONE implementation (its held-derivation / loaded mirrors are
 *    spelled nowhere else);
 * 4. the EditorPane mount effect that consumes it carries NO caller-side
 *    `loaded` gate — the hook owns the gate, and a second copy is the one the
 *    W2c resync policy (same `syncFromEditor`, off the structural diff) would
 *    not share.
 *
 * Allowlists EMPTY. A hit is MIGRATE-it onto the door.
 */
import { describe, expect, it } from "vitest";
import fs, { readFileSync } from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  codeOnly,
  enclosingDeclaration,
  swallowedLines,
  trackedFiles,
} from "@/lib/__tests__/_source-scan";

const read = (abs: string) => readFileSync(abs, "utf8");
const rel = (abs: string) => path.relative(REPO_ROOT, abs);

function productionFiles(): string[] {
  return [
    ...trackedFiles("src", /\.(ts|tsx)$/),
    ...trackedFiles("library", /\.(ts|tsx)$/),
  ].filter((p) => !/__tests__|\.test\.tsx?$/.test(p));
}

const DECLARATION = /const\s+syncFromEditor\s*=\s*useCallback\(/g;
/** A bare write door inside a reconcile body: `update(`, `persist(`,
 *  `setState(` as a CALL, not as part of `updateWhenLoaded(` or a member. */
const BARE_WRITE = /(?<![\w.$])(update|persist|setState)\(/;

/** The body of an arrow declaration, anchored on its `=> {` (the trap
 *  `mirror-evidence-census` records: a parameter list can carry a brace). */
function arrowBody(src: string, from: number): string {
  const arrow = src.indexOf("=> {", from);
  if (arrow < 0) return "";
  const i = arrow + 3;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
  }
  return src.slice(i);
}

/** Every `syncFromEditor` declaration in a file, with its verdict. */
function reconcileDeclarations(
  code: string,
): Array<{ entersDoor: boolean; bareWrite: string | null }> {
  const out: Array<{ entersDoor: boolean; bareWrite: string | null }> = [];
  for (const m of code.matchAll(DECLARATION)) {
    const body = arrowBody(code, m.index ?? 0);
    const bare = body.match(BARE_WRITE);
    out.push({
      entersDoor: body.includes("updateWhenLoaded("),
      bareWrite: bare ? bare[0] : null,
    });
  }
  return out;
}

describe("census · a load-time reconcile enters the door", () => {
  it("the scanner is not swallowing any file the legs read", () => {
    for (const f of [
      "src/hooks/useCitations.ts",
      "src/hooks/usePersistentState.ts",
      "src/hooks/useFootnotes.ts",
      "src/components/EditorPane.tsx",
    ]) {
      expect(swallowedLines(read(path.join(REPO_ROOT, f))), f).toEqual([]);
    }
  });

  it("the predicate can SEE the pre-570 shape (synthetic canary)", () => {
    const pre570 = `
      const syncFromEditor = useCallback(
        (atoms: Atom[]) => {
          const refs = atoms.map(toRef);
          update((prev) => ({ ...prev, citations: [...refs] }));
        },
        [update],
      );`;
    expect(reconcileDeclarations(pre570)).toEqual([
      { entersDoor: false, bareWrite: "update(" },
    ]);
    const bespoke = `
      const syncFromEditor = useCallback((eds: E[]) => {
        const next = { footnotes: eds };
        setState(next);
        persist(next);
      }, [persist]);`;
    expect(reconcileDeclarations(bespoke)).toEqual([
      { entersDoor: false, bareWrite: "setState(" },
    ]);
    const doored = `
      const syncFromEditor = useCallback(
        (atoms: Atom[]) => {
          updateWhenLoaded((prev) => ({ ...prev, citations: atoms }));
        },
        [updateWhenLoaded],
      );`;
    expect(reconcileDeclarations(doored)).toEqual([
      { entersDoor: true, bareWrite: null },
    ]);
  });

  it("every production syncFromEditor declaration enters updateWhenLoaded and spells no bare write door — an EXACT set", () => {
    const declaring: string[] = [];
    const offenders: string[] = [];
    for (const abs of productionFiles()) {
      const code = codeOnly(read(abs));
      const decls = reconcileDeclarations(code);
      if (decls.length === 0) continue;
      declaring.push(rel(abs));
      for (const d of decls) {
        if (!d.entersDoor) offenders.push(`${rel(abs)}: does not enter updateWhenLoaded`);
        if (d.bareWrite) offenders.push(`${rel(abs)}: bare ${d.bareWrite}`);
      }
    }
    expect(offenders).toEqual([]);
    // An exact set: a NEW editor-derived reconcile joins by being written
    // through the door (and lands here as a diff), a retired one leaves here.
    expect(declaring.sort()).toEqual(["src/hooks/useCitations.ts"]);
  });

  it("the retired reconciles stay retired: useFootnotes spells no syncFromEditor, useExamples is gone entirely", () => {
    const code = codeOnly(read(path.join(REPO_ROOT, "src/hooks/useFootnotes.ts")));
    expect(code.includes("syncFromEditor")).toBe(false);
    // `useExamples` lost its reconcile in 570 and its last reason to exist in
    // 726 — the file itself is the retirement now. A re-created hook of that
    // name would also have to face the caller census.
    expect(
      fs.existsSync(path.join(REPO_ROOT, "src/hooks/useExamples.ts")),
      "useExamples.ts is deleted (task 726) — a re-created one needs a production caller",
    ).toBe(false);
  });

  it("the door has ONE implementation: its held derivation is spelled only in usePersistentState", () => {
    // The needle is the door's OWN identity — the held-derivation slot. Not
    // `loadedRef`: `useEditorUIState` keeps a load mirror of that name for its
    // own scroll/caret persistence, which is not a reconcile door.
    const spellers: string[] = [];
    for (const abs of productionFiles()) {
      const code = codeOnly(read(abs));
      if (/heldReconcileRef|updateWhenLoaded\s*=/.test(code)) {
        spellers.push(rel(abs));
      }
    }
    expect(spellers).toEqual(["src/hooks/usePersistentState.ts"]);
    const door = codeOnly(
      read(path.join(REPO_ROOT, "src/hooks/usePersistentState.ts")),
    );
    // The hold, the exactly-once apply, and the docId reset all exist.
    expect(door).toContain("heldReconcileRef.current = fn;");
    expect(door).toContain("heldReconcileRef.current = null;");
    expect(door).toContain("updateWhenLoaded,");
  });

  it("the EditorPane mount-time sync consumes the hook's door and carries NO caller-side loaded gate", () => {
    const src = codeOnly(
      read(path.join(REPO_ROOT, "src/components/EditorPane.tsx")),
    );
    const call = src.indexOf("citationsHook.syncFromEditor(editorCits)");
    expect(call).toBeGreaterThan(-1);
    const region = enclosingDeclaration(src, call);
    // The effect is keyed on the editor alone; the hook holds the load gate.
    expect(region).not.toContain(".loaded");
    expect(region).toContain("if (!editor) return;");
  });
});
