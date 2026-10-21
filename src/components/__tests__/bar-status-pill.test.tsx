/**
 * @vitest-environment jsdom
 */

/**
 * **The ONE bar status pill** (task 769).
 *
 * The Virgil-bar data-integrity badges shared a tone table (task 571) but no
 * pill: each rebuilt the chrome by hand, and everything the class string did
 * not carry drifted — the announcement (two of seven had a role), the width
 * cap (260/280/360), the glyph ink, three action-button styles (one nested
 * inside the labelled span), and three copies of the kebab + menu row.
 *
 * Two halves:
 * - the CONTRACT: each tone yields its role/aria-live, the glyph is inked by
 *   the tone's edge, ONE width cap, actions are siblings of the labelled span;
 * - the CENSUS: every badge `StatusCluster` mounts renders through the pill,
 *   and no `*Badge.tsx` spells the raw pill class or a private kebab/row.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import {
  BAR_STATUS_MENU_WIDTH,
  BAR_STATUS_PILL_MAX_WIDTH,
  BarStatusAction,
  BarStatusPill,
  barStatusAnnouncement,
  barStatusPalette,
  type BarStatusTone,
} from "../status/BarStatusPill";
import { TONE_ANNOUNCEMENT, TONE_PALETTE } from "@/lib/interruption-tone";
import { BAR_STATUS_ORDER } from "@/lib/bar-status-policy";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

afterEach(cleanup);

describe("BarStatusPill · the contract", () => {
  const EXPECTED: Record<BarStatusTone, { role: string | null; live: string }> = {
    live: { role: "status", live: "polite" },
    warning: { role: "status", live: "polite" },
    info: { role: "status", live: "polite" },
    danger: { role: "alert", live: "assertive" },
    quiet: { role: "status", live: "polite" },
    // A ticking readout ("idle 12s") — not a live region (task 1214).
    presence: { role: null, live: "off" },
  };

  it.each(Object.entries(EXPECTED))("tone %s announces as %o", (tone, want) => {
    const { container } = render(
      <BarStatusPill
        tone={tone as BarStatusTone}
        glyph={<svg />}
        label="Label"
        ariaLabel="Accessible label"
      />,
    );
    const span = container.querySelector("[data-bar-status-label]")!;
    expect(span.getAttribute("role")).toBe(want.role);
    expect(span.getAttribute("aria-live")).toBe(want.live);
    expect(span.getAttribute("aria-label")).toBe("Accessible label");
    // The glyph is inked by the tone's edge — the SPECIFIED value (jsdom
    // resolves no CSS vars).
    const glyph = container.querySelector("[data-bar-status-glyph]") as HTMLElement;
    expect(glyph.style.color).toBe(barStatusPalette(tone as BarStatusTone).edge);
    // ONE width cap.
    expect((span as HTMLElement).style.maxWidth).toBe(`${BAR_STATUS_PILL_MAX_WIDTH}px`);
  });

  it("the leaf's four tones read the leaf's tables — the pill adds only `quiet` and `presence`", () => {
    for (const tone of Object.keys(TONE_PALETTE) as (keyof typeof TONE_PALETTE)[]) {
      expect(barStatusPalette(tone)).toBe(TONE_PALETTE[tone]);
      expect(barStatusAnnouncement(tone)).toBe(TONE_ANNOUNCEMENT[tone]);
    }
  });

  it("actions are SIBLINGS of the labelled span, typed buttons in the one bar style", () => {
    const { container } = render(
      <BarStatusPill
        tone="warning"
        glyph={<svg />}
        label="Label"
        ariaLabel="Accessible label"
        actions={<BarStatusAction onClick={() => {}}>Restore</BarStatusAction>}
      />,
    );
    const span = container.querySelector("[data-bar-status-label]")!;
    expect(span.querySelector("button")).toBeNull();
    const btn = container.querySelector("button")!;
    expect(btn.textContent).toBe("Restore");
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.className).toBe("topbarbtn");
  });

  it("a WIDGET pill puts its controls inside the chrome and announces its label (task 1214)", () => {
    const { container, rerender } = render(
      <BarStatusPill
        tone="quiet"
        ariaLabel="Writing timer"
        label={null}
        widget={<button type="button">Play</button>}
      />,
    );
    const group = container.querySelector("[data-bar-status-widget]") as HTMLElement;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("Writing timer");
    expect(group.style.maxWidth).toBe(`${BAR_STATUS_PILL_MAX_WIDTH}px`);
    expect(group.querySelector("button")!.textContent).toBe("Play");
    // The live region is mounted BEFORE it has anything to say — a region
    // that appears with its text is not read out.
    const live = group.querySelector("[data-bar-status-label]")!;
    expect(live.getAttribute("role")).toBe("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("");
    rerender(
      <BarStatusPill
        tone="quiet"
        ariaLabel="Writing timer"
        label="Done"
        widget={<button type="button">Play</button>}
      />,
    );
    expect(container.querySelector("[data-bar-status-label]")).toBe(live);
    expect(live.textContent).toBe("Done");
    // No glyph given → no empty glyph wrapper.
    expect(container.querySelector("[data-bar-status-glyph]")).toBeNull();
  });

  it("an identity edge replaces the register's edge on the hairline only", () => {
    const { container } = render(
      <BarStatusPill
        tone="presence"
        identityEdge="rgb(18, 52, 86)"
        glyph={<svg />}
        label="Ada is editing"
        ariaLabel="Ada is editing"
      />,
    );
    const span = container.querySelector("[data-bar-status-label]") as HTMLElement;
    expect(span.style.borderColor).toBe("rgb(18, 52, 86)");
    const glyph = container.querySelector("[data-bar-status-glyph]") as HTMLElement;
    expect(glyph.style.color).toBe(barStatusPalette("presence").edge);
  });

  it("the in-document band announces through the SAME table", () => {
    const band = read("src/components/DocumentInterruptionBanner.tsx");
    expect(band).toContain("{...announcementForTone(view.tone)}");
    expect(band).not.toMatch(/role=\{view\.tone === "danger"/);
  });
});

describe("BarStatusPill · the census", () => {
  // Task 1214: the census used to select its subjects by FILENAME
  // (`readdirSync` + `*Badge.tsx`), so two bar occupants not named `…Badge`
  // (the Pomodoro, the collab pen pill) hand-rolled the chrome unseen. Its
  // subjects are now DERIVED from the policy table's own mount.
  const CLUSTER = "src/components/editor-layout/StatusCluster.tsx";
  const cluster = () => read(CLUSTER);

  /** Import name → repo-relative file, for every component the cluster
   *  imports from `src/components` (default or named, `@/components/…` or a
   *  relative `../…`). */
  const clusterImports = (): Map<string, string> => {
    const out = new Map<string, string>();
    for (const m of cluster().matchAll(/import\s+([^;]+?)\s+from\s+"((?:@\/components|\.\.)\/[\w/]+)"/g)) {
      const rel = m[2].replace(/^@\/components\//, "src/components/").replace(/^\.\.\//, "src/components/");
      const file = `${rel}.tsx`;
      if (!existsSync(join(ROOT, file))) continue;
      const names = m[1].replace(/type\s+\w+/g, "").match(/[A-Z]\w*/g) ?? [];
      for (const n of names) out.set(n, file);
    }
    return out;
  };

  /** policy id → the component the cluster mounts for it, read off the
   *  `statusItems: Record<BarStatusItemId, ReactNode>` literal. */
  const policyMounts = (): Map<string, string> => {
    const src = cluster();
    const body = src.slice(src.indexOf("const statusItems: Record<BarStatusItemId"));
    const out = new Map<string, string>();
    for (const id of BAR_STATUS_ORDER) {
      const key = /^[a-z]+$/.test(id) ? id : `"${id}"`;
      // Ids are `[a-z-]` — no regex metacharacters to escape.
      const m = new RegExp(`\\n\\s*${key}:\\s*\\(?\\s*<([A-Z]\\w*)`).exec(body);
      if (m) out.set(id, m[1]);
    }
    return out;
  };

  it("every BAR_STATUS_ORDER row is mounted, and its component renders through BarStatusPill", () => {
    const mounts = policyMounts();
    const imports = clusterImports();
    expect([...mounts.keys()].sort()).toEqual([...BAR_STATUS_ORDER].sort());
    const offenders: string[] = [];
    for (const [id, comp] of mounts) {
      const file = imports.get(comp);
      if (!file) {
        offenders.push(`${id}: <${comp}> is not an src/components import`);
        continue;
      }
      if (!read(file).includes("<BarStatusPill")) offenders.push(`${id}: ${file} hand-rolls its pill`);
    }
    expect(offenders).toEqual([]);
  });

  it("discovers the residents the defect lived on (self-check, so the sweep cannot pass vacuously)", () => {
    const files = new Set(clusterImports().values());
    for (const f of [
      "src/components/PomodoroTimer.tsx",
      "src/components/CollabStatusPill.tsx",
      "src/components/SaveStateBadge.tsx",
      "src/components/SoftwareUpdateBanner.tsx",
    ]) {
      expect(files).toContain(f);
    }
    expect(policyMounts().get("pomodoro")).toBe("PomodoroTimer");
  });

  it("the collab pen pill (mounted outside the policy rows) renders through BarStatusPill", () => {
    expect(cluster()).toMatch(/<CollabStatusPill[\s\S]*?variant="badge"/);
    expect(read("src/components/CollabStatusPill.tsx")).toContain("<BarStatusPill");
  });

  it("no cluster resident spells the raw pill chrome, a private kebab, or a private menu row", () => {
    const offenders: string[] = [];
    for (const rel of new Set(clusterImports().values())) {
      if (rel.endsWith("status/BarStatusPill.tsx")) continue;
      const src = read(rel);
      src.split("\n").forEach((line, i) => {
        if (/rounded-full/.test(line) && /text-\[11px\]/.test(line) && /\bborder\b/.test(line)) {
          offenders.push(`${rel}:${i + 1} raw pill class`);
        }
      });
      if (/function KebabIcon\b/.test(src)) offenders.push(`${rel} private KebabIcon`);
      if (/function \w*MenuRow\b/.test(src) || /function \w*IdentityRow\b/.test(src)) {
        offenders.push(`${rel} private menu row`);
      }
      if (/<circle cx="5" cy="12" r="1\.6"/.test(src)) offenders.push(`${rel} private kebab glyph`);
    }
    expect(offenders).toEqual([]);
  });

  it("no cluster resident declares its own menu width — the pill owns ONE spec (task 1215)", () => {
    const offenders: string[] = [];
    for (const rel of new Set(clusterImports().values())) {
      if (rel.endsWith("status/BarStatusPill.tsx")) continue;
      const src = read(rel);
      if (!src.includes("<BarStatusPill")) continue;
      src.split("\n").forEach((line, i) => {
        // The menu surface's width props — gone from `BarStatusMenu`, so a
        // badge re-adding one is a type error AND this line.
        if (/\bcontainer(?:ClassName|Style)\b/.test(line)) {
          offenders.push(`${rel}:${i + 1} ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
    // The menu's width is a stated spec, not a literal at the mount.
    const pill = read("src/components/status/BarStatusPill.tsx");
    expect(pill).toMatch(/containerStyle=\{MENU_WIDTH_STYLE\}/);
    expect(pill).not.toMatch(/\b(?:min|max)-w-\[\d+px\]/);
    expect(BAR_STATUS_MENU_WIDTH.min).toBeLessThan(BAR_STATUS_MENU_WIDTH.max);
  });

  it("an ACTIVATABLE pill is a typed button that keeps the button role (task 1131)", () => {
    const { container } = render(
      <BarStatusPill
        tone="quiet"
        glyph={<svg />}
        label="Virgil update"
        ariaLabel="Virgil update"
        onActivate={() => {}}
      />,
    );
    const btn = container.querySelector("[data-bar-status-label]")!;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
    // A `role="status"` would rename the button for assistive tech.
    expect(btn.getAttribute("role")).toBeNull();
    expect(btn.getAttribute("aria-live")).toBe("polite");
  });
});
