import type { Task } from './types';
import { dayKey } from './types';

export function calendarPacket(tasks: Task[], now = new Date()) {
  const today = dayKey(now);
  const text = (s: string, n: number) =>
    s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, '?')
      .slice(0, n);
  return {
    type: 'calendar',
    version: 1,
    epoch: Math.floor(now.getTime() / 1000),
    offset: -now.getTimezoneOffset() * 60,
    events: tasks
      .filter((t) => !t.deleted && !t.done && !!t.date && t.date >= today)
      .sort(
        (a, b) =>
          (a.date + (a.time || '23:59')).localeCompare(
            b.date + (b.time || '23:59'),
          ) || a.title.localeCompare(b.title),
      )
      .slice(0, 48)
      .map((t) => ({
        title: text(t.title, 80),
        date: t.date,
        time: t.time,
        course: text(t.course || t.category, 30),
      })),
  };
}

type Port = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number; bufferSize: number }): Promise<void>;
  close(): Promise<void>;
  setSignals(signals: {
    dataTerminalReady: boolean;
    requestToSend: boolean;
  }): Promise<void>;
};
type Serial = {
  requestPort(options: { filters: { usbVendorId: number }[] }): Promise<Port>;
};
export function serialApi() {
  return (navigator as Navigator & { serial?: Serial }).serial;
}

export class CydConnection {
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private readTask?: Promise<void>;
  private pending?: {
    resolve: (v: Record<string, unknown>) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private closing = false;
  constructor(
    private port: Port,
    private onDisconnect: () => void,
  ) {}
  private rejectPending(message: string) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.reject(new Error(message));
  }
  async open() {
    await this.port.open({ baudRate: 115200, bufferSize: 32768 });
    await this.port.setSignals({
      dataTerminalReady: false,
      requestToSend: false,
    });
    this.reader = this.port.readable!.getReader();
    this.writer = this.port.writable!.getWriter();
    this.readTask = this.read();
    // Opening a USB UART can reset the ESP32. Allow its boot to finish.
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const reply = await this.send({ type: 'hello' });
    if (reply.device !== 'duenext-cyd' || reply.version !== 1)
      throw new Error(
        'Install the DueNext CYD firmware on this display first.',
      );
  }
  private async read() {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!this.closing) {
        const { value, done } = await this.reader!.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          let reply: Record<string, unknown>;
          try {
            reply = JSON.parse(line);
          } catch {
            continue;
          }
          if (
            this.pending &&
            (reply.type === 'ack' ||
              reply.type === 'hello' ||
              reply.type === 'error')
          ) {
            const p = this.pending;
            this.pending = undefined;
            clearTimeout(p.timer);
            if (reply.type === 'error')
              p.reject(
                new Error(
                  typeof reply.message === 'string'
                    ? reply.message
                    : 'Display rejected the calendar.',
                ),
              );
            else p.resolve(reply);
          }
        }
        if (buffer.length > 4096) buffer = '';
      }
    } catch {
      /* USB removal is handled below. */
    } finally {
      this.rejectPending('Display disconnected.');
      if (!this.closing) this.onDisconnect();
    }
  }
  async send(data: unknown): Promise<Record<string, unknown>> {
    if (this.pending) throw new Error('Display is still syncing.');
    const reply = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(
          new Error(
            'Display did not respond. Reconnect the USB cable and try again.',
          ),
        );
      }, 8000);
      this.pending = { resolve, reject, timer };
    });
    try {
      await this.writer!.write(
        new TextEncoder().encode(JSON.stringify(data) + '\n'),
      );
    } catch {
      this.rejectPending('Could not send to the display.');
    }
    return reply;
  }
  async close() {
    if (this.closing) return;
    this.closing = true;
    await this.reader?.cancel().catch(() => {});
    await this.readTask;
    this.reader?.releaseLock();
    this.writer?.releaseLock();
    await this.port.close().catch(() => {});
  }
}
