'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * A reusable list + inline form for the admin sections that are honest CRUD and
 * nothing more (destinations, blog posts).
 *
 * The configuration is deliberately declarative — plain data, no callbacks —
 * because it is handed across the server/client boundary from a server
 * component, and functions do not survive that trip. Rows are supplied by the
 * server page; after every mutation the component asks the router to refresh,
 * so the freshly-read database rows come back down as new props.
 */

export interface CrudField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox' | 'number';
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** Render across both columns of the form grid. */
  full?: boolean;
}

export interface CrudColumn {
  key: string;
  label: string;
  kind?: 'text' | 'mono' | 'badge' | 'bool' | 'date' | 'muted' | 'num';
}

export type CrudRow = Record<string, unknown>;

// ---------------------------------------------------------------- helpers --

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Formats straight from the stored string, so no time zone can shift a date. */
function formatStoredDate(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1]}`;
}

const GOOD = ['published', 'active', 'approved', 'paid', 'confirmed', 'open'];
const WARN = ['draft', 'pending', 'new', 'paused', 'in_progress'];
const BAD = ['rejected', 'cancelled', 'retired', 'expired'];

function badgeClass(value: string): string {
  const v = value.toLowerCase();
  if (GOOD.includes(v)) return 'badge badge-good';
  if (WARN.includes(v)) return 'badge badge-warn';
  if (BAD.includes(v)) return 'badge badge-danger';
  return 'badge badge-neutral';
}

function renderCell(row: CrudRow, column: CrudColumn) {
  const raw = row[column.key];

  switch (column.kind) {
    case 'mono':
      return <span className="mono">{raw === null || raw === undefined ? '—' : String(raw)}</span>;
    case 'badge': {
      const text = String(raw ?? '');
      if (!text) return <span className="muted">—</span>;
      return <span className={badgeClass(text)}>{text.replace(/_/g, ' ')}</span>;
    }
    case 'bool':
      return raw ? (
        <span className="badge badge-accent">Yes</span>
      ) : (
        <span className="muted">No</span>
      );
    case 'date':
      return <span className="tabular">{formatStoredDate(raw)}</span>;
    case 'num':
      return <span className="tabular">{raw === null || raw === undefined ? '—' : String(raw)}</span>;
    case 'muted':
      return <span className="muted">{raw ? String(raw) : '—'}</span>;
    default: {
      const text = raw === null || raw === undefined || raw === '' ? '—' : String(raw);
      return text.length > 90 ? `${text.slice(0, 90)}…` : text;
    }
  }
}

function blankForm(fields: CrudField[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const f of fields) out[f.name] = f.type === 'checkbox' ? false : '';
  return out;
}

function formFromRow(fields: CrudField[], row: CrudRow): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const f of fields) {
    const raw = row[f.name];
    out[f.name] =
      f.type === 'checkbox'
        ? Boolean(raw)
        : raw === null || raw === undefined
          ? ''
          : String(raw);
  }
  return out;
}

// -------------------------------------------------------------- component --

export default function SimpleCrud({
  noun,
  endpoint,
  rows,
  columns,
  fields,
  emptyMessage,
  idKey = 'id',
  titleKey,
}: {
  /** Singular, lower case: "destination", "blog post". Used in every message. */
  noun: string;
  endpoint: string;
  rows: CrudRow[];
  columns: CrudColumn[];
  fields: CrudField[];
  emptyMessage: string;
  idKey?: string;
  /** Which column holds the human name, for confirmation dialogs. */
  titleKey?: string;
}) {
  const router = useRouter();

  const [mode, setMode] = useState<'closed' | 'create' | 'edit'>('closed');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>(() =>
    blankForm(fields),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const nameKey = titleKey ?? columns[0]?.key ?? idKey;

  function startCreate() {
    setForm(blankForm(fields));
    setEditingId(null);
    setError(null);
    setNotice(null);
    setMode('create');
  }

  function startEdit(row: CrudRow) {
    setForm(formFromRow(fields, row));
    setEditingId(Number(row[idKey]));
    setError(null);
    setNotice(null);
    setMode('edit');
  }

  function close() {
    setMode('closed');
    setEditingId(null);
    setError(null);
  }

  function buildPayload(): Record<string, unknown> | string {
    const payload: Record<string, unknown> = {};

    for (const f of fields) {
      const value = form[f.name];

      if (f.type === 'checkbox') {
        payload[f.name] = value ? 1 : 0;
        continue;
      }

      const text = String(value ?? '').trim();

      if (f.required && text === '') {
        return `${f.label} is required.`;
      }

      if (f.type === 'number') {
        payload[f.name] = text === '' ? null : Number(text);
        continue;
      }

      payload[f.name] = text === '' ? null : text;
    }

    return payload;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload = buildPayload();
    if (typeof payload === 'string') {
      setError(payload);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(
        mode === 'edit' ? `${endpoint}/${editingId}` : endpoint,
        {
          method: mode === 'edit' ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? `Could not save the ${noun} (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }

      setNotice(mode === 'edit' ? `Saved the ${noun}.` : `Created the ${noun}.`);
      setBusy(false);
      close();
      router.refresh();
    } catch {
      setError(`Network error — the ${noun} was not saved.`);
      setBusy(false);
    }
  }

  async function remove(row: CrudRow) {
    const label = String(row[nameKey] ?? `#${row[idKey]}`);
    if (!window.confirm(`Delete the ${noun} "${label}"? This cannot be undone.`)) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${endpoint}/${row[idKey]}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? `Could not delete the ${noun} (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      setNotice(`Deleted "${label}".`);
      setBusy(false);
      if (editingId === Number(row[idKey])) close();
      router.refresh();
    } catch {
      setError(`Network error — the ${noun} was not deleted.`);
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="between">
        <p className="muted" style={{ margin: 0 }}>
          {rows.length} {rows.length === 1 ? noun : `${noun}s`} in the database.
        </p>
        {mode === 'closed' && (
          <button type="button" className="btn btn-primary" onClick={startCreate}>
            New {noun}
          </button>
        )}
      </div>

      {notice && mode === 'closed' && (
        <div className="alert alert-good" role="status">
          {notice}
        </div>
      )}

      {mode !== 'closed' && (
        <form className="card card-pad stack" onSubmit={submit}>
          <div className="between">
            <h2 style={{ fontSize: '1.5rem' }}>
              {mode === 'edit' ? `Edit ${noun}` : `New ${noun}`}
            </h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
              Close
            </button>
          </div>

          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}

          <div className="form-grid">
            {fields.map((f) => {
              const id = `crud-${f.name}`;
              const value = form[f.name];

              if (f.type === 'checkbox') {
                return (
                  <div className={f.full ? 'field span-2' : 'field'} key={f.name}>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) =>
                          setForm((s) => ({ ...s, [f.name]: e.target.checked }))
                        }
                      />
                      <span>
                        <strong>{f.label}</strong>
                        {f.hint && (
                          <>
                            <br />
                            <span className="hint">{f.hint}</span>
                          </>
                        )}
                      </span>
                    </label>
                  </div>
                );
              }

              return (
                <div className={f.full ? 'field span-2' : 'field'} key={f.name}>
                  <label className="label" htmlFor={id}>
                    {f.label}
                    {f.required && <span className="muted"> (required)</span>}
                  </label>

                  {f.type === 'textarea' && (
                    <textarea
                      id={id}
                      className="textarea"
                      value={String(value ?? '')}
                      placeholder={f.placeholder}
                      onChange={(e) =>
                        setForm((s) => ({ ...s, [f.name]: e.target.value }))
                      }
                    />
                  )}

                  {f.type === 'select' && (
                    <select
                      id={id}
                      className="select"
                      value={String(value ?? '')}
                      onChange={(e) =>
                        setForm((s) => ({ ...s, [f.name]: e.target.value }))
                      }
                    >
                      <option value="">Choose one…</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}

                  {(f.type === 'text' || f.type === 'number') && (
                    <input
                      id={id}
                      className="input"
                      type={f.type === 'number' ? 'number' : 'text'}
                      value={String(value ?? '')}
                      placeholder={f.placeholder}
                      onChange={(e) =>
                        setForm((s) => ({ ...s, [f.name]: e.target.value }))
                      }
                    />
                  )}

                  {f.hint && <span className="hint">{f.hint}</span>}
                </div>
              );
            })}
          </div>

          <div className="cluster cluster-sm">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : `Create ${noun}`}
            </button>
            <button type="button" className="btn btn-secondary" onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <div className="card">
          <p className="empty-state">{emptyMessage}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col">
                    {c.label}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row[idKey])}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.kind === 'num' ? 'num' : undefined}>
                      {renderCell(row, c)}
                    </td>
                  ))}
                  <td>
                    <div className="cluster cluster-sm">
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => startEdit(row)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={busy}
                        onClick={() => void remove(row)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
