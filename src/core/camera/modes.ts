// Camera modes as data (spec §7, L1): each named mode is a solved package. The
// movement-plane constraint is a SIM concern (enabledTranslations on the player
// body), never faked in the camera -- these two knobs are deliberately separate.

import type { CameraMode, MovementPlane } from '../recipe/schema';

export interface CameraModePackage {
  readonly projection: 'orthographic';
  /** Radians around +y; 0 looks down -z. */
  readonly azimuth: number;
  /** Radians above the horizon. */
  readonly elevation: number;
  readonly orthoHalfHeight: number;
  readonly controlScheme: 'tap-side' | 'tap-to-move';
}

export const CAMERA_MODES: Readonly<Record<CameraMode, CameraModePackage>> = {
  'side-2d': {
    projection: 'orthographic',
    azimuth: 0,
    elevation: 0,
    orthoHalfHeight: 5,
    controlScheme: 'tap-side',
  },
  isometric: {
    projection: 'orthographic',
    azimuth: Math.PI / 4,
    // True isometric elevation: atan(1/sqrt(2)) ~ 35.26 degrees.
    elevation: Math.atan(Math.SQRT1_2),
    orthoHalfHeight: 7,
    controlScheme: 'tap-to-move',
  },
};

export interface EnabledTranslations {
  readonly x: boolean;
  readonly y: boolean;
  readonly z: boolean;
}

/** Which translation axes stay enabled on the player body for a movement plane. */
export const enabledTranslations = (plane: MovementPlane): EnabledTranslations =>
  plane === 'side' ? { x: true, y: true, z: false } : { x: true, y: true, z: true };
