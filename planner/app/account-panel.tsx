'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/firebase-client';
export default function AccountPanel({
  onDeleted,
  owner,
  expanded = false,
}: {
  onDeleted: () => void;
  owner: string;
  expanded?: boolean;
}) {
  const [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [recovery, setRecovery] = useState(false);
  useEffect(() => {
    void authFetch('/api/recovery', {}, owner)
      .then((r) => r.json())
      .then((r: { allowed: boolean }) =>
        setRecovery(
          r.allowed && !!localStorage.getItem('duenext.legacy-quarantine.v2'),
        ),
      )
      .catch(() => {});
  }, [owner]);
  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await authFetch('/api/account', {}, owner);
      if (!r.ok) {
        const data = (await r.json()) as { error?: string };
        throw new Error(data.error || 'Export failed.');
      }
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement('a');
      a.href = url;
      a.download = 'duenext-export.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await authFetch(
          '/api/account',
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm }),
          },
          owner,
        ),
        data = (await r.json()) as { error?: string; revoked?: boolean };
      if (!r.ok) throw new Error(data.error || 'Deletion failed.');
      if (data.revoked === false)
        window.alert(
          'Your planner was deleted. Remove DueNext access in your Google account settings to finish disconnecting Google.',
        );
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="account-panel" open={expanded || undefined}>
      <summary>My data & account</summary>
      <p>
        Your assignments and classes belong to this account.{' '}
        <Link href="/privacy">Privacy</Link> · <Link href="/help">Help</Link>
      </p>
      <button
        className="outline"
        disabled={busy}
        onClick={() => void download()}
      >
        Export my planner
      </button>
      {recovery && (
        <details>
          <summary>Recover my original browser planner</summary>
          <p>
            These records were stored before account isolation was added. Import
            only if this is your original browser. Existing cloud items are
            preserved; recovered items become manual plans.
          </p>
          <button
            className="outline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void authFetch(
                '/api/recovery',
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sealed: localStorage.getItem(
                      'duenext.legacy-quarantine.v2',
                    ),
                  }),
                },
                owner,
              )
                .then(async (r) => {
                  const d = (await r.json()) as { error?: string };
                  if (!r.ok) throw new Error(d.error || 'Recovery failed.');
                  localStorage.removeItem('duenext.legacy-quarantine.v2');
                  location.reload();
                })
                .catch((e) => setError((e as Error).message))
                .finally(() => setBusy(false));
            }}
          >
            Import my original planner
          </button>
        </details>
      )}
      <details>
        <summary>Delete my account</summary>
        <p>
          This permanently deletes your planner, timetable, and saved
          connections. Export first if you want a copy. Sign in within the last
          five minutes to confirm. Your existing Google calendar and Canvas
          account remain yours.
        </p>
        <label>
          Type DELETE to confirm
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button
          className="delete-button"
          disabled={busy || confirm !== 'DELETE'}
          onClick={() => void remove()}
        >
          {busy ? 'Working…' : 'Delete my account permanently'}
        </button>
      </details>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </details>
  );
}
