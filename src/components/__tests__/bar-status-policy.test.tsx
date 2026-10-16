/**
 * @vitest-environment jsdom
 */

/**
 * **The bar status policy — must-see only** (task 1131).
 *
 * Gabriel: "I'm seeing way too many updates and status checks … unless I
 * absolutely have to see it, no." Every protected-tier item used to gate
 * itself; informational notices (skills updated, "Saved · 22:38", a long
 * update sentence) piled up in a tier that never yields.
 *
 * Three halves:
 * - the CENSUS: StatusCluster mounts its protected tier ONLY through the
 *   policy's order, every mounted item is named by the table, and every
 *   item's component asks `barStatusVisible` with its OWN id — so the
 *   registry is read (AGENTS.md "A registry earns its name by being read");
 * - the POLICY: the default answers Gabriel chose;
 * - the SURFACES: the update chip says exactly "Virgil update", and the
 *   skills-updated note lives in the Help menu, not on the bar.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  BAR_STATUS_ORDER,
  BAR_STATUS_POLICY,
  barStatusVisible,
  type BarStatusItemId,
} from "@/lib/bar-status-policy";

const updateState = vi.hoisted(() => ({ value: "waiting" as string }));
const unlanded = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/useUpdateAvailable", () => ({
  useUpdateState: () => updateState.value,
  applyUpdate: vi.fn(),
}));
// reload-door transitively pulls `@/lib/storage` (the known barrel/storage
// gotcha) — stub it; nothing here touches a sidecar.
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("@/hooks/useUnsavedWork", () => ({
  useAnyUnlandedWork: () => unlanded.value,
}));

import { SoftwareUpdateBanner, VIRGIL_UPDATE_LABEL } from "../SoftwareUpdateBanner";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const CLUSTER = "src/components/editor-layout/StatusCluster.tsx";

afterEach(() => {
  cleanup();
  updateState.value = "waiting";
  unlanded.value = false;
});

/** The `statusItems` record in StatusCluster: id → component tag. */
function clusterItems(): Map<string, string> {
  const src = read(CLUSTER);
  const start = src.indexOf("const statusItems: Record<BarStatusItemId, ReactNode> = {");
  expect(start, "StatusCluster declares its protected tier as a policy-keyed record").toBeGreaterThan(-1);
  const end = src.indexOf("\n  };", start);
  const body = src
    .slice(start, end)
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  const items = new Map<string, string>();
  for (const m of body.matchAll(/^\s{4}"?([\w-]+)"?:\s*\(?\s*<([A-Z]\w*)/gm)) {
    items.set(m[1]!, m[2]!);
  }
  return items;
}

/** The file a cluster component tag is imported from. */
function fileOf(tag: string): string {
  const src = read(CLUSTER);
  const m =
    src.match(new RegExp(`import\\s+\\{[^}]*\\b${tag}\\b[^}]*\\}\\s+from\\s+"([^"]+)"`)) ??
    src.match(new RegExp(`import\\s+${tag}\\s+from\\s+"([^"]+)"`));
  expect(m, `${tag} is imported by StatusCluster`).toBeTruthy();
  const spec = m![1]!;
  const rel = spec.startsWith("@/")
    ? `src/${spec.slice(2)}`
    : join("src/components/editor-layout", spec).replace(/\\/g, "/");
  return `${rel}.tsx`;
}

describe("bar status policy · the census", () => {
  it("the order names exactly the table's items, once each", () => {
    expect([...BAR_STATUS_ORDER].sort()).toEqual(Object.keys(BAR_STATUS_POLICY).sort());
    expect(new Set(BAR_STATUS_ORDER).size).toBe(BAR_STATUS_ORDER.length);
  });

  it("StatusCluster mounts every table item — and nothing the table does not name", () => {
    expect([...clusterItems().keys()].sort()).toEqual([...BAR_STATUS_ORDER].sort());
  });

  it("the protected tier renders ONLY through the policy order", () => {
    // Between the cluster's `return (` and the collapsible group, the JSX may
    // hold the wrapper and the ordered map — no status item mounted beside it.
    const src = read(CLUSTER);
    const ret = src.indexOf("  return (\n", src.indexOf("function StatusClusterImpl"));
    const group = src.indexOf('data-bar-tier="collapsible"', ret);
    const slice = src
      .slice(ret, group)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\/.*$/gm, "");
    expect(slice).toContain("BAR_STATUS_ORDER.map");
    const tags = [...slice.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]);
    expect(tags.filter((t) => t !== "Fragment")).toEqual([]);
  });

  it.each([...clusterItems()])(
    "%s → <%s> asks barStatusVisible with its own id",
    (id, tag) => {
      const src = read(fileOf(tag));
      expect(src).toContain(`barStatusVisible("${id}"`);
    },
  );

  it("no protected item reads a layout preference (zen / collapse) to decide visibility", () => {
    const items = clusterItems();
    const src = read(CLUSTER);
    const start = src.indexOf("const statusItems");
    const body = src.slice(start, src.indexOf("\n  };", start));
    expect(body).not.toMatch(/topbarRightCollapsed|collapsePreference|zenModeOn/);
    expect(items.size).toBe(BAR_STATUS_ORDER.length);
  });
});

