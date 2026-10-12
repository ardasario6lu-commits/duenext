'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Task } from '@/lib/types';
import { calendarPacket, CydConnection, serialApi } from '@/lib/cyd';

export function useCyd(tasks: Task[]) {
  const connection = useRef<CydConnection | null>(null);
  const latest = useRef(tasks);
  const sending = useRef(false);
  const connecting = useRef(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    'Connect your display with a USB data cable.',
  );
  useEffect(() => {
    latest.current = tasks;
  }, [tasks]);
  const disconnect = useCallback(async () => {
    const current = connection.current;
    connection.current = null;
    setConnected(false);
    await current?.close();
  }, []);
  const sync = useCallback(async () => {
    if (!connection.current || sending.current) return;
    sending.current = true;
    try {
      const packet = calendarPacket(latest.current);
      const reply = await connection.current.send(packet);
      if (
        reply.type !== 'ack' ||
        typeof reply.count !== 'number' ||
        reply.count !== packet.events.length
      )
        throw new Error(
          'Display did not confirm the complete calendar. Reconnect and try again.',
        );
      setStatus(
        `${reply.count} upcoming items on your display · Synced ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
      );
    } catch (e) {
      setStatus((e as Error).message);
      await disconnect();
    } finally {
      sending.current = false;
    }
  }, [disconnect]);
  const connect = async () => {
    if (connecting.current) return;
    const serial = serialApi();
    if (!serial) {
      setStatus(
        'Open DueNext in Chrome or Edge on your laptop to connect over USB.',
      );
      return;
    }
    connecting.current = true;
    setBusy(true);
    try {
      const port = await serial.requestPort({
        filters: [{ usbVendorId: 0x1a86 }, { usbVendorId: 0x10c4 }],
      });
      const current = new CydConnection(port, () => {
        setStatus(
          'USB disconnected. Your display keeps its last saved calendar.',
        );
        void disconnect();
      });
      connection.current = current;
      await current.open();
      setConnected(true);
      await sync();
    } catch (e) {
      setStatus(
        (e as Error).name === 'NotFoundError'
          ? 'No display selected.'
          : (e as Error).message,
      );
      await disconnect();
    } finally {
      connecting.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!connected) return;
    const timer = setTimeout(() => void sync(), 400);
    return () => clearTimeout(timer);
  }, [tasks, connected, sync]);
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => void sync(), 30000);
    return () => clearInterval(timer);
  }, [connected, sync]);
  useEffect(
    () => () => {
      void connection.current?.close();
      connection.current = null;
    },
    [],
  );
  const clear = async () => {
    if (!connection.current || sending.current) return;
    sending.current = true;
    try {
      const reply = await connection.current.send({
        type: 'clear',
        version: 1,
      });
      if (reply.type !== 'ack' || reply.count !== 0)
        throw new Error(
          'The display did not confirm clearing. Update its firmware and retry.',
        );
      setStatus(
        'Saved display calendar cleared. Reconnect to send your planner again.',
      );
      await disconnect();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      sending.current = false;
    }
  };
  return { connected, busy, status, connect, disconnect, sync, clear };
}
