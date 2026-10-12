import { field, HttpError, object, validDate } from './domain';
export type Category = 'school' | 'life' | 'college';
export type Task = {
  id: string;
  title: string;
  category: Category;
  kind: 'task' | 'event';
  date: string | null;
  time: string;
  endTime: string;
  endDate?: string;
  notes: string;
  course: string;
  priority: 'normal' | 'high';
  done: number;
  source: 'manual' | 'canvas' | 'google';
  sourceId?: string;
  sourceUrl: string;
  googleId?: string;
  googlePendingUpdated?: string;
  requestId?: string;
  updated: string;
  deleted: number;
  revision: number;
};
export type ConnectionStatus = {
  canvas: boolean;
  google: boolean;
  googleConfigured: boolean;
  lastCanvas: string | null;
  lastGoogle: string | null;
  origin: string;
};
export const labels: Record<Category, string> = {
  school: 'School',
  life: 'Life',
  college: 'College apps',
};
export function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseDay(s: string) {
  return new Date(s + 'T12:00:00');
}
export function taskOrder(a: Task, b: Task) {
  return (
    (a.date || '9999').localeCompare(b.date || '9999') ||
    a.time.localeCompare(b.time)
  );
}
export function validateTask(
  raw: unknown,
): Pick<
  Task,
  | 'title'
  | 'date'
  | 'time'
  | 'endTime'
  | 'endDate'
  | 'category'
  | 'kind'
  | 'priority'
  | 'notes'
  | 'course'
  | 'done'
> {
  const t = object(raw),
    title = field(t, 'title', 200),
    category = field(t, 'category', 10),
    kind = field(t, 'kind', 10),
    priority = field(t, 'priority', 10) || 'normal';
  const date = field(t, 'date', 10) || null,
    time = field(t, 'time', 5),
    endTime = field(t, 'endTime', 5),
    endDate = field(t, 'endDate', 10) || undefined;
  if (!title) throw new HttpError('Give this item a title.');
  if ((date && !validDate(date)) || (!date && kind === 'event'))
    throw new HttpError('Choose a valid date.');
  if (
    !['school', 'life', 'college'].includes(category) ||
    !['task', 'event'].includes(kind)
  )
    throw new HttpError('Choose a calendar and item type.');
  if (!['normal', 'high'].includes(priority))
    throw new HttpError('Choose a valid priority.');
  if (
    [time, endTime].some((v) => v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) ||
    (!date && (time || endTime))
  )
    throw new HttpError('Choose a valid time and date.');
  if (
    endDate &&
    (!date || !validDate(endDate) || endDate < date || kind !== 'event')
  )
    throw new HttpError('Choose a valid event end date.');
  if (endTime && (!time || ((!endDate || endDate === date) && endTime <= time)))
    throw new HttpError(
      'End time must be later than start time on the same day.',
    );
  return {
    title,
    date,
    time,
    endTime,
    ...(endDate ? { endDate } : {}),
    category: category as Category,
    kind: kind as Task['kind'],
    priority: priority as Task['priority'],
    notes: field(t, 'notes', 10000),
    course: field(t, 'course', 150),
    done: t.done === true || t.done === 1 ? 1 : 0,
  };
}
