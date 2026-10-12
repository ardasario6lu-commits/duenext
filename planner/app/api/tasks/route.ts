import {
  createTask,
  failure,
  getTask,
  guard,
  HttpError,
  identifier,
  json,
  putTask,
  rateLimit,
  readBody,
  taskPage,
  user,
} from '@/lib/server';
import { revision } from '@/lib/domain';
import { validateTask, type Task } from '@/lib/types';
export async function GET(req: Request) {
  try {
    const auth = await user(req);
    await rateLimit(auth, 'reads', 120);
    const url = new URL(req.url);
    return json(
      await taskPage(
        auth,
        url.searchParams.get('cursor') || '',
        Number(url.searchParams.get('limit') || 200),
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    guard(req);
    const auth = await user(req);
    await rateLimit(auth, 'writes');
    const raw = await readBody(req),
      value = validateTask(raw);
    const key = identifier(req.headers.get('idempotency-key'));
    const task: Task = {
      id: crypto.randomUUID(),
      ...value,
      source: 'manual',
      sourceUrl: '',
      updated: new Date().toISOString(),
      deleted: 0,
      revision: 1,
    };
    return json({ task: await createTask(auth, task, key) }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request) {
  try {
    guard(req);
    const auth = await user(req);
    await rateLimit(auth, 'writes');
    const raw = await readBody(req),
      id = identifier(raw.id),
      expected = revision(raw.revision),
      previous = await getTask(auth, id);
    if (!previous || previous.deleted)
      throw new HttpError('This item no longer exists.', 404);
    if (previous.source === 'google')
      throw new HttpError('Edit this event in Google Calendar.');
    if (raw.completeOnly !== true && previous.source === 'canvas')
      throw new HttpError(
        'Change assignment details in Canvas. You can mark it complete here.',
      );
    if (raw.completeOnly === true && typeof raw.done !== 'boolean')
      throw new HttpError('Choose a completion state.');
    const task = await putTask(
      auth,
      {
        ...previous,
        ...(raw.completeOnly !== true ? { endDate: undefined } : {}),
        ...(raw.completeOnly === true
          ? { done: raw.done ? 1 : 0 }
          : validateTask(raw)),
        updated: new Date().toISOString(),
      },
      expected,
    );
    return json({ task });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(req: Request) {
  try {
    guard(req);
    const auth = await user(req);
    await rateLimit(auth, 'writes');
    const raw = await readBody(req),
      expected = revision(raw.revision),
      task = await getTask(auth, identifier(raw.id));
    if (!task) throw new HttpError('This item no longer exists.', 404);
    if (task.source !== 'manual')
      throw new HttpError('Remove imported items at their source.');
    return json({
      task: await putTask(
        auth,
        { ...task, deleted: 1, updated: new Date().toISOString() },
        expected,
      ),
    });
  } catch (e) {
    return failure(e);
  }
}
