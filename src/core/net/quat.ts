// Minimal quaternion math for core/net. Deliberately not three.js (core imports no
// renderer); render code may convert to THREE.Quaternion at the edge.

export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };

export const normalizeQuat = (q: Quat): Quat => {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length === 0) return IDENTITY_QUAT;
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
};

export const dotQuat = (a: Quat, b: Quat): number =>
  a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

/** Rotation-angle-aware similarity: 1 means identical orientation (q and -q collapse). */
export const orientationDot = (a: Quat, b: Quat): number => Math.abs(dotQuat(a, b));

// Local reassignment below is the standard slerp hot-path shape; nothing escapes.
export const slerpQuat = (a: Quat, b: Quat, t: number): Quat => {
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let d = dotQuat(a, b);
  if (d < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    d = -d;
  }
  if (d > 0.9995) {
    return normalizeQuat({
      x: a.x + (bx - a.x) * t,
      y: a.y + (by - a.y) * t,
      z: a.z + (bz - a.z) * t,
      w: a.w + (bw - a.w) * t,
    });
  }
  const theta0 = Math.acos(Math.min(1, d));
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.sin((1 - t) * theta0) / sinTheta0;
  const s1 = Math.sin(t * theta0) / sinTheta0;
  return {
    x: a.x * s0 + bx * s1,
    y: a.y * s0 + by * s1,
    z: a.z * s0 + bz * s1,
    w: a.w * s0 + bw * s1,
  };
};
