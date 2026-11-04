import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS } from "@/hooks/preferences-defaults";
import { dropRetiredDefaults, RETIRED_PREF_DEFAULTS } from "@/lib/retired-pref-defaults.mjs";

describe("retired preference defaults", () => {
  it("drops a stored value equal to a retired default, so the new default shows", () => {
    const stored = { topbarBackground: "#c5dbe2", editorFontSize: 1 };
    const { next, dropped } = dropRetiredDefaults(stored);
    expect(dropped).toEqual(["topbarBackground"]);
    expect({ ...DEFAULT_PREFS, ...next }.topbarBackground).toBe(DEFAULT_PREFS.topbarBackground);
    expect(next.editorFontSize).toBe(1);
  });

  it("keeps a colour the user chose, even a near neighbour of a retired one", () => {
    const stored = { topbarBackground: "#c5dbe3", mutedColor: "#123456" };
    const { next, dropped } = dropRetiredDefaults(stored);
    expect(dropped).toEqual([]);
    expect(next).toBe(stored);
  });

  it("matches a colour whatever its case", () => {
    expect(dropRetiredDefaults({ topbarBackground: "#C5DBE2" }).dropped).toEqual(["topbarBackground"]);
  });

  it("does not mutate the stored blob", () => {
    const stored = { libraryBg: "#ddeaee" };
    dropRetiredDefaults(stored);
    expect(stored.libraryBg).toBe("#ddeaee");
  });

  it("names only real preferences, never one's own current default", () => {
    const prefs = DEFAULT_PREFS as unknown as Record<string, unknown>;
    for (const [key, retired] of Object.entries(RETIRED_PREF_DEFAULTS)) {
      expect(prefs, key).toHaveProperty(key);
      expect(retired, key).not.toContain(prefs[key]);
    }
  });
});
