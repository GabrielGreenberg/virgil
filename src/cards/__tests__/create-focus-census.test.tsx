// @vitest-environment jsdom
//
// Task 1358 — "drop the caret into a new card's field" has ONE owner per half:
//
//   1. WHICH kinds focus on create is `CARD_REGISTRY[kind].createFocus` — read
//      by `finishCreate` through `focusesBodyOnCreate`. The hand-kept
//      `EDITABLE_BODY_KINDS` set (and its "keep in lockstep" docstring) is gone.
//   2. WHICH field gets the caret is NAMED by the card — its
//      `data-card-primary-field` stamp — not guessed by `focusNewCard` from DOM
//      shape in a per-kind `switch` (which carried a dead `"revision"` case).
//
// The census: every `createFocus: "body"` kind's card component stamps exactly
// one primary field, and the stamp resolves to the RIGHT field (todo → its
// title input, not the notes textarea; a suggestion → its first EDITABLE
// textarea, not the read-only captured original).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup } from "@testing-library/react";
import { CARD_REGISTRY } from "../card-registry";
import { focusesBodyOnCreate } from "../predicates";
import type { CardKind } from "../types";
import { EditableCard, CardTitleInput } from "@/components/panel-primitives";
import { FieldBlock } from "@/panels/_shared/suggestion-fields";
import {
  FIELD_ORDER,
  FIRST_EDITABLE_FIELD,
  READONLY_HUMAN_FIELDS,
} from "@/panels/_shared/suggestion-field-vocabulary";
import {
  CARD_PRIMARY_FIELD_ATTR,
  findCardPrimaryField,
} from "@/lib/card-primary-field";
import { focusNewCard } from "@/lib/focus-new-card";
import { createViewLifetime } from "@/lib/tiptap/view-lifetime";
import { themeFromAccent } from "@/lib/panel-theme";

const SRC = path.resolve(__dirname, "../..");
const KINDS = Object.keys(CARD_REGISTRY) as CardKind[];
const THEME = themeFromAccent("#7a6ff0");

/** Each `createFocus: "body"` kind → the component that renders its card, and
 *  the door it stamps its primary field through. A new body kind fails the
 *  coverage leg until it is added here (and stamps). */
