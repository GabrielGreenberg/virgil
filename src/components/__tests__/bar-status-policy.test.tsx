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
 *   item's component asks `useBarStatusVisible` with its OWN id — so the
 *   registry is read (AGENTS.md "A registry earns its name by being read");
 *   and every entry declares a settle window (task 1174), applied by that ONE
 *   hook — no item component arms a timer of its own for it;
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
  barStatusVerdict,
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
    "%s → <%s> asks useBarStatusVisible with its own id",
    (id, tag) => {
      const src = read(fileOf(tag));
      expect(src).toContain(`useBarStatusVisible("${id}"`);
      // The pure predicate is not a render gate: reading it directly would
      // skip the settle rule (task 1174).
      expect(src.replace(/useBarStatusVisible\(/g, "")).not.toMatch(/\bbarStatusVisible\(/);
    },
  );

  it("every entry DECLARES a settle window (task 1174) — even when it is 0", () => {
    for (const [id, entry] of Object.entries(BAR_STATUS_POLICY)) {
      expect(typeof entry.settleMs, id).toBe("number");
      expect(entry.settleMs, id).toBeGreaterThanOrEqual(0);
    }
  });

  it("no protected item reads a layout preference (zen / collapse) to decide visibility", () => {
    const items = clusterItems();
    const src = read(CLUSTER);
    const start = src.indexOf("const statusItems");
    const body = src.slice(start, src.indexOf("\n  };", start));
    expect(body).not.toMatch(/topbarRightCollapsed|collapsePreference|zenModeOn/);
    expect(items.size).toBe(BAR_STATUS_ORDER.length);
  });
});

/**
 * Task 1353 — a MODE indicator hand-placed in the collapsible tool group
 * vanishes with the tools (the Focus-view chip did). A control that is
 * `aria-pressed="true"` unconditionally is, by construction, a "this mode is
 * on" indicator, so it may not live in the collapsible subtree at all: it is a
 * policy entry. A pressed-STATE toggle there must be named below with the
 * reason its "on" is evident without the bar (or is the opener of a surface
 * that is itself visible while open).
 */
const COLLAPSIBLE_TOGGLES: Record<string, string> = {
  zenModeOn: "Zen — the stripped-chrome layout is itself the indicator.",
  codeView: "Code view — the code pane on screen is the indicator.",
  pdfView: "PDF view — the PDF pane on screen is the indicator (its stale dot is low-value; stays a tool).",
  bugReportOpen: "Opens the bug-report window, which is visible while open.",
  preferencesOpen: "Opens Preferences, which is visible while open.",
  printOpen: "Opens the print dialog, which is visible while open.",
  aiWindowOpen: "Opens the AI window, which is visible while open.",
  manageStylesOpen: "Opens the Document style modal, which is visible while open.",
};

function collapsibleSlice(): string {
  const src = read(CLUSTER);
  const start = src.indexOf('data-bar-tier="collapsible"');
  const end = src.indexOf("ref={collapseChipRef}", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
}

describe("bar status policy · mode indicators are policy entries (task 1353)", () => {
  it("no always-pressed mode chip is rendered inside the collapsible tool group", () => {
    expect(collapsibleSlice()).not.toMatch(/aria-pressed="true"/);
  });

  it("every pressed-state toggle in the collapsible group is allowlisted with a reason", () => {
    const exprs = [...collapsibleSlice().matchAll(/aria-pressed=\{([^}]+)\}/g)].map((m) => m[1]!.trim());
    expect(exprs.length).toBeGreaterThan(0);
    for (const e of exprs) {
      expect(COLLAPSIBLE_TOGGLES[e], `aria-pressed={${e}} in the collapsible group: a mode the user turned on belongs in BAR_STATUS_POLICY; a layout-evident toggle needs an allowlist reason`).toBeTruthy();
    }
    // And the allowlist carries no stale rows.
    for (const k of Object.keys(COLLAPSIBLE_TOGGLES)) expect(exprs, k).toContain(k);
  });

  it("the mode chips' components are not mounted inside the collapsible group", () => {
    const slice = collapsibleSlice();
    for (const tag of ["FocusViewChip", "HelperModeChip", "CompileStatusChip"]) {
      expect(slice).not.toContain(`<${tag}`);
    }
    expect(slice).not.toMatch(/variant="badge"/);
    // The compile spinner has ONE owner — the protected tier's chip.
    expect(slice).not.toContain("animate-spin");
  });
});

