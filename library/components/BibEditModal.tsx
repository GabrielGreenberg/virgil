"use client";

/**
 * bib-display-exempt-file: EDIT SURFACE — every `fields` read in this file is
 * the user's own editable value, and its raw-mode textarea round-trips back
 * through `parseBibEntryBlock` into the saved fields. Projecting anything here
 * is the ONE change in the bib-row family (task 409) that would write a
 * rendering into the `.bib` instead of avoiding one.
 */

import { useCallback, useId, useRef, useState } from "react";
import type { BibEntry } from "@library/lib/types";
import { FONT_MONO, FONT_SANS } from "@/lib/font-stacks";
import {
  ANNOTATION_FIELDS,
  BIB_ENTRY_TYPES,
  CORE_FIELDS,
  IDENTIFIER_FIELDS,
  PUBLICATION_FIELDS_BY_TYPE,
  buildBibEditDiff,
  emitBibEntry,
  isEmptyBibEditDiff,
  knownFieldsForType,
} from "@library/lib/bib-edit";
import type { BibEditDiffPayload } from "@library/lib/queue";
import { bibEditBase, parseBibEntryBlock } from "@library/lib/bib-raw-entry";
import SystemDialog, {
  SystemDialogButton,
  SystemDialogFooter,
} from "@/components/system-dialog";
import { useSystemDialog } from "@/components/system-dialog-host";
import { NEVER_SPELLCHECK_PROPS } from "@/lib/spellcheck-policy";

interface Props {
  entry: BibEntry;
  /** Called when the user confirms an edit that changes something. The payload
   *  is the DIFF against `entry` (what the user set and removed), never the
   *  whole entry — a whole entry would delete every field added on disk since
   *  the modal opened (task 763). */
  onSave: (payload: BibEditDiffPayload) => Promise<void>;
  onClose: () => void;
}

type Mode = "form" | "raw";

/** What Save would do RIGHT NOW: queue this diff, or refuse on a raw block
 *  that does not parse. One answer for Save AND for the dismissal guard, so
 *  "would closing lose anything?" is the literal question "would Save have
 *  written anything?" (task 820), never a parallel dirty heuristic. */
type PendingEdit =
  | { kind: "diff"; diff: BibEditDiffPayload }
  | { kind: "unparseable" };

