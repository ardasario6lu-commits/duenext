'use client';
import Link from 'next/link';

import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { Layers } from 'lucide-react';
import Planner from './planner';
import { auth, signIn, quarantineLegacyTasks } from '@/lib/firebase-client';

export default function AuthGate() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remember, setRemember] = useState(false);

  useEffect(
    () =>
      onAuthStateChanged(auth, (next) => {
        setUser(null);
        if (!next) {
          setReady(true);
          return;
        }
        setReady(false);
        void quarantineLegacyTasks(next.uid)
          .then(() => {
            if (auth.currentUser?.uid === next.uid) {
              setUser(next);
              setReady(true);
            }
          })
          .catch((cause) => {
            setError(
              cause instanceof Error
                ? cause.message
                : 'Browser upgrade failed.',
            );
            setReady(true);
          });
      }),
    [],
  );

  if (ready && user) return <Planner key={user.uid} owner={user.uid} />;

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <span className="brand-icon">
            <Layers size={25} />
          </span>
          duenext<span className="brand-period">.</span>
        </div>
        <p className="eyebrow">A little order for a busy week.</p>
        <h1>
          {ready ? 'Make room for what’s next.' : 'Opening your planner…'}
        </h1>
        <p className="auth-copy">
          Assignments, personal plans, and college deadlines in one calendar on
          every device.
        </p>
        <div className="auth-features">
          <span>School assignments</span>
          <span>Personal plans</span>
          <span>College deadlines</span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {error && auth.currentUser && (
          <button
            className="outline"
            onClick={() => {
              const current = auth.currentUser;
              if (!current) return;
              setBusy(true);
              void quarantineLegacyTasks(current.uid)
                .then(() => {
                  if (auth.currentUser?.uid === current.uid) {
                    setUser(current);
                    setError('');
                  }
                })
                .catch((cause) => setError((cause as Error).message))
                .finally(() => setBusy(false));
            }}
          >
            Retry browser data upgrade
          </button>
        )}
        {ready && (
          <label className="remember-choice">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />{' '}
            Remember me on this personal device
          </label>
        )}
        {ready && (
          <button
            className="primary auth-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await signIn(remember);
              } catch (cause) {
                const message =
                  cause instanceof Error ? cause.message : 'Sign-in failed.';
                setError(
                  message.includes('unauthorized-domain')
                    ? 'Google sign-in is not enabled for this address. Contact the project organizer.'
                    : message.includes('popup-closed-by-user')
                      ? 'The sign-in window closed before finishing. Try again and keep it open.'
                      : message.includes('network-request-failed')
                        ? 'Google sign-in could not connect. Check your network and browser blocking settings.'
                        : 'Google sign-in did not finish. Please try again.',
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Signing in…' : 'Continue with Google'}
          </button>
        )}
        <small>
          Your planner stays private to your Google account.{' '}
          <Link href="/privacy">Privacy</Link> · <Link href="/help">Help</Link>
        </small>
      </section>
    </main>
  );
}
