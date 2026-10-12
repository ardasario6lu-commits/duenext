import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Compile the actual pure module so tests exercise the shipped protocol.
const dir = await mkdtemp(`${tmpdir()}/duenext-cyd-`);
try {
  for (const name of ['domain', 'types', 'cyd']) {
    const source = (await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8')).replaceAll("from './types'", "from './types.mjs'").replaceAll("from './domain'", "from './domain.mjs'");
    await writeFile(`${dir}/${name}.mjs`, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  }
  const { calendarPacket, CydConnection } = await import(pathToFileURL(`${dir}/cyd.mjs`));
  const now = new Date(2026, 8, 12, 19, 0);
  const task = (title, more = {}) => ({ title, date: '2026-09-12', time: '', course: '', category: 'school', done: 0, deleted: 0, ...more });
  const packet = calendarPacket([
    task('Tomorrow', { date: '2026-09-13' }), task('All day'), task('Timed', { time: '09:00' }),
    task('Undated', {date: null}), task('Done', { done: 1 }), task('Deleted', { deleted: 1 }), task('Old', { date: '2026-09-11' }),
  ], now);
  assert.deepEqual(packet.events.map(e => e.title), ['Timed', 'All day', 'Tomorrow']);
  assert.equal(packet.epoch, Math.floor(now.getTime() / 1000));
  assert.equal(packet.offset, -now.getTimezoneOffset() * 60);
  const many = calendarPacket(Array.from({ length: 100 }, (_, i) => task('é😀'.repeat(100) + i)), now);
  assert.equal(many.events.length, 48);
  assert.ok(many.events.every(e => e.title.length <= 80 && /^[\x20-\x7e]*$/.test(e.title)));
  assert.ok(JSON.stringify(many).length < 24000);
  assert.deepEqual(calendarPacket([], now).events, []);

  let controller; let closed = false; let rejectPacket = false;
  const port = {
    readable: new ReadableStream({ start(c) { controller = c; } }),
    writable: new WritableStream({ write(bytes) {
      const request = JSON.parse(new TextDecoder().decode(bytes));
      const response = request.type === 'hello' ? { type: 'hello', device: 'duenext-cyd', version: 1 }
        : rejectPacket ? { type: 'error', message: 'Could not save calendar' } : { type: 'ack', count: request.type === 'clear' ? 0 : request.events.length };
      const wire = new TextEncoder().encode('boot log\n' + JSON.stringify(response) + '\n');
      controller.enqueue(wire.slice(0, 17)); controller.enqueue(wire.slice(17));
    } }),
    async open() {}, async setSignals() {}, async close() { closed = true; },
  };
  const device = new CydConnection(port, () => {});
  await device.open();
  assert.equal((await device.send(packet)).count, 3);
  assert.equal((await device.send({type: 'clear', version: 1})).count, 0);
  rejectPacket = true;
  await assert.rejects(device.send(packet), /Could not save calendar/);
  await device.close(); assert.ok(closed);
  assert.equal(port.readable.locked, false); assert.equal(port.writable.locked, false);
  console.log('CYD tests passed: filtering, ordering, bounds, timezone, handshake, chunked acknowledgments, device errors, port cleanup.');
} finally { await rm(dir, { recursive: true, force: true }); }
