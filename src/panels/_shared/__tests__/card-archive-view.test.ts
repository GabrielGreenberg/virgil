/**
 * `filterByArchiveView` — the per-panel View Active / Archives / All filter
 * shared by CardListPanel + the menu. Pins the three-way semantics + that an
 * absent `archived` flag reads as active.
 */
import { describe, it, expect } from "vitest";
import { filterByArchiveView } from "../card-archive-view";

interface Row {
  id: string;
  archived?: boolean;
}

const rows: Row[] = [
  { id: "a" }, // absent ⇒ active
  { id: "b", archived: false }, // active
  { id: "c", archived: true }, // archived
  { id: "d", archived: true }, // archived
];

const getArchived = (r: Row) => !!r.archived;
const ids = (rs: Row[]) => rs.map((r) => r.id);

describe("filterByArchiveView", () => {
  it("active → only un-archived (absent flag counts as active)", () => {
    expect(ids(filterByArchiveView(rows, "active", getArchived))).toEqual([
      "a",
      "b",
    ]);
  });

  it("archived → only archived", () => {
    expect(ids(filterByArchiveView(rows, "archived", getArchived))).toEqual([
      "c",
      "d",
    ]);
  });

  it("all → everything, order preserved", () => {
    expect(ids(filterByArchiveView(rows, "all", getArchived))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("active + archived partition the list (no overlap, no loss)", () => {
    const active = filterByArchiveView(rows, "active", getArchived);
    const archived = filterByArchiveView(rows, "archived", getArchived);
    expect(active.length + archived.length).toBe(rows.length);
    expect(new Set([...ids(active), ...ids(archived)])).toEqual(
      new Set(ids(rows)),
    );
  });
});
