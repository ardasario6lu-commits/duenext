'use client';
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useSyncExternalStore,
} from 'react';
import {
  CalendarDays,
  CheckCheck,
  GraduationCap,
  Plus,
  ChevronLeft,
  ChevronRight,
  Link2,
  ArrowUpRight,
  Sun,
  Layers,
  RefreshCw,
  Check,
  Trash2,
  ExternalLink,
  Flag,
  Smartphone,
  AlertCircle,
  LogOut,
  Settings2,
} from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Empty, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  dayKey,
  parseDay,
  labels,
  type Task,
  type Category,
  type ConnectionStatus,
  taskOrder,
} from '@/lib/types';
import { auth, authFetch, signOutUser } from '@/lib/firebase-client';
import { useCyd } from '@/hooks/use-cyd';
import SchoolPanel from './school-panel';
import AccountPanel from './account-panel';
import TodayClasses from './today-classes';
import { schoolDayKey } from '@/lib/domain';
import { focusTasks } from '@/lib/planner-display';
import { PlannerTaskState } from '@/lib/planner-task-state';
import type { SchoolCalendar } from '@/lib/school';
import SchoolDateMarker, { schoolDateDescription } from './school-date-marker';
const cats: Category[] = ['school', 'life', 'college'];
const color = (c: Category) => 'c' + cats.indexOf(c);

