// Serialisation and hashing of the game state.
//
// Layout (all integers little-endian, written through DataView so the bytes do not depend on the machine):
//   0  magic u32 'SPEL'      4  formatVersion u32     8  engineVersion u32    12 mapHash u32
//   16 seed u32              20 config flags u32      24 seats u32            28 width u32
//   32 height u32            36 tick u32              40 rejects u32          44 rng[4] u32 x 4
//   60 terrain u8 x n        elevation u16 x n        owner u8 x n            stamp u32 x n
//   end: checksum u32 = hashState(state)                                      (n = width * height)
// The outbox is not part of the format. deserialize() never throws: any byte string gives a state or an error result.
import { FNV_OFFSET, finishHash, foldBytes, foldU16, foldU32, foldWord } from './hash';
import { Outbox } from './outbox';
import {
  ENGINE_VERSION,
  MAX_SEATS,
  configToFlags,
  flagsToConfig,
  validDimensions,
  type GameState,
  type MatchHeader,
} from './state';

/** Bumped when the byte layout above changes. */
export const FORMAT_VERSION = 1;
/** 'SPEL' as a little-endian u32. */
export const MAGIC = 0x4c455053;
export const HEADER_BYTES = 60;
const CHECKSUM_BYTES = 4;
const BYTES_PER_CELL = 8;

export type DeserializeError =
  | 'not-bytes'
  | 'too-short'
  | 'magic'
  | 'format-version'
  | 'engine-version'
  | 'header'
  | 'size'
  | 'owner-range'
  | 'checksum';

export type DeserializeResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly error: DeserializeError };

/** Number of bytes serialize() produces for a size. */
export function serializedLength(width: number, height: number): number {
  return HEADER_BYTES + width * height * BYTES_PER_CELL + CHECKSUM_BYTES;
}

/** The hash of a state: header words, scalars, the generator, then every array in fixed order. Not the outbox. */
export function hashState(state: GameState): number {
  const h = state.header;
  let x = FNV_OFFSET | 0;
  x = foldWord(x, h.engineVersion);
  x = foldWord(x, h.mapHash);
  x = foldWord(x, h.seed);
  x = foldWord(x, configToFlags(h.config));
  x = foldWord(x, h.seats);
  x = foldWord(x, state.width);
  x = foldWord(x, state.height);
  x = foldWord(x, state.tick);
  x = foldWord(x, state.rejects);
  x = foldU32(x, state.rng);
  x = foldBytes(x, state.terrain);
  x = foldU16(x, state.elevation);
  x = foldBytes(x, state.owner);
  x = foldU32(x, state.stamp);
  return finishHash(x);
}

/** The state as bytes (a fresh array that shares nothing with the state). */
export function serialize(state: GameState): Uint8Array {
  const n = state.width * state.height;
  const out = new Uint8Array(serializedLength(state.width, state.height));
  const v = new DataView(out.buffer);
  const h = state.header;
  v.setUint32(0, MAGIC, true);
  v.setUint32(4, FORMAT_VERSION, true);
  v.setUint32(8, h.engineVersion, true);
  v.setUint32(12, h.mapHash, true);
  v.setUint32(16, h.seed, true);
  v.setUint32(20, configToFlags(h.config), true);
  v.setUint32(24, h.seats, true);
  v.setUint32(28, state.width, true);
  v.setUint32(32, state.height, true);
  v.setUint32(36, state.tick, true);
  v.setUint32(40, state.rejects, true);
  for (let i = 0; i < 4; i++) v.setUint32(44 + i * 4, state.rng[i] as number, true);
  let p = HEADER_BYTES;
  out.set(state.terrain, p);
  p += n;
  for (let i = 0; i < n; i++) v.setUint16(p + i * 2, state.elevation[i] as number, true);
  p += n * 2;
  out.set(state.owner, p);
  p += n;
  for (let i = 0; i < n; i++) v.setUint32(p + i * 4, state.stamp[i] as number, true);
  p += n * 4;
  v.setUint32(p, hashState(state), true);
  return out;
}

function isBytes(x: unknown): x is Uint8Array {
  return Object.prototype.toString.call(x) === '[object Uint8Array]';
}

function fail(error: DeserializeError): DeserializeResult {
  return { ok: false, error };
}

/** Rebuilds a state from bytes made by serialize(). Checks the layout, the ranges and the checksum. Never throws. */
export function deserialize(bytes: Uint8Array): DeserializeResult {
  if (!isBytes(bytes)) return fail('not-bytes');
  if (bytes.length < HEADER_BYTES + CHECKSUM_BYTES) return fail('too-short');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== MAGIC) return fail('magic');
  if (v.getUint32(4, true) !== FORMAT_VERSION) return fail('format-version');
  const engineVersion = v.getUint32(8, true);
  if (engineVersion !== ENGINE_VERSION) return fail('engine-version');
  const mapHash = v.getUint32(12, true);
  const seed = v.getUint32(16, true);
  const flags = v.getUint32(20, true);
  const seats = v.getUint32(24, true);
  const width = v.getUint32(28, true);
  const height = v.getUint32(32, true);
  const config = flagsToConfig(flags);
  if (config === null || seats < 1 || seats > MAX_SEATS || !validDimensions(width, height)) return fail('header');
  const n = width * height;
  if (bytes.length !== serializedLength(width, height)) return fail('size');

  const rng = new Uint32Array(4);
  for (let i = 0; i < 4; i++) rng[i] = v.getUint32(44 + i * 4, true);
  let p = HEADER_BYTES;
  const terrain = new Uint8Array(n);
  terrain.set(bytes.subarray(p, p + n));
  p += n;
  const elevation = new Uint16Array(n);
  for (let i = 0; i < n; i++) elevation[i] = v.getUint16(p + i * 2, true);
  p += n * 2;
  const owner = new Uint8Array(n);
  owner.set(bytes.subarray(p, p + n));
  p += n;
  for (let i = 0; i < n; i++) if ((owner[i] as number) > seats) return fail('owner-range');
  const stamp = new Uint32Array(n);
  for (let i = 0; i < n; i++) stamp[i] = v.getUint32(p + i * 4, true);
  p += n * 4;

  const header: MatchHeader = Object.freeze({ engineVersion, mapHash, seed, config: Object.freeze(config), seats });
  const state: GameState = {
    header,
    width,
    height,
    tick: v.getUint32(36, true),
    rejects: v.getUint32(40, true),
    rng,
    terrain,
    elevation,
    owner,
    stamp,
    outbox: new Outbox(),
  };
  if (v.getUint32(p, true) !== hashState(state)) return fail('checksum');
  return { ok: true, state };
}
