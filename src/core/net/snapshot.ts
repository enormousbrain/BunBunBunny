// The snapshot wire format — ID-tagged, awake-only capable (spec §8.1/§8.7; plan doc §2).
//
// Layout, little-endian:
//   header (8 B): u8 version | u8 flags | u16 bodyCount | u32 tick
//   per body (14 B):
//     u16  packed id: top 2 bits = quaternion largest-component index, low 14 = bodyId
//     i16 x3 position, millimetres (POSITION_SCALE), world clamp +/-32.767 m
//     i16 x3 smallest-three quaternion components, scaled by 32767/sqrt(1/2)
//
// The 14-bit bodyId is the price of the smallest-three index bits: 16383 bodies max,
// far above the soft cap. Planned bodies count up from 0; player bodies count DOWN
// from MAX_BODY_ID so the two ranges can never collide.

import type { Vec3 } from '../recipe/schema';
import { normalizeQuat, type Quat } from './quat';

export interface BodyPose {
  readonly bodyId: number;
  readonly position: Vec3;
  readonly rotation: Quat;
}

export interface Snapshot {
  readonly tick: number;
  readonly bodies: readonly BodyPose[];
}

export const SNAPSHOT_VERSION = 1;
export const POSITION_SCALE = 1000;
export const MAX_BODY_ID = 0x3fff;
export const HEADER_BYTES = 8;
export const BYTES_PER_BODY = 14;

/** Player capsules take ids from the top of the range, descending. */
export const playerBodyId = (slot: number): number => MAX_BODY_ID - slot;

const QUAT_SCALE = 32767 / Math.SQRT1_2;

const clampI16 = (value: number): number =>
  Math.max(-32767, Math.min(32767, Math.round(value)));

interface PackedQuat {
  readonly index: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

const packSmallestThree = (rotation: Quat): PackedQuat => {
  const n = normalizeQuat(rotation);
  const comps: readonly [number, number, number, number] = [n.x, n.y, n.z, n.w];
  let index = 0;
  for (let i = 1; i < 4; i += 1) {
    const value = comps[i] ?? 0;
    const current = comps[index] ?? 0;
    if (Math.abs(value) > Math.abs(current)) index = i;
  }
  const sign = (comps[index] ?? 0) < 0 ? -1 : 1;
  switch (index) {
    case 0:
      return { index, a: n.y * sign, b: n.z * sign, c: n.w * sign };
    case 1:
      return { index, a: n.x * sign, b: n.z * sign, c: n.w * sign };
    case 2:
      return { index, a: n.x * sign, b: n.y * sign, c: n.w * sign };
    default:
      return { index, a: n.x * sign, b: n.y * sign, c: n.z * sign };
  }
};

const unpackSmallestThree = (index: number, a: number, b: number, c: number): Quat => {
  const largest = Math.sqrt(Math.max(0, 1 - a * a - b * b - c * c));
  switch (index) {
    case 0:
      return { x: largest, y: a, z: b, w: c };
    case 1:
      return { x: a, y: largest, z: b, w: c };
    case 2:
      return { x: a, y: b, z: largest, w: c };
    case 3:
      return { x: a, y: b, z: c, w: largest };
    default:
      throw new Error(`invalid quaternion index ${index}`);
  }
};

export const encodeSnapshot = (snapshot: Snapshot): ArrayBuffer => {
  const buffer = new ArrayBuffer(HEADER_BYTES + snapshot.bodies.length * BYTES_PER_BODY);
  const view = new DataView(buffer);
  view.setUint8(0, SNAPSHOT_VERSION);
  view.setUint8(1, 0);
  view.setUint16(2, snapshot.bodies.length, true);
  view.setUint32(4, snapshot.tick >>> 0, true);
  let offset = HEADER_BYTES;
  for (const body of snapshot.bodies) {
    if (body.bodyId < 0 || body.bodyId > MAX_BODY_ID)
      throw new Error(`bodyId ${body.bodyId} outside u14 range`);
    const packed = packSmallestThree(body.rotation);
    view.setUint16(offset, (packed.index << 14) | body.bodyId, true);
    view.setInt16(offset + 2, clampI16(body.position.x * POSITION_SCALE), true);
    view.setInt16(offset + 4, clampI16(body.position.y * POSITION_SCALE), true);
    view.setInt16(offset + 6, clampI16(body.position.z * POSITION_SCALE), true);
    view.setInt16(offset + 8, clampI16(packed.a * QUAT_SCALE), true);
    view.setInt16(offset + 10, clampI16(packed.b * QUAT_SCALE), true);
    view.setInt16(offset + 12, clampI16(packed.c * QUAT_SCALE), true);
    offset += BYTES_PER_BODY;
  }
  return buffer;
};

export const decodeSnapshot = (buffer: ArrayBuffer): Snapshot => {
  const view = new DataView(buffer);
  const version = view.getUint8(0);
  if (version !== SNAPSHOT_VERSION)
    throw new Error(`unknown snapshot version ${version}`);
  const count = view.getUint16(2, true);
  const tick = view.getUint32(4, true);
  const bodies: BodyPose[] = [];
  let offset = HEADER_BYTES;
  for (let i = 0; i < count; i += 1) {
    const packedId = view.getUint16(offset, true);
    const index = packedId >> 14;
    const bodyId = packedId & MAX_BODY_ID;
    const position: Vec3 = {
      x: view.getInt16(offset + 2, true) / POSITION_SCALE,
      y: view.getInt16(offset + 4, true) / POSITION_SCALE,
      z: view.getInt16(offset + 6, true) / POSITION_SCALE,
    };
    const rotation = unpackSmallestThree(
      index,
      view.getInt16(offset + 8, true) / QUAT_SCALE,
      view.getInt16(offset + 10, true) / QUAT_SCALE,
      view.getInt16(offset + 12, true) / QUAT_SCALE,
    );
    bodies.push({ bodyId, position, rotation });
    offset += BYTES_PER_BODY;
  }
  return { tick, bodies };
};
