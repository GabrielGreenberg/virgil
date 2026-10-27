// Task 1327 — CENSUS: the writers of the user's content coalesce through the
// ONE write coalescer (`@/lib/write-coalescer`), never a hand-rolled
// `setTimeout` re-arm. Task 1174's "continuous typing must still write" rule
// (maxWait) was private code in `useDocument`; every other writer kept an
// uncapped trailing timer and silently opted out of it. A writer file here
// may name `setTimeout` only at a declared, non-write site.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, codeOnly } from "@/lib/__tests__/_source-scan";

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
      const arms = [...src.matchAll(/(\w+)(?:\.current)?\s*=\s*(?:window\.)?setTimeout\(/g)].map(
        (m) => m[1],
      );
      const bare = (src.match(/(?:window\.)?setTimeout\(/g) ?? []).length;
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

  it("the primitive is the ONE place a burst start is stamped", () => {
    const src = codeOnly(
      readFileSync(path.join(REPO_ROOT, "src/hooks/useDocument.ts"), "utf8"),
    );
    expect(src).not.toMatch(/burstStart/);
  });
});
