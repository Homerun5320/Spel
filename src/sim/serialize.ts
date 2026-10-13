// Serialisation and hashing of the game state.
//
// Layout (all integers little-endian, written through DataView so the bytes do not depend on the machine):
//   0  magic u32 'SPEL'      4  formatVersion u32     8  engineVersion u32    12 mapHash u32
//   16 seed u32              20 config flags u32      24 seats u32            28 width u32
//   32 height u32            36 tick u32              40 rejects u32          44 rng[4] u32 x 4
//   60 players u32
//   64 terrain u8 x n        elevation u16 x n        owner u16 x n           stamp u32 x n
//      rowCos u16 x height   troops u32 x (seats+1)   troopFrac u32 x (seats+1)
//      gold u32 x (seats+1)  capital u32 x (seats+1)
//   end: checksum u32 = hashState(state)                                      (n = width * height)
// The outbox and the derived parts (grid, aggregates, scratch) are not part of the format. deserialize() never throws:
// any byte string gives a state or an error result.
import { FNV_OFFSET, finishHash, foldBytes, foldU16, foldU32, foldWord } from './hash';
import { MICRO_QT_PER_QT } from './rules';
import {
  ENGINE_VERSION,
  MAX_SEATS,
  assembleState,
  configToFlags,
  flagsToConfig,
  ownerSlots,
  validDimensions,
  validRowCos,
  type GameState,
  type MatchHeader,
} from './state';

/** Bumped when the byte layout above changes. 2: owner u16 (D71). 3: players, rowCos and the per-owner economy arrays (M04). */
export const FORMAT_VERSION = 3;
/** 'SPEL' as a little-endian u32. */
export const MAGIC = 0x4c455053;
export const HEADER_BYTES = 64;
const CHECKSUM_BYTES = 4;
/** terrain 1 + elevation 2 + owner 2 + stamp 4. */
const BYTES_PER_CELL = 9;
/** rowCos: u16 per row. */
const BYTES_PER_ROW = 2;
/** troops, troopFrac, gold, capital: 4 u32 per ownerId (0..seats). */
const BYTES_PER_OWNER = 16;

export type DeserializeError =
  | 'not-bytes'
  | 'too-short'
  | 'magic'
  | 'format-version'
  | 'engine-version'
  | 'header'
  | 'size'
  | 'owner-range'
  | 'economy-range'
  | 'checksum';

export type DeserializeResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly error: DeserializeError };

/** Number of bytes serialize() produces for a size. */
export function serializedLength(width: number, height: number, seats: number): number {
  return HEADER_BYTES + width * height * BYTES_PER_CELL + height * BYTES_PER_ROW + ownerSlots(seats) * BYTES_PER_OWNER + CHECKSUM_BYTES;
}

/** The hash of a state: header words, scalars, the generator, then every array in fixed order. Not the outbox, not the derived parts. */
export function hashState(state: GameState): number {
  const h = state.header;
  let x = FNV_OFFSET | 0;
  x = foldWord(x, h.engineVersion);
  x = foldWord(x, h.mapHash);
  x = foldWord(x, h.seed);
  x = foldWord(x, configToFlags(h.config));
  x = foldWord(x, h.seats);
  x = foldWord(x, h.players);
  x = foldWord(x, state.width);
  x = foldWord(x, state.height);
  x = foldWord(x, state.tick);
  x = foldWord(x, state.rejects);
  x = foldU32(x, state.rng);
  x = foldBytes(x, state.terrain);
  x = foldU16(x, state.elevation);
  x = foldU16(x, state.owner);
  x = foldU32(x, state.stamp);
  x = foldU16(x, state.rowCos);
  x = foldU32(x, state.troops);
  x = foldU32(x, state.troopFrac);
  x = foldU32(x, state.gold);
  x = foldU32(x, state.capital);
  return finishHash(x);
}

function putU16s(v: DataView, at: number, a: Uint16Array): number {
  for (let i = 0; i < a.length; i++) v.setUint16(at + i * 2, a[i] as number, true);
  return at + a.length * 2;
}

