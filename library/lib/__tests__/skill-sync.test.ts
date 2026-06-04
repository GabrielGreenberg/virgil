import { describe, expect, it } from "vitest";
import { diskPathFor } from "../skill-sync";

// diskPathFor is the routing table the per-folder skill-sync engine uses to
// place each bundled file (`<subsystem>/<bundle-relative path>`) on disk. This
// pins the operational-manifest route (chip 10) AND guards the two pre-existing
// prefixes against regression.
describe("diskPathFor", () => {
  describe("the operational-manifest route (manifest/* → .claude/virgil/)", () => {
    it("routes a manifest doc to a single shared .claude/virgil/, with no subsystem segment", () => {
      expect(diskPathFor("manifest", "identity.md")).toBe(".claude/virgil/identity.md");
      expect(diskPathFor("manifest", "INDEX.md")).toBe(".claude/virgil/INDEX.md");
      expect(diskPathFor("manifest", "sidecars.md")).toBe(".claude/virgil/sidecars.md");
    });
  });

  describe("the pre-existing routes are unchanged (back-compat)", () => {
    it("keeps claude-commands/* under .claude/commands/<subsystem>/", () => {
      expect(diskPathFor("editor", "claude-commands/draft-footnote.md")).toBe(
        ".claude/commands/editor/draft-footnote.md",
      );
      expect(diskPathFor("library", "claude-commands/index-paper.md")).toBe(
        ".claude/commands/library/index-paper.md",
      );
      expect(diskPathFor("virgil", "claude-commands/start.md")).toBe(
        ".claude/commands/virgil/start.md",
      );
    });

    it("keeps scripts/* under .virgil/scripts/<subsystem>/", () => {
      expect(diskPathFor("editor", "scripts/apply_response.py")).toBe(
        ".virgil/scripts/editor/apply_response.py",
      );
      expect(diskPathFor("library", "scripts/_tools.py")).toBe(
        ".virgil/scripts/library/_tools.py",
      );
    });

    it("keeps the library-only workspace CLAUDE.md special case", () => {
      expect(diskPathFor("library", "CLAUDE.md")).toBe(".claude/CLAUDE.md");
      // The special case is library-scoped; another subsystem's CLAUDE.md is
      // not a recognised path.
      expect(diskPathFor("editor", "CLAUDE.md")).toBeUndefined();
    });
  });

  describe("unrecognised paths are skipped (undefined)", () => {
    it("returns undefined for an unknown bundle-relative prefix", () => {
      expect(diskPathFor("editor", "weird/x.md")).toBeUndefined();
    });
    it("does not treat a non-manifest subsystem's bare file as a manifest doc", () => {
      // Only the `manifest` subsystem routes a bare `<file>` to .claude/virgil/.
      expect(diskPathFor("editor", "identity.md")).toBeUndefined();
    });
    it("routes a known prefix even under an unknown subsystem (prefix-keyed, not subsystem-keyed)", () => {
      // The commands/scripts branches key on the bundle-relative prefix and use
      // the subsystem only as the destination dir segment — so an unrecognised
      // subsystem with a known prefix still routes. (Subsystems are constrained
      // upstream by the meta-manifest's `sources`, not here.)
      expect(diskPathFor("bogus", "claude-commands/x.md")).toBe(
        ".claude/commands/bogus/x.md",
      );
    });
  });
});
