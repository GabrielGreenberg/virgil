// Task 386 — the CENSUS half.
//
// The shared door (`useCardDeleteKey`) was never the part that could misbehave.
// A card component that attaches its OWN shell-level Delete/Backspace handler
// is: that is exactly what `EditableCard` did for a year, on the strength of a
// docstring claiming its `isFocused` focus-tracking already encoded the field
// guard — true of the body editor, false of the title input, and a silent data
// loss. Two handlers whose guards must agree is how the two drifted apart, and
// no behavioural test of the door can see a second one.
//
// So: no production card surface may spell a Delete/Backspace card-delete
// handler of its own. The allowlist is EMPTY — a hit is ROUTE-it-through-the-
// door, never an entry.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { codeOnly, commentsStripped, tagAround, walkFiles } from "@/lib/__tests__/_source-scan";

const ROOT = join(__dirname, "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const p of walkFiles(dir, { skipDirs: ["__tests__"] })) if (/\.tsx?$/.test(p)) out.push(p);
  return out;
}

/** Every production source file under the two card-bearing trees. Membership is
 *  DISCOVERED, not hand-listed: a new panel is covered by existing. */
const CARD_SOURCES = [
  ...walk(join(ROOT, "src", "components")),
  ...walk(join(ROOT, "src", "panels")),
  ...walk(join(ROOT, "src", "cards")),
];

/** The door itself + the shared guard it calls. Everything else is a call
 *  site. */
const DOOR_FILE = join(ROOT, "src", "components", "panel-primitives.tsx");

/** A comparison against the Backspace/Delete key names, in code (literals kept
 *  — the drift lives inside the quotes). */
