// Fixed-timestep accumulator (plan doc §3). The sim never ties itself to rAF or wall
// clock directly; callers feed elapsed time in, this says how many fixed steps to run.

export interface StepPlan {
  readonly steps: number;
  readonly accumulator: number;
}

/**
 * maxStepsPerFrame is the spiral-of-death guard: when the host stalls, run at most
 * that many catch-up steps and DROP the rest of the backlog (sim time slips relative
 * to wall time, which is correct -- the alternative is a death spiral).
 */
export const planSteps = (
  accumulator: number,
  elapsedSeconds: number,
  dtSeconds: number,
  maxStepsPerFrame = 5,
): StepPlan => {
  const total = accumulator + Math.max(0, elapsedSeconds);
  const steps = Math.min(Math.floor(total / dtSeconds), maxStepsPerFrame);
  const remainder = total - steps * dtSeconds;
  return {
    steps,
    accumulator: steps === maxStepsPerFrame ? Math.min(remainder, dtSeconds) : remainder,
  };
};
