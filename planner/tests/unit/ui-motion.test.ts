import { describe, expect, it } from 'vitest';
import { advanceSpring } from '@/lib/ui-motion';

describe('critically damped UI spring', () => {
  it('settles without overshooting when starting at rest', () => {
    let state = { position: 0, velocity: 0 };
    for (let frame = 0; frame < 120; frame++) {
      state = advanceSpring(state, 100, 1 / 60);
      expect(state.position).toBeGreaterThanOrEqual(0);
      expect(state.position).toBeLessThanOrEqual(100);
    }
    expect(state.position).toBeCloseTo(100, 5);
    expect(state.velocity).toBeCloseTo(0, 5);
  });

  it('preserves position and velocity at the instant of a reversal', () => {
    const moving = advanceSpring({ position: 0, velocity: 0 }, 100, 0.08);
    expect(moving.velocity).toBeGreaterThan(0);
    const reversed = advanceSpring(moving, 0, 0);
    expect(reversed.position).toBeCloseTo(moving.position, 10);
    expect(reversed.velocity).toBeCloseTo(moving.velocity, 10);
    const settled = advanceSpring(reversed, 0, 2);
    expect(settled.position).toBeCloseTo(0, 5);
  });

  it('has the same response at different refresh rates', () => {
    const initial = { position: 25, velocity: 150 };
    let at60 = initial;
    let at120 = initial;
    for (let i = 0; i < 30; i++) at60 = advanceSpring(at60, 200, 1 / 60);
    for (let i = 0; i < 60; i++) at120 = advanceSpring(at120, 200, 1 / 120);
    expect(at60.position).toBeCloseTo(at120.position, 10);
    expect(at60.velocity).toBeCloseTo(at120.velocity, 10);
  });
});