const STAMP_DOOR: Record<string, { file: string; door: RegExp }> = {
  note: { file: "panels/Notes/NoteCard.tsx", door: /<EditableCard\b/ },
  footnote: { file: "panels/Footnotes/FootnoteCard.tsx", door: /<EditableCard\b/ },
  archive: { file: "panels/Archive/ArchiveCard.tsx", door: /<EditableCard\b/ },
  report: { file: "panels/Reports/ReportCard.tsx", door: /<EditableCard\b/ },
  "report-request": { file: "panels/Reports/ReportRequestCard.tsx", door: /<EditableCard\b/ },
  "revision-comment": { file: "panels/Revisions/RevisionRequestCard.tsx", door: /<EditableCard\b/ },
  "cutter-comment": { file: "panels/Cutter/CutterCommentCard.tsx", door: /<EditableCard\b/ },
  todo: { file: "panels/Todo/TodoRow.tsx", door: /<CardTitleInput\b[\s\S]{0,800}?\bprimaryField\b/ },
  "revision-suggestion": {
    file: "panels/_shared/SuggestionCard.tsx",
    door: /primary=\{field === FIRST_EDITABLE_FIELD\}/,
  },
  "cutter-suggestion": {
    file: "panels/_shared/SuggestionCard.tsx",
    door: /primary=\{field === FIRST_EDITABLE_FIELD\}/,
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("CARD_REGISTRY.createFocus is the one 'focus on create' table (task 1358)", () => {
  it("every kind declares it; citation's popover owns its own focus", () => {
    for (const k of KINDS) {
      expect(["body", "popover", null]).toContain(CARD_REGISTRY[k].createFocus);
    }
    expect(CARD_REGISTRY.citation.createFocus).toBe("popover");
    expect(focusesBodyOnCreate("citation")).toBe(false);
    expect(focusesBodyOnCreate("highlight")).toBe(false);
  });

  it("a 'body' kind has a user-content model to type into", () => {
    for (const k of KINDS.filter(focusesBodyOnCreate)) {
      expect(CARD_REGISTRY[k].content, k).not.toBeNull();
    }
  });

  it("every 'body' kind's card component stamps its primary field through a door", () => {
    const bodyKinds = KINDS.filter(focusesBodyOnCreate).sort();
    expect(bodyKinds).toEqual(Object.keys(STAMP_DOOR).sort());
    for (const k of bodyKinds) {
      const { file, door } = STAMP_DOOR[k];
      const src = readFileSync(path.join(SRC, file), "utf8").replace(/\s+/g, " ");
      expect(door.test(src), `${k} (${file})`).toBe(true);
    }
  });

  it("the hand-kept kind tables are gone from the focuser", () => {
    const src = readFileSync(path.join(SRC, "lib/focus-new-card.ts"), "utf8");
    expect(src).not.toMatch(/EDITABLE_BODY_KINDS/);
    expect(src).not.toMatch(/case "revision":/);
    expect(src).not.toMatch(/switch \(kind\)/);
  });
});

describe("each stamp door renders exactly one primary field, on the right element", () => {
  it("EditableCard stamps its rich body (not the body title input)", () => {
    const { container } = render(
      <EditableCard
        id="n1"
        kind="note"
        cardKind="note"
        selected
        theme={THEME}
        hideToolbar
        bodyTitle="A title"
        onBodyTitleChange={() => {}}
        onDelete={() => {}}
        value={{ type: "doc", content: [] } as never}
        onChange={() => {}}
        placeholder="Text here."
      />,
    );
    const stamps = container.querySelectorAll(`[${CARD_PRIMARY_FIELD_ATTR}]`);
    expect(stamps).toHaveLength(1);
    // The stamp wraps the RichTextField, never the title input.
    expect(stamps[0].querySelector("input")).toBeNull();
  });

  it("todo: the title input is primary, not the notes textarea", () => {
    const { container } = render(
      <div>
        <CardTitleInput defaultValue="a todo" onChange={() => {}} primaryField />
        <textarea defaultValue="notes" />
      </div>,
    );
    expect(container.querySelectorAll(`[${CARD_PRIMARY_FIELD_ATTR}]`)).toHaveLength(1);
    expect(findCardPrimaryField(container)).toBeInstanceOf(HTMLInputElement);
  });

  it("suggestion: the first EDITABLE field is primary — the read-only original never is", () => {
    expect(FIRST_EDITABLE_FIELD).toBeDefined();
    expect(READONLY_HUMAN_FIELDS.has(FIRST_EDITABLE_FIELD!)).toBe(false);
    const { container } = render(
      <div>
        {FIELD_ORDER.map((field) => (
          <FieldBlock
            key={field}
            field={field}
            value=""
            onChange={() => {}}
            readOnly={READONLY_HUMAN_FIELDS.has(field)}
            panelKey={undefined}
            primary={field === FIRST_EDITABLE_FIELD}
          />
        ))}
      </div>,
    );
    const stamps = container.querySelectorAll(`[${CARD_PRIMARY_FIELD_ATTR}]`);
    expect(stamps).toHaveLength(1);
    const target = findCardPrimaryField(container);
    expect(target).toBeInstanceOf(HTMLTextAreaElement);
    expect((target as HTMLTextAreaElement).readOnly).toBe(false);
  });
});

describe("focusNewCard focuses the stamped field", () => {
  let rafQueue: FrameRequestCallback[] = [];
  const flush = (n: number) => {
    for (let i = 0; i < n; i++) {
      const q = rafQueue;
      rafQueue = [];
      for (const cb of q) cb(0);
    }
  };
  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  function mountCard(key: string, html: string): HTMLElement {
    const card = document.createElement("div");
    card.setAttribute("data-card-key", key);
    card.innerHTML = html;
    document.body.appendChild(card);
    return card;
  }

  it("todo-shaped card: the stamped title input wins over an earlier textarea", () => {
    const card = mountCard(
      "float:card:todo:t1",
      `<textarea id="notes"></textarea><input type="text" id="title" ${CARD_PRIMARY_FIELD_ATTR} />`,
    );
    focusNewCard("float:card:todo:t1", createViewLifetime());
    flush(3);
    expect(document.activeElement).toBe(card.querySelector("#title"));
  });

  it("a stamped wrapper whose editor has not mounted yet is waited for, not bypassed", () => {
    const card = mountCard(
      "float:card:note:n9",
      `<input type="text" id="title" /><div ${CARD_PRIMARY_FIELD_ATTR} id="wrap"></div>`,
    );
    focusNewCard("float:card:note:n9", createViewLifetime());
    flush(3);
    // Not the title input — the focuser waits for the named field.
    expect(document.activeElement).not.toBe(card.querySelector("#title"));
    const body = document.createElement("div");
    body.setAttribute("contenteditable", "true");
    card.querySelector("#wrap")!.appendChild(body);
    flush(2);
    expect(document.activeElement).toBe(body);
  });
});
