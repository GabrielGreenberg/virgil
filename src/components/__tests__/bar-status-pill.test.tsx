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

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import {
  BAR_STATUS_PILL_MAX_WIDTH,
  BarStatusAction,
  BarStatusPill,
  barStatusAnnouncement,
  barStatusPalette,
  type BarStatusTone,
} from "../status/BarStatusPill";
import { TONE_ANNOUNCEMENT, TONE_PALETTE } from "@/lib/interruption-tone";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

afterEach(cleanup);

describe("BarStatusPill · the contract", () => {
  const EXPECTED: Record<BarStatusTone, { role: string; live: string }> = {
    live: { role: "status", live: "polite" },
    warning: { role: "status", live: "polite" },
    info: { role: "status", live: "polite" },
    danger: { role: "alert", live: "assertive" },
    quiet: { role: "status", live: "polite" },
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

  it("the leaf's four tones read the leaf's tables — the pill adds only `quiet`", () => {
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

  it("the in-document band announces through the SAME table", () => {
    const band = read("src/components/DocumentInterruptionBanner.tsx");
    expect(band).toContain("{...announcementForTone(view.tone)}");
    expect(band).not.toMatch(/role=\{view\.tone === "danger"/);
  });
});

describe("BarStatusPill · the census", () => {
  const CLUSTER = "src/components/editor-layout/StatusCluster.tsx";
  /** Every `<…Badge` the cluster mounts — discovered, not hand-listed. */
  const clusterBadges = () => {
    const src = read(CLUSTER);
    return [...new Set([...src.matchAll(/<([A-Z]\w*Badge)(?![\w.])/g)].map((m) => m[1]))];
  };

  it("discovers the badges the defect lived on", () => {
    expect(clusterBadges().sort()).toEqual(
      [
        "CoworkPenBadge",
        "ExternalChangeBadge",
        "MirrorRecoveryBadge",
        "PreservationNoticeBadge",
        "SaveStateBadge",
        "SyncConflictBadge",
      ].sort(),
    );
  });

  it.each([
    "CoworkPenBadge",
    "ExternalChangeBadge",
    "MirrorRecoveryBadge",
    "PreservationNoticeBadge",
    "SaveStateBadge",
    "SyncConflictBadge",
  ])("%s renders through BarStatusPill", (name) => {
    expect(clusterBadges()).toContain(name);
    expect(read(`src/components/${name}.tsx`)).toContain("<BarStatusPill");
  });

  const badgeFiles = () =>
    readdirSync(join(ROOT, "src/components"))
      .filter((f) => /Badge\.tsx$/.test(f))
      .map((f) => `src/components/${f}`);

  it("no *Badge.tsx spells the raw pill chrome, a private kebab, or a private menu row", () => {
    const offenders: string[] = [];
    for (const rel of badgeFiles()) {
      const src = read(rel);
      src.split("\n").forEach((line, i) => {
        if (/rounded-full/.test(line) && /text-\[11px\]/.test(line) && /\bborder\b/.test(line)) {
          offenders.push(`${rel}:${i + 1} raw pill class`);
        }
      });
      if (/function KebabIcon\b/.test(src)) offenders.push(`${rel} private KebabIcon`);
      if (/function MenuRow\b/.test(src)) offenders.push(`${rel} private MenuRow`);
    }
    expect(offenders).toEqual([]);
  });

  it("every bar button is a typed button (a bare <button> submits a form)", () => {
    expect(read("src/components/SoftwareUpdateBanner.tsx")).toMatch(
      /<button\s+type="button"\s+onClick=\{\(\) => void handleClick\(\)\}/,
    );
  });
});
