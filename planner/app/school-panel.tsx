'use client';
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/firebase-client';
import {
  classesForDate,
  parseCalendarCsv,
  type ClassBlock,
  type SchoolCalendar,
} from '@/lib/school';
const fresh = (): ClassBlock => ({
  id: crypto.randomUUID(),
  name: '',
  room: '',
  cycle: 'A',
  startTime: '07:45',
  endTime: '09:15',
  termStart: '2026-08-19',
  termEnd: '2027-06-10',
  revision: 0,
});
async function requestForOwner(
  owner: string,
  path: string,
  method = 'GET',
  body?: unknown,
  key?: string,
) {
  const response = await authFetch(
    '/api/' + path,
    {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    owner,
  );
  const data = (await response.json()) as {
    error?: string;
    classes: ClassBlock[];
    calendar: SchoolCalendar;
    admin: boolean;
    courses: { id: string; name: string; code: string }[];
    connected: boolean;
    pending: boolean;
  };
  if (!response.ok) throw new Error(data.error || 'Could not save. Try again.');
  return data;
}
export default function SchoolPanel({
  date,
  owner,
  onCalendarChanged,
}: {
  date: string;
  owner: string;
  onCalendarChanged?: (calendar: SchoolCalendar) => void;
}) {
  const request = useCallback(
    (path: string, method = 'GET', body?: unknown, key?: string) =>
      requestForOwner(owner, path, method, body, key),
    [owner],
  );
  const [calendar, setCalendar] = useState<SchoolCalendar | null>(null),
    [classes, setClasses] = useState<ClassBlock[]>([]),
    [admin, setAdmin] = useState(false),
    [draft, setDraft] = useState<ClassBlock>(fresh),
    [csv, setCsv] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [courses, setCourses] = useState<
      { id: string; name: string; code: string }[]
    >([]),
    [canvasConnected, setCanvasConnected] = useState(false),
    [coursesPending, setCoursesPending] = useState(false);
  const loadCourses = useCallback(async () => {
    const result = await request('courses');
    setCourses(result.courses);
    setCanvasConnected(result.connected);
    setCoursesPending(result.pending);
  }, [request]);
  const reload = useCallback(async () => {
    const [a, b] = await Promise.all([
      request('school-calendar'),
      request('timetable'),
      loadCourses(),
    ]);
    setCalendar(a.calendar);
    onCalendarChanged?.(a.calendar);
    setAdmin(a.admin);
    setClasses(b.classes);
  }, [request, loadCourses, onCalendarChanged]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void reload().catch((e) => setError((e as Error).message));
    }, 0);
    return () => clearTimeout(timer);
  }, [reload]);
  const day = calendar?.dates.find((d) => d.date === date),
    todayClasses = classesForDate(classes, day, date);
  const save = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(
        'timetable',
        draft.revision ? 'PATCH' : 'POST',
        draft,
        draft.id,
      );
      await reload();
      setDraft(fresh());
      setNotice('Class saved.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (item: ClassBlock) => {
    setBusy(true);
    setError('');
    try {
      await request('timetable', 'DELETE', {
        id: item.id,
        revision: item.revision,
      });
      await reload();
      if (draft.id === item.id) setDraft(fresh());
      setNotice('Class removed.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="school-panel" aria-label="School day and timetable">
      <div className="school-day-heading">
        <div>
          <p className="eyebrow">INTERNATIONAL ACADEMY · {date}</p>
          <h2>
            {!day
              ? 'School schedule unavailable'
              : day.dayType === 'no-school'
                ? 'No school'
                : `${day.cycle} day${day.dayType === 'early-release' ? ' · Dismissal at 11 a.m.' : ''}`}
          </h2>
          {day?.notes && <p>{day.notes}</p>}
        </div>
        <a
          href={
            calendar?.sourceUrl ||
            'https://www.iatoday.org/tri-campus/graphic-calendar'
          }
          target="_blank"
          rel="noreferrer"
        >
          Official calendar
        </a>
      </div>
      {day &&
        (day.dayType === 'early-release' || day.dayType === 'special') && (
          <p>
            Check the school’s special class schedule. Regular class times are
            not shown for this day.
          </p>
        )}
      <div className="today-classes">
        {todayClasses.map((c) => (
          <article key={c.id}>
            <strong>{c.name}</strong>
            <span>
              {c.startTime}–{c.endTime}
              {c.room ? ` · ${c.room}` : ''}
            </span>
          </article>
        ))}
      </div>
      {!classes.length && calendar && (
        <p>
          Welcome to your private planner. Add your A/B classes below, then add
          assignments or connect Canvas.
        </p>
      )}
      <details>
        <summary
          onClick={() =>
            void loadCourses().catch((e) => setError((e as Error).message))
          }
        >
          My A/B timetable
        </summary>
        <div className="class-list">
          {classes.map((c) => (
            <div className="class-row" key={c.id}>
              <span>
                <strong>
                  {c.cycle} · {c.name}
                </strong>
                <br />
                {c.startTime}–{c.endTime}
                {c.room ? ` · ${c.room}` : ''}
              </span>
              <button
                className="outline"
                aria-label={`Edit ${c.name}`}
                disabled={busy}
                onClick={() => {
                  setDraft(c);
                  setNotice('');
                }}
              >
                Edit
              </button>
              <button
                className="subtle"
                aria-label={`Remove ${c.name}`}
                disabled={busy}
                onClick={() => void remove(c)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <form onSubmit={save} className="task-form">
          <h3>{draft.revision ? 'Edit class' : 'Add a class'}</h3>
          <fieldset disabled={busy}>
            {canvasConnected ? (
              <label>
                Choose a Canvas class
                <select
                  aria-label="Choose a Canvas class"
                  value={draft.canvasCourseId || ''}
                  onChange={(e) => {
                    const course = courses.find((c) => c.id === e.target.value);
                    setDraft({
                      ...draft,
                      canvasCourseId: course?.id || undefined,
                      ...(course ? { name: course.name } : {}),
                    });
                  }}
                >
                  <option value="">Enter a class manually</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.code && c.code !== c.name ? ` (${c.code})` : ''}
                    </option>
                  ))}
                </select>
                {coursesPending && (
                  <span>
                    Canvas courses are still syncing. Choose Sync now, then
                    reopen your timetable to refresh the choices.
                  </span>
                )}
              </label>
            ) : (
              <p>
                Connect Canvas to choose from your active courses, or enter a
                class manually.
              </p>
            )}
            <div className="form-grid">
              <label>
                Class name
                <input
                  required
                  maxLength={150}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                Room (optional)
                <input
                  maxLength={80}
                  value={draft.room}
                  onChange={(e) => setDraft({ ...draft, room: e.target.value })}
                />
              </label>
            </div>
            <label>
              Cycle day
              <select
                value={draft.cycle}
                onChange={(e) =>
                  setDraft({ ...draft, cycle: e.target.value as 'A' | 'B' })
                }
              >
                <option value="A">A day</option>
                <option value="B">B day</option>
              </select>
            </label>
            <div className="form-grid">
              <label>
                Start time
                <input
                  type="time"
                  required
                  value={draft.startTime}
                  onChange={(e) =>
                    setDraft({ ...draft, startTime: e.target.value })
                  }
                />
              </label>
              <label>
                End time
                <input
                  type="time"
                  required
                  value={draft.endTime}
                  onChange={(e) =>
                    setDraft({ ...draft, endTime: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Term starts
                <input
                  type="date"
                  required
                  value={draft.termStart}
                  onChange={(e) =>
                    setDraft({ ...draft, termStart: e.target.value })
                  }
                />
              </label>
              <label>
                Term ends
                <input
                  type="date"
                  required
                  value={draft.termEnd}
                  onChange={(e) =>
                    setDraft({ ...draft, termEnd: e.target.value })
                  }
                />
              </label>
            </div>
          </fieldset>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save class'}
          </button>
          {draft.revision > 0 && (
            <button
              className="subtle"
              type="button"
              onClick={() => setDraft(fresh())}
            >
              Cancel edit
            </button>
          )}
        </form>
      </details>
      {admin && calendar && (
        <details>
          <summary>Manage the shared school calendar</summary>
          <p>
            These dates are shared with all students. Private student planners
            are not available here. Current revision: {calendar.revision}.
          </p>
          <button
            className="outline"
            onClick={() =>
              setCsv(
                'date,cycle,dayType,dismissal,notes\n' +
                  calendar.dates
                    .map((d) =>
                      [
                        d.date,
                        d.cycle || '',
                        d.dayType,
                        d.dismissal,
                        d.notes,
                      ].join(','),
                    )
                    .join('\n'),
              )
            }
          >
            Load current dates
          </button>
          <label>
            Import calendar CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && file.size <= 300000) void file.text().then(setCsv);
                else setError('Choose a CSV smaller than 300 KB.');
              }}
            />
          </label>
          <label>
            Review dates before publishing
            <textarea
              rows={10}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder="date,cycle,dayType,dismissal,notes"
            />
          </label>
          <button
            className="primary"
            disabled={busy || !csv}
            onClick={() => {
              setBusy(true);
              setError('');
              void (async () => {
                try {
                  await request(
                    'school-calendar',
                    'PUT',
                    parseCalendarCsv(csv, calendar),
                  );
                  await reload();
                  setNotice('Shared calendar published.');
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Publish reviewed dates
          </button>
        </details>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}{' '}
          <button
            className="subtle"
            onClick={() =>
              void reload()
                .then(() => setError(''))
                .catch((e) => setError((e as Error).message))
            }
          >
            Retry
          </button>
        </p>
      )}
      {notice && <output className="school-status">{notice}</output>}
    </section>
  );
}
