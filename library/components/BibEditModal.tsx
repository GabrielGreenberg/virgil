"use client";

import { useEffect, useRef, useState } from "react";
import type { BibEntry } from "@library/lib/types";
import { FONT_MONO, FONT_SANS } from "@/lib/font-stacks";
import {
  ANNOTATION_FIELDS,
  BIB_ENTRY_TYPES,
  CORE_FIELDS,
  IDENTIFIER_FIELDS,
  PUBLICATION_FIELDS_BY_TYPE,
  emitBibEntry,
  knownFieldsForType,
} from "@library/lib/bib-edit";

interface Props {
  entry: BibEntry;
  /** Called when the user confirms the edit. The component formats the
   *  payload (entry type + cleaned fields) and hands it back. */
  onSave: (type: string, fields: Record<string, string>) => Promise<void>;
  onClose: () => void;
}

type Mode = "form" | "raw";

export default function BibEditModal({ entry, onSave, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("form");
  const [type, setType] = useState<string>(entry.type);
  const [fields, setFields] = useState<Record<string, string>>({ ...entry.fields });
  // One seed at mount feeds BOTH the initial rows and the id allocator, so the
  // two never diverge (task 128). The raw→form re-seed adopts the same source.
  const [extraRows, setExtraRows] = useState<ExtraRow[]>(() => seedExtraRows(entry).rows);
  const [raw, setRaw] = useState<string>(emitBibEntry(entry.type, entry.key, entry.fields));
  const [rawError, setRawError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(seedExtraRows(entry).nextId);

  // Close on Escape, lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Focus the dialog on open so keyboard nav lands inside.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

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
    // Preserve any unknown original fields the user didn't touch via
    // extra rows (defensive — shouldn't normally happen since seedExtraRows
    // captures them all).
    const known = knownFieldsForType(type);
    const extraKeys = new Set(extraRows.map((r) => r.key.trim()));
    for (const [k, v] of Object.entries(fields)) {
      if (known.has(k)) continue;
      if (extraKeys.has(k)) continue;
      if (v && v.trim().length > 0) out[k] = v.trim();
    }
    return out;
  };

  const handleSwitchMode = (next: Mode) => {
    if (next === mode) return;
    if (next === "raw") {
      const consolidated = consolidateFields();
      setRaw(emitBibEntry(type, entry.key, consolidated));
      setRawError(null);
    } else {
      // form ← raw: parse the raw text and update form state.
      const parsed = parseSingleEntry(raw, entry.key);
      if (!parsed) {
        setRawError("Couldn't parse this BibTeX. Fix syntax or stay in raw mode.");
        return;
      }
      setType(parsed.type);
      setFields(parsed.fields);
      const seeded = seedExtraRowsFromFields(parsed.type, parsed.fields);
      setExtraRows(seeded.rows);
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
      let outType: string;
      let outFields: Record<string, string>;
      if (mode === "raw") {
        const parsed = parseSingleEntry(raw, entry.key);
        if (!parsed) {
          setRawError("Couldn't parse this BibTeX. Fix syntax before saving.");
          setSaving(false);
          return;
        }
        outType = parsed.type;
        outFields = parsed.fields;
      } else {
        outType = type;
        outFields = consolidateFields();
      }
      await onSave(outType, outFields);
      onClose();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const publicationFields = PUBLICATION_FIELDS_BY_TYPE[type] ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit bib entry ${entry.key}`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "5vh 16px",
        zIndex: 200,
        overflow: "auto",
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "var(--pod-border)",
          borderRadius: "var(--pod-radius)",
          boxShadow: "var(--pod-shadow)",
          width: "min(720px, 100%)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          outline: "none",
        }}
      >
        <Header
          citekey={entry.key}
          mode={mode}
          onSwitchMode={handleSwitchMode}
          onClose={onClose}
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

        <Footer
          saving={saving}
          saveError={saveError}
          onCancel={onClose}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Header / Footer
// ────────────────────────────────────────────────────────────────────────

function Header({
  citekey,
  mode,
  onSwitchMode,
  onClose,
}: {
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
        <div style={{ fontSize: 14, fontWeight: 600 }}>Edit bib entry</div>
        <code style={{ fontFamily: FONT_MONO, fontSize: 11, color: "var(--muted)" }}>
          {citekey}
        </code>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ModeToggle mode={mode} onChange={onSwitchMode} />
        <button
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

function Footer({
  saving,
  saveError,
  onCancel,
  onSave,
}: {
  saving: boolean;
  saveError: string | null;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div
      style={{
        padding: "10px 16px",
        borderTop: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        Saved edits queue for the <code style={{ fontFamily: FONT_MONO }}>/apply-bib-edit</code> skill.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {saveError && (
          <span style={{ fontSize: 12, color: "var(--danger)" }}>{saveError}</span>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          style={{
            background: "transparent",
            border: "1px solid var(--border-light)",
            borderRadius: "var(--radius-sm)",
            padding: "5px 12px",
            fontSize: 12,
            cursor: saving ? "not-allowed" : "pointer",
            color: "var(--foreground)",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          style={{
            background: "var(--accent)",
            color: "white",
            border: "1px solid var(--accent)",
            borderRadius: "var(--radius-sm)",
            padding: "5px 14px",
            fontSize: 12,
            cursor: saving ? "wait" : "pointer",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Form view
// ────────────────────────────────────────────────────────────────────────

function FormView({
  type,
  setType,
  fields,
  updateField,
  publicationFields,
  extraRows,
  setExtraRows,
  nextId,
}: {
  type: string;
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
            {BIB_ENTRY_TYPES.map((t) => (
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
        spellCheck={false}
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

/** Parse a single BibTeX entry block (the form `@type{key, k=v, ...}`).
 *  Returns null if the block is malformed. The citekey in the parsed
 *  block is ignored — the caller carries the canonical key separately. */
function parseSingleEntry(
  raw: string,
  _canonicalKey: string,
): { type: string; fields: Record<string, string> } | null {
  void _canonicalKey;
  const text = raw.trim();
  const head = text.match(/^@(\w+)\s*\{\s*([^,]+),/);
  if (!head) return null;
  const type = head[1];
  // Find the matching closing brace for the @type{...} block.
  const openIdx = text.indexOf("{", head.index! + 1);
  if (openIdx === -1) return null;
  let depth = 0;
  let endIdx = -1;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) return null;
  // Body is everything between the citekey comma and the matching `}`.
  const afterKey = text.indexOf(",", openIdx);
  if (afterKey === -1 || afterKey > endIdx) return null;
  const body = text.slice(afterKey + 1, endIdx);

  const fields: Record<string, string> = {};
  // Walk fields one at a time. A field is `name = {...}` or `name = "..."`,
  // separated from the next by a comma. Brace-balanced extraction handles
  // values that themselves contain `{` / `}`.
  let i = 0;
  while (i < body.length) {
    // Skip whitespace and stray commas.
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    if (i >= body.length) break;
    // Read field name.
    const nameStart = i;
    while (i < body.length && /[A-Za-z0-9_-]/.test(body[i])) i++;
    const name = body.slice(nameStart, i).toLowerCase();
    if (!name) {
      // Couldn't read a name where one was expected — bail.
      return null;
    }
    // Skip whitespace + `=`.
    while (i < body.length && /\s/.test(body[i])) i++;
    if (body[i] !== "=") return null;
    i++;
    while (i < body.length && /\s/.test(body[i])) i++;
    // Read value.
    let value: string;
    if (body[i] === "{") {
      let d = 0;
      const start = i;
      for (; i < body.length; i++) {
        if (body[i] === "{") d++;
        else if (body[i] === "}") {
          d--;
          if (d === 0) {
            i++;
            break;
          }
        }
      }
      value = body.slice(start + 1, i - 1);
    } else if (body[i] === '"') {
      const start = ++i;
      while (i < body.length && body[i] !== '"') i++;
      value = body.slice(start, i);
      if (body[i] === '"') i++;
    } else {
      // Unquoted (number / string concat). Read until comma at depth 0.
      const start = i;
      while (i < body.length && body[i] !== ",") i++;
      value = body.slice(start, i).trim();
    }
    fields[name] = value;
  }
  return { type, fields };
}

