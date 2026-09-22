export type MouthSmoothing = {
  readonly attack: number;
  readonly release: number;
};

export const mouthEnergyFromFrequencyData = (
  data: Uint8Array<ArrayBufferLike>,
  activationThreshold = 0.05,
): number => {
  if (data.length === 0) return 0;
  const sum = data.reduce((total, value) => total + value, 0);
  const raw = Math.min(1, Math.max(0, (sum / data.length) / 60));
  return raw > activationThreshold ? 0.3 + raw * 0.7 : 0;
};

export const smoothMouthEnergy = (
  current: number,
  target: number,
  smoothing: MouthSmoothing = { attack: 0.5, release: 0.2 },
): number => {
  const rate = target > current ? smoothing.attack : smoothing.release;
  return current + (target - current) * rate;
};

export const jawRotationForMouthEnergy = (
  energy: number,
  closedRotation: number,
  openRotation = 0,
): number => closedRotation + (openRotation - closedRotation) * Math.min(1, Math.max(0, energy));
