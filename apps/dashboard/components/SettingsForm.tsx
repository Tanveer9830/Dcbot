'use client';

import { useState } from 'react';

export interface FieldSpec {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea' | 'list';
  help?: string;
  options?: Array<{ value: string; label: string }>;
  value: unknown;
  min?: number;
  max?: number;
}

interface SettingsFormProps {
  guildId: string;
  group: string;
  fields: FieldSpec[];
}

/**
 * Generic settings form.
 *
 * Sends only the fields the user actually changed. The server route re-validates
 * the group name, re-verifies guild membership, and writes through the
 * repository - the client never decides what is allowed.
 */
export function SettingsForm({ guildId, group, fields }: SettingsFormProps): JSX.Element {
  const initial = Object.fromEntries(fields.map((field) => [field.key, field.value]));
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const set = (key: string, value: unknown): void => {
    setValues((current) => ({ ...current, [key]: value }));
    setStatus('idle');
    setMessage(null);
  };

  const changed = (): Record<string, unknown> => {
    const patch: Record<string, unknown> = {};
    for (const field of fields) {
      const next = values[field.key];
      const before = initial[field.key];
      if (JSON.stringify(next) !== JSON.stringify(before)) patch[field.key] = next;
    }
    return patch;
  };

  const save = async (): Promise<void> => {
    const patch = changed();
    if (Object.keys(patch).length === 0) {
      setStatus('idle');
      setMessage('Nothing changed.');
      return;
    }
    setStatus('saving');
    try {
      const response = await fetch(`/api/guilds/${guildId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group, patch }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus('error');
        setMessage(body.error ?? `Request failed (${response.status}).`);
        return;
      }
      setStatus('saved');
      setMessage(`Saved ${Object.keys(patch).length} setting(s).`);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Network error.');
    }
  };

  return (
    <div className="card">
      {fields.map((field) => (
        <div className="field" key={field.key}>
          <label htmlFor={field.key}>{field.label}</label>
          {field.type === 'boolean' ? (
            <select
              id={field.key}
              value={values[field.key] ? 'true' : 'false'}
              onChange={(event) => set(field.key, event.target.value === 'true')}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          ) : field.type === 'select' ? (
            <select
              id={field.key}
              value={String(values[field.key] ?? '')}
              onChange={(event) => set(field.key, event.target.value)}
            >
              {(field.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : field.type === 'list' ? (
            <input
              id={field.key}
              type="text"
              value={
                Array.isArray(values[field.key]) ? (values[field.key] as string[]).join(', ') : ''
              }
              onChange={(event) =>
                set(
                  field.key,
                  event.target.value
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter(Boolean),
                )
              }
            />
          ) : field.type === 'textarea' ? (
            <textarea
              id={field.key}
              rows={4}
              value={String(values[field.key] ?? '')}
              onChange={(event) => set(field.key, event.target.value)}
            />
          ) : (
            <input
              id={field.key}
              type={field.type === 'number' ? 'number' : 'text'}
              min={field.min}
              max={field.max}
              value={
                values[field.key] === null || values[field.key] === undefined
                  ? ''
                  : String(values[field.key])
              }
              onChange={(event) =>
                set(
                  field.key,
                  field.type === 'number' ? Number(event.target.value) : event.target.value,
                )
              }
            />
          )}
          {field.help ? (
            <div className="muted" style={{ fontSize: '0.82rem', marginTop: 4 }}>
              {field.help}
            </div>
          ) : null}
        </div>
      ))}

      <div className="row" role="status" aria-live="polite">
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={status === 'saving'}
          type="button"
        >
          {status === 'saving' ? 'Saving…' : 'Save changes'}
        </button>
        {message ? (
          <span className={status === 'error' ? 'pill pill-bad' : 'pill pill-ok'}>{message}</span>
        ) : null}
      </div>
    </div>
  );
}
