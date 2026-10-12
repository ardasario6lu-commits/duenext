import { expect, it } from 'vitest';
import { focusTasks } from '../../lib/planner-display';
import type { Task } from '../../lib/types';
const task = (id: string, done = 0) =>
  ({
    id,
    done,
    date: '2026-10-09',
    kind: 'task',
    time: '',
    deleted: 0,
  }) as Task;

it('keeps a checked item in its original focus position after a save or refresh', () => {
  const before = [task('one'), task('two'), task('three'), task('four')];
  const ids = focusTasks(before, null).map((item) => item.id);
  const after = [task('four'), task('three'), task('one', 1), task('two')];
  const shown = focusTasks(after, ids);
  expect(shown.map((item) => item.id)).toEqual(['one', 'two', 'three']);
  expect(shown[0].done).toBe(1);
  expect(focusTasks(after, null).map((item) => item.id)).toEqual([
    'four',
    'three',
    'two',
  ]);
});

it('does not promote historical completed work or restore removed tasks', () => {
  const deleted = { ...task('deleted'), deleted: 1 };
  expect(
    focusTasks([task('old', 1), deleted, task('open')], null).map(
      (item) => item.id,
    ),
  ).toEqual(['open']);
  expect(
    focusTasks([task('old', 1), deleted], ['old', 'deleted', 'missing']).map(
      (item) => item.id,
    ),
  ).toEqual(['old']);
});
