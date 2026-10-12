export type SpringState = { position: number; velocity: number };

// Exact critically damped solution. Retargeting retains both presentation
// position and velocity; elapsed seconds keep the response frame-rate independent.
export function advanceSpring(
  state: SpringState,
  target: number,
  seconds: number,
  response = 0.32,
): SpringState {
  const frequency = (2 * Math.PI) / response;
  const offset = state.position - target;
  const momentum = state.velocity + frequency * offset;
  const decay = Math.exp(-frequency * seconds);
  return {
    position: target + (offset + momentum * seconds) * decay,
    velocity: (state.velocity - frequency * momentum * seconds) * decay,
  };
}
