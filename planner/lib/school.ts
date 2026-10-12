import {
  field,
  HttpError,
  identifier,
  object,
  safeUrl,
  validDate,
} from './domain';
export type SchoolDate = {
  date: string;
  cycle: 'A' | 'B' | null;
  dayType: 'normal' | 'early-release' | 'no-school' | 'special';
  dismissal: string;
  notes: string;
};
export type SchoolCalendar = {
  school: string;
  year: string;
  timeZone: string;
  sourceUrl: string;
  sourceSha256: string;
  verifiedAt: string;
  revision: number;
  dates: SchoolDate[];
};
export type ClassBlock = {
  id: string;
  name: string;
  room: string;
  cycle: 'A' | 'B';
  startTime: string;
  endTime: string;
  termStart: string;
  termEnd: string;
  canvasCourseId?: string;
  revision: number;
};
export function validateClass(
  raw: unknown,
): Omit<ClassBlock, 'id' | 'revision'> {
  const t = object(raw),
    name = field(t, 'name', 150),
    room = field(t, 'room', 80),
    startTime = field(t, 'startTime', 5),
    endTime = field(t, 'endTime', 5),
    termStart = field(t, 'termStart', 10),
    termEnd = field(t, 'termEnd', 10);
  if (
    !name ||
    !['A', 'B'].includes(String(t.cycle)) ||
    ![startTime, endTime].every((v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) ||
    endTime <= startTime ||
    !validDate(termStart) ||
    !validDate(termEnd) ||
    termEnd < termStart
  )
    throw new HttpError(
      'Check the class name, A/B day, times, and term dates.',
    );
  const canvasCourseId = field(t, 'canvasCourseId', 20);
  if (canvasCourseId && !/^\d+$/.test(canvasCourseId))
    throw new HttpError('Choose a valid Canvas course.');
  return {
    name,
    room,
    cycle: t.cycle as 'A' | 'B',
    startTime,
    endTime,
    termStart,
    termEnd,
    ...(canvasCourseId ? { canvasCourseId } : {}),
  };
}
export function validateCalendar(raw: unknown): SchoolCalendar {
  const t = object(raw);
  if (
    t.year !== '2026-2027' ||
    t.timeZone !== 'America/Detroit' ||
    !Array.isArray(t.dates) ||
    t.dates.length > 366 ||
    t.dates.length < 1
  )
    throw new HttpError(
      'Provide the 2026–27 school calendar in America/Detroit.',
    );
  const seen = new Set<string>();
  const dates = t.dates
    .map((value) => {
      const d = object(value),
        date = field(d, 'date', 10),
        notes = field(d, 'notes', 500),
        dismissal = field(d, 'dismissal', 5);
      if (
        !validDate(date) ||
        date < '2026-08-01' ||
        date > '2027-06-30' ||
        seen.has(date) ||
        !['normal', 'early-release', 'no-school', 'special'].includes(
          String(d.dayType),
        )
      )
        throw new HttpError('Check calendar dates and day types.');
      seen.add(date);
      if (
        !['A', 'B', null].includes(d.cycle as string | null) ||
        (d.dayType === 'no-school' && d.cycle !== null) ||
        (d.dayType !== 'no-school' && !d.cycle) ||
        (d.dayType === 'early-release' &&
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(dismissal)) ||
        (d.dayType !== 'early-release' && dismissal)
      )
        throw new HttpError('Check the A/B day and early-release time.');
      return {
        date,
        cycle: d.cycle as SchoolDate['cycle'],
        dayType: d.dayType as SchoolDate['dayType'],
        dismissal,
        notes,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    school: 'International Academy',
    year: '2026-2027',
    timeZone: 'America/Detroit',
    sourceUrl: safeUrl(t.sourceUrl),
    sourceSha256: field(t, 'sourceSha256', 64),
    verifiedAt: field(t, 'verifiedAt', 40),
    revision: Number(t.revision) || 1,
    dates,
  };
}
export function parseCalendarCsv(
  text: string,
  base: SchoolCalendar,
): SchoolCalendar {
  const lines = text.trim().split(/\r?\n/);
  if (lines[0]?.trim() !== 'date,cycle,dayType,dismissal,notes')
    throw new Error('Use the CSV header date,cycle,dayType,dismissal,notes.');
  return validateCalendar({
    ...base,
    dates: lines
      .slice(1)
      .filter(Boolean)
      .map((line) => {
        const [date, cycle, dayType, dismissal, ...notes] = line.split(',');
        return {
          date,
          cycle: cycle || null,
          dayType,
          dismissal: dismissal || '',
          notes: notes.join(','),
        };
      }),
  });
}
export function classesForDate(
  classes: ClassBlock[],
  day: SchoolDate | undefined,
  date: string,
) {
  if (!day || day.dayType !== 'normal') return [];
  return classes
    .filter(
      (c) => c.cycle === day.cycle && c.termStart <= date && c.termEnd >= date,
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}
export function classId(raw: unknown) {
  return identifier(raw);
}
