import { describe, expect, it, vi } from 'vitest';
import { PlannerTaskState } from '../../lib/planner-task-state';
import type { Task } from '../../lib/types';
const task = (id: string, revision = 1, done = 0): Task => ({
  id,
  revision,
  done,
  title: id,
  category: 'school',
  kind: 'task',
  date: '2026-10-10',
  time: '',
  endTime: '',
  notes: '',
  course: '',
  priority: 'normal',
  source: 'manual',
  sourceUrl: '',
  updated: '',
  deleted: 0,
});
function loaded() {
  const state = new PlannerTaskState();
  state.acceptRead(state.beginRead(), [task('existing')]);
  return state;
}
describe('planner task updates', () => {
  it('publishes a saved item before any refresh and rejects a pre-save snapshot', () => {
    const state = loaded(),
      stale = state.beginRead(),
      listener = vi.fn();
    state.subscribe(listener);
    state.beginMutation();
    state.upsert(task('new'));
    state.finishMutation();
    expect(listener).toHaveBeenCalledOnce();
    expect(state.acceptRead(stale, [task('existing')])).toBe(false);
    expect(state.getSnapshot().map((t) => t.id)).toEqual(['existing', 'new']);
  });
  it('keeps optimistic completion while reads arrive, then retains the server revision', () => {
    const state = loaded(),
      stale = state.beginRead();
    state.beginMutation();
    state.upsert(task('existing', 1, 1));
    expect(state.getSnapshot()[0].done).toBe(1);
    const duringWrite = state.beginRead();
    expect(state.acceptRead(duringWrite, [task('existing')])).toBe(false);
    state.upsert(task('existing', 7, 1));
    state.finishMutation();
    expect(state.acceptRead(stale, [task('existing')])).toBe(false);
    expect(state.acceptRead(duringWrite, [task('existing')])).toBe(false);
    expect(state.getSnapshot()[0]).toMatchObject({ done: 1, revision: 7 });
  });
  it('restores an unsuccessful completion and accepts a fresh read afterwards', () => {
    const state = loaded(),
      original = state.getSnapshot()[0];
    state.beginMutation();
    state.upsert({ ...original, done: 1 });
    state.upsert(original);
    state.finishMutation();
    expect(state.getSnapshot()[0].done).toBe(0);
    expect(state.acceptRead(state.beginRead(), [task('existing', 2)])).toBe(
      true,
    );
    expect(state.getSnapshot()[0].revision).toBe(2);
  });
  it('does not resurrect a deleted item from an earlier request', () => {
    const state = loaded(),
      stale = state.beginRead();
    state.beginMutation();
    state.upsert({ ...task('existing', 2), deleted: 1 });
    state.finishMutation();
    expect(state.acceptRead(stale, [task('existing')])).toBe(false);
    expect(state.getSnapshot()).toEqual([]);
  });
  it('accepts only the newest refresh when requests finish in reverse order', () => {
    const state = loaded(),
      first = state.beginRead(),
      second = state.beginRead();
    expect(
      state.acceptRead(second, [task('existing', 2), task('other-device')]),
    ).toBe(true);
    expect(state.acceptRead(first, [task('existing')])).toBe(false);
    expect(state.getSnapshot()).toHaveLength(2);
  });
  it('replaces edited fields using the response and never duplicates a retried create', () => {
    const state = loaded();
    const edited = {
      ...task('existing', 2),
      title: 'Updated title',
      date: '2026-10-12',
    };
    state.upsert(edited);
    state.upsert(task('existing', 1));
    state.upsert(task('new'));
    state.upsert(task('new'));
    expect(state.getSnapshot()).toEqual([edited, task('new')]);
  });
  it('keeps state private to each mounted account and unsubscribes listeners', () => {
    const first = loaded(),
      second = new PlannerTaskState(),
      listener = vi.fn();
    const unsubscribe = first.subscribe(listener);
    unsubscribe();
    first.upsert(task('private'));
    expect(second.getSnapshot()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });
});

it('retains two simultaneous completions when their acknowledgements arrive out of order', () => {
  const state = new PlannerTaskState();
  state.acceptRead(state.beginRead(), [task('one'), task('two')]);
  state.beginMutation();
  state.upsert(task('one', 1, 1));
  state.beginMutation();
  state.upsert(task('two', 1, 1));
  const stale = state.beginRead();
  state.upsert(task('two', 2, 1));
  state.finishMutation();
  expect(
    state.acceptRead(state.beginRead(), [task('one'), task('two', 2, 1)]),
  ).toBe(false);
  expect(state.getSnapshot().every((item) => item.done === 1)).toBe(true);
  state.upsert(task('one', 2, 1));
  state.finishMutation();
  expect(state.acceptRead(stale, [task('one'), task('two')])).toBe(false);
  expect(state.getSnapshot().map((item) => item.revision)).toEqual([2, 2]);
});

it('rolls back only the failed item when another completion succeeds', () => {
  const state = new PlannerTaskState();
  state.acceptRead(state.beginRead(), [task('failed'), task('saved')]);
  state.beginMutation();
  state.upsert(task('failed', 1, 1));
  state.beginMutation();
  state.upsert(task('saved', 1, 1));
  state.upsert(task('saved', 2, 1));
  state.finishMutation();
  state.upsert(task('failed'));
  state.finishMutation();
  expect(state.getSnapshot().map((item) => item.done)).toEqual([0, 1]);
});
