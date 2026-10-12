import { taskOrder, type Task } from './types';

export function focusTasks(tasks: Task[], heldIds: string[] | null) {
  if (heldIds) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return heldIds.flatMap((id) => {
      const task = byId.get(id);
      return task && !task.deleted ? [task] : [];
    });
  }
  return tasks
    .filter(
      (task) =>
        task.date && !task.done && !task.deleted && task.kind === 'task',
    )
    .toSorted(taskOrder)
    .slice(0, 3);
}