export default function BibEditModal({ entry: shown, onSave, onClose }: Props) {
  // The entry this edit is a diff AGAINST: the disk block (`raw`) read
  // faithfully — type as written, values verbatim, keys as keyed — never the
  // CSL projection `shown` carries for display (task 795). Seeding the form
  // from the projection falsely held type changes (`@inbook` read as
  // `incollection`), stripped the LaTeX of any field the user touched, and
  // re-keyed `booktitle` as `journal`. Fixed at mount, like the form state.
  const [entry] = useState<BibEntry>(() => bibEditBase(shown));
  const [mode, setMode] = useState<Mode>("form");
  const [type, setType] = useState<string>(entry.type);
  const [fields, setFields] = useState<Record<string, string>>({ ...entry.fields });
  // One seed at mount feeds BOTH the initial rows and the id allocator, so the
  // two never diverge (task 128). The raw→form re-seed adopts the same source.
  const [extraRows, setExtraRows] = useState<ExtraRow[]>(() => seedExtraRows(entry).rows);
  const [raw, setRaw] = useState<string>(() => emitBibEntry(entry.type, entry.key, entry.fields));
  const [rawError, setRawError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleId = useId();
  const nextId = useRef(seedExtraRows(entry).nextId);
  // The keys the "Other fields" rows were seeded with. Such a key is the USER's
  // to keep or remove through its row — ✕ or a rename takes it out — so the
  // hidden-field carry-over in `consolidateFields` must never re-add it (task
  // 763: it did, which made ✕ on a custom field inert).
  const seededExtraKeys = useRef(new Set(seedExtraRows(entry).rows.map((r) => r.key)));

  const updateField = (k: string, v: string) =>
    setFields((cur) => ({ ...cur, [k]: v }));

  const consolidateFields = (): Record<string, string> => {
    const out: Record<string, string> = {};
    // Known fields, in a stable order.
    const order = [
      ...CORE_FIELDS,
      ...(PUBLICATION_FIELDS_BY_TYPE[type] ?? []),
      ...IDENTIFIER_FIELDS,
      ...ANNOTATION_FIELDS,
    ];
    for (const k of order) {
      const v = fields[k];
      if (v && v.trim().length > 0) out[k] = v.trim();
    }
    // Extras (catch-all + any remaining unknown fields from the original
    // entry that the user didn't delete by clearing).
    for (const r of extraRows) {
      const k = r.key.trim();
      if (k && r.value.trim().length > 0) out[k] = r.value.trim();
    }
    // Carry over fields the form does not SHOW — e.g. `journal` after the
    // type changes @article → @book: no longer a form field for the new type,
    // never an extra row. The user did not remove those, so they stay. A key
    // that had its own extra row is excluded: its row is the only say it gets,
    // and a row the user deleted or renamed is a removal (task 763).
    const known = knownFieldsForType(type);
    const extraKeys = new Set(extraRows.map((r) => r.key.trim()));
    for (const [k, v] of Object.entries(fields)) {
      if (known.has(k)) continue;
      if (extraKeys.has(k)) continue;
      if (seededExtraKeys.current.has(k)) continue;
      if (v && v.trim().length > 0) out[k] = v.trim();
    }
    return out;
  };

  const pendingEdit = (): PendingEdit => {
    if (mode === "raw") {
      const parsed = parseBibEntryBlock(raw);
      if (!parsed) return { kind: "unparseable" };
      return { kind: "diff", diff: buildBibEditDiff(entry, parsed.type, parsed.fields) };
    }
    return { kind: "diff", diff: buildBibEditDiff(entry, type, consolidateFields()) };
  };

  const handleSwitchMode = (next: Mode) => {
    if (next === mode) return;
    if (next === "raw") {
      const consolidated = consolidateFields();
      setRaw(emitBibEntry(type, entry.key, consolidated));
      setRawError(null);
    } else {
      // form ← raw: parse the raw text and update form state.
      const parsed = parseBibEntryBlock(raw);
      if (!parsed) {
        setRawError("Couldn't parse this BibTeX. Fix syntax or stay in raw mode.");
        return;
      }
      setType(parsed.type);
      setFields(parsed.fields);
      const seeded = seedExtraRowsFromFields(parsed.type, parsed.fields);
      setExtraRows(seeded.rows);
      seededExtraKeys.current = new Set(seeded.rows.map((r) => r.key));
      // Resync the shared allocator so the next "+ Add field" can't collide
      // with a re-seeded row id (task 128).
      nextId.current = seeded.nextId;
      setRawError(null);
    }
    setMode(next);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const pending = pendingEdit();
      if (pending.kind === "unparseable") {
        setRawError("Couldn't parse this BibTeX. Fix syntax before saving.");
        setSaving(false);
        return;
      }
      // Nothing changed → nothing to queue; the Save is just a close.
      if (!isEmptyBibEditDiff(pending.diff)) await onSave(pending.diff);
      onClose();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /* ── The dismissal guard (task 820) ──────────────────────────────────
     This form is the ONLY copy of what the user typed until Save queues it, so
     every way out that is not Save ASKS — Escape and the backdrop through the
     shell's one door (`dismissGuard`), ✕ and Cancel by calling the same guard
     (a footer button never enters the shell's door; task 530's
     `StyleEditorModal` shape). Pristine stays FREE: an entry opened and closed
     untouched never prompts, or the prompt becomes furniture. A raw block that
     no longer parses is work too — it cannot be measured, so it asks.
     `danger` tone cues "Keep editing" (task 386), so a moving hand's Enter
     keeps the draft. */
  const systemDialog = useSystemDialog();
  const pending = pendingEdit();
  const dirty = pending.kind === "unparseable" || !isEmptyBibEditDiff(pending.diff);
  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    return systemDialog.confirm({
      title: "Discard your changes?",
      message: `Your edits to ${entry.key} haven't been saved. Discarding them can't be undone.`,
      confirmLabel: "Discard",
      cancelLabel: "Keep editing",
      tone: "danger",
    });
  }, [dirty, systemDialog, entry.key]);
  const requestCancel = () => {
    void confirmDiscard().then((ok) => {
      if (ok) onClose();
    });
  };

  const publicationFields = PUBLICATION_FIELDS_BY_TYPE[type] ?? [];

  return (
    <SystemDialog
      open
      onClose={onClose}
      size="xl"
      labelledBy={titleId}
      dismissGuard={confirmDiscard}
      frameClassName="flex flex-col max-h-[90vh]"
    >
      <Header
        titleId={titleId}
        citekey={entry.key}
        mode={mode}
        onSwitchMode={handleSwitchMode}
        onClose={requestCancel}
      />

      <div
        style={{
          padding: 16,
          overflow: "auto",
          flex: 1,
          minHeight: 0,
        }}
      >
        {mode === "form" ? (
          <FormView
            type={type}
            baseType={entry.type}
            setType={setType}
            fields={fields}
            updateField={updateField}
            publicationFields={publicationFields}
            extraRows={extraRows}
            setExtraRows={setExtraRows}
            nextId={nextId}
          />
        ) : (
          <RawView
            raw={raw}
            setRaw={setRaw}
            error={rawError}
          />
        )}
      </div>

      <SystemDialogFooter>
        <div style={{ fontSize: 12, color: "var(--muted)", marginRight: "auto" }}>
          Saved edits queue for the <code style={{ fontFamily: FONT_MONO }}>/apply-bib-edit</code> skill.
        </div>
        {saveError && (
          <span style={{ fontSize: 12, color: "var(--danger)" }}>{saveError}</span>
        )}
        <SystemDialogButton
          variant="secondary"
          onClick={requestCancel}
          disabled={saving}
        >
          Cancel
        </SystemDialogButton>
        <SystemDialogButton
          variant="primary"
          onClick={() => void handleSave()}
          disabled={saving}
          autoFocus
        >
          {saving ? "Saving…" : "Save"}
        </SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Header
// ────────────────────────────────────────────────────────────────────────

function Header({
  titleId,
  citekey,
  mode,
  onSwitchMode,
  onClose,
}: {
  titleId: string;
  citekey: string;
  mode: Mode;
  onSwitchMode: (m: Mode) => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        padding: "12px 16px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div id={titleId} style={{ fontSize: 14, fontWeight: 600 }}>
          Edit bib entry <span className="sr-only">{citekey}</span>
        </div>
        <code style={{ fontFamily: FONT_MONO, fontSize: 11, color: "var(--muted)" }}>
          {citekey}
        </code>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ModeToggle mode={mode} onChange={onSwitchMode} />
        <button
          className="focus-ring"
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-sm)",
            padding: "4px 10px",
            fontSize: 12,
            cursor: "pointer",
            color: "var(--muted)",
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Editor mode"
      style={{
        display: "inline-flex",
        border: "1px solid var(--border-light)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
      }}
    >
      {(["form", "raw"] as const).map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(m)}
            style={{
              background: active ? "var(--control-selected)" : "transparent",
              color: active ? "white" : "var(--foreground)",
              border: "none",
              padding: "4px 12px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {m === "form" ? "Form" : "Raw BibTeX"}
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Form view
// ────────────────────────────────────────────────────────────────────────

function FormView({
  type,
  baseType,
  setType,
  fields,
  updateField,
  publicationFields,
  extraRows,
  setExtraRows,
  nextId,
}: {
  type: string;
  /** The type on disk. Offered even when it is not one of the stock types
   *  (`@online`, `@booklet`, …) so opening the modal never forces a change. */
  baseType: string;
  setType: (t: string) => void;
  fields: Record<string, string>;
  updateField: (k: string, v: string) => void;
  publicationFields: string[];
  extraRows: Array<{ id: number; key: string; value: string }>;
  setExtraRows: React.Dispatch<React.SetStateAction<Array<{ id: number; key: string; value: string }>>>;
  nextId: React.MutableRefObject<number>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Section label="Identity">
        <Row label="type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            style={inputStyle}
          >
            {typeOptions(baseType, type).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Row>
      </Section>

      <Section label="Core">
        <FieldInputs
          keys={CORE_FIELDS}
          fields={fields}
          updateField={updateField}
        />
      </Section>

      {publicationFields.length > 0 && (
        <Section label="Publication">
          <FieldInputs
            keys={publicationFields}
            fields={fields}
            updateField={updateField}
          />
        </Section>
      )}

      <Section label="Identifiers">
        <FieldInputs
          keys={IDENTIFIER_FIELDS}
          fields={fields}
          updateField={updateField}
        />
      </Section>

      <Section label="Annotations">
        <FieldInputs
          keys={ANNOTATION_FIELDS}
          fields={fields}
          updateField={updateField}
          textareas={new Set(["abstract", "note"])}
        />
      </Section>

      <Section label="Other fields">
        <ExtraRows
          rows={extraRows}
          setRows={setExtraRows}
          nextId={nextId}
        />
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset
      style={{
        border: "1px solid var(--border-light)",
        borderRadius: "var(--radius-md)",
        padding: "10px 12px 12px",
        margin: 0,
      }}
    >
      <legend
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--muted)",
          padding: "0 6px",
        }}
      >
        {label}
      </legend>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </fieldset>
  );
}

function FieldInputs({
  keys,
  fields,
  updateField,
  textareas,
}: {
  keys: readonly string[] | string[];
  fields: Record<string, string>;
  updateField: (k: string, v: string) => void;
  textareas?: Set<string>;
}) {
  return (
    <>
      {keys.map((k) => (
        <Row key={k} label={k}>
          {textareas?.has(k) ? (
            <textarea
              value={fields[k] ?? ""}
              onChange={(e) => updateField(k, e.target.value)}
              rows={k === "abstract" ? 4 : 2}
              style={{ ...inputStyle, fontFamily: FONT_SANS, resize: "vertical" }}
            />
          ) : (
            <input
              type="text"
              value={fields[k] ?? ""}
              onChange={(e) => updateField(k, e.target.value)}
              style={inputStyle}
            />
          )}
        </Row>
      ))}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(80px, 110px) 1fr",
        alignItems: "start",
        columnGap: 10,
        rowGap: 4,
        fontSize: 13,
      }}
    >
      <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: "var(--muted)", paddingTop: 6 }}>
        {label}
      </span>
      <span>{children}</span>
    </label>
  );
}

