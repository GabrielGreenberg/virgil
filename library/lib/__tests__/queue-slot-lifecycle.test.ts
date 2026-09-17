/**
 * The queue SLOT LIFECYCLE, app half (task 618).
 *
 * `writeQueueEntry` used to write `queue/<name>.json` blind: it never looked
 * at a `<name>.done` left by an earlier run (so the drain skipped the new
 * request as "already done"), and `index` / `authenticate` / the deep-index
 * companion all wrote the one `<citekey>.json` (last writer won — including
 * over an entry being worked). These legs pin the contract stated in
 * `library/scripts/queue_slot.py` from the TS side; the parity with the Python
 * table lives in `queue-slot-parity.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = vi.hoisted(() => ({ files: new Map<string, string>() }));

vi.mock("../library-storage", () => ({
  SUBDIRS: { queue: ".virgil/queue", unsorted: "unsorted" },
  readTextFile: vi.fn(async (_r: unknown, path: string) => disk.files.get(path)),
  readJsonFile: vi.fn(async (_r: unknown, path: string) => {
    const t = disk.files.get(path);
    if (t === undefined) return undefined;
    try {
      return JSON.parse(t);
    } catch {
      return undefined;
    }
  }),
  writeTextFile: vi.fn(async (_r: unknown, path: string, text: string) => {
    disk.files.set(path, text);
  }),
  writeJsonFile: vi.fn(async (_r: unknown, path: string, value: unknown) => {
    disk.files.set(path, JSON.stringify(value, null, 2) + "\n");
  }),
  writeBinaryFile: vi.fn(),
  deleteFile: vi.fn(async (_r: unknown, path: string) => {
    disk.files.delete(path);
  }),
}));

import {
  QueueSlotBusyError,
  queueFilename,
  writeQueueEntry,
  type QueueEntry,
} from "../queue";
import {
  cancelBibReview,
  cancelDeepIndex,
  queueBibReview,
  queueDeepIndex,
  queueIndex,
} from "../bib-edit";

const ROOT = {} as FileSystemDirectoryHandle;
const Q = ".virgil/queue";

function put(name: string, entry: Partial<QueueEntry> | string) {
  disk.files.set(
    `${Q}/${name}`,
    typeof entry === "string" ? entry : JSON.stringify(entry),
  );
}
function get(name: string): QueueEntry | undefined {
  const t = disk.files.get(`${Q}/${name}`);
  return t === undefined ? undefined : (JSON.parse(t) as QueueEntry);
}
function names(): string[] {
  return [...disk.files.keys()]
    .filter((k) => k.startsWith(`${Q}/`))
    .map((k) => k.slice(Q.length + 1))
    .sort();
}

beforeEach(() => disk.files.clear());

describe("slot table — one slot per kind", () => {
  const base = { status: "requested", requestedAt: "x", attempts: 0 } as const;
  it("gives authenticate its own slot, apart from index", () => {
    expect(queueFilename({ kind: "authenticate", citekey: "k", ...base })).toBe("k-auth.json");
    expect(queueFilename({ kind: "index", citekey: "k", ...base })).toBe("k.json");
    expect(queueFilename({ kind: "reindex", citekey: "k", ...base })).toBe("k.json");
  });
});

describe("retire-on-write (members 1 & 2)", () => {
  it("rotates a stale same-kind .done out of the slot before writing", async () => {
    put("k-bibedit.done", { kind: "bib-edit", citekey: "k", requestedAt: "old" });
    await writeQueueEntry(ROOT, {
      kind: "bib-edit",
      status: "requested",
      citekey: "k",
      requestedAt: "new",
      attempts: 0,
      bibEdit: { type: "article", fields: {} },
    });
    const all = names();
    expect(all).not.toContain("k-bibedit.done");
    expect(all.some((n) => /^k-bibedit\.bib-edit\..+\.done$/.test(n))).toBe(true);
    expect(get("k-bibedit.json")?.requestedAt).toBe("new");
  });

  it("rotates an empty (unparseable) marker as kind unknown", async () => {
    put("k.done", "");
    await queueIndex(ROOT, "k");
    expect(names().some((n) => /^k\.unknown\..+\.done$/.test(n))).toBe(true);
    expect(names()).not.toContain("k.done");
  });
});

describe("kinds coexist; in-flight work is protected (member 3)", () => {
  it("an index request never replaces a bib review", async () => {
    await queueBibReview(ROOT, "k");
    await queueIndex(ROOT, "k");
    expect(get("k-auth.json")?.kind).toBe("authenticate");
    expect(get("k.json")?.kind).toBe("index");
  });

  it("refuses to overwrite a running entry", async () => {
    put("k.json", { kind: "index", status: "running", citekey: "k" });
    await expect(queueIndex(ROOT, "k")).rejects.toBeInstanceOf(QueueSlotBusyError);
    expect(get("k.json")?.status).toBe("running");
  });

  it("migrates a legacy authenticate out of the bare slot before an index lands", async () => {
    put("k.json", { kind: "authenticate", status: "requested", citekey: "k", note: "legacy" });
    await queueIndex(ROOT, "k");
    expect(get("k.json")?.kind).toBe("index");
    expect(get("k-auth.json")?.note).toBe("legacy");
  });

  it("refuses the bare slot while a legacy authenticate there is running", async () => {
    put("k.json", { kind: "authenticate", status: "running", citekey: "k" });
    await expect(queueIndex(ROOT, "k")).rejects.toMatchObject({ reason: "occupied" });
    expect(get("k.json")?.kind).toBe("authenticate");
  });

  it("cancelBibReview finds both the new slot and a legacy bare-slot request", async () => {
    await queueBibReview(ROOT, "a");
    expect(await cancelBibReview(ROOT, "a")).toBe(true);
    expect(get("a-auth.json")).toBeUndefined();

    put("b.json", { kind: "authenticate", status: "requested", citekey: "b" });
    expect(await cancelBibReview(ROOT, "b")).toBe(true);
    expect(get("b.json")).toBeUndefined();

    put("c.json", { kind: "index", status: "requested", citekey: "c" });
    expect(await cancelBibReview(ROOT, "c")).toBe(false);
    expect(get("c.json")?.kind).toBe("index");
  });

  it("the deep-index companion never replaces, and its cancel never removes, a user's own index", async () => {
    await queueIndex(ROOT, "k", "mine");
    await queueDeepIndex(ROOT, "k", undefined, true);
    expect(get("k.json")?.note).toBe("mine");
    expect(get("k.json")?.companionOf).toBeUndefined();
    expect(await cancelDeepIndex(ROOT, "k")).toBe(true);
    expect(get("k.json")?.note).toBe("mine");
  });

  it("cancelDeepIndex still removes the companion it planted", async () => {
    await queueDeepIndex(ROOT, "k", undefined, true);
    expect(get("k.json")?.companionOf).toBe("deepIndex");
    expect(await cancelDeepIndex(ROOT, "k")).toBe(true);
    expect(get("k.json")).toBeUndefined();
    expect(get("k-deepindex.json")).toBeUndefined();
  });

  it("a deep index does not plant a companion over a running index", async () => {
    put("k.json", { kind: "index", status: "running", citekey: "k" });
    await queueDeepIndex(ROOT, "k", undefined, true);
    expect(get("k.json")?.status).toBe("running");
    expect(get("k-deepindex.json")?.kind).toBe("deepIndex");
  });
});