const KEY_TEST = /\.key\s*===\s*["'](?:Backspace|Delete)["']|["'](?:Backspace|Delete)["']\s*===\s*\w*\.key/;

/** A destructive verb near the hit — what makes a key handler a DELETE handler
 *  rather than, say, a menu's letter alias or an editor keymap. */
const DESTRUCTIVE = /\b(?:onDelete|tryDelete|onDismiss|doDelete|handleDelete|deleteCard|removeCard)\b/;

/**
 * The ONE exemption, scoped to the SHAPE that justifies it rather than to the
 * file (task 204's rule): the margin marker's own key handler.
 *
 * A marker is a LEAF `<button>` — it is the focused target itself and can
 * contain no field — so "did this key come from a nested interactive control?"
 * has no meaning there, and `useCardDeleteKey` (which needs a card, a
 * `selected` axis and a shell to compare against) is the wrong door. The
 * exemption carries its own PROOF leg below: the handler must still sit on a
 * `<button>`. Give the marker a nested input and the exemption expires.
 */
const LEAF_CONTROL_EXEMPTIONS = [
  { file: "src/components/Marginalia.tsx", tag: /^<button/ },
];

describe("card-delete key: ONE door (task 386)", () => {
  /** Every `Delete`/`Backspace`-with-a-destructive-verb site under the card
   *  trees, as `relPath:line`. The window is 5 lines so the two-line form the
   *  retired handler actually had (`if (e.key === …) { … onDelete() }`) is
   *  seen, not just the single-line one. */
  function destructiveKeySites(): { rel: string; line: number; index: number }[] {
    const out: { rel: string; line: number; index: number }[] = [];
    for (const file of CARD_SOURCES) {
      if (file === DOOR_FILE) continue;
      const src = commentsStripped(readFileSync(file, "utf8"));
      const lines = src.split("\n");
      let offset = 0;
      lines.forEach((line, i) => {
        const at = offset;
        offset += line.length + 1;
        if (!KEY_TEST.test(line)) return;
        if (!DESTRUCTIVE.test(lines.slice(i, i + 5).join("\n"))) return;
        out.push({ rel: relative(ROOT, file), line: i + 1, index: at });
      });
    }
    return out;
  }

  it("no card surface spells its own Delete/Backspace card-delete handler", () => {
    const hits = destructiveKeySites()
      .filter((h) => !LEAF_CONTROL_EXEMPTIONS.some((e) => e.file === h.rel))
      .map((h) => `${h.rel}:${h.line}`);
    expect(hits).toEqual([]);
  });

  it("every exemption still describes a LEAF control, and still covers one", () => {
    const sites = destructiveKeySites();
    for (const ex of LEAF_CONTROL_EXEMPTIONS) {
      const mine = sites.filter((h) => h.rel === ex.file);
      // An exemption that has stopped excusing anything is a standing licence
      // for the next shell handler added under the exempted name.
      expect(mine.length).toBeGreaterThan(0);
      const src = commentsStripped(readFileSync(join(ROOT, ex.file), "utf8"));
      for (const h of mine) {
        const tag = tagAround(src, h.index);
        expect(tag, `${ex.file}:${h.line} has no enclosing JSX tag`).toBeTruthy();
        expect(tag!.slice(0, 40)).toMatch(ex.tag);
      }
    }
  });

  it("the door file itself declares the key test EXACTLY once (in the hook)", () => {
    // A canary for the census above: if `KEY_TEST` ever stops matching the real
    // shape, this leg goes to 0 and the census passes vacuously.
    const src = codeOnly(readFileSync(DOOR_FILE, "utf8"));
    const matches = src
      .split("\n")
      .filter((l) => /e\.key === "Delete" \|\| e\.key === "Backspace"/.test(l));
    // `codeOnly` blanks literals, so match on the un-blanked source instead.
    const raw = commentsStripped(readFileSync(DOOR_FILE, "utf8"));
    const rawMatches = raw.split("\n").filter((l) => KEY_TEST.test(l));
    expect(matches.length + rawMatches.length).toBeGreaterThan(0);
    expect(rawMatches).toHaveLength(1);
  });

  it("EditableCard routes its shell key through the shared hook", () => {
    const raw = commentsStripped(readFileSync(DOOR_FILE, "utf8"));
    // The retired bespoke handler is gone…
    expect(raw).not.toMatch(/if \(!selected \|\| !onDelete \|\| isFocused\) return;/);
    // …and the shell handler is the hook's return value.
    expect(raw).toMatch(/const handleKeyDown = useCardDeleteKey\(/);
  });
});

describe("a destructive bare-key shortcut bails on an editable target (task 386 sweep)", () => {
  it("the menu controller's window-CAPTURE handler consults the editable guard", () => {
    const p = join(ROOT, "src", "components", "menu", "useMenuKeyboard.ts");
    const raw = commentsStripped(readFileSync(p, "utf8"));
    expect(raw).toMatch(/isEditableEventTarget\(e\.target\)/);
    // …and it does so in the WINDOW source, before consuming. (The combobox
    // handler is wired by the caller onto the menu's own input and must keep
    // working.)
    const win = raw.slice(raw.indexOf('source !== "window"'));
    expect(win).toMatch(/isEditableEventTarget/);
  });

  it("the editable-target predicate lives in the import-free leaf", () => {
    const leaf = readFileSync(join(ROOT, "src", "lib", "drag-blocklist.ts"), "utf8");
    expect(leaf).toMatch(/export function isEditableEventTarget/);
    // The leaf's whole point: nothing to import, so any layer can take it.
    expect(commentsStripped(leaf)).not.toMatch(/^\s*import\s/m);
  });
});

// Task 702 — the PERMIT half. The door above guarantees the key's GUARDS; it
// cannot see what the key RUNS. A keyboard delete has no button for the host
// to withhold, so the thunk it arms must itself ask the host permit (task 637).
//
// Task 976 moved the ARM into the shell: `PanelCard` arms Delete/Backspace from
// its own `onTrashClick` (gated on the same permit that hides the trash), so a
// card cannot offer the trash without the key — a citation did, for as long as
// each kind wired its own `useCardDeleteKey`. The census therefore reads the
// TRASH thunk each card hands the shell: it must be the shared executor
// (`usePanelCardTryDelete`, which asks the permit and owns the content
// confirm), never a raw `onDelete`, and no card may arm the key itself.
describe("card-delete key: the shell arms it from the trash, and the thunk asks the permit (tasks 702 + 976)", () => {
  /** A call site that DISMISSES rather than deletes a card record — no sidecar
   *  card write for a host to refuse. Scoped to the file AND the verb. */
  const DISMISS_EXEMPTIONS = [
    { file: "src/panels/Errors/ErrorCard.tsx", arg: /^\(\)\s*=>\s*onDismiss\(/ },
  ];

  function trashSites(): { rel: string; src: string; arg: string }[] {
    const out: { rel: string; src: string; arg: string }[] = [];
    for (const file of CARD_SOURCES) {
      if (file === DOOR_FILE) continue;
      const src = commentsStripped(readFileSync(file, "utf8"));
      for (const m of src.matchAll(/onTrashClick=\{([^}]*(?:\}[^}]*)?)\}\s*$/gm)) {
        out.push({ rel: relative(ROOT, file), src, arg: m[1].trim() });
      }
    }
    return out;
  }

  it("census canary: the scan still finds the known trash sites", () => {
    // Todo, Highlight, Citation, the shared Suggestion card, Error.
    expect(trashSites().length).toBeGreaterThanOrEqual(5);
  });

  it("no card arms the delete key itself — the shell does, from the trash", () => {
    const bad = CARD_SOURCES.filter((f) => f !== DOOR_FILE)
      .filter((f) => /\buseCardDeleteKey\(/.test(commentsStripped(readFileSync(f, "utf8"))))
      .map((f) => relative(ROOT, f));
    expect(bad).toEqual([]);
    // …and the shell really does arm it from the trash thunk.
    const door = commentsStripped(readFileSync(DOOR_FILE, "utf8"));
    expect(door).toMatch(/const armedDelete = onTrashClick && deleteAllowed \? onTrashClick : undefined;/);
    expect(door).toMatch(/useCardDeleteKey\(selected, armedDelete\)/);
  });

  it("no trash thunk is a raw onDelete; every deleting card routes through the shared executor", () => {
    const bad: string[] = [];
    for (const site of trashSites()) {
      const exempt = DISMISS_EXEMPTIONS.find(
        (e) => e.file === site.rel && e.arg.test(site.arg),
      );
      if (exempt) continue;
      if (/\bonDelete\s*\(/.test(site.arg)) {
        bad.push(`${site.rel}: raw onDelete on the trash (${site.arg})`);
        continue;
      }
      if (!/\busePanelCardTryDelete\(/.test(site.src)) {
        bad.push(`${site.rel}: trash thunk is not the shared executor`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every dismiss exemption still covers a live trash site", () => {
    const sites = trashSites();
    for (const ex of DISMISS_EXEMPTIONS) {
      expect(sites.some((s) => s.rel === ex.file && ex.arg.test(s.arg))).toBe(true);
    }
  });
});

// Task 976 — the CONFIRM half. Three copies of "delete this card, confirming if
// it has content" (EditableCard, TodoRow, the shared hook) drifted on placement:
// two opened beside the card, the hook screen-centred. There is one now.
describe("card-delete confirm: ONE door (task 976)", () => {
  const SRC_ROOT = join(ROOT, "src");
  const ALL_SOURCES = walk(SRC_ROOT);

  it("the confirm wording is spelled once, in has-content.ts", () => {
    const owner = join(SRC_ROOT, "cards", "has-content.ts");
    const hits = ALL_SOURCES.filter((f) => f !== owner)
      .filter((f) => commentsStripped(readFileSync(f, "utf8")).includes("This item has text. Delete it?"))
      .map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("no card surface renders its own controlled <ConfirmDialog> for a delete", () => {
    const bad: string[] = [];
    for (const file of CARD_SOURCES) {
      const src = commentsStripped(readFileSync(file, "utf8"));
      for (const m of src.matchAll(/<ConfirmDialog\b/g)) {
        const tag = tagAround(src, m.index! + 1) ?? src.slice(m.index!, m.index! + 600);
        if (DESTRUCTIVE.test(tag) || /CARD_DELETE_CONFIRM_MESSAGE/.test(tag)) {
          bad.push(`${relative(ROOT, file)}:${src.slice(0, m.index!).split("\n").length}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("the shared executor REQUIRES the card anchor and hands it to the confirm", () => {
    const door = commentsStripped(readFileSync(DOOR_FILE, "utf8"));
    const hook = door.slice(door.indexOf("export function usePanelCardTryDelete("));
    const sig = hook.slice(0, hook.indexOf("{ tryDelete: () => void; dialog: ReactNode }"));
    expect(sig).toMatch(/anchorRef: RefObject<HTMLElement \| null>;/);
    expect(sig).not.toMatch(/anchorRef\?:/);
    expect(hook.slice(0, 2000)).toMatch(/confirm\(\{[^}]*anchorRef[^}]*\}\)/);
  });
});
