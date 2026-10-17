// A deliberately broken copy of step(): it runs the real step and then lets Math.random decide something. The golden test
// must notice (a hash mismatch against the committed file, and two runs that differ from each other).
import { step, type StepFn } from '../../../src/sim/step';

export const stepWithMathRandom: StepFn = (state, turn) => {
  const result = step(state, turn);
  // One random cell gets a random owner now and then: invisible to a quick look, fatal for lockstep.
  if (Math.random() < 0.5) {
    const cell = Math.floor(Math.random() * state.width * state.height);
    state.stamp[cell] = (state.stamp[cell] as number) ^ 1;
  }
  return result;
};
