/**
 * Lifecycle WRONG-FLAG assertion (test-hardening chip, Session-17 handoff).
 *
 * `assertLifecycleCoverage` (src/panels/card-lifecycle-registry.tsx) is the
 * only check that a per-doc lifecycle registry provides EXACTLY the ops
 * `CARD_REGISTRY[kind].lifecycle` declares — but it's a dev-only
 * console.error fired at runtime from EditorPane, invisible to CI. This
 * suite arms it: it fails `npx vitest run` (the coherence.yml typecheck job)
 * if the checker ever stops catching a wrong flag, and pins each mismatch
 * direction:
 *
 *   - a WIRED-but-UNDECLARED op (silently granting clone/delete to an
 *     all-false kind, e.g. "filling" the R18/R19 permanent gaps),
 *   - a DECLARED-but-UNWIRED op (capability silently dropped),
 *   - a bindAnchor mismatch (the Mode-B re-bind the duplicate cascade needs),
 *   - and that a registry built EXACTLY per the declarations is silent.
 *
 * NOTE: this does NOT verify EditorPane's live provider value (that needs a
 * full editor mount); it verifies the checker EditorPane runs against it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  assertLifecycleCoverage,
  type CardLifecycle,
  type CardLifecycleRegistry,
} from "@/panels/card-lifecycle-registry";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_KINDS } from "@/cards/predicates";

/** Build a registry that wires EXACTLY what each kind declares. */
function conformingRegistry(): CardLifecycleRegistry {
  const reg: CardLifecycleRegistry = {};
  for (const k of CARD_KINDS) {
    const d = CARD_REGISTRY[k].lifecycle;
    if (!d.clone && !d.delete && !d.bindAnchor) continue; // nothing to wire
    const entry: Partial<CardLifecycle> = {};
    if (d.clone) entry.clone = () => null;
    if (d.delete) entry.delete = () => {};
    if (d.bindAnchor) entry.bindAnchor = () => {};
    reg[k] = entry as CardLifecycle;
  }
  return reg;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assertLifecycleCoverage (the lifecycle wrong-flag check, CI-armed)", () => {
  it("a registry wired exactly per CARD_REGISTRY declarations is SILENT", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    assertLifecycleCoverage(conformingRegistry());
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("catches a WIRED-but-UNDECLARED op (filling a permanent gap, e.g. example.clone)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reg = conformingRegistry();
    // R19: example is a PERMANENT all-false gap — wiring a clone is exactly
    // the "wrong flag" a future chip might ship.
    reg.example = { clone: () => null, delete: () => {} } as CardLifecycle;
    assertLifecycleCoverage(reg);
    expect(errSpy).toHaveBeenCalled();
    const msg = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(msg).toContain('"example"');
  });

  it("catches a DECLARED-but-UNWIRED op (capability silently dropped, e.g. note)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reg = conformingRegistry();
    // note declares { clone:true, delete:true, bindAnchor:true } — drop it
    // from the provider entirely.
    delete reg.note;
    assertLifecycleCoverage(reg);
    expect(errSpy).toHaveBeenCalled();
    const msg = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(msg).toContain('"note"');
  });

  it("catches a bindAnchor mismatch in either direction", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reg = conformingRegistry();
    // footnote declares bindAnchor: false — wiring one is a wrong flag…
    reg.footnote = {
      ...(reg.footnote as CardLifecycle),
      bindAnchor: () => {},
    };
    // …and cutter-comment declares bindAnchor: true — unwiring it is too.
    const cc = { ...(reg["cutter-comment"] as CardLifecycle) };
    delete (cc as Partial<CardLifecycle>).bindAnchor;
    reg["cutter-comment"] = cc;
    assertLifecycleCoverage(reg);
    const msg = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(msg).toContain('"footnote"');
    expect(msg).toContain('"cutter-comment"');
  });

  it("one error per mismatched kind, none for conforming kinds", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const reg = conformingRegistry();
    reg.example = { clone: () => null, delete: () => {} } as CardLifecycle;
    assertLifecycleCoverage(reg);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});
