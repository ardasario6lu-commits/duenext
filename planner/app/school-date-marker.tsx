import type { SchoolDate } from '@/lib/school';

export function schoolDateDescription(day: SchoolDate) {
  return [
    day.cycle ? `${day.cycle} day` : 'No school',
    day.dayType === 'early-release' ? 'Dismissal at 11 a.m.' : '',
    day.notes && !['No school', 'Weekend'].includes(day.notes) ? day.notes : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export default function SchoolDateMarker({
  day,
  part,
  weekend = false,
}: {
  day: SchoolDate;
  part: 'cycle' | 'note';
  weekend?: boolean;
}) {
  const description = schoolDateDescription(day);
  if (part === 'cycle') {
    return day.cycle ? (
      <span
        className={`school-cycle-label school-cycle-${day.cycle.toLowerCase()}`}
        aria-label={description}
      >
        {day.cycle}
        <span className="school-cycle-word"> day</span>
      </span>
    ) : null;
  }
  const note =
    day.dayType === 'early-release' ? '11 a.m. dismissal' : day.notes;
  if (day.dayType === 'no-school') {
    if (weekend && ['No school', 'Weekend', ''].includes(day.notes))
      return null;
    return (
      <span
        className="school-date-note school-closure-label"
        aria-label={description}
      >
        No school
      </span>
    );
  }
  return note ? (
    <span className="school-date-note" aria-label={description}>
      {note}
    </span>
  ) : null;
}
