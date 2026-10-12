'use client';

import { useLayoutEffect, useRef } from 'react';
import { advanceSpring, type SpringState } from '@/lib/ui-motion';

export function SpringTabIndicator() {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const indicator = ref.current;
    const list = indicator?.parentElement;
    if (!indicator || !list) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let x: SpringState = { position: 0, velocity: 0 };
    let width: SpringState = { position: 0, velocity: 0 };
    let targetX = 0;
    let targetWidth = 0;
    let initialized = false;
    let frame = 0;
    let lastTime = 0;

    const paint = () => {
      indicator.style.transform = `translateX(${x.position}px)`;
      indicator.style.width = `${Math.max(0, width.position)}px`;
    };
    const snap = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      x = { position: targetX, velocity: 0 };
      width = { position: targetWidth, velocity: 0 };
      paint();
    };
    const tick = (time: number) => {
      const elapsed = Math.min((time - lastTime) / 1000, 0.064);
      lastTime = time;
      x = advanceSpring(x, targetX, elapsed);
      width = advanceSpring(width, targetWidth, elapsed);
      paint();
      if (
        Math.abs(x.position - targetX) < 0.1 &&
        Math.abs(width.position - targetWidth) < 0.1 &&
        Math.abs(x.velocity) < 0.5 &&
        Math.abs(width.velocity) < 0.5
      ) {
        snap();
      } else {
        frame = requestAnimationFrame(tick);
      }
    };
    const measure = () => {
      const active = list.querySelector<HTMLElement>(
        '[role="tab"][data-active]',
      );
      if (!active) {
        indicator.hidden = true;
        list.removeAttribute('data-spring-ready');
        return;
      }
      targetX = active.offsetLeft;
      targetWidth = active.offsetWidth;
      indicator.style.top = `${active.offsetTop}px`;
      indicator.style.height = `${active.offsetHeight}px`;
      indicator.hidden = false;
      list.setAttribute('data-spring-ready', '');
      if (!initialized || reduced.matches) {
        initialized = true;
        snap();
      } else if (!frame) {
        lastTime = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const resize = new ResizeObserver(measure);
    const observeSizes = () => {
      resize.disconnect();
      resize.observe(list);
      list
        .querySelectorAll('[role="tab"]')
        .forEach((tab) => resize.observe(tab));
    };
    const changes = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'childList')) observeSizes();
      measure();
    });
    changes.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-active'],
    });
    reduced.addEventListener('change', measure);
    observeSizes();
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      reduced.removeEventListener('change', measure);
      list.removeAttribute('data-spring-ready');
    };
  }, []);

  return (
    <span ref={ref} data-slot="tabs-indicator" aria-hidden="true" hidden />
  );
}