describe("bar status policy · the default answers", () => {
  const cases: [BarStatusItemId, object, boolean][] = [
    ["software-update", { update: "none" }, false],
    ["software-update", { update: "waiting" }, true],
    ["software-update", { update: "activated-elsewhere" }, true],
    ["skill-sync", { failed: false }, false],
    ["skill-sync", { failed: true }, true],
    ["save-state", { tier: "clean" }, false],
    ["save-state", { tier: "pending" }, false],
    ["save-state", { tier: "unsaved" }, true],
    ["save-state", { tier: "blocked" }, true],
    ["cowork-pen", { held: true }, true],
    ["preservation", { standing: true }, true],
    ["mirror-recovery", { standing: true }, true],
    ["sync-conflict", { standing: true }, true],
    ["external-change", { standing: true }, true],
    ["external-change", { standing: false }, false],
    ["pomodoro", { open: true }, true],
    ["pomodoro", { open: false }, false],
  ];
  it.each(cases)("%s %o → %s", (id, state, want) => {
    expect(barStatusVisible(id, state as never)).toBe(want);
  });

  it("every entry states WHY", () => {
    for (const [id, entry] of Object.entries(BAR_STATUS_POLICY)) {
      expect(entry.why.length, id).toBeGreaterThan(10);
    }
  });
});

describe("bar status policy · the surfaces", () => {
  it.each([
    ["waiting", false],
    ["waiting", true],
    ["activated-elsewhere", false],
    ["activated-elsewhere", true],
  ])("the update chip (%s, unsaved=%s) says exactly “Virgil update”", (state, dirty) => {
    updateState.value = state;
    unlanded.value = dirty;
    const { container } = render(<SoftwareUpdateBanner />);
    const label = container.querySelector("[data-bar-status-label]")!;
    expect(label.textContent).toBe(VIRGIL_UPDATE_LABEL);
    expect(VIRGIL_UPDATE_LABEL).toBe("Virgil update");
    // The state distinction moved to the hover hint.
    expect(label.getAttribute("data-hint")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("no update ⇒ no chip", () => {
    updateState.value = "none";
    const { container } = render(<SoftwareUpdateBanner />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByText(VIRGIL_UPDATE_LABEL)).toBeNull();
  });

  it("the skills-updated note is NOT a bar pill — it lives on the Help menu's Refresh skills row", () => {
    expect(read("src/components/SkillSyncControls.tsx")).not.toMatch(/Skills updated to v|SkillSyncNotice/);
    const cluster = read(CLUSTER);
    expect(cluster).toMatch(/Updated to v\{skillSyncNotice\.version\}/);
    expect(cluster).toMatch(/restart your Claude\s+Code cowork session/);
  });
});