type ApiResult = ConnectionStatus & {
  tasks: Task[];
  task: Task;
  error?: string;
  errors?: string[];
  busy?: boolean;
  url?: string;
  nextCursor?: string | null;
  jobs?: { provider: string; status: string; count: number }[];
  revoked?: boolean;
};
async function apiRequest(
  owner: string,
  path: string,
  body?: unknown,
  method = 'POST',
): Promise<ApiResult> {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (
    path === 'tasks' &&
    method === 'POST' &&
    body &&
    typeof body === 'object'
  ) {
    const key = (body as Task).requestId;
    headers.set('Idempotency-Key', key || crypto.randomUUID());
  }
  const response = await authFetch(
    '/api/' + path,
    {
      method: body === undefined ? 'GET' : method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    owner,
  );
  const result = (await response.json()) as ApiResult;
  if (!response.ok)
    throw new Error(result.error || 'Could not save. Please try again.');
  return result;
}
async function loadAllTasks(owner: string) {
  const tasks: Task[] = [];
  let cursor = '';
  do {
    const page = await apiRequest(
      owner,
      'tasks?limit=200' +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
    );
    tasks.push(...page.tasks);
    cursor = page.nextCursor || '';
  } while (cursor);
  return tasks;
}
const fresh = (date: string, category: Category = 'school'): Task => ({
  id: '',
  revision: 0,
  requestId: crypto.randomUUID(),
  title: '',
  category,
  kind: 'task',
  date,
  time: '',
  endTime: '',
  notes: '',
  course: '',
  priority: 'normal',
  done: 0,
  source: 'manual',
  sourceUrl: '',
  updated: '',
  deleted: 0,
});
function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <button
      className={active ? 'active' : ''}
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        onClick();
        setOpenMobile(false);
      }}
    >
      {children}
    </button>
  );
}
function Choice({
  value,
  onChange,
  items,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  items: Record<string, string>;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger aria-label={label} className="form-select">
        <SelectValue>{items[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([key, title]) => (
          <SelectItem key={key} value={key}>
            {title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export default function Home({ owner }: { owner: string }) {
  const api = useCallback(
    (path: string, body?: unknown, method = 'POST') =>
      apiRequest(owner, path, body, method),
    [owner],
  );
  const [date, setDate] = useState(() => parseDay(schoolDayKey()));
  const [view, setView] = useState('month');
  const [page, setPage] = useState('calendar');
  const [taskState] = useState(() => new PlannerTaskState());
  const tasks = useSyncExternalStore(
    taskState.subscribe,
    taskState.getSnapshot,
    taskState.getSnapshot,
  );
  const cyd = useCyd(tasks);
  const [enabled, setEnabled] = useState<Category[]>(cats);
  const [conn, setConn] = useState<ConnectionStatus | null>(null);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState('timetable');
  const [schoolCalendar, setSchoolCalendar] = useState<SchoolCalendar | null>(
    null,
  );
  const [schoolCalendarError, setSchoolCalendarError] = useState(false);
  const [draft, setDraft] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingCompletionIds, setPendingCompletionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const pendingCompletionRef = useRef(new Set<string>());
  const [syncing, setSyncing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [taskFilter, setTaskFilter] = useState('all');
  const [showCompleted, setShowCompleted] = useState(true);
  const [heldFocusIds, setHeldFocusIds] = useState<string[] | null>(null);
  const [detailScope, setDetailScope] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const syncRef = useRef(false);
  const mutationRef = useRef(false);
  const connectionReadRef = useRef(0);
  const today = schoolDayKey();
  useEffect(() => {
    const controller = new AbortController();
    void authFetch('/api/school-calendar', { signal: controller.signal }, owner)
      .then(async (response) => {
        if (!response.ok) throw new Error('School calendar unavailable');
        const data = (await response.json()) as { calendar: SchoolCalendar };
        if (!controller.signal.aborted) {
          setSchoolCalendar(data.calendar);
          setSchoolCalendarError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setSchoolCalendarError(true);
      });
    return () => controller.abort();
  }, [owner]);
  const reload = useCallback(async () => {
    const ticket = taskState.beginRead();
    const connectionRead = ++connectionReadRef.current;
    await Promise.all([
      loadAllTasks(owner).then((items) => {
        if (taskState.acceptRead(ticket, items)) setLoaded(true);
      }),
      api('connections').then((status) => {
        if (connectionRead === connectionReadRef.current) setConn(status);
      }),
    ]);
  }, [api, owner, taskState]);
  const sync = useCallback(
    async (provider?: string, quiet = false) => {
      if (syncRef.current) return;
      syncRef.current = true;
      setSyncing(true);
      try {
        let r = await api('sync', {
          provider,
          timeZone: 'America/Detroit',
          force: !quiet,
        });
        while (
          r.jobs?.some((job) => job.status === 'pending') &&
          auth.currentUser?.uid === owner &&
          !document.hidden
        ) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          r = await api('sync', { provider, timeZone: 'America/Detroit' });
        }
        await reload();
        if (r.errors?.length) setError(r.errors.join(' '));
        else {
          if (!quiet) setError('');
          if (!quiet)
            setNotice(
              r.busy
                ? 'A sync is already running.'
                : provider === 'canvas'
                  ? 'Canvas assignments synced.'
                  : 'Your calendars are up to date.',
            );
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        syncRef.current = false;
        setSyncing(false);
      }
    },
    [reload, api, owner, setError],
  );
  useEffect(() => {
    const kickoff = window.setTimeout(() => {
      void reload()
        .then(() => sync(undefined, true))
        .catch((e) => setError(e.message));
    }, 0);
    const interval = setInterval(() => {
      if (!document.hidden) void sync(undefined, true);
    }, 300000);
    const focus = () => {
      void reload().catch((e) => setError(e.message));
    };
    window.addEventListener('focus', focus);
    const q = new URLSearchParams(location.search);
    const resultTimer = window.setTimeout(() => {
      if (q.get('google')) {
        setConnectionsOpen(true);
        if (q.get('google') === 'error')
          setError(
            'Google authorization did not finish. Check your setup and try again.',
          );
        else
          setNotice('Google Calendar connected. Your first sync is starting.');
        history.replaceState({}, '', location.pathname);
      }
    }, 0);
    return () => {
      clearInterval(interval);
      clearTimeout(kickoff);
      clearTimeout(resultTimer);
      window.removeEventListener('focus', focus);
    };
  }, [reload, sync]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            definition: {
              name: string;
              title: string;
              description: string;
              inputSchema: unknown;
              annotations: unknown;
              execute: (input: unknown) => Promise<unknown>;
            },
            options: { signal: AbortSignal },
          ) => unknown;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: 'create_planner_item',
          title: 'Create planner item',
          description:
            'Save a dated school, life, or college task or event and refresh the visible planner.',
          inputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              date: { type: 'string', description: 'YYYY-MM-DD' },
              category: { enum: cats },
              kind: { enum: ['task', 'event'] },
              time: { type: 'string' },
              notes: { type: 'string' },
            },
            required: ['title', 'date', 'category', 'kind'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input: unknown) => {
            if (mutationRef.current)
              throw new Error(
                'Another change is still saving. Try again shortly.',
              );
            mutationRef.current = true;
            taskState.beginMutation();
            setBusy(true);
            try {
              const r = await api('tasks', input);
              taskState.upsert(r.task);
              setHeldFocusIds(null);
              void sync(undefined, true);
              return { id: r.task.id, title: r.task.title, date: r.task.date };
            } finally {
              taskState.finishMutation();
              mutationRef.current = false;
              setBusy(false);
            }
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, [api, sync, taskState]);
  const openNew = (
    d = today,
    category: Category = page === 'college' ? 'college' : 'school',
  ) => {
    setError('');
    setDraft(fresh(d, category));
  };
  async function save(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      !draft ||
      mutationRef.current ||
      pendingCompletionRef.current.has(draft.id)
    )
      return;
    mutationRef.current = true;
    taskState.beginMutation();
    setBusy(true);
    setError('');
    try {
      const result = await api('tasks', draft, draft.id ? 'PATCH' : 'POST');
      taskState.upsert(result.task);
      setHeldFocusIds(null);
      setDraft(null);
      setNotice('Saved to your planner.');
      void sync(undefined, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      taskState.finishMutation();
      mutationRef.current = false;
      setBusy(false);
    }
  }
  async function complete(t: Task) {
    if (
      pendingCompletionRef.current.has(t.id) ||
      (mutationRef.current && draft?.id === t.id)
    )
      return;
    const original = taskState.getSnapshot().find((item) => item.id === t.id);
    if (!original) return;
    pendingCompletionRef.current.add(t.id);
    setPendingCompletionIds(new Set(pendingCompletionRef.current));
    taskState.beginMutation();
    setError('');
    if (focusItems.some((item) => item.id === t.id))
      setHeldFocusIds(focusItems.map((item) => item.id));
    const optimistic = { ...original, done: original.done ? 0 : 1 };
    taskState.upsert(optimistic);
    setDraft((current) => (current?.id === t.id ? optimistic : current));
    try {
      const result = await api(
        'tasks',
        {
          id: original.id,
          revision: original.revision,
          completeOnly: true,
          done: !original.done,
        },
        'PATCH',
      );
      taskState.upsert(result.task);
      setDraft((current) => (current?.id === t.id ? result.task : current));
      void sync(undefined, true);
    } catch (e) {
      taskState.upsert(original);
      setDraft((current) => (current?.id === t.id ? original : current));
      setError((e as Error).message);
    } finally {
      taskState.finishMutation();
      pendingCompletionRef.current.delete(t.id);
      setPendingCompletionIds(new Set(pendingCompletionRef.current));
    }
  }
  async function remove() {
    if (
      !draft ||
      mutationRef.current ||
      pendingCompletionRef.current.has(draft.id)
    )
      return;
    mutationRef.current = true;
    taskState.beginMutation();
    setBusy(true);
    setError('');
    try {
      const result = await api(
        'tasks',
        { id: draft.id, revision: draft.revision },
        'DELETE',
      );
      taskState.upsert(result.task);
      setDeleting(false);
      setDraft(null);
      void sync(undefined, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      taskState.finishMutation();
      mutationRef.current = false;
      setBusy(false);
    }
  }
  async function authorizeGoogle() {
    const start = await api('google/start', {});
    if (!start.url) throw new Error('Google authorization could not start.');
    const popup = window.open(
      start.url,
      'duenext-google-calendar',
      'popup,width=520,height=720,resizable=yes,scrollbars=yes',
    );
    if (!popup) {
      location.assign(start.url);
      return;
    }
    const finish = (result: 'connected' | 'error') => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(watch);
      if (!popup.closed) popup.close();
      if (result === 'connected') {
        setConnectionsOpen(true);
        setNotice('Google Calendar connected. Your first sync is starting.');
        if (auth.currentUser?.uid === owner)
          void reload().then(() => sync('google', true));
      } else {
        setError('Google authorization did not finish. Please try again.');
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin === location.origin &&
        event.source === popup &&
        event.data?.type === 'duenext-google' &&
        (event.data.result === 'connected' || event.data.result === 'error')
      )
        finish(event.data.result);
    };
    window.addEventListener('message', onMessage);
    const watch = window.setInterval(() => {
      if (popup.closed) {
        window.removeEventListener('message', onMessage);
        window.clearInterval(watch);
      }
    }, 500);
  }
  async function connect(provider: string) {
    setBusy(true);
    setError('');
    try {
      await api(
        'connections',
        provider === 'canvas' ? { provider, token } : { provider },
      );
      setToken('');
      await reload();
      if (provider === 'canvas') await sync('canvas');
      else await authorizeGoogle();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect(provider: string) {
    setBusy(true);
    try {
      await api('connections', { provider }, 'DELETE');
      await reload();
      setNotice(
        'Disconnected. Previously imported items remain in your planner.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = new Date(view === 'week' ? date : first);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const cellCount =
    view === 'week'
      ? 7
      : Math.ceil(
          (((first.getDay() + 6) % 7) +
            new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()) /
            7,
        ) * 7;
  const filtered = tasks.filter((t) => enabled.includes(t.category));
  const calendarItems = filtered.filter(
    (t) => t.date && (showCompleted || !t.done),
  );
  const byDay: Record<string, Task[]> = {};
  for (let i = 0; i < cellCount; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const key = dayKey(day);
    byDay[key] = calendarItems.filter(
      (t) => !!t.date && t.date <= key && (t.endDate || t.date) >= key,
    );
  }
  const weekEnd = new Date(start);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const periodLabel =
    view === 'week'
      ? `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: weekEnd.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })}`
      : date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekKey = dayKey(nextWeek);
  const dueToday = filtered.filter(
    (t) => t.kind === 'task' && !t.done && t.date === today,
  );
  const dueSoon = filtered.filter(
    (t) =>
      t.kind === 'task' &&
      !t.done &&
      !!t.date &&
      t.date > today &&
      t.date <= nextWeekKey,
  );
  const overdue = filtered.filter(
    (t) =>
      t.kind === 'task' &&
      !t.done &&
      !!t.date &&
      ((!!t.date && t.date < today) ||
        (t.date === today &&
          !!t.time &&
          t.time <
            new Intl.DateTimeFormat('en-GB', {
              timeZone: 'America/Detroit',
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
            }).format(new Date()))),
  );
  const detailItems = (
    detailScope === 'today'
      ? dueToday
      : detailScope === 'soon'
        ? dueSoon
        : detailScope === 'overdue'
          ? overdue
          : calendarItems.filter(
              (t) =>
                !!t.date &&
                !!detailScope &&
                t.date <= detailScope &&
                (t.endDate || t.date) >= detailScope,
            )
  ).toSorted((a, b) => taskOrder(a, b));
  const timeLabel = (time: string) => {
    if (!time) return 'All day';
    const [h, m] = time.split(':').map(Number);
    return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
  };
  const upcoming = filtered
    .filter((t) => !!t.date && !t.done && t.kind === 'task')
    .sort((a, b) => taskOrder(a, b));
  const focusItems = focusTasks(filtered, heldFocusIds);
  const visible = filtered.filter(
    (t) =>
      (page !== 'college' || t.category === 'college') &&
      (page !== 'tasks' || t.kind === 'task') &&
      (page === 'calendar'
        ? (showCompleted || !t.done) &&
          !!t.date &&
          t.date <=
            dayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)) &&
          (t.endDate || t.date) >= dayKey(first)
        : taskFilter === 'all'
          ? true
          : taskFilter === 'done'
            ? !!t.done
            : !t.done),
  );
  const grouped = Object.groupBy(visible, (t) => t.date || '');
  const dayLabel = (s: string) =>
    !s
      ? 'Undated assignments'
      : s === today
        ? 'Today'
        : parseDay(s).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
  const row = (t: Task) => (
    <div className={'task-row ' + (t.done ? 'completed' : '')} key={t.id}>
      {t.kind === 'task' && t.source !== 'google' ? (
        <Checkbox
          disabled={
            pendingCompletionIds.has(t.id) || (busy && draft?.id === t.id)
          }
          checked={!!t.done}
          onCheckedChange={() => complete(t)}
          aria-label={
            'Mark ' + t.title + (t.done ? ' incomplete' : ' complete')
          }
        />
      ) : (
        <CalendarDays size={17} className="muted" />
      )}
      <button
        className="task-copy"
        onClick={() => {
          setDetailScope(null);
          setDraft(t);
        }}
      >
        <strong>{t.done ? <s>{t.title}</s> : t.title}</strong>
        <span>
          <i className={'dot ' + color(t.category)} />
          {t.course || labels[t.category]}
          {t.time && ' · ' + timeLabel(t.time)}
          {t.source === 'canvas' && ' · Canvas'}
          {t.source === 'google' && ' · Google'}
        </span>
      </button>
      {t.priority === 'high' && <Flag size={15} className="flag" />}
      <span
        className={
          'due-label ' +
          (t.kind === 'task' && !!t.date && t.date < today && !t.done
            ? 'overdue'
            : '')
        }
      >
        {dayLabel(t.date || '')}
      </span>
    </div>
  );
  const step = (direction: number) => {
    if (view === 'week') {
      const d = new Date(date);
      d.setDate(d.getDate() + 7 * direction);
      setDate(d);
    } else
      setDate(new Date(date.getFullYear(), date.getMonth() + direction, 1));
  };
  const focusPanel = (
    <aside className="focus-panel">
      <div className="focus-heading">
        <Sun size={20} />
        <h2>{focusItems.length ? 'Next to do' : 'All caught up'}</h2>
        <span className="radar-count">{upcoming.length} remaining</span>
      </div>
      <p>
        {upcoming.length
          ? 'Unfinished tasks, ordered by deadline.'
          : 'Add your first task or connect Canvas to see what’s coming up.'}
      </p>
      {focusItems.length ? (
        <div className="radar-tasks">
          {focusItems.map((t) => (
            <div
              className={'radar-task' + (t.done ? ' completed' : '')}
              key={t.id}
            >
              <Checkbox
                checked={!!t.done}
                disabled={
                  pendingCompletionIds.has(t.id) || (busy && draft?.id === t.id)
                }
                onCheckedChange={() => complete(t)}
                aria-label={
                  'Mark ' + t.title + (t.done ? ' incomplete' : ' complete')
                }
              />
              <button onClick={() => setDraft(t)}>
                <strong>{t.done ? <s>{t.title}</s> : t.title}</strong>
                <span className={!!t.date && t.date < today ? 'overdue' : ''}>
                  {dayLabel(t.date || '')}
                  {t.time && ' · ' + timeLabel(t.time)}
                </span>
                <small>
                  <i className={'dot ' + color(t.category)} />
                  {t.course || labels[t.category]}
                </small>
                {!!t.done && (
                  <span className="completed-caption">
                    {pendingCompletionIds.has(t.id) ? 'Saving…' : 'Completed'}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty className="empty-radar">
          <CheckCheck size={34} />
          <EmptyTitle>Room to make a plan</EmptyTitle>
          <EmptyDescription>Your next steps will live here.</EmptyDescription>
        </Empty>
      )}
      {focusItems.some((item) => item.done) &&
        upcoming.some(
          (item) => !focusItems.some((shown) => shown.id === item.id),
        ) && (
          <button
            className="focus-next-batch"
            onClick={() => setHeldFocusIds(null)}
          >
            Show next tasks
          </button>
        )}
    </aside>
  );
  return (
    <SidebarProvider
      style={{ '--sidebar-width': '15rem' } as React.CSSProperties}
    >
      <Sidebar>
        <SidebarContent>
          <div className="brand">
            <span className="brand-icon">
              <Layers size={23} />
            </span>
            duenext<span className="brand-period">.</span>
          </div>
          <div className="workspace-label">My planner</div>
          <nav className="navigation" aria-label="Planner">
            <NavButton
              active={page === 'calendar'}
              onClick={() => setPage('calendar')}
            >
              <CalendarDays />
              Calendar
            </NavButton>
            <NavButton
              active={page === 'tasks'}
              onClick={() => setPage('tasks')}
            >
              <CheckCheck />
              My tasks
              <span className="nav-count">
                {tasks.filter((t) => !t.done && t.kind === 'task').length}
              </span>
            </NavButton>
            <NavButton
              active={page === 'college'}
              onClick={() => setPage('college')}
            >
              <GraduationCap />
              College applications
            </NavButton>
          </nav>
          <div className="sidebar-divider" />
          <button
            className="connect-link"
            onClick={() => setConnectionsOpen(true)}
          >
            <Link2 size={18} />
            Connections
            <ArrowUpRight size={16} />
          </button>
        </SidebarContent>
        <SidebarFooter>
          <button
            className="sidebar-settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={16} />
            Settings
          </button>
          <div className="device-note">
            <span className="cloud-label">
              <Check size={14} />
              {busy || pendingCompletionIds.size > 0
                ? 'Saving…'
                : loaded
                  ? 'Saved across your devices'
                  : 'Connecting to your planner'}
            </span>
            <span>
              Signed in as {auth.currentUser?.email || 'your Google account'}.
            </span>
          </div>
          <button
            className="sidebar-signout"
            onClick={() => {
              void cyd.disconnect().then(() => signOutUser());
            }}
          >
            <LogOut size={15} />
            Sign out
          </button>
        </SidebarFooter>
      </Sidebar>
      <main className="main">
        <header className="topbar">
          <div>
            <SidebarTrigger />
            <strong>
              {page === 'calendar'
                ? 'Calendar'
                : page === 'tasks'
                  ? 'My tasks'
                  : 'College applications'}
            </strong>
          </div>
          <div className="topbar-actions">
            <button
              className="settings-button"
              aria-label="Open planner settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={17} />
            </button>
            <button
              className="sync-button"
              onClick={() => sync()}
              disabled={syncing || !loaded}
            >
              <RefreshCw size={15} className={syncing ? 'spinning' : ''} />
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {new Date().toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </div>
              <h1>
                {page === 'calendar'
                  ? 'Your planner'
                  : page === 'tasks'
                    ? 'Your to-do list'
                    : 'College applications'}
              </h1>
              {page !== 'calendar' && (
                <p>
                  {page === 'tasks'
                    ? 'Everything you need to get done, in one place.'
                    : 'Essays, applications, and every deadline along the way.'}
                </p>
              )}
            </div>
            <button
              className="primary"
              onClick={() => openNew()}
              aria-label="Create new task or event"
            >
              <Plus size={19} />
              Add item
            </button>
          </div>
          {page === 'calendar' && (
            <div className="calendar-overview">
              <button onClick={() => setDetailScope('today')}>
                <span className="overview-icon blue">
                  <Sun size={20} />
                </span>
                <span>
                  <small>Due today</small>
                  <strong>
                    {loaded ? dueToday.length : '—'}
                    <em>{dueToday.length === 1 ? 'task' : 'tasks'}</em>
                  </strong>
                </span>
                <ArrowUpRight size={16} />
              </button>
              <button onClick={() => setDetailScope('soon')}>
                <span className="overview-icon violet">
                  <CalendarDays size={20} />
                </span>
                <span>
                  <small>Next 7 days</small>
                  <strong>
                    {loaded ? dueSoon.length : '—'}
                    <em>{dueSoon.length === 1 ? 'task' : 'tasks'}</em>
                  </strong>
                </span>
                <ArrowUpRight size={16} />
              </button>
              <button onClick={() => setDetailScope('overdue')}>
                <span
                  className={
                    'overview-icon ' + (overdue.length ? 'amber' : 'green')
                  }
                >
                  <AlertCircle size={20} />
                </span>
                <span>
                  <small>Overdue</small>
                  <strong>
                    {loaded ? overdue.length : '—'}
                    <em>{overdue.length ? 'to catch up' : 'all clear'}</em>
                  </strong>
                </span>
                <ArrowUpRight size={16} />
              </button>
            </div>
          )}
          {error && !draft && !connectionsOpen && (
            <div role="alert" className="error-banner">
              {error}
              <button
                onClick={() => {
                  setError('');
                  void reload().catch((e) => setError(e.message));
                }}
              >
                Retry
              </button>
            </div>
          )}
          <section className={`planner-layout planner-${page}`}>
            {page === 'calendar' && (
              <div className="daily-planner-row">
                {focusPanel}
                <TodayClasses
                  key={owner + String(settingsOpen)}
                  owner={owner}
                  date={today}
                  calendar={schoolCalendar}
                  onManage={() => {
                    setSettingsSection('timetable');
                    setSettingsOpen(true);
                  }}
                />
              </div>
            )}

            <div className="calendar-panel">
              <div className="calendar-toolbar">
                <div className="month-nav">
                  <h2>
                    {page === 'calendar'
                      ? periodLabel
                      : page === 'tasks'
                        ? 'My to-do list'
                        : 'College deadlines'}
                  </h2>
                  {page === 'calendar' && (
                    <>
                      <button
                        aria-label="Previous period"
                        onClick={() => step(-1)}
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button aria-label="Next period" onClick={() => step(1)}>
                        <ChevronRight size={18} />
                      </button>
                      <button
                        className="today"
                        onClick={() => setDate(new Date())}
                      >
                        Today
                      </button>
                    </>
                  )}
                </div>
                <Tabs
                  value={page === 'calendar' ? view : taskFilter}
                  onValueChange={(v) =>
                    page === 'calendar'
                      ? setView(String(v))
                      : setTaskFilter(String(v))
                  }
                >
                  <TabsList
                    aria-label={
                      page === 'calendar' ? 'Calendar view' : 'Task status'
                    }
                  >
                    {(page === 'calendar'
                      ? ['month', 'week', 'agenda']
                      : ['open', 'done', 'all']
                    ).map((v) => (
                      <TabsTrigger value={v} key={v}>
                        {v[0].toUpperCase() + v.slice(1)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
              {page === 'calendar' && (
                <div className="calendar-filterbar">
                  <div className="calendar-filterchips">
                    {cats.map((c) => (
                      <button
                        key={c}
                        className={enabled.includes(c) ? 'enabled' : ''}
                        aria-pressed={enabled.includes(c)}
                        onClick={() =>
                          setEnabled((v) =>
                            v.includes(c)
                              ? v.filter((x) => x !== c)
                              : [...v, c],
                          )
                        }
                      >
                        <i className={'dot ' + color(c)} />
                        {labels[c]}
                      </button>
                    ))}
                  </div>
                  <label className="completed-filter">
                    <Checkbox
                      checked={showCompleted}
                      onCheckedChange={(v) => setShowCompleted(!!v)}
                    />
                    Show completed
                  </label>
                  <label className="date-jump">
                    <span className="sr-only">Jump to date</span>
                    <input
                      aria-label="Jump to date"
                      type="date"
                      value={dayKey(date)}
                      onChange={(e) => {
                        if (e.target.value) setDate(parseDay(e.target.value));
                      }}
                    />
                  </label>
                </div>
              )}
              {page === 'calendar' && (
                <div className="school-calendar-key">
                  <span>
                    <i className="school-key-a">A</i> A day
                  </span>
                  <span>
                    <i className="school-key-b">B</i> B day
                  </span>
                  <span className="school-key-closure">
                    No school / holidays
                  </span>
                  <a
                    href={
                      schoolCalendar?.sourceUrl ||
                      'https://www.iatoday.org/tri-campus/graphic-calendar'
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    IA calendar
                  </a>
                  {!schoolCalendar && (
                    <output>
                      {schoolCalendarError
                        ? 'School schedule unavailable'
                        : 'Loading school dates…'}
                    </output>
                  )}
                </div>
              )}
              {page === 'calendar' && view !== 'agenda' ? (
                <>
                  <div
                    className={
                      'month-grid ' + (view === 'week' ? 'week-grid' : '')
                    }
                  >
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(
                      (x) => (
                        <div className="weekday" key={x}>
                          {x}
                        </div>
                      ),
                    )}
                    {Array.from({ length: cellCount }, (_, i) => {
                      const d = new Date(start);
                      d.setDate(start.getDate() + i);
                      const key = dayKey(d);
                      const schoolDate = schoolCalendar?.dates.find(
                        (day) => day.date === key,
                      );
                      const schoolDescription = schoolDate
                        ? schoolDateDescription(schoolDate)
                        : schoolCalendar
                          ? 'School schedule unavailable'
                          : '';
                      const events = (byDay[key] || []).toSorted(taskOrder);
                      return (
                        <div
                          key={key}
                          className={
                            'day-cell ' +
                            (d.getMonth() !== date.getMonth()
                              ? 'outside '
                              : '') +
                            (key === today ? 'current-day ' : '') +
                            (schoolDate?.dayType === 'no-school'
                              ? 'school-closed '
                              : '') +
                            ([0, 6].includes(d.getDay()) ? 'weekend' : '')
                          }
                          title={schoolDescription || undefined}
                        >
                          <button
                            type="button"
                            className="day-create-area"
                            aria-label={'Create task or event on ' + key}
                            onClick={() => openNew(key)}
                          />
                          <div className="calendar-date-heading">
                            <button
                              aria-label={
                                'Add item on ' +
                                key +
                                (schoolDescription
                                  ? ' · ' + schoolDescription
                                  : '')
                              }
                              onClick={() => openNew(key)}
                              className={
                                key === today
                                  ? 'date-number is-today'
                                  : 'date-number'
                              }
                            >
                              {view === 'week'
                                ? d.toLocaleDateString('en-US', {
                                    weekday: 'short',
                                    day: 'numeric',
                                  })
                                : d.getDate()}
                            </button>
                            {schoolDate?.cycle && (
                              <SchoolDateMarker day={schoolDate} part="cycle" />
                            )}
                            {schoolCalendar && !schoolDate && (
                              <span
                                className="school-date-unavailable"
                                aria-label="School schedule unavailable"
                              >
                                —
                              </span>
                            )}
                          </div>
                          {schoolDate && (
                            <SchoolDateMarker
                              day={schoolDate}
                              part="note"
                              weekend={[0, 6].includes(d.getDay())}
                            />
                          )}
                          {events
                            .slice(0, view === 'week' ? undefined : 2)
                            .map((t) => (
                              <button
                                className={
                                  'event-chip ' +
                                  t.category +
                                  (t.done ? ' completed' : '')
                                }
                                onClick={() => setDraft(t)}
                                key={t.id}
                                title={`${t.title}${t.time ? ' · ' + t.time : ''}`}
                              >
                                <span className="chip-text">
                                  {t.done ? '✓ ' : ''}
                                  {t.done ? <s>{t.title}</s> : t.title}
                                </span>
                                <small>
                                  <span className="event-time">
                                    {t.time
                                      ? timeLabel(t.time)
                                      : t.kind === 'task'
                                        ? 'Deadline'
                                        : 'All day'}
                                  </span>
                                  <span className="event-time-compact">
                                    {t.time || 'All day'}
                                  </span>
                                  {t.source === 'canvas' && <span>Canvas</span>}
                                </small>
                              </button>
                            ))}
                          {events.length > 2 && view !== 'week' && (
                            <button
                              className="more-events"
                              onClick={() => {
                                setDetailScope(key);
                              }}
                            >
                              +{events.length - 2} more
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <footer className="calendar-footer">
                    {cats.map((c) => (
                      <span key={c}>
                        <i className={'dot ' + color(c)} />
                        {labels[c]}
                      </span>
                    ))}
                    <span className="calendar-hint">
                      Tap a date to add a plan
                    </span>
                  </footer>
                </>
              ) : (
                <div className="agenda-list">
                  {Object.keys(grouped)
                    .sort()
                    .map((d) => (
                      <section key={d}>
                        <div className="agenda-date">
                          {dayLabel(d)}
                          <span>{d ? parseDay(d).getFullYear() : ''}</span>
                        </div>
                        {grouped[d]!.map(row)}
                      </section>
                    ))}
                  {!visible.length && (
                    <Empty className="empty-list">
                      <CheckCheck size={32} />
                      <EmptyTitle>
                        {!loaded
                          ? 'Loading your planner…'
                          : taskFilter === 'done' && page !== 'calendar'
                            ? 'Your wins will go here.'
                            : 'Room to make a plan.'}
                      </EmptyTitle>
                      <EmptyDescription>
                        {!loaded
                          ? 'Your saved tasks will appear shortly.'
                          : page === 'college'
                            ? 'Add a deadline for an essay, recommendation, or application.'
                            : 'Add a task or event, or turn on another calendar.'}
                      </EmptyDescription>
                      <button className="outline" onClick={() => openNew()}>
                        <Plus size={17} />
                        Add {page === 'college' ? 'a deadline' : 'a task'}
                      </button>
                    </Empty>
                  )}
                </div>
              )}
            </div>

            {page !== 'calendar' && focusPanel}
          </section>
          {!conn?.canvas && (
            <div className="setup-strip">
              <span className="setup-icon">
                <Link2 size={22} />
              </span>
              <div>
                <strong>Add your Canvas assignments</strong>
                <p>
                  Connect Canvas to bring your school deadlines into DueNext.
                </p>
              </div>
              <button
                className="text-button"
                onClick={() => setConnectionsOpen(true)}
              >
                Connect Canvas <ArrowUpRight size={16} />
              </button>
            </div>
          )}
          {conn?.canvas && (
            <div className="connected-strip">
              <span>
                <i className="status-dot" />
                Canvas ·{' '}
                {conn.lastCanvas ? 'Connected' : 'Waiting for first sync'}
              </span>
              <span>
                {conn.lastCanvas
                  ? 'Last synced ' +
                    new Date(conn.lastCanvas).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })
                  : 'Ready for first sync'}
              </span>
            </div>
          )}
        </div>
      </main>
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent className="planner-settings">
          <SheetHeader>
            <SheetTitle>Planner settings</SheetTitle>
            <SheetDescription>
              Manage your private classes and planner data.
            </SheetDescription>
          </SheetHeader>
          <nav className="planner-settings-nav" aria-label="Settings sections">
            <button
              aria-pressed={settingsSection === 'timetable'}
              onClick={() => setSettingsSection('timetable')}
            >
              Timetable
            </button>
            <button
              onClick={() => {
                setSettingsOpen(false);
                setConnectionsOpen(true);
              }}
            >
              Connections
            </button>
            <button
              aria-pressed={settingsSection === 'account'}
              onClick={() => setSettingsSection('account')}
            >
              Account
            </button>
          </nav>
          {settingsSection === 'timetable' && (
            <SchoolPanel
              owner={owner}
              date={today}
              onCalendarChanged={setSchoolCalendar}
            />
          )}
          {settingsSection === 'account' && (
            <AccountPanel
              owner={owner}
              expanded
              onDeleted={() => {
                void cyd.disconnect().then(() => signOutUser());
              }}
            />
          )}
        </SheetContent>
      </Sheet>
      <Sheet
        open={!!detailScope}
        onOpenChange={(open) => {
          if (!open) setDetailScope(null);
        }}
      >
        <SheetContent className="day-details">
          <SheetHeader>
            <div className="eyebrow">YOUR PLANS</div>
            <SheetTitle>
              {detailScope === 'today'
                ? 'Due today'
                : detailScope === 'soon'
                  ? 'Next 7 days'
                  : detailScope === 'overdue'
                    ? 'Catch-up list'
                    : detailScope
                      ? parseDay(detailScope).toLocaleDateString('en-US', {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric',
                        })
                      : 'Day details'}
            </SheetTitle>
            <SheetDescription>
              {detailItems.length} {detailItems.length === 1 ? 'item' : 'items'}{' '}
              · Your visible calendars
            </SheetDescription>
          </SheetHeader>
          <div className="day-detail-list">
            {detailItems.map(row)}
            {!detailItems.length && (
              <Empty>
                <CheckCheck size={28} />
                <EmptyTitle>Nothing on this list.</EmptyTitle>
                <EmptyDescription>
                  You have some breathing room.
                </EmptyDescription>
              </Empty>
            )}
          </div>
          <button
            className="primary"
            onClick={() => {
              const d =
                detailScope && /^\d{4}-/.test(detailScope)
                  ? detailScope
                  : today;
              setDetailScope(null);
              openNew(d);
            }}
          >
            <Plus size={18} />
            Add a plan
          </button>
        </SheetContent>
      </Sheet>
      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDraft(null);
            setError('');
          }
        }}
      >
        <DialogContent className="editor-dialog">
          <DialogTitle>
            {draft?.id
              ? draft.source === 'manual'
                ? 'Edit your plan'
                : 'Your ' + (draft.source === 'canvas' ? 'assignment' : 'event')
              : 'New item'}
          </DialogTitle>
          <DialogDescription>
            {draft?.source === 'canvas'
              ? 'Assignment details update from Canvas. Checking it off here does not submit your work.'
              : draft?.source === 'google'
                ? 'This event comes from your primary Google calendar. Edit it in Google Calendar.'
                : 'A task to finish, an event to attend, or a deadline to remember.'}
          </DialogDescription>
          {draft && (
            <form onSubmit={save} className="task-form">
              <fieldset
                disabled={
                  busy ||
                  pendingCompletionIds.has(draft.id) ||
                  draft.source !== 'manual'
                }
              >
                <label>
                  Title
                  <input
                    required
                    maxLength={200}
                    placeholder="Assignment or event title"
                    value={draft.title}
                    onChange={(e) =>
                      setDraft({ ...draft, title: e.target.value })
                    }
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Calendar
                    <Choice
                      label="Calendar"
                      value={draft.category}
                      items={labels}
                      onChange={(v) =>
                        setDraft({ ...draft, category: v as Category })
                      }
                    />
                  </label>
                  <label>
                    Type
                    <Choice
                      label="Type"
                      value={draft.kind}
                      items={{ task: 'Task / deadline', event: 'Event' }}
                      onChange={(v) =>
                        setDraft({ ...draft, kind: v as 'task' | 'event' })
                      }
                    />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    Date
                    <input
                      type="date"
                      required={draft.kind === 'event'}
                      value={draft.date || ''}
                      onChange={(e) =>
                        setDraft({ ...draft, date: e.target.value || null })
                      }
                    />
                  </label>
                  <label>
                    {draft.kind === 'task'
                      ? 'Due time (optional)'
                      : 'Start time (optional)'}
                    <input
                      type="time"
                      value={draft.time}
                      onChange={(e) =>
                        setDraft({ ...draft, time: e.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="form-grid">
                  <label>
                    {draft.category === 'college'
                      ? 'College / application'
                      : draft.category === 'school'
                        ? 'Class'
                        : 'Group (optional)'}
                    <input
                      placeholder={
                        draft.category === 'college'
                          ? 'e.g. University of Michigan'
                          : draft.category === 'school'
                            ? 'e.g. IB Biology'
                            : 'e.g. Personal'
                      }
                      maxLength={150}
                      value={draft.course}
                      onChange={(e) =>
                        setDraft({ ...draft, course: e.target.value })
                      }
                    />
                  </label>
                  {draft.kind === 'event' ? (
                    <>
                      <label>
                        End time (optional)
                        <input
                          type="time"
                          value={draft.endTime}
                          onChange={(e) =>
                            setDraft({ ...draft, endTime: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        End date (optional)
                        <input
                          type="date"
                          min={draft.date || undefined}
                          value={draft.endDate || ''}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              endDate: e.target.value || undefined,
                            })
                          }
                        />
                      </label>
                    </>
                  ) : (
                    <label>
                      Priority
                      <Choice
                        label="Priority"
                        value={draft.priority}
                        items={{ normal: 'Normal', high: 'High priority' }}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            priority: v as 'normal' | 'high',
                          })
                        }
                      />
                    </label>
                  )}
                </div>
                <label>
                  Notes
                  <textarea
                    rows={3}
                    maxLength={10000}
                    value={draft.notes}
                    placeholder="Anything you’ll want to remember…"
                    onChange={(e) =>
                      setDraft({ ...draft, notes: e.target.value })
                    }
                  />
                </label>
              </fieldset>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              <div className="editor-actions">
                {draft.id && draft.source === 'manual' && (
                  <button
                    type="button"
                    className="delete-button"
                    disabled={busy || pendingCompletionIds.has(draft.id)}
                    aria-label="Delete item"
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
                {draft.sourceUrl && (
                  <a
                    href={draft.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-button"
                  >
                    Open in {draft.source === 'canvas' ? 'Canvas' : 'Google'}
                    <ExternalLink size={16} />
                  </a>
                )}
                {draft.id &&
                  draft.kind === 'task' &&
                  draft.source !== 'google' && (
                    <button
                      type="button"
                      disabled={busy || pendingCompletionIds.has(draft.id)}
                      className="outline"
                      onClick={() => complete(draft)}
                    >
                      <Check size={17} />
                      {draft.done ? 'Mark incomplete' : 'Complete'}
                    </button>
                  )}
                {draft.source === 'manual' && (
                  <button
                    className="primary"
                    disabled={busy || pendingCompletionIds.has(draft.id)}
                  >
                    {busy
                      ? 'Saving…'
                      : 'Save ' + (draft.kind === 'task' ? 'task' : 'event')}
                  </button>
                )}
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogTitle>Delete this plan?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes it from DueNext and its connected DueNext Google
            calendar on the next sync.
          </AlertDialogDescription>
          <div className="editor-actions">
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <button
              className="primary danger"
              onClick={remove}
              disabled={busy || (!!draft && pendingCompletionIds.has(draft.id))}
            >
              Delete
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={connectionsOpen}
        onOpenChange={(open) => {
          setConnectionsOpen(open);
          if (!open) {
            setError('');
            setToken('');
          }
        }}
      >
        <DialogContent className="connections-dialog">
          <DialogTitle>Your calendars, connected.</DialogTitle>
          <DialogDescription>
            Connect once. Your planner stays with you on your phone, iPad, and
            laptop.
          </DialogDescription>
          <div className="connection-card">
            <div className="connection-title">
              <span className="service-icon">
                <Smartphone />
              </span>
              <div>
                <h3>CYD display</h3>
                <p>Your calendar on your desk</p>
              </div>
              <span className={'status ' + (cyd.connected ? 'connected' : '')}>
                {cyd.connected ? 'Connected' : 'USB'}
              </span>
            </div>
            <p>
              Shows your next 48 unfinished items. Updates automatically while
              DueNext is open and the USB cable is connected. The display keeps
              the last calendar after disconnecting.
            </p>
            <output aria-live="polite">{cyd.status}</output>
            <div className="connection-actions">
              {cyd.connected ? (
                <>
                  <button className="outline" onClick={() => void cyd.sync()}>
                    Sync display
                  </button>
                  <button className="outline" onClick={() => void cyd.clear()}>
                    Clear saved display calendar
                  </button>
                  <button
                    className="subtle"
                    onClick={() => void cyd.disconnect()}
                  >
                    Disconnect display
                  </button>
                </>
              ) : (
                <button
                  className="primary"
                  disabled={cyd.busy}
                  onClick={() => void cyd.connect()}
                >
                  {cyd.busy ? 'Connecting…' : 'Connect CYD'}
                </button>
              )}
            </div>
          </div>
          <div className="connection-card">
            <div className="connection-title">
              <span className="service-icon canvas-icon">
                <Sun />
              </span>
              <div>
                <h3>Canvas</h3>
                <p>ia.instructure.com</p>
              </div>
              <span className={'status ' + (conn?.canvas ? 'connected' : '')}>
                {conn?.canvas ? 'Connected' : 'Not connected'}
              </span>
            </div>
            <p>
              Import dated assignments from active courses, including course
              names and due times. Refreshes when you open DueNext and every 5
              minutes while it’s open.
            </p>
            {conn?.canvas ? (
              <div className="connection-actions">
                <button
                  className="outline"
                  disabled={syncing}
                  onClick={() => sync('canvas')}
                >
                  <RefreshCw size={16} />
                  Sync assignments
                </button>
                <button
                  className="subtle"
                  disabled={busy}
                  onClick={() => disconnect('canvas')}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <>
                <ol className="setup-steps">
                  <li>
                    Open{' '}
                    <a
                      href="https://ia.instructure.com/profile/settings"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Canvas → Account → Settings <ExternalLink size={13} />
                    </a>
                    .
                  </li>
                  <li>
                    Under Approved Integrations, create a New Access Token.
                  </li>
                  <li>
                    Paste it below. Your token is validated and encrypted in
                    private account storage. It is never saved in this browser.
                  </li>
                </ol>
                <label className="connection-field">
                  Canvas access token
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="Paste your token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </label>
                <button
                  className="primary"
                  disabled={busy || !token.trim()}
                  onClick={() => connect('canvas')}
                >
                  {busy ? 'Connecting…' : 'Connect Canvas'}
                </button>
              </>
            )}
          </div>
          <div className="connection-card">
            <div className="connection-title">
              <span className="service-icon google-icon">
                <CalendarDays />
              </span>
              <div>
                <h3>Google Calendar</h3>
                <p>Plans in both places</p>
              </div>
              <span className={'status ' + (conn?.google ? 'connected' : '')}>
                {conn?.google ? 'Connected' : 'Setup needed'}
              </span>
            </div>
            <p>
              Your plans sync to a separate DueNext calendar. Changes there come
              back here; your primary Google calendar appears here as read-only
              events. Sync runs while DueNext is open.
            </p>
            {conn?.google ? (
              <div className="connection-actions">
                <button
                  className="outline"
                  disabled={syncing}
                  onClick={() => sync('google')}
                >
                  <RefreshCw size={16} />
                  Sync calendar
                </button>
                <button
                  className="subtle"
                  disabled={busy}
                  onClick={() => disconnect('google')}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="connection-actions">
                <button
                  className="primary"
                  disabled={busy || !conn?.googleConfigured}
                  onClick={() => {
                    setBusy(true);
                    setError('');
                    void authorizeGoogle()
                      .catch((e) => setError((e as Error).message))
                      .finally(() => setBusy(false));
                  }}
                >
                  Connect Google Calendar <ArrowUpRight size={16} />
                </button>
                {!conn?.googleConfigured && (
                  <p>
                    Google Calendar is awaiting launch configuration. You can
                    use your planner and Canvas now.
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="phone-note">
            <Smartphone size={23} />
            <p>
              Open this same link on any device and sign in with your Google
              account. On iPhone or iPad, use Safari → Share → Add to Home
              Screen.
            </p>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
      {notice && (
        <output className="notice">
          <Check size={18} />
          {notice}
        </output>
      )}
    </SidebarProvider>
  );
}
