// @vitest-environment jsdom
//
// Task 2026-08-31-517 (the memo's Tier A) — native spellcheck becomes
// deliberate and switchable, through ONE registry row and ONE write.
//
// Eleven `spellcheck` decisions were scattered across the app and none of them
// was collected into a rule, so from outside the pattern read as arbitrary and
// there was no way to turn the thing off. The switch is a single inherited
// `spellcheck` attribute on `<body>` rather than a `checkSpelling` prop
// threaded into each surface's `editorProps.attributes` — there are TWELVE of
// those blocks (the main editor, RichTextField, BorrowedMainText, nine float
// bodies, ExampleCard), none of which sets `spellcheck` today, so twelve
// threads would be twelve chances for the thirteenth surface to be forgotten.
//
// The leg with teeth is the CENSUS. The door was never the part that could
// misbehave — a surface that opts out with a bare literal is, and it renders
// perfectly while leaving "the surfaces deliberately left out" unstated.
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

import {
  NEVER_SPELLCHECK_ATTRS,
  NEVER_SPELLCHECK_PROPS,
  VIRGIL_CHECKED_ATTRS,
  SPELLCHECK_ATTR,
  applyNativeSpellcheck,
} from "@/lib/spellcheck-policy";
import { VIEW_PREF_REGISTRY, toggleRowsInMenuGroup } from "@/lib/view-prefs/registry";
import {
  commentsStripped,
  trackedFiles,
  REPO_ROOT,
} from "@/lib/__tests__/_source-scan";

// ── A. the write ─────────────────────────────────────────────────────────────

describe("the switch is one attribute on <body>", () => {
  beforeEach(() => document.body.removeAttribute(SPELLCHECK_ATTR));

  it("OFF writes `spellcheck=false`; ON removes the attribute entirely", () => {
    applyNativeSpellcheck(false);
    expect(document.body.getAttribute(SPELLCHECK_ATTR)).toBe("false");
    // ON is the ABSENCE of the attribute, not `"true"`: the default state IS
    // on, so the pref's default position leaves the DOM byte-identical to what
    // shipped before the switch existed.
    applyNativeSpellcheck(true);
    expect(document.body.hasAttribute(SPELLCHECK_ATTR)).toBe(false);
  });

  it("is idempotent in both positions", () => {
    applyNativeSpellcheck(false);
    applyNativeSpellcheck(false);
    expect(document.body.getAttribute(SPELLCHECK_ATTR)).toBe("false");
    applyNativeSpellcheck(true);
    applyNativeSpellcheck(true);
    expect(document.body.hasAttribute(SPELLCHECK_ATTR)).toBe(false);
  });

  it("a deliberate opt-out is a DESCENDANT false, so it survives either position", () => {
    // This is what makes the body attribute safe: an explicit descendant value
    // wins over an inherited one, so the eleven opt-outs are unaffected by the
    // pref and need no knowledge of it.
    expect(NEVER_SPELLCHECK_ATTRS).toEqual({ spellcheck: "false" });
    expect(NEVER_SPELLCHECK_PROPS).toEqual({ spellCheck: false });
  });

  it("VIRGIL_CHECKED is the same VALUE and a different CLAIM (task 518)", () => {
    // The hand-off Virgil's own checker contributes while it is live. Same
    // bytes, different question — "who underlines this surface" rather than
    // "may anyone" — which is why it is a third constant rather than a reuse:
    // the census below would otherwise have to read the plugin's hand-off as a
    // hand-written opt-out, and the two must stay tellable apart.
    expect(VIRGIL_CHECKED_ATTRS).toEqual({ spellcheck: "false" });
    expect(VIRGIL_CHECKED_ATTRS).not.toBe(NEVER_SPELLCHECK_ATTRS);
  });
});

// ── B. the registry row ──────────────────────────────────────────────────────

