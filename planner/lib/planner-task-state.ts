import type { Task } from './types';

type ReadTicket = { read: number; mutation: number };

/** Account-local state; a refresh must never replace an in-flight or newer edit. */
export class PlannerTaskState {
  private tasks: Task[] = [];
  private listeners = new Set<() => void>();
  private read = 0;
  private mutation = 0;
  private pending = 0;

  getSnapshot = () => this.tasks;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(tasks: Task[]) {
    this.tasks = tasks;
    for (const listener of this.listeners) listener();
  }
  beginRead(): ReadTicket {
    return { read: ++this.read, mutation: this.mutation };
  }
  acceptRead(ticket: ReadTicket, tasks: Task[]) {
    if (
      this.pending ||
      ticket.read !== this.read ||
      ticket.mutation !== this.mutation
    )
      return false;
    this.publish(tasks.filter((task) => !task.deleted));
    return true;
  }
  beginMutation() {
    this.pending++;
    this.mutation++;
  }
  finishMutation() {
    this.pending--;
    this.mutation++;
  }
  upsert(task: Task) {
    const previous = this.tasks.find((item) => item.id === task.id);
    if (previous && previous.revision > task.revision) return;
    this.publish(
      task.deleted
        ? this.tasks.filter((item) => item.id !== task.id)
        : previous
          ? this.tasks.map((item) => (item.id === task.id ? task : item))
          : [...this.tasks, task],
    );
  }
}