function ExtraRows({
  rows,
  setRows,
  nextId,
}: {
  rows: Array<{ id: number; key: string; value: string }>;
  setRows: React.Dispatch<React.SetStateAction<Array<{ id: number; key: string; value: string }>>>;
  nextId: React.MutableRefObject<number>;
}) {
  const addRow = () => {
    setRows((cur) => [...cur, { id: nextId.current++, key: "", value: "" }]);
  };
  const updateRow = (id: number, patch: Partial<{ key: string; value: string }>) => {
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeRow = (id: number) => {
    setRows((cur) => cur.filter((r) => r.id !== id));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>
          No custom fields. Use “+ Add field” for any field not listed above.
        </div>
      )}
      {rows.map((r) => (
        <div
          key={r.id}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(80px, 110px) 1fr auto",
            columnGap: 8,
          }}
        >
          <input
            type="text"
            placeholder="field"
            value={r.key}
            onChange={(e) => updateRow(r.id, { key: e.target.value })}
            style={{ ...inputStyle, fontFamily: FONT_MONO }}
          />
          <input
            type="text"
            placeholder="value"
            value={r.value}
            onChange={(e) => updateRow(r.id, { value: e.target.value })}
            style={inputStyle}
          />
          <button
            className="focus-ring"
            type="button"
            onClick={() => removeRow(r.id)}
            aria-label={`Remove ${r.key || "row"}`}
            style={{
              background: "transparent",
              border: "1px solid var(--border-light)",
              borderRadius: "var(--radius-sm)",
              padding: "0 8px",
              fontSize: 12,
              cursor: "pointer",
              color: "var(--muted)",
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        style={{
          alignSelf: "flex-start",
          background: "transparent",
          border: "1px dashed var(--border-light)",
          borderRadius: "var(--radius-sm)",
          padding: "4px 10px",
          fontSize: 12,
          cursor: "pointer",
          color: "var(--muted)",
        }}
      >
        + Add field
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Raw view
// ────────────────────────────────────────────────────────────────────────

function RawView({
  raw,
  setRaw,
  error,
}: {
  raw: string;
  setRaw: (s: string) => void;
  error: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        Edit the raw BibTeX block. The citekey is fixed — changing it here is ignored
        on save (re-trigger triage to rename a paper).
      </div>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        {...NEVER_SPELLCHECK_PROPS}
        rows={18}
        style={{
          ...inputStyle,
          fontFamily: FONT_MONO,
          fontSize: 12,
          lineHeight: 1.5,
          resize: "vertical",
        }}
      />
      {error && (
        <div style={{ fontSize: 12, color: "var(--danger)" }}>{error}</div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  border: "1px solid var(--border-light)",
  borderRadius: "var(--radius-sm)",
  background: "var(--background)",
  fontSize: 13,
  outline: "none",
  fontFamily: FONT_SANS,
  color: "var(--foreground)",
  boxSizing: "border-box",
};

/** The stock types, plus the disk type and the current pick when either is
 *  outside them — a `<select>` whose value has no `<option>` silently shows
 *  (and on the next change submits) a different type. */
function typeOptions(baseType: string, type: string): string[] {
  const out: string[] = [...BIB_ENTRY_TYPES];
  for (const t of [baseType, type]) if (t && !out.includes(t)) out.push(t);
  return out;
}

type ExtraRow = { id: number; key: string; value: string };

/** The result of a seed: the rows PLUS the next free id. Both the mount seed
 *  and the raw→form re-seed must adopt `nextId` so the monotonic `addRow`
 *  allocator can never mint an id that collides with a re-seeded row (the
 *  two allocators share ONE counter — see task 128). */
type ExtraSeed = { rows: ExtraRow[]; nextId: number };

function seedExtraRows(entry: BibEntry): ExtraSeed {
  return seedExtraRowsFromFields(entry.type, entry.fields);
}

function seedExtraRowsFromFields(
  type: string,
  fields: Record<string, string>,
): ExtraSeed {
  const known = knownFieldsForType(type);
  let id = 1;
  const rows = Object.entries(fields)
    .filter(([k, v]) => !known.has(k) && v && v.trim().length > 0)
    .map(([k, v]) => ({ id: id++, key: k, value: v }));
  // After the map `id` is the last-used id + 1 (or 1 when there were no rows),
  // i.e. the next free id — always strictly greater than every seeded row id.
  return { rows, nextId: id };
}
