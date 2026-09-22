// Input commands on the wire (plan doc §4): even the local single player sends these
// over the transport channel, so the prediction seam exists from day one.
//
// Layout, little-endian (8 B):
//   u8 playerId slot | u32 seq | i8 moveX | i8 moveZ | u8 buttons (bit0 = jump)

export interface InputCommand {
  readonly playerSlot: number;
  readonly seq: number;
  readonly move: { readonly x: number; readonly z: number };
  readonly jump: boolean;
}

export const INPUT_BYTES = 8;
const BUTTON_JUMP = 1 << 0;

const clampUnit = (value: number): number => Math.max(-1, Math.min(1, value));

export const encodeInput = (command: InputCommand): ArrayBuffer => {
  const buffer = new ArrayBuffer(INPUT_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, command.playerSlot);
  view.setUint32(1, command.seq >>> 0, true);
  view.setInt8(5, Math.round(clampUnit(command.move.x) * 127));
  view.setInt8(6, Math.round(clampUnit(command.move.z) * 127));
  view.setUint8(7, command.jump ? BUTTON_JUMP : 0);
  return buffer;
};

export const decodeInput = (buffer: ArrayBuffer): InputCommand => {
  const view = new DataView(buffer);
  return {
    playerSlot: view.getUint8(0),
    seq: view.getUint32(1, true),
    move: { x: view.getInt8(5) / 127, z: view.getInt8(6) / 127 },
    jump: (view.getUint8(7) & BUTTON_JUMP) !== 0,
  };
};
