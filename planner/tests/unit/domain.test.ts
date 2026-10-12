import { describe, expect, it } from 'vitest';
import {
  identifier,
  readBody,
  safeUrl,
  schoolDayKey,
  validDate,
} from '../../lib/domain';
import { validateTask } from '../../lib/types';
import {
  classesForDate,
  parseCalendarCsv,
  validateCalendar,
  validateClass,
} from '../../lib/school';
import seed from '../../data/school-calendar-2026-2027.json';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const calendar = validateCalendar(seed);
describe('input and school time boundaries', () => {
  it('rejects path aliases and unsafe source links', () => {
    for (const id of ['../studentB', 'x/y', '%2f', '.', '', 'a'.repeat(129)])
      expect(() => identifier(id)).toThrow();
    for (const url of [
      'javascript:alert(1)',
      'http://example.com',
      'https://user:secret@example.com',
    ])
      expect(() => safeUrl(url)).toThrow();
  });
  it('validates dates and permits undated assignments only', () => {
    expect(validDate('2026-02-30')).toBe(false);
    expect(
      validateTask({
        title: 'Essay',
        category: 'school',
        kind: 'task',
        date: null,
      }).date,
    ).toBeNull();
    expect(() =>
      validateTask({
        title: 'Event',
        category: 'life',
        kind: 'event',
        date: null,
      }),
    ).toThrow();
    expect(schoolDayKey(new Date('2026-10-09T02:00:00Z'))).toBe('2026-10-08');
  });
  it('bounds streaming JSON, not just declared content length', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'x'.repeat(40) }),
    });
    await expect(readBody(req, 20)).rejects.toMatchObject({ status: 413 });
    await expect(
      readBody(new Request('http://localhost', { method: 'POST', body: '{}' })),
    ).rejects.toMatchObject({ status: 415 });
  });
});
describe('calendar matches every visually checked PDF cell', () => {
  const blue: Record<string, number[]> = {
    '2026-08': [20, 24, 26, 28],
    '2026-09': [1, 3, 9, 11, 15, 17, 21, 23, 25, 29],
    '2026-10': [1, 5, 7, 9, 13, 15, 19, 21, 23, 27, 29],
    '2026-11': [5, 9, 11, 13, 17, 19, 23, 30],
    '2026-12': [2, 4, 8, 10, 14, 16, 18],
    '2027-01': [5, 7, 11, 13, 15, 20, 22, 26, 28],
    '2027-02': [1, 3, 5, 9, 11, 22, 24, 26],
    '2027-03': [2, 4, 9, 11, 15, 17, 19, 23, 25],
    '2027-04': [6, 8, 12, 14, 16, 20, 22, 26, 28, 30],
    '2027-05': [4, 6, 10, 12, 14, 18, 20, 24, 26, 28],
    '2027-06': [2, 4, 8, 10],
  };
  const closures: Record<string, number[]> = {
    '2026-09': [4, 7],
    '2026-10': [30],
    '2026-11': [2, 3, 25, 26, 27],
    '2026-12': [21, 22, 23, 24, 25, 28, 29, 30, 31],
    '2027-01': [1, 18],
    '2027-02': [15, 16, 17, 18, 19],
    '2027-03': [8, 26, 29, 30, 31],
    '2027-04': [1, 2],
    '2027-05': [31],
  };
  const early = [
    '2026-09-23',
    '2026-10-23',
    '2026-10-29',
    '2027-01-15',
    '2027-03-01',
    '2027-04-08',
    '2027-04-26',
    '2027-06-09',
    '2027-06-10',
  ];
  it('has the original source digest, 334 unique dates and 180 school days', () => {
    expect(
      createHash('sha256')
        .update(readFileSync('sources/ia-calendar-2026-2027.pdf'))
        .digest('hex'),
    ).toBe(calendar.sourceSha256);
    expect(calendar.dates).toHaveLength(334);
    expect(calendar.dates.filter((d) => d.cycle)).toHaveLength(180);
  });
  it.each(calendar.dates.map((d) => [d.date, d] as const))(
    '%s has the published cycle and day type',
    (date, day) => {
      const month = date.slice(0, 7),
        number = Number(date.slice(-2)),
        weekday = new Date(date + 'T12:00:00Z').getUTCDay();
      const closed =
        weekday === 0 ||
        weekday === 6 ||
        date < '2026-08-19' ||
        date > '2027-06-10' ||
        closures[month]?.includes(number);
      expect(day.cycle).toBe(
        closed ? null : blue[month].includes(number) ? 'B' : 'A',
      );
      expect(day.dayType).toBe(
        closed
          ? 'no-school'
          : early.includes(date)
            ? 'early-release'
            : 'normal',
      );
      expect(day.dismissal).toBe(early.includes(date) ? '11:00' : '');
    },
  );
  it('keeps midterms full days and unknown/special dates without invented class times', () => {
    for (const date of [
      '2026-12-15',
      '2026-12-16',
      '2026-12-17',
      '2026-12-18',
    ]) {
      const d = calendar.dates.find((d) => d.date === date)!;
      expect(d.dayType).toBe('normal');
      expect(d.notes).toContain('Midterms');
    }
    const c = {
      ...validateClass({
        name: 'Physics',
        cycle: 'B',
        startTime: '07:45',
        endTime: '09:15',
        termStart: '2026-08-19',
        termEnd: '2027-06-10',
      }),
      id: 'physics',
      revision: 1,
    };
    expect(
      classesForDate(
        [c],
        calendar.dates.find((d) => d.date === '2026-10-23'),
        '2026-10-23',
      ),
    ).toEqual([]);
    expect(classesForDate([c], undefined, '2027-08-19')).toEqual([]);
  });
  it('rejects duplicate calendar rows and invalid class times', () => {
    expect(() =>
      parseCalendarCsv(
        'date,cycle,dayType,dismissal,notes\n2026-10-08,A,normal,,\n2026-10-08,B,normal,,',
        calendar,
      ),
    ).toThrow();
    expect(() =>
      validateClass({
        name: 'Physics',
        cycle: 'B',
        startTime: '09:15',
        endTime: '07:45',
        termStart: '2026-08-19',
        termEnd: '2027-06-10',
      }),
    ).toThrow();
  });
});
it('validates inclusive multi-day and overnight event dates', () => {
  const overnight = validateTask({
    title: 'Trip',
    category: 'life',
    kind: 'event',
    date: '2026-10-09',
    endDate: '2026-10-10',
    time: '22:00',
    endTime: '01:00',
  });
  expect(overnight.endDate).toBe('2026-10-10');
  expect(() =>
    validateTask({
      title: 'Trip',
      category: 'life',
      kind: 'event',
      date: '2026-10-09',
      endDate: '2026-10-08',
    }),
  ).toThrow();
});
