import { describe, expect, it } from 'vitest';
import {
  jawRotationForMouthEnergy,
  mouthEnergyFromFrequencyData,
  smoothMouthEnergy,
} from './mouth';

describe('mouth energy core', () => {
  it('gates quiet analyser data to silence', () => {
    expect(mouthEnergyFromFrequencyData(new Uint8Array([1, 2, 3]))).toBe(0);
  });

  it('normalizes louder analyser data into the speaking range', () => {
    expect(mouthEnergyFromFrequencyData(new Uint8Array([60, 60, 60]))).toBe(1);
    expect(mouthEnergyFromFrequencyData(new Uint8Array([30, 30, 30]))).toBeCloseTo(0.65);
  });

  it('uses faster attack than release by default', () => {
    expect(smoothMouthEnergy(0, 1)).toBe(0.5);
    expect(smoothMouthEnergy(1, 0)).toBe(0.8);
  });

  it('maps silence to closed and peaks to open jaw rotation', () => {
    expect(jawRotationForMouthEnergy(0, -40, 0)).toBe(-40);
    expect(jawRotationForMouthEnergy(1, -40, 0)).toBe(0);
    expect(jawRotationForMouthEnergy(0.5, -40, 0)).toBe(-20);
  });
});
