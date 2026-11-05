// Task 1474 — a panel "+" creates through the ONE create door per kind.
//
// Every card a panel header "+" makes goes through `CardCreationApi`
// (`createNote`, `createTodo`, `createFootnote`, …), whose shared tail
// (`finishCreate`) expands, selects and pins the card, focuses its primary
// field per `CARD_REGISTRY[kind].createFocus`, and — for the kinds that have
// one — marks it pristine so a blank card is click-away-discardable. The
// Footnotes panel was the exception: its host took an `onAdd` prop threaded
// from EditorPane (`handleAddFootnote` → `createEmptyFootnote()` directly), so
// a footnote made with the panel "+" was neither pristine, selected nor
// focused, although the menu / slash footnote was all three.
//
// The census: in every panel host, each `onAdd*` handed to the panel must
// reach a door the host destructured from `useCardCreationContext()` — never
// a prop threaded in from outside (`p.onAdd`), which is how the bypass was
// spelled. Non-card adds (a bibliography ENTRY is not a card) are declared
// exemptions with a reason.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const HOSTS_DIR = path.resolve(__dirname, "..");

/** `<file>::<attr>` → why this add is not a card-creation door. */
const EXEMPT: Record<string, string> = {
  "bibliography-host.tsx::onAddBibEntry":
    "adds a .bib ENTRY (the bibliography's own write door), not a card",
  "bibliography-host.tsx::onAddEntryRequest":
    "files a bib entry-lookup request on the bib settings sidecar, not a card",
  "citations-host.tsx::onAddBibEntry":
    "adds a .bib ENTRY from the citation picker, not a card",
};

/** Read a balanced `{ … }` (or `( … )`) starting at `open`. */
function balanced(src: string, open: number): string {
  const pairs: Record<string, string> = { "{": "}", "(": ")" };
  const close = pairs[src[open]];
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === src[open]) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unbalanced ${src[open]} at ${open}`);
}

interface AddSite {
  file: string;
  attr: string;
  value: string;
}

function addSites(file: string, src: string): AddSite[] {
  const out: AddSite[] = [];
  const re = /\b(onAdd\w*)=\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push({ file, attr: m[1], value: balanced(src, m.index + m[0].length - 1).trim() });
  }
  return out;
}

/** The doors this host destructured from `useCardCreationContext()`. */
function contextDoors(src: string): string[] {
  const m = /const\s*\{([^}]*)\}\s*=\s*useCardCreationContext\(\)/.exec(src);
  if (!m) return [];
  return m[1].split(",").map((s) => s.trim().split(/\s*:\s*/).pop()!).filter(Boolean);
}

/** The body an `onAdd*` value runs: inline, or a same-file `useCallback`. */
function bodyOf(src: string, value: string): string {
  if (!/^\w+$/.test(value)) return value;
  const decl = new RegExp(`const\\s+${value}\\s*=\\s*useCallback\\(`).exec(src);
  if (!decl) return value;
  return balanced(src, decl.index + decl[0].length - 1);
}

const HOST_FILES = readdirSync(HOSTS_DIR).filter((f) => f.endsWith("-host.tsx"));
const SITES = HOST_FILES.flatMap((f) =>
  addSites(f, readFileSync(path.join(HOSTS_DIR, f), "utf8")),
);

describe("panel add-door census (task 1474)", () => {
  it("is non-vacuous: the card panels' adds are all found", () => {
    const found = new Set(SITES.map((s) => `${s.file}::${s.attr}`));
    for (const k of [
      "footnotes-host.tsx::onAdd",
      "todo-host.tsx::onAdd",
      "notes-host.tsx::onAddNote",
      "notes-host.tsx::onAddHighlight",
      "cutter-host.tsx::onAddComment",
      "cutter-host.tsx::onAddSuggestion",
      "reports-host.tsx::onAddReport",
      "reports-host.tsx::onAddReportRequest",
      "revisions-host.tsx::onAddRequest",
      "revisions-host.tsx::onAddSuggestion",
    ]) {
      expect(found, k).toContain(k);
    }
  });

  it("every exemption names a live site (no stale reasons)", () => {
    const found = new Set(SITES.map((s) => `${s.file}::${s.attr}`));
    for (const k of Object.keys(EXEMPT)) expect(found, k).toContain(k);
  });

  it("every panel add reaches a CardCreationApi door — never a threaded prop", () => {
    const offenders: string[] = [];
    for (const site of SITES) {
      const key = `${site.file}::${site.attr}`;
      if (EXEMPT[key]) continue;
      const src = readFileSync(path.join(HOSTS_DIR, site.file), "utf8");
      const doors = contextDoors(src).filter((d) => d.startsWith("create"));
      const body = bodyOf(src, site.value);
      const reaches = doors.some((d) => new RegExp(`\\b${d}\\(`).test(body));
      if (!reaches) {
        offenders.push(
          `${key} = {${site.value.slice(0, 60)}} — create through useCardCreationContext() ` +
            `(doors here: ${doors.join(", ") || "none"}), or declare a non-card exemption`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});
