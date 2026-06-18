/**
 * BIB-A2-04 — a citekey rename must NOT strand a popped-out bibliography float
 * or the panel selection.
 *
 * The bib float key is `float:card:bib:<citekey>` and the floatable resolves
 * the entry BY citekey; the panel selection (`selectedBibKey`) is citekey-keyed
 * too. Without a lockstep re-point on rename, the popped window blanks/dies and
 * its saved rect orphans, and the selection loses its target.
 *
 * The deep fix routes the re-point through the IdentityCascade as the single
 * writer: EditorPane registers a `bibEntry` migrator that, on a `renameCitekey`
 * change, (1) lockstep-remaps the float key via `remapCardPopKey` and (2)
 * re-points the selection. This test pins that contract at the cascade level
 * (the EditorPane migrator is a thin wiring of exactly this shape) and proves
 * it composes with the OTHER `bibEntry` migrator (the editor `\cite{}` rewrite)
 * — both fan out on ONE rename.
 */

import { describe, it, expect } from "vitest";
import {
  IdentityCascade,
  renameCitekeyChange,
  isRenameCitekey,
} from "../identity-cascade";
import { cardPopKey } from "@/panels/panel-registry";

describe("bib float + selection re-point on rename (BIB-A2-04)", () => {
  it("lockstep-remaps the float key and re-points the selection", async () => {
    const cascade = new IdentityCascade();

    // Stand-ins for EditorPane's `viewPrefs.remapCardPopKey` + `setSelectedBibKey`.
    const remaps: Array<[string, string]> = [];
    let selectedBibKey: string | null = "foo"; // the renamed entry is selected

    cascade.registerMigrator("bibEntry", (change) => {
      if (!isRenameCitekey(change)) return;
      const { oldKey, newKey } = change.renameCitekey;
      if (oldKey === newKey) return;
      remaps.push([cardPopKey("bib", oldKey), cardPopKey("bib", newKey)]);
      selectedBibKey = selectedBibKey === oldKey ? newKey : selectedBibKey;
    });

    await cascade.runIdentityChange(
      renameCitekeyChange({ uid: "u1", oldKey: "foo", newKey: "newfoo" }),
    );

    // 1. The float key was lockstep-remapped old → new.
    expect(remaps).toEqual([["float:card:bib:foo", "float:card:bib:newfoo"]]);
    // 2. The panel selection followed the rename.
    expect(selectedBibKey).toBe("newfoo");
  });

  it("does not touch the selection when a DIFFERENT entry is selected", async () => {
    const cascade = new IdentityCascade();
    let selectedBibKey: string | null = "other";
    cascade.registerMigrator("bibEntry", (change) => {
      if (!isRenameCitekey(change)) return;
      const { oldKey, newKey } = change.renameCitekey;
      selectedBibKey = selectedBibKey === oldKey ? newKey : selectedBibKey;
    });
    await cascade.runIdentityChange(
      renameCitekeyChange({ uid: "u1", oldKey: "foo", newKey: "newfoo" }),
    );
    expect(selectedBibKey).toBe("other"); // untouched
  });

  it("composes with the \\cite{} rewrite migrator — both fan out on one rename", async () => {
    const cascade = new IdentityCascade();
    const order: string[] = [];
    // Migrator A: the editor \cite{} doc-rewrite (its real EditorPane sibling).
    cascade.registerMigrator("bibEntry", (c) => {
      if (isRenameCitekey(c)) order.push("cite-rewrite");
    });
    // Migrator B: the float/selection re-point (this slice's addition).
    cascade.registerMigrator("bibEntry", (c) => {
      if (isRenameCitekey(c)) order.push("float-selection");
    });

    await cascade.runIdentityChange(
      renameCitekeyChange({ uid: "u1", oldKey: "foo", newKey: "newfoo" }),
    );

    expect(order.sort()).toEqual(["cite-rewrite", "float-selection"]);
    expect(cascade.migratorCount("bibEntry")).toBe(2);
  });
});
