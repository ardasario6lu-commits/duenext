import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import seed from '../../data/school-calendar-2026-2027.json';
import { validateCalendar } from '../../lib/school';
import SchoolDateMarker, {
  schoolDateDescription,
} from '../../app/school-date-marker';

const dates = validateCalendar(seed).dates;
const date = (key: string) => dates.find((d) => d.date === key)!;

it('renders the verified cycle and early dismissal without treating midterms as a closure', () => {
  expect(schoolDateDescription(date('2026-08-19'))).toBe('A day');
  expect(schoolDateDescription(date('2026-08-20'))).toBe('B day');
  expect(schoolDateDescription(date('2026-10-23'))).toContain(
    'B day · Dismissal at 11 a.m.',
  );
  expect(schoolDateDescription(date('2026-12-16'))).toContain(
    'Midterms — full day of school',
  );
  expect(
    renderToStaticMarkup(
      createElement(SchoolDateMarker, {
        day: date('2026-12-16'),
        part: 'cycle',
      }),
    ),
  ).toContain('school-cycle-b');
});

it('labels published closures and keeps ordinary weekends quiet', () => {
  const closure = renderToStaticMarkup(
    createElement(SchoolDateMarker, { day: date('2026-10-30'), part: 'note' }),
  );
  expect(closure).toContain('No school');
  expect(closure).toContain('Conference compensation');
  expect(
    renderToStaticMarkup(
      createElement(SchoolDateMarker, {
        day: date('2026-10-30'),
        part: 'cycle',
      }),
    ),
  ).toBe('');
  expect(
    renderToStaticMarkup(
      createElement(SchoolDateMarker, {
        day: date('2026-10-31'),
        part: 'note',
        weekend: true,
      }),
    ),
  ).toBe('');
});