describe("bar status policy · the default answers", () => {
  const cases: [BarStatusItemId, object, boolean][] = [
    ["software-update", { update: "none" }, false],
    ["software-update", { update: "waiting" }, true],
    ["software-update", { update: "activated-elsewhere" }, true],
    ["skill-sync", { failed: false }, false],
    ["skill-sync", { failed: true }, true],
    ["save-state", { tier: "clean", reason: null }, false],
    ["save-state", { tier: "pending", reason: null }, false],
    ["save-state", { tier: "unsaved", reason: null }, true],
    ["save-state", { tier: "blocked", reason: "conflict" }, true],
    ["save-state", { tier: "blocked", reason: "preservation" }, true],
    ["save-state", { tier: "blocked", reason: "error" }, true],
    // Task 1174: a cowork hold is the cowork-pen pill's to explain.
    ["save-state", { tier: "blocked", reason: "cowork" }, false],
    ["cowork-pen", { held: true }, true],
    ["preservation", { standing: true }, true],
    ["mirror-recovery", { standing: true }, true],
    ["sync-conflict", { standing: true }, true],
    ["external-change", { standing: true, atRisk: false }, true],
    ["external-change", { standing: false, atRisk: false }, false],
    ["pomodoro", { open: true }, true],
    ["pomodoro", { open: false }, false],
    // Task 1353 — modes the user turned on survive collapse; zen hides them.
    ["focus-view", { active: true, zen: false }, true],
    ["focus-view", { active: true, zen: true }, false],
    ["focus-view", { active: false, zen: false }, false],
    ["helper-mode", { on: true, zen: false }, true],
    ["helper-mode", { on: true, zen: true }, false],
    ["helper-mode", { on: false, zen: false }, false],
    ["collab", { enabled: true, zen: false }, true],
    ["collab", { enabled: true, zen: true }, false],
    ["collab", { enabled: false, zen: false }, false],
    ["compile", { compiling: true }, true],
    ["compile", { compiling: false }, false],
  ];
  it.each(cases)("%s %o → %s", (id, state, want) => {
    expect(barStatusVisible(id, state as never)).toBe(want);
  });

  // Task 1174 — the settle rule's defaults: what paints at once, what must
  // LAST first.
  const verdicts: [BarStatusItemId, object, string][] = [
    ["save-state", { tier: "unsaved", reason: null }, "settle"],
    ["save-state", { tier: "blocked", reason: "preservation" }, "now"],
    ["save-state", { tier: "blocked", reason: "error" }, "now"],
    ["save-state", { tier: "blocked", reason: "conflict" }, "now"],
    ["save-state", { tier: "pending", reason: null }, "hidden"],
    ["cowork-pen", { held: true }, "settle"],
    ["external-change", { standing: true, atRisk: false }, "settle"],
    ["external-change", { standing: true, atRisk: true }, "now"],
    ["preservation", { standing: true }, "now"],
    ["mirror-recovery", { standing: true }, "now"],
    ["software-update", { update: "waiting" }, "now"],
    ["skill-sync", { failed: true }, "now"],
    ["pomodoro", { open: true }, "now"],
    ["focus-view", { active: true, zen: false }, "now"],
    ["helper-mode", { on: true, zen: false }, "now"],
    ["collab", { enabled: true, zen: false }, "now"],
    ["compile", { compiling: true }, "now"],
  ];
  it.each(verdicts)("verdict %s %o → %s", (id, state, want) => {
    expect(barStatusVerdict(id, state as never)).toBe(want);
  });

  it("the settle windows Gabriel's report asked for", () => {
    expect(BAR_STATUS_POLICY["save-state"].settleMs).toBeGreaterThanOrEqual(10_000);
    expect(BAR_STATUS_POLICY["cowork-pen"].settleMs).toBeGreaterThanOrEqual(10_000);
    expect(BAR_STATUS_POLICY["external-change"].settleMs).toBeGreaterThanOrEqual(5_000);
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
    // The Help menu left StatusCluster for its own file in task 1361.
    const help = read("src/components/editor-layout/HelpMenu.tsx");
    expect(help).toMatch(/Updated to v\{skillSyncNotice\.version\}/);
    expect(help).toMatch(/restart your Claude\s+Code\s+cowork session/);
  });
});
