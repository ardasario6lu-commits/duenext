import 'server-only';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpError } from './domain';
export function adminApp() {
  const existing = getApps().find((a) => a.name === 'duenext-server');
  if (existing) return existing;
  const projectId = process.env.FIREBASE_PROJECT_ID || 'demo-duenext';
  if (
    process.env.NODE_ENV === 'production' &&
    (process.env.FIRESTORE_EMULATOR_HOST ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST)
  )
    throw new HttpError('Unsafe storage configuration.', 503);
  if (
    process.env.FIRESTORE_EMULATOR_HOST &&
    process.env.FIREBASE_AUTH_EMULATOR_HOST
  )
    return initializeApp({ projectId }, 'duenext-server');
  const raw = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!raw && !process.env.GOOGLE_APPLICATION_CREDENTIALS)
    throw new HttpError(
      'Planner storage is being configured. Please try again later.',
      503,
    );
  if (raw) {
    let credential;
    try {
      const value = JSON.parse(raw) as { project_id?: string };
      if (value.project_id !== projectId) throw new Error();
      credential = cert(JSON.parse(raw));
    } catch {
      throw new HttpError(
        'Planner storage configuration needs attention.',
        503,
      );
    }
    return initializeApp({ projectId, credential }, 'duenext-server');
  }
  return initializeApp({ projectId }, 'duenext-server');
}
export function database() {
  return getFirestore(adminApp());
}
export function adminAuth() {
  return getAuth(adminApp());
}