function putU32s(v: DataView, at: number, a: Uint32Array): number {
  for (let i = 0; i < a.length; i++) v.setUint32(at + i * 4, a[i] as number, true);
  return at + a.length * 4;
}

function getU16s(v: DataView, at: number, a: Uint16Array): number {
  for (let i = 0; i < a.length; i++) a[i] = v.getUint16(at + i * 2, true);
  return at + a.length * 2;
}

function getU32s(v: DataView, at: number, a: Uint32Array): number {
  for (let i = 0; i < a.length; i++) a[i] = v.getUint32(at + i * 4, true);
  return at + a.length * 4;
}

/** The state as bytes (a fresh array that shares nothing with the state). */
export function serialize(state: GameState): Uint8Array {
  const out = new Uint8Array(serializedLength(state.width, state.height, state.header.seats));
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
  v.setUint32(60, h.players, true);
  let p = HEADER_BYTES;
  out.set(state.terrain, p);
  p += state.terrain.length;
  p = putU16s(v, p, state.elevation);
  p = putU16s(v, p, state.owner);
  p = putU32s(v, p, state.stamp);
  p = putU16s(v, p, state.rowCos);
  p = putU32s(v, p, state.troops);
  p = putU32s(v, p, state.troopFrac);
  p = putU32s(v, p, state.gold);
  p = putU32s(v, p, state.capital);
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
  const players = v.getUint32(60, true);
  const config = flagsToConfig(flags);
  if (config === null || seats < 1 || seats > MAX_SEATS || players < 1 || players > seats || !validDimensions(width, height)) return fail('header');
  const n = width * height;
  if (bytes.length !== serializedLength(width, height, seats)) return fail('size');

  const rng = new Uint32Array(4);
  for (let i = 0; i < 4; i++) rng[i] = v.getUint32(44 + i * 4, true);
  let p = HEADER_BYTES;
  const terrain = new Uint8Array(n);
  terrain.set(bytes.subarray(p, p + n));
  p += n;
  const elevation = new Uint16Array(n);
  p = getU16s(v, p, elevation);
  const owner = new Uint16Array(n);
  p = getU16s(v, p, owner);
  for (let i = 0; i < n; i++) if ((owner[i] as number) > seats) return fail('owner-range');
  const stamp = new Uint32Array(n);
  p = getU32s(v, p, stamp);
  const rowCos = new Uint16Array(height);
  p = getU16s(v, p, rowCos);
  if (!validRowCos(rowCos)) return fail('header');
  const troops = new Uint32Array(ownerSlots(seats));
  p = getU32s(v, p, troops);
  const troopFrac = new Uint32Array(ownerSlots(seats));
  p = getU32s(v, p, troopFrac);
  const gold = new Uint32Array(ownerSlots(seats));
  p = getU32s(v, p, gold);
  const capital = new Uint32Array(ownerSlots(seats));
  p = getU32s(v, p, capital);
  // The economy arrays have a shape the sim relies on: slot 0 (unowned) is empty, the remainder is below one QT, a capital is a real cell.
  if (troops[0] !== 0 || troopFrac[0] !== 0 || gold[0] !== 0 || capital[0] !== 0) return fail('economy-range');
  for (let o = 1; o <= seats; o++) {
    if ((troopFrac[o] as number) >= MICRO_QT_PER_QT || (capital[o] as number) > n) return fail('economy-range');
  }

  const header: MatchHeader = Object.freeze({ engineVersion, mapHash, seed, config: Object.freeze(config), seats, players });
  let state: GameState;
  try {
    state = assembleState({ header, width, height, tick: v.getUint32(36, true), rejects: v.getUint32(40, true), rng, terrain, elevation, owner, stamp, rowCos, troops, troopFrac, gold, capital });
  } catch {
    return fail('header');
  }
  if (v.getUint32(p, true) !== hashState(state)) return fail('checksum');
  return { ok: true, state };
}
