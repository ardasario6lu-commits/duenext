import 'server-only';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, database } from './admin';
import {
  active,
  cleanTask,
  connection,
  HttpError,
  identifier,
  normalizeTask,
  saveConnection,
  seal,
  unseal,
  type AuthContext,
} from './server';
const seededIds = new Set([
  '0b374fcd-33ed-4fcc-8e96-e678814561db',
  '0e8fa595-1f76-4c98-ae4d-c2fa353eaf6a',
  '18077561-13d1-4d7a-81b1-a826a566a601',
  '270fd481-7f35-49e9-9816-4e290ba1d1d2',
  '53c74fca-b440-4324-8d53-8dc37944182a',
  '67f2bb1a-a539-404a-b1f7-f936cb2df27e',
  '71b55a0c-8e78-4dab-8240-d30fe9e94ee9',
  '86900570-52b7-47b4-a3b3-6c820145b5fb',
  '99f7543b-8427-408e-93ea-de0a522f7f8d',
  'b5dff25a-51ff-4adc-88b2-956a996cb93f',
  'd6912d1f-e170-41d3-8ea7-e153e66096aa',
]);
export async function migrationOwners() {
  const owners = new Map(
    (await database().collection('users').listDocuments()).map((ref) => [
      ref.id,
      ref,
    ]),
  );
  // Earlier builds stored assignments beneath workspaces/<verified UID>.
  // Unowned workspaces must never become a student's planner.
  const workspaces = await database().collection('workspaces').listDocuments();
  for (const workspace of workspaces) {
    try {
      await adminAuth().getUser(workspace.id);
      owners.set(workspace.id, database().doc(`users/${workspace.id}`));
    } catch (error) {
      if ((error as { code?: string }).code !== 'auth/user-not-found')
        throw error;
    }
  }
  return [...owners.values()];
}
export function legacyTaskId(owner: string, raw: Record<string, unknown>) {
  const original = identifier(raw.id);
  if (raw.source !== 'canvas') return original;
  const sourceUrl = typeof raw.sourceUrl === 'string' ? raw.sourceUrl : '';
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    return original;
  }
  const ids = url.pathname.match(/^\/courses\/(\d+)\/assignments\/(\d+)\/?$/);
  if (url.origin !== 'https://ia.instructure.com' || !ids) return original;
  return createHash('sha256')
    .update(`${identifier(owner)}:canvas:${ids[1]}:${ids[2]}`)
    .digest('hex')
    .slice(0, 32);
}
export function migrationTasks(
  owner: string,
  legacy: Record<string, unknown>,
  personalOwner = process.env.LEGACY_PERSONAL_OWNER_UID,
) {
  const values: unknown =
    typeof legacy.tasks === 'string'
      ? JSON.parse(legacy.tasks)
      : legacy.tasks || [];
  if (!Array.isArray(values))
    throw new HttpError('Legacy assignments need manual review.');
  const ids = new Set<string>();
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object')
      throw new HttpError('A legacy assignment needs manual review.');
    const raw = value as Record<string, unknown>,
      task = normalizeTask(raw);
    if (!task) throw new HttpError('A legacy assignment needs manual review.');
    if (
      (typeof raw.title === 'string' && raw.title.length > 200) ||
      (typeof raw.notes === 'string' && raw.notes.length > 10000)
    )
      throw new HttpError(
        'A legacy assignment exceeds the new limits. Recover it from the backup before migration.',
      );
    if (ids.has(task.id))
      throw new HttpError('Duplicate legacy assignment IDs need review.');
    ids.add(task.id);
    if (seededIds.has(task.id)) {
      if (!personalOwner)
        throw new HttpError(
          'Set LEGACY_PERSONAL_OWNER_UID before migrating seeded assignments.',
        );
      if (owner !== personalOwner) return [];
    }
    const nextId = legacyTaskId(owner, raw);
    if (task.source === 'canvas' && nextId !== task.id) {
      const ids = new URL(task.sourceUrl).pathname.match(
        /^\/courses\/(\d+)\/assignments\/(\d+)\/?$/,
      )!;
      task.id = nextId;
      task.sourceId = `${ids[1]}:${ids[2]}`;
    }
    return [task];
  });
}
export async function migrateUser(
  owner: string,
  backup: (encrypted: string) => Promise<void>,
  apply = false,
) {
  identifier(owner);
  const auth: AuthContext = { owner, token: '', migration: true },
    legacyRef = database().doc(`users/${owner}/settings/canvas`),
    oldConnectionsRef = database().doc(`users/${owner}/settings/duenext`),
    workspace = database().doc(`workspaces/${owner}`),
    profile = database().doc(`users/${owner}`),
    profileDoc = await profile.get();
  if (Number(profileDoc.data()?.migrationVersion) >= 3)
    return { owner, status: 'already-migrated', count: 0 };
  const [legacyDoc, oldConnectionsDoc, assignments, classes] =
    await Promise.all([
      legacyRef.get(),
      oldConnectionsRef.get(),
      workspace.collection('assignments').get(),
      workspace.collection('classes').get(),
    ]);
  const legacy = legacyDoc.data() || {},
    oldConnections = oldConnectionsDoc.data() || {};
  if (
    !legacyDoc.exists &&
    !oldConnectionsDoc.exists &&
    assignments.empty &&
    classes.empty
  )
    return { owner, status: 'already-migrated', count: 0 };
  const workspaceTasks = migrationTasks(owner, {
    tasks: assignments.docs.map((doc) => ({ ...doc.data(), id: doc.id })),
  });
  const tasks = [
    ...new Map(
      [...workspaceTasks, ...migrationTasks(owner, legacy)].map((task) => [
        task.id,
        task,
      ]),
    ).values(),
  ];
  const legacyClasses = classes.docs.map((doc) => ({
    id: doc.id,
    ...Object.fromEntries(
      ['name', 'room', 'teacher', 'email'].map((key) => [
        key,
        typeof doc.data()[key] === 'string' ? doc.data()[key] : '',
      ]),
    ),
  }));
  if (Buffer.byteLength(JSON.stringify(legacyClasses)) > 500000)
    throw new HttpError(
      'Legacy classes need manual recovery before migration.',
    );
  if (!apply) return { owner, status: 'dry-run', count: tasks.length };
  // Stop the new API's writes for this user throughout a resumable migration.
  await profile.set({ migrating: true }, { merge: true });
  const existing = await database().collection(`users/${owner}/tasks`).get();
  await backup(
    await seal({
      formatVersion: 1,
      owner,
      exportedAt: new Date().toISOString(),
      legacy,
      oldConnections,
      workspaceAssignments: assignments.docs.map((doc) => ({
        ...doc.data(),
        id: doc.id,
      })),
      workspaceClasses: classes.docs.map((doc) => ({
        ...doc.data(),
        id: doc.id,
      })),
      tasks: existing.docs.map((d) => d.data()),
    }),
  );
  for (let offset = 0; offset < tasks.length; offset += 100) {
    const chunk = tasks.slice(offset, offset + 100),
      refs = chunk.map((t) => database().doc(`users/${owner}/tasks/${t.id}`));
    await database().runTransaction(async (tx) => {
      await active(tx, auth);
      const docs = await tx.getAll(...refs);
      chunk.forEach((task, index) => {
        if (!docs[index].exists) tx.create(refs[index], cleanTask(task));
      });
    });
  }
  if (legacyClasses.length) {
    const archive = database().doc(`users/${owner}/private/legacy-classes`);
    await database().runTransaction(async (tx) => {
      await active(tx, auth);
      const previous = (await tx.get(archive)).data()?.classes || [];
      const merged = [
        ...new Map(
          [...legacyClasses, ...previous].map((item) => [item.id, item]),
        ).values(),
      ];
      tx.set(archive, { classes: merged });
    });
  }
  const conn = await connection(auth);
  if (!conn.canvas) {
    const encrypted = oldConnections.canvas || legacy.canvas;
    if (typeof encrypted === 'string' && encrypted) {
      const value = await unseal<{ token: string }>(encrypted);
      conn.canvas = await seal(value);
    } else if (typeof legacy.token === 'string' && legacy.token)
      conn.canvas = await seal({ token: legacy.token });
  }
  const oldGoogle = oldConnections.google || legacy.google;
  if (!conn.google && typeof oldGoogle === 'string' && oldGoogle) {
    const value = await unseal<{
      clientId?: string;
      refresh?: string;
      calendar?: string;
    }>(oldGoogle);
    if (value.refresh && value.clientId === process.env.GOOGLE_CLIENT_ID)
      conn.google = await seal({
        refresh: value.refresh,
        ...(value.calendar ? { calendar: value.calendar } : {}),
      });
  }
  await saveConnection(auth, conn);
  // All replacement documents and encrypted backups exist before cleanup.
  await database().recursiveDelete(workspace);
  await database().runTransaction(async (tx) => {
    await active(tx, auth);
    const removed = {
      token: FieldValue.delete(),
      canvas: FieldValue.delete(),
      google: FieldValue.delete(),
      tasks: FieldValue.delete(),
      syncLock: FieldValue.delete(),
      migratedAt: new Date().toISOString(),
    };
    if (legacyDoc.exists) tx.update(legacyRef, removed);
    if (oldConnectionsDoc.exists) tx.update(oldConnectionsRef, removed);
    tx.set(profile, { migrating: false, migrationVersion: 3 }, { merge: true });
  });
  return { owner, status: 'migrated', count: tasks.length };
}