describe("one registry row, zero MenuBar edits", () => {
  it("`checkSpelling` is a Display toggle defaulting ON", () => {
    const def = VIEW_PREF_REGISTRY.checkSpelling;
    expect(def.kind).toBe("toggle");
    expect(def.default).toBe(true);
    expect(def.menu).toBe("display");
    expect(def.scope).toBe("global");
  });

  it("…and it reaches the View menu through the derived Display rows", () => {
    const rows = toggleRowsInMenuGroup("display");
    const row = rows.find((r) => r.key === "checkSpelling");
    expect(row).toBeTruthy();
    expect(row!.id).toBe(VIEW_PREF_REGISTRY.checkSpelling.menuRowId);
    expect(row!.label).toBe("Check spelling");
  });
});

// ── C. the census ────────────────────────────────────────────────────────────

describe("census — every opt-out enters the door", () => {
  const PRODUCTION = [
    ...trackedFiles("src", /\.(ts|tsx)$/),
    ...trackedFiles("library", /\.(ts|tsx)$/),
  ].filter((p) => !p.includes("__tests__"));

  /** The door itself is the one file entitled to spell the raw forms. */
  const DOOR = "src/lib/spellcheck-policy.ts";

  it("no production file spells a raw spellcheck opt-out", () => {
    // Comments stripped, string LITERALS KEPT — the thing being hunted IS a
    // literal, so blanking literals would make this leg pass vacuously.
    const offenders: string[] = [];
    for (const abs of PRODUCTION) {
      const rel = abs.slice(REPO_ROOT.length + 1);
      if (rel === DOOR) continue;
      const src = commentsStripped(readFileSync(abs, "utf8"));
      for (const line of src.split("\n")) {
        if (/spellCheck\s*=\s*\{\s*(false|true)\s*\}/.test(line)) offenders.push(`${rel}: ${line.trim()}`);
        if (/spellcheck\s*:\s*"(false|true)"/.test(line)) offenders.push(`${rel}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the scanner can SEE one — the canary", () => {
    // Synthetic, never standing on a drained production line: drain the
    // allowlist and a canary built from it evaporates while the leg keeps
    // passing.
    const fixture = commentsStripped(
      '  <input spellCheck={false} />\n  attributes: { spellcheck: "false" },\n',
    );
    const flagged = fixture
      .split("\n")
      .filter(
        (l) =>
          /spellCheck\s*=\s*\{\s*(false|true)\s*\}/.test(l) ||
          /spellcheck\s*:\s*"(false|true)"/.test(l),
      );
    expect(flagged).toHaveLength(2);
  });

  it("the door has real consumers — the exemption is not a licence", () => {
    // A door nothing enters is the dead-SSOT shape (task 202). Both shapes
    // must have live callers, and there must be MANY: the eleven opt-outs are
    // the whole point of collecting them.
    const attrs: string[] = [];
    const props: string[] = [];
    for (const abs of PRODUCTION) {
      const rel = abs.slice(REPO_ROOT.length + 1);
      if (rel === DOOR) continue;
      const src = commentsStripped(readFileSync(abs, "utf8"));
      if (src.includes("NEVER_SPELLCHECK_ATTRS")) attrs.push(rel);
      if (src.includes("NEVER_SPELLCHECK_PROPS")) props.push(rel);
    }
    // Two CodeMirror source pods + the main editor's read-only branch.
    expect(attrs.length).toBeGreaterThanOrEqual(3);
    // The discrete form inputs.
    expect(props.length).toBeGreaterThanOrEqual(6);
  });

  it("the policy has exactly ONE mount", () => {
    // Two writers of one attribute is how they come to disagree. `useEffect`
    // cleanup restores ON, so a second mount unmounting would silently
    // re-enable spellcheck under the first.
    const callers: string[] = [];
    for (const abs of PRODUCTION) {
      const rel = abs.slice(REPO_ROOT.length + 1);
      if (rel === DOOR) continue;
      const src = commentsStripped(readFileSync(abs, "utf8"));
      if (/useNativeSpellcheck\s*\(/.test(src)) callers.push(rel);
    }
    expect(callers).toEqual(["src/components/EditorLayout.tsx"]);
  });
});
