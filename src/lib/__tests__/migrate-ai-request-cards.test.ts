/**
 * Pins the BUG #55b(b) one-time migration: UNLINKED note/todo
 * `ai-requests.json` entries become real Note/Todo cards with the per-card
 * `aiRequest` flag, re-bridged to the request via `linkedTo`.
 *
 * The contract the task fixes in stone: the migration PRESERVES text + kind,
 * SETS the per-card flag, and RE-BRIDGES `linkedTo` — and converts NOTHING
 * else (footnote/citation/suggestion stay in the AIWindow; linked + terminal
 * requests are untouched), so it can run on every load idempotently.
 */
import { describe, it, expect } from "vitest";
import { migrateUnlinkedCardRequests } from "@/lib/migrate-ai-request-cards";
import type { AiRequest } from "@/lib/types";

const NOW = "2026-06-21T12:00:00.000Z";

function idGen() {
  let n = 0;
  return () => `card-${++n}`;
}

const deps = () => ({ genId: idGen(), now: () => NOW });

function req(partial: Partial<AiRequest> & Pick<AiRequest, "id" | "kind">): AiRequest {
  return {
    text: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "draft",
    ...partial,
  };
}

describe("migrateUnlinkedCardRequests (#55b retire ai kind)", () => {
  it("converts an unlinked note request → a Note card + re-bridged request", () => {
    const r = req({ id: "r1", kind: "note", text: "summarize the related work" });
    const out = migrateUnlinkedCardRequests([r], deps());

    expect(out.changed).toBe(true);
    expect(out.addedTodos).toHaveLength(0);
    expect(out.addedNotes).toHaveLength(1);

    const note = out.addedNotes[0];
    // sets the per-card flag
    expect(note.aiRequest).toBe(true);
    expect(note.kind).toBe("note");
    expect(note.links).toEqual([]);
    // preserves text (in the note body)
    expect(JSON.stringify(note.content)).toContain("summarize the related work");

    const relinked = out.relinkedRequests[0];
    // preserves text + kind
    expect(relinked.kind).toBe("note");
    expect(relinked.text).toBe("summarize the related work");
    // re-bridges linkedTo at the new card
    expect(relinked.linkedTo).toEqual({ panel: "notes", cardId: note.id });
    // legacy draft normalized to the v1 open status the bridge writes
    expect(relinked.status).toBe("pending");
    // same request identity (in-place re-link, not a fresh request)
    expect(relinked.id).toBe("r1");
  });

  it("converts an unlinked todo request → a Todo card + re-bridged request", () => {
    const r = req({ id: "r2", kind: "todo", text: "tighten the conclusion", status: "pending" });
    const out = migrateUnlinkedCardRequests([r], deps());

    expect(out.addedNotes).toHaveLength(0);
    expect(out.addedTodos).toHaveLength(1);

    const todo = out.addedTodos[0];
    expect(todo.aiRequest).toBe(true);
    expect(todo.done).toBe(false);
    expect(todo.links).toEqual([]);
    // preserves text (todo body IS the text)
    expect(todo.text).toBe("tighten the conclusion");

    const relinked = out.relinkedRequests[0];
    expect(relinked.kind).toBe("todo");
    expect(relinked.text).toBe("tighten the conclusion");
    expect(relinked.linkedTo).toEqual({ panel: "todos", cardId: todo.id });
    expect(relinked.status).toBe("pending");
  });

  it("does NOT convert footnote / citation / suggestion / highlight requests", () => {
    const reqs: AiRequest[] = [
      req({ id: "fn", kind: "footnote", text: "cite Vannevar" }),
      req({ id: "ci", kind: "citation", text: "find the source" }),
      req({ id: "sg", kind: "suggestion", text: "apply cut" }),
      req({ id: "hl", kind: "highlight", text: "mark this" }),
    ];
    const out = migrateUnlinkedCardRequests(reqs, deps());
    expect(out.changed).toBe(false);
    expect(out.addedNotes).toHaveLength(0);
    expect(out.addedTodos).toHaveLength(0);
    expect(out.relinkedRequests).toHaveLength(0);
  });

  it("leaves ALREADY-LINKED note/todo requests untouched (idempotent re-run)", () => {
    const reqs: AiRequest[] = [
      req({ id: "n", kind: "note", text: "x", status: "pending", linkedTo: { panel: "notes", cardId: "existing-note" } }),
      req({ id: "t", kind: "todo", text: "y", status: "pending", linkedTo: { panel: "todos", cardId: "existing-todo" } }),
    ];
    const out = migrateUnlinkedCardRequests(reqs, deps());
    expect(out.changed).toBe(false);
    expect(out.addedNotes).toHaveLength(0);
    expect(out.addedTodos).toHaveLength(0);
  });

  it("leaves TERMINAL (complete/failed) note/todo requests untouched", () => {
    const reqs: AiRequest[] = [
      req({ id: "n", kind: "note", text: "done note", status: "complete" }),
      req({ id: "t", kind: "todo", text: "failed todo", status: "failed" }),
    ];
    const out = migrateUnlinkedCardRequests(reqs, deps());
    expect(out.changed).toBe(false);
    expect(out.relinkedRequests).toHaveLength(0);
  });

  it("running on the migration's own output is a no-op (re-link sticks)", () => {
    const r = req({ id: "r1", kind: "note", text: "hello" });
    const first = migrateUnlinkedCardRequests([r], deps());
    // Feed the relinked request back in (simulating a reload after migration).
    const second = migrateUnlinkedCardRequests(first.relinkedRequests, deps());
    expect(second.changed).toBe(false);
    expect(second.addedNotes).toHaveLength(0);
  });

  it("preserves paragraphIds / selectedText carried on the source request", () => {
    const r = req({
      id: "r1",
      kind: "note",
      text: "anchored note",
      paragraphIds: ["p-1", "p-2"],
      selectedText: "the quoted span",
    });
    const out = migrateUnlinkedCardRequests([r], deps());
    const relinked = out.relinkedRequests[0];
    expect(relinked.paragraphIds).toEqual(["p-1", "p-2"]);
    expect(relinked.selectedText).toBe("the quoted span");
  });

  it("handles an empty unlinked note request (empty body, still flagged)", () => {
    const r = req({ id: "r1", kind: "note", text: "" });
    const out = migrateUnlinkedCardRequests([r], deps());
    expect(out.addedNotes).toHaveLength(1);
    expect(out.addedNotes[0].aiRequest).toBe(true);
    expect(out.relinkedRequests[0].linkedTo).toEqual({
      panel: "notes",
      cardId: out.addedNotes[0].id,
    });
  });
});
