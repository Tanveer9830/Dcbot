'use client';

import { useState } from 'react';

interface SaveButtonProps {
  guildId: string;
  group: string;
  patch: Record<string, unknown>;
  label?: string;
}

/**
 * Client-side save control.
 *
 * It only POSTs the patch; the server re-verifies the session, the guild
 * membership and the settings group before writing anything.
 */
export function SaveButton({
  guildId,
  group,
  patch,
  label = 'Save changes',
}: SaveButtonProps): JSX.Element {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setState('saving');
    setMessage(null);
    try {
      const response = await fetch(`/api/guilds/${guildId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group, patch }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setState('error');
        setMessage(body.error ?? `Request failed (${response.status}).`);
        return;
      }
      setState('saved');
      setMessage('Saved.');
      window.setTimeout(() => setState('idle'), 2500);
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Network error.');
    }
  };

  return (
    <div className="row" role="status" aria-live="polite">
      <button
        className="btn btn-primary"
        onClick={save}
        disabled={state === 'saving'}
        type="button"
      >
        {state === 'saving' ? 'Saving…' : label}
      </button>
      {message ? (
        <span className={state === 'error' ? 'pill pill-bad' : 'pill pill-ok'}>{message}</span>
      ) : null}
    </div>
  );
}
