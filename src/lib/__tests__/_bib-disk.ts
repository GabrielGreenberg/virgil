/**
 * An in-memory `references.bib` whose writes LAND — the `readBib` / `mutateBib`
 * pair for `@/lib/storage` stubs whose suite needs a bib write to SUCCEED.
 *
 * Not a suite; a helper (see [_mock-storage.ts](_mock-storage.ts) for why it
 * lives here). It exists because the default stub's `mutateBib` answers `null`
 * WITHOUT running the mutator, which `mutateProjectBib` reads — correctly — as
 * the door refusing the file (`read-only`). Suites that pinned a rename's
 * fan-out on that stub were passing only because the hook fanned out over a
 * refused write (task 1142); a write that lands is what they meant.
 *
 * USAGE (inside a hoisted `vi.mock` factory, so import lazily):
 * ```ts
 * vi.mock("@/lib/storage", async () => {
 *   const { bibDisk } = await import("@/lib/__tests__/_bib-disk");
 *   return { ...otherStubs, ...bibDisk("@article{foo,\n}\n") };
 * });
 * beforeEach(() => resetBibDisk());
 * ```
 */
import { vi } from "vitest";

let initialText = "";
/** One file per doc: suites mount several docs, and a landed write on one must
 *  not be what the next doc reads. */
const files = new Map<string, string>();
const fileOf = (docId: string) => files.get(docId) ?? initialText;

/** Put every doc's disk back to what `bibDisk` was seeded with — call in
 *  `beforeEach`, since a landed write otherwise carries into the next test. */
export function resetBibDisk(): void {
  files.clear();
}

export function bibDisk(initial: string) {
  initialText = initial;
  files.clear();
  return {
    readBib: vi.fn(async (docId: string) => ({
      bibText: fileOf(docId),
      detectedPackage: undefined,
    })),
    mutateBib: vi.fn(
      async (handle: { docId: string }, mutate: (current: string) => string | null) => {
        const next = mutate(fileOf(handle.docId));
        if (next === null) return null;
        files.set(handle.docId, next);
        return next;
      },
    ),
  };
}
