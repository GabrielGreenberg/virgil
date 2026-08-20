/**
 * Bug-report drop — the writer's half of the drop contract.
 *
 * The reader (the remote-inbox heartbeat, ~/virgil-tasks/REMOTE_INBOX.md)
 * parses report.md's frontmatter and trusts its `screenshots` manifest as
 * the completeness check, so the format legs here round-trip through a
 * parser written the way the heartbeat would write it — not through the
 * builder's own inverse. The write-protocol legs pin the two-phase order
 * (screenshots first, report.md LAST): Dropbox does not guarantee arrival
 * order, and report.md is the completion marker the reader keys on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// bug-report.ts touches IndexedDB at module scope (createStore) — back it
// with a Map, the tex-assets.test.ts precedent.
vi.mock("idb-keyval", () => {
  const backing = new Map<string, unknown>();
  return {
    createStore: (_db: string, _name: string) => Symbol("store"),
    get: async (key: string) => backing.get(key),
    set: async (key: string, value: unknown) => {
      backing.set(key, value);
    },
    del: async (key: string) => {
      backing.delete(key);
    },
  };
});

// Record every write, in order, so the two-phase protocol is assertable.
const writeLog: { kind: "binary" | "text"; path: string; data: unknown }[] = [];
vi.mock("@library/lib/library-storage", () => ({
  writeTextFile: async (_root: unknown, path: string, text: string) => {
    writeLog.push({ kind: "text", path, data: text });
  },
  writeBinaryFile: async (_root: unknown, path: string, blob: Blob) => {
    writeLog.push({ kind: "binary", path, data: blob });
  },
  // queue.ts (sanitizeFilename's module) imports these at module scope.
  readJsonFile: async () => undefined,
  writeJsonFile: async () => {},
  SUBDIRS: { unsorted: "unsorted" },
}));

import {
  buildDropFolderName,
  buildReportMarkdown,
  extFromMime,
  machineSlug,
  randomSuffix,
  writeBugReport,
  type BugReportMeta,
} from "@/lib/bug-report";

/** Parse the frontmatter the way the heartbeat would: first line `---`,
 *  everything to the NEXT bare `---` line is `key: value` (values JSON),
 *  body is what follows the blank line after it. */
function parseReport(md: string): {
  fields: Record<string, unknown>;
  body: string;
} {
  const lines = md.split("\n");
  expect(lines[0]).toBe("---");
  const close = lines.indexOf("---", 1);
  expect(close).toBeGreaterThan(0);
  const fields: Record<string, unknown> = {};
  for (const line of lines.slice(1, close)) {
    const i = line.indexOf(": ");
    expect(i).toBeGreaterThan(0);
    const key = line.slice(0, i);
    const raw = line.slice(i + 2);
    fields[key] = raw === "null" ? null : JSON.parse(raw);
  }
  // Builder emits one blank line between the closing --- and the body.
  expect(lines[close + 1]).toBe("");
  return { fields, body: lines.slice(close + 2).join("\n") };
}

const META: Omit<BugReportMeta, "screenshots"> = {
  sentAt: "2026-08-19T21:22:05.123Z",
  machineLabel: "Office iMac",
  appVersion: "0.1.94",
  userAgent: 'Mozilla/5.0 (Macintosh; "quoted") Chrome/139: yes',
  docName: 'Coherence: "Intro" draft',
};

describe("buildReportMarkdown", () => {
  it("round-trips every field through a heartbeat-shaped parser, quotes and colons included", () => {
    const md = buildReportMarkdown(
      { ...META, screenshots: ["shot-1.png", "shot-2.jpg"] },
      "The margin markers overlap.\nSecond line.",
    );
    const { fields, body } = parseReport(md);
    expect(fields).toEqual({
      kind: "virgil-bug-report",
      version: 1,
      sentAt: META.sentAt,
      machine: META.machineLabel,
      appVersion: META.appVersion,
      userAgent: META.userAgent,
      doc: META.docName,
      screenshots: ["shot-1.png", "shot-2.jpg"],
    });
    expect(body).toBe("The margin markers overlap.\nSecond line.\n");
  });

  it("a body containing a literal --- line survives (parser closes on the FIRST delimiter)", () => {
    const md = buildReportMarkdown(
      { ...META, screenshots: [] },
      "before\n---\nafter",
    );
    const { body } = parseReport(md);
    expect(body).toBe("before\n---\nafter\n");
  });

  it("a null doc serializes as YAML null, not the string 'null'", () => {
    const md = buildReportMarkdown(
      { ...META, docName: null, screenshots: [] },
      "x",
    );
    const { fields } = parseReport(md);
    expect(fields.doc).toBeNull();
  });

  it("does not double a trailing newline the text already has", () => {
    const md = buildReportMarkdown({ ...META, screenshots: [] }, "x\n");
    expect(md.endsWith("x\n")).toBe(true);
    expect(md.endsWith("x\n\n")).toBe(false);
  });
});

