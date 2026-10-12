'use client';
import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/firebase-client';
import {
  classesForDate,
  type ClassBlock,
  type SchoolCalendar,
} from '@/lib/school';

export default function TodayClasses({
  owner,
  date,
  calendar,
  onManage,
}: {
  owner: string;
  date: string;
  calendar: SchoolCalendar | null;
  onManage: () => void;
}) {
  const [classes, setClasses] = useState<ClassBlock[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void authFetch('/api/timetable', { signal: controller.signal }, owner)
      .then(async (response) => {
        if (!response.ok) throw new Error('Timetable unavailable');
        const data = (await response.json()) as { classes: ClassBlock[] };
        if (!controller.signal.aborted) {
          setClasses(data.classes);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [owner]);
  const day = calendar?.dates.find((item) => item.date === date);
  const today = classesForDate(classes, day, date);
  return (
    <aside className="today-class-panel" aria-label="Today's classes">
      <div className="today-class-heading">
        <h2>Today’s classes</h2>
        {day?.cycle && (
          <span
            className={`school-cycle-label school-cycle-${day.cycle.toLowerCase()}`}
          >
            {day.cycle} day
          </span>
        )}
      </div>
      {!day ? (
        <p>
          {calendar
            ? 'Schedule unavailable for this date.'
            : 'Loading school schedule…'}
        </p>
      ) : day.dayType === 'no-school' ? (
        <p>
          No school today.
          {day.notes && day.notes !== 'No school' && day.notes !== 'Weekend'
            ? ` ${day.notes}.`
            : ''}
        </p>
      ) : day.dayType !== 'normal' ? (
        <p>
          {day.dayType === 'early-release' ? 'Dismissal at 11 a.m. ' : ''}Check
          the school’s special class schedule.
        </p>
      ) : error ? (
        <p role="alert">
          Your timetable could not load. Open timetable settings to retry.
        </p>
      ) : !loaded ? (
        <p>Loading your classes…</p>
      ) : !today.length ? (
        <p>
          {classes.length
            ? 'No classes scheduled for today.'
            : 'Add your A/B classes to see your day here.'}
        </p>
      ) : (
        <ol className="today-class-list">
          {today.map((item) => (
            <li key={item.id}>
              <time>
                {item.startTime}
                <span>{item.endTime}</span>
              </time>
              <div>
                <strong>{item.name}</strong>
                {item.room && <span>Room {item.room}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
      <button className="manage-timetable" onClick={onManage}>
        Manage timetable
      </button>
    </aside>
  );
}
