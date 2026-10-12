/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `fsaPickerUsable` (task 1085) — the figure picker asks storage-mode which
 * backend this session is on instead of mirroring the detection. The mirror
 * read `virgil:force-dev-storage` unconditionally; storage-mode honours it only
 * in a build with NEXT_PUBLIC_DEV_STORAGE, so a production build with the flag
 * left set ran FSA storage behind an `<input>` picker.
 *
 * `isDevStorage` is frozen at module load (the row's `readAt`), so every case
 * sets its environment and THEN imports a fresh module.
 */

const g = globalThis as unknown as Record<string, unknown>;

function stubFsa(): void {
  vi.stubGlobal("showDirectoryPicker", () => {});
  vi.stubGlobal("showOpenFilePicker", () => {});
  if (typeof g.FileSystemDirectoryHandle === "undefined") {
    vi.stubGlobal("FileSystemDirectoryHandle", class {});
  }
  if (typeof g.FileSystemFileHandle === "undefined") {
    vi.stubGlobal("FileSystemFileHandle", class {});
  }
}

async function load() {
  vi.resetModules();
  return import("@/lib/storage-mode");
}

describe("fsaPickerUsable — the picker follows the backend choice", () => {
  beforeEach(() => {
    localStorage.clear();
    stubFsa();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("flag set but dev storage not allowed by the build → FSA storage, so the FSA picker", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_STORAGE", "");
    localStorage.setItem("virgil:force-dev-storage", "1");
    const mode = await load();
    expect(mode.isDevStorage).toBe(false);
    expect(mode.fsaPickerUsable()).toBe(true);
  });

  it("flag set in a dev-storage build → dev storage, so the <input> picker", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_STORAGE", "1");
    localStorage.setItem("virgil:force-dev-storage", "1");
    const mode = await load();
    expect(mode.isDevStorage).toBe(true);
    expect(mode.fsaPickerUsable()).toBe(false);
  });

  it("inside an iframe the FSA picker is never usable, even on FSA storage", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_STORAGE", "");
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    const mode = await load();
    expect(mode.isDevStorage).toBe(false);
    expect(mode.fsaPickerUsable()).toBe(false);
  });

  it("without the FSA spec the picker falls back", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEV_STORAGE", "");
    vi.unstubAllGlobals();
    vi.stubGlobal("showOpenFilePicker", undefined);
    const mode = await load();
    expect(mode.fsaPickerUsable()).toBe(false);
  });
});