describe("buildDropFolderName", () => {
  const now = new Date("2026-08-19T21:22:05.123Z");

  it("is UTC, colon-free, and FSA/Windows-legal", () => {
    const name = buildDropFolderName(now, "Office iMac", "x7kq");
    expect(name).toBe("2026-08-19-212205Z-office-imac-x7kq");
    // FSA forbids < > : " / \ | ? * and control chars.
    // eslint-disable-next-line no-control-regex
    expect(name).not.toMatch(/[<>:"/\\|?*\x00-\x1f]/);
  });

  it("slugs a hostile machine label instead of leaking illegal characters", () => {
    const name = buildDropFolderName(now, 'my "great" / machine?', "abcd");
    // eslint-disable-next-line no-control-regex
    expect(name).not.toMatch(/[<>:"/\\|?*\x00-\x1f\s]/);
    expect(name.endsWith("-abcd")).toBe(true);
  });
});

describe("machineSlug", () => {
  it("lowercases, dashes spaces, collapses runs", () => {
    expect(machineSlug("Office iMac")).toBe("office-imac");
    expect(machineSlug("A   B")).toBe("a-b");
  });
  it("falls back to 'unknown' when nothing survives", () => {
    expect(machineSlug("")).toBe("unknown");
    expect(machineSlug("///")).toBe("unknown");
  });
});

describe("extFromMime", () => {
  it("maps the clipboard image types, defaulting unknown to png", () => {
    expect(extFromMime("image/png")).toBe("png");
    expect(extFromMime("image/jpeg")).toBe("jpg");
    expect(extFromMime("image/webp")).toBe("webp");
    expect(extFromMime("image/gif")).toBe("gif");
    expect(extFromMime("image/tiff")).toBe("tif");
    expect(extFromMime("image/x-exotic")).toBe("png");
  });
});

describe("randomSuffix", () => {
  it("is 4 chars of lowercase alphanumerics", () => {
    for (let i = 0; i < 20; i++) {
      expect(randomSuffix()).toMatch(/^[a-z2-9]{4}$/);
    }
  });
});

describe("writeBugReport — the two-phase write protocol", () => {
  const handle = {} as FileSystemDirectoryHandle;

  beforeEach(() => {
    writeLog.length = 0;
  });

  it("writes screenshots first and report.md LAST, all inside one new folder", async () => {
    const images = [
      { blob: new Blob(["a"]), ext: "png" },
      { blob: new Blob(["b"]), ext: "jpg" },
    ];
    const { folderName } = await writeBugReport(handle, {
      text: "hello",
      images,
      meta: META,
    });
    expect(writeLog.map((w) => w.kind)).toEqual(["binary", "binary", "text"]);
    expect(writeLog.map((w) => w.path)).toEqual([
      `${folderName}/shot-1.png`,
      `${folderName}/shot-2.jpg`,
      `${folderName}/report.md`,
    ]);
    // The completion marker's manifest matches the tray order exactly.
    const { fields } = parseReport(writeLog[2].data as string);
    expect(fields.screenshots).toEqual(["shot-1.png", "shot-2.jpg"]);
    // The written blobs are the images, in order.
    expect(writeLog[0].data).toBe(images[0].blob);
    expect(writeLog[1].data).toBe(images[1].blob);
  });

  it("a text-only report writes exactly one file: report.md", async () => {
    const { folderName } = await writeBugReport(handle, {
      text: "just words",
      images: [],
      meta: META,
    });
    expect(writeLog.map((w) => w.path)).toEqual([`${folderName}/report.md`]);
    const { fields, body } = parseReport(writeLog[0].data as string);
    expect(fields.screenshots).toEqual([]);
    expect(body).toBe("just words\n");
  });
});
