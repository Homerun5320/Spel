// Serialisation and hashing of the game state.
//
// Layout (all integers little-endian, written through DataView so the bytes do not depend on the machine):
//   0  magic u32 'SPEL'      4  formatVersion u32     8  engineVersion u32    12 mapHash u32
//   16 seed u32              20 config flags u32      24 seats u32            28 width u32
//   32 height u32            36 tick u32              40 rejects u32          44 rng[4] u32 x 4
//   60 players u32
//   64 terrain u8 x n        elevation u16 x n        owner u16 x n           stamp u32 x n
//      exposure u16 x n  rowCos u16 x height   troops u32 x (seats+1)   troopFrac u32 x (seats+1)
//      gold u32 x (seats+1)  capital u32 x (seats+1)
//      attacks: seq u32, count u32, then per attack id attacker target troops costFrac progress compactAt picks bags (u32 each),
//               followed by `bags` x (depth u32, count u32, count x cell u32)   (the frontier bags exactly as they are, ascending depth)
//      enclave queue: ENCLAVE_FLIP_TICKS x (count u32, count x cell u32)
//      ONLY when config flag 8 (homeRules) is on: country u8 x n, homeLand u8 x (seats+1), portMilli u16 x (seats+1),
//               defenceMilli u16 x (seats+1)   (D112: a match without the flag is byte-identical to M05, so FORMAT_VERSION stays 5)
//      air block (M12a-1, always present, between the home block and the structure block): helicopters: highWater u32, recycledCount u32, recycled u32 x recycledCount, liveCount u32,
//               then per live slot by ascending id: id owner state factory readyTick stateTick x y alt hp load fuel mode target routeLen routeIdx (u32 each, x y alt signed),
//               each followed by routeLen x cell u32; beachheads: count u32, then per live slot by ascending index: index owner seed landTick status (u32 each)
//      structures (M09 part A, always present): highWater u32, recycledCount u32, recycled u32 x recycledCount, deleteReady u32 x (seats+1), embargo u8 x (seats+1)^2 (M09 part B),
//               liveCount u32, then per live slot by ascending id: id type owner cell level buildTick readyTick upgradeReadyTick salvoTick (u32 each),
//               then (Districts-1) districtCount u32 and per district by ascending (id, slot): id slot kind level readyTick upgradeReadyTick (u32 each)
//      match block (M18-1, always present): winFlags timeLimitTicks landSharePct holdTicks ended winner reason endTick holdOwner holdCount (u32 each), then six u32 x (seats+1)
//               arrays: eliminated capitalLost peakLand built conquered districts
//      diplomacy block (M18c-1, always present, after the match block): pairCount u32, then per non-war pair by ascending (a, b) with a < b: a b relation until (u32 each);
//               embargoCount u32, then per embargo by ascending imposer * slots + target: imposer target (u32 each); cooldownUntil u32 x (seats+1);
//               proposalCount u32, then per open proposal in creation order: from to treaty expire (u32 each); treatiesMade u32 x (seats+1), treatiesBroken u32 x (seats+1), then the byte length of the whole block
//               including this word (u32: it lets the reader find the block from the end, so a wrong district count is still caught as a size error)
//   end: checksum u32 = hashState(state)                                      (n = width * height)
// The outbox and the derived parts (grid, aggregates, scratch) are not part of the format. deserialize() never throws:
// any byte string gives a state or an error result.
import { Attack, AttackTable } from './attacks';
import { EnclaveQueues, enclaveBucket } from './enclaveQueue';
import { TRAIT_MAX_MILLI, TRAIT_MIN_MILLI, type HomeRules } from './homeRules';
import { foldStructures } from './structures';
import { ALLIANCE_FEDERATION, DiplomacyTable, RELATION_ALLIANCE, RELATION_TRUCE, diplomacyCounts, foldDiplomacy } from './diplomacyTable';
import { BEACH_STATUS_MAX, BeachheadTable, HELI_BUILDING, HELI_LIFT, HELI_PAD, HELI_RETURN, HELI_STATE_MAX, HeliTable, foldHelis } from './heliTable';
import { SimEnv } from './env';
import { MatchState, normalWin, winFlagsOf, type WinConfig, WIN_FLAG_LAND, WIN_FLAG_LAST, WIN_FLAG_SCORE } from './matchState';
import { FNV_OFFSET, finishHash, foldBytes, foldU16, foldU32, foldWord } from './hash';
import {
  BEACHHEAD_CAPACITY,
  BUILD_TICKS,
  DISTRICT_BUILD_TICKS,
  DISTRICT_MAX_SLOTS,
  D_MAX_CELLS,
  ENCLAVE_FLIP_TICKS,
  HELI_BUILD_TICKS,
  HELI_CAPACITY,
  HELI_FUEL_MAX_Q8,
  HELI_HP_TENTHS,
  HELI_MAX_TROOPS,
  HELI_ROUTE_CAPACITY,
  MICRO_CELLS_PER_CELL,
  MICRO_QT_PER_QT,
  MILLI_QT_PER_QT,
  PROGRESS_DEBT_MAX,
  PROPOSAL_CAPACITY,
  PROPOSAL_TTL_TICKS,
  SAM_SALVO_PERIOD_TICKS,
  STRUCT_CAPACITY,
  STRUCT_LEVEL_HARD_CAP,
  TECH_COUNT,
  TREATY_BREAK_COOLDOWN_TICKS,
  TRUCE_TICKS,
} from './rules';
import { TECH_FX_CAP } from './rules';
import { TECH_FX_FUEL, TECH_FX_LOAD, techMaskValid, techPrereqOf } from './techTable';
import { STRUCT_CITY, STRUCT_FACTORY, STRUCT_SAM, STRUCT_TYPE_SLOTS, maxLevelOf } from './structureRules';
import { districtSlotsOf, isDistrictKind } from './districtRules';
import { StructureTable } from './structures';
import {
  ENGINE_VERSION,
  MAX_SEATS,
  assembleState,
  configToFlags,
  flagsToConfig,
  ownerSlots,
  validDimensions,
  validRowCos,
  normalConfig,
  type GameState,
  type MatchConfig,
  type MatchHeader,
} from './state';

/** Bumped when the byte layout above changes. 2: owner u16 (D71). 3: players, rowCos and the per-owner economy arrays (M04). 4: attacks and the enclave queue (M04 conquest). 5: the exposure array (M04 fix pass). 6: the structure table (M09 part A). 7: the embargo flags (M09 part B). 8: the district table (Districts-1). 9: the match block (M18-1). 10: Sim-Growth (City levels up to 10, five district slots per row). 11: Sim-Levels2 (u16 levels up to 999 in the structure and district tables). 12: M12a-1 (the air block: the helicopter and beachhead tables). 13: M18c-1 (the diplomacy block after the match block; the M12a-3 landing track may raise the format on its own branch, the orchestrator sets the final value when the tracks are merged). 14: M12b (the salvo clock `salvoTick` of every structure row). 15: M18d-1 (the technology arrays at the end of the match block: researched mask, current tech + 1, finish tick). 16: M18b-2 (an alliance pair may carry `until` 1 = bound by a federation; the layout is unchanged, deserialize accepts the value). */
export const FORMAT_VERSION = 16;
/** 'SPEL' as a little-endian u32. */
export const MAGIC = 0x4c455053;
export const HEADER_BYTES = 64;
const CHECKSUM_BYTES = 4;
/** terrain 1 + elevation 2 + owner 2 + stamp 4 + exposure 2. */
const BYTES_PER_CELL = 11;
/** rowCos: u16 per row. */
const BYTES_PER_ROW = 2;
/** troops, troopFrac, gold, capital: 4 u32 per ownerId (0..seats). */
const BYTES_PER_OWNER = 16;
/** Attack table header (seq, count) and the counts of the enclave buckets: what a state without attacks and candidates adds. */
const EMPTY_TABLES_BYTES = 8 + ENCLAVE_FLIP_TICKS * 4;
/** The structure block of a state without structures: highWater, recycledCount, liveCount, districtCount (the Delete cooldowns add 4 bytes per ownerId). */
const EMPTY_STRUCTURE_BYTES = 16;
/** One district: id, slot, kind, level, readyTick, upgradeReadyTick. */
const BYTES_PER_DISTRICT = 24;
/** One live structure: id, type, owner, cell, level, buildTick, readyTick, upgradeReadyTick, salvoTick (M12b). */
const BYTES_PER_STRUCTURE = 36;
/** One attack record without its frontier: nine u32. */
const BYTES_PER_ATTACK = 36;
/** One frontier bag: depth and count, then its cells (4 bytes each). */
const BYTES_PER_BAG = 8;
/** The air block of a state without helicopters and beachheads: highWater, recycledCount, liveCount, beachhead count. */
const EMPTY_AIR_BYTES = 16;
/** One live helicopter: id owner state factory readyTick stateTick x y alt hp load fuel mode target routeLen routeIdx (its route cells follow, 4 bytes each). */
const BYTES_PER_HELI = 64;
/** One live beachhead: index owner seed landTick status. */
const BYTES_PER_BEACHHEAD = 20;
/** The match block: ten u32 scalars and nine u32 arrays of (seats + 1) (the last three are the technology arrays of M18d-1: researched mask, current tech + 1, finish tick). */
function matchBytes(seats: number): number {
  return 40 + 36 * ownerSlots(seats);
}

/** The diplomacy block of a state without relations: three counts, the cooldowns, the two statistics arrays and the length word. */
function diploEmptyBytes(seats: number): number {
  return 16 + 12 * ownerSlots(seats);
}

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
  | 'exposure-range'
  | 'attack-range'
  | 'enclave-range'
  | 'home-range'
  | 'structure-range'
  | 'air-range'
  | 'no-occluders'
  | 'match-range'
  | 'diplomacy-range'
  | 'checksum';

export type DeserializeResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly error: DeserializeError };

/** Number of bytes serialize() produces for a size when no attack is running and no enclave candidate is queued. */
export function serializedLength(width: number, height: number, seats: number): number {
  return HEADER_BYTES + width * height * BYTES_PER_CELL + height * BYTES_PER_ROW + ownerSlots(seats) * BYTES_PER_OWNER + EMPTY_TABLES_BYTES + EMPTY_STRUCTURE_BYTES + ownerSlots(seats) * 4 + ownerSlots(seats) * ownerSlots(seats) + EMPTY_AIR_BYTES + matchBytes(seats) + diploEmptyBytes(seats) + CHECKSUM_BYTES;
}

/** Number of non-empty frontier bags of an attack. */
function bagsOf(a: Attack): number {
  let n = 0;
  for (let d = 0; d < a.counts.length; d++) if ((a.counts[d] as number) > 0) n++;
  return n;
}

/** Bytes of the home rules block (D112): the country map (u8 per cell), then u8 + u16 + u16 per ownerId. */
function homeBytes(cells: number, seats: number): number {
  return cells + ownerSlots(seats) * 5;
}

/** Number of bytes serialize() produces for this state. */
export function serializedLengthOf(state: GameState): number {
  let n = serializedLength(state.width, state.height, state.header.seats);
  for (const a of state.attacks.list) n += BYTES_PER_ATTACK + a.size * 4 + bagsOf(a) * BYTES_PER_BAG;
  if (state.home !== null) n += homeBytes(state.width * state.height, state.header.seats);
  n += state.structures.liveCount * BYTES_PER_STRUCTURE + state.structures.recycledCount * 4 + state.structures.districtCount * BYTES_PER_DISTRICT;
  const hl = state.helis;
  n += hl.liveCount * BYTES_PER_HELI + hl.recycledCount * 4 + state.beachheads.liveCount * BYTES_PER_BEACHHEAD;
  for (let id = 0; id < hl.highWater; id++) if (hl.owner[id] !== 0) n += (hl.routeLen[id] as number) * 4;
  const dc = diplomacyCounts(state.diplo);
  n += dc.pairs * 16 + dc.embargoes * 8 + dc.proposals * 16;
  return n + state.enclaves.length * 4;
}

/** Folds the win block of the header and the match state (M18-1). */
function foldMatch(h: number, state: GameState): number {
  const w = state.header.config.win;
  const m = state.match;
  let x = foldWord(h, winFlagsOf(w));
  x = foldWord(x, w === undefined ? 0 : w.timeLimitTicks);
  x = foldWord(x, w === undefined ? 0 : w.landSharePct);
  x = foldWord(x, w === undefined ? 0 : w.holdTicks);
  x = foldWord(x, m.ended);
  x = foldWord(x, m.winner);
  x = foldWord(x, m.reason);
  x = foldWord(x, m.endTick);
  x = foldWord(x, m.holdOwner);
  x = foldWord(x, m.holdCount);
  x = foldBytes(x, m.eliminated);
  x = foldBytes(x, m.capitalLost);
  x = foldU32(x, m.peakLand);
  x = foldU32(x, m.built);
  x = foldU32(x, m.conquered);
  x = foldU32(x, m.districts);
  x = foldU16(x, m.techMask);
  x = foldBytes(x, m.techCurrent);
  return foldU32(x, m.techDone);
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
  x = foldU16(x, state.exposure);
  x = foldU16(x, state.rowCos);
  x = foldU32(x, state.troops);
  x = foldU32(x, state.troopFrac);
  x = foldU32(x, state.gold);
  x = foldU32(x, state.capital);
  x = foldWord(x, state.attacks.seq);
  x = foldWord(x, state.attacks.list.length);
  for (const a of state.attacks.list) {
    x = foldWord(x, a.id);
    x = foldWord(x, a.attacker);
    x = foldWord(x, a.target);
    x = foldWord(x, a.troops);
    x = foldWord(x, a.costFrac);
    x = foldWord(x, a.progress);
    x = foldWord(x, a.compactAt);
    x = foldWord(x, a.picks);
    x = foldWord(x, a.size);
    for (let d = 0; d < a.counts.length; d++) {
      const n = a.counts[d] as number;
      if (n === 0) continue;
      const bag = a.bags[d] as Int32Array;
      x = foldWord(x, d);
      x = foldWord(x, n);
      for (let i = 0; i < n; i++) x = foldWord(x, bag[i] as number);
    }
  }
  for (let b = 0; b < ENCLAVE_FLIP_TICKS; b++) {
    const n = state.enclaves.counts[b] as number;
    const list = state.enclaves.buckets[b] as Int32Array;
    x = foldWord(x, n);
    for (let i = 0; i < n; i++) x = foldWord(x, list[i] as number);
  }
  const home = state.home;
  if (home !== null) {
    x = foldBytes(x, home.country);
    x = foldBytes(x, home.homeLand);
    x = foldU16(x, home.portMilli);
    x = foldU16(x, home.defenceMilli);
  }
  x = foldStructures(x, state.structures);
  x = foldHelis(x, state.helis, state.beachheads);
  x = foldMatch(x, state);
  x = foldDiplomacy(x, state.diplo, state.match.treatiesMade, state.match.treatiesBroken);
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
  const out = new Uint8Array(serializedLengthOf(state));
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
  p = putU16s(v, p, state.exposure);
  p = putU16s(v, p, state.rowCos);
  p = putU32s(v, p, state.troops);
  p = putU32s(v, p, state.troopFrac);
  p = putU32s(v, p, state.gold);
  p = putU32s(v, p, state.capital);
  v.setUint32(p, state.attacks.seq, true);
  v.setUint32(p + 4, state.attacks.list.length, true);
  p += 8;
  for (const a of state.attacks.list) {
    v.setUint32(p, a.id, true);
    v.setUint32(p + 4, a.attacker, true);
    v.setUint32(p + 8, a.target, true);
    v.setUint32(p + 12, a.troops, true);
    v.setUint32(p + 16, a.costFrac, true);
    v.setInt32(p + 20, a.progress, true);
    v.setUint32(p + 24, a.compactAt, true);
    v.setUint32(p + 28, a.picks, true);
    v.setUint32(p + 32, bagsOf(a), true);
    p += BYTES_PER_ATTACK;
    for (let d = 0; d < a.counts.length; d++) {
      const count = a.counts[d] as number;
      if (count === 0) continue;
      const bag = a.bags[d] as Int32Array;
      v.setUint32(p, d, true);
      v.setUint32(p + 4, count, true);
      p += BYTES_PER_BAG;
      for (let i = 0; i < count; i++) {
        v.setUint32(p, bag[i] as number, true);
        p += 4;
      }
    }
  }
  for (let b = 0; b < ENCLAVE_FLIP_TICKS; b++) {
    const n = state.enclaves.counts[b] as number;
    const list = state.enclaves.buckets[b] as Int32Array;
    v.setUint32(p, n, true);
    p += 4;
    for (let i = 0; i < n; i++) {
      v.setUint32(p, list[i] as number, true);
      p += 4;
    }
  }
  const home = state.home;
  if (home !== null) {
    out.set(home.country, p);
    p += home.country.length;
    out.set(home.homeLand, p);
    p += home.homeLand.length;
    p = putU16s(v, p, home.portMilli);
    p = putU16s(v, p, home.defenceMilli);
  }
  const hl = state.helis;
  v.setUint32(p, hl.highWater, true);
  v.setUint32(p + 4, hl.recycledCount, true);
  p += 8;
  for (let i = 0; i < hl.recycledCount; i++) {
    v.setUint32(p, hl.recycled[i] as number, true);
    p += 4;
  }
  v.setUint32(p, hl.liveCount, true);
  p += 4;
  for (let id = 0; id < hl.highWater; id++) {
    if (hl.owner[id] === 0) continue;
    const len = hl.routeLen[id] as number;
    v.setUint32(p, id, true);
    v.setUint32(p + 4, hl.owner[id] as number, true);
    v.setUint32(p + 8, hl.state[id] as number, true);
    v.setUint32(p + 12, hl.factory[id] as number, true);
    v.setUint32(p + 16, hl.readyTick[id] as number, true);
    v.setUint32(p + 20, hl.stateTick[id] as number, true);
    v.setInt32(p + 24, hl.x[id] as number, true);
    v.setInt32(p + 28, hl.y[id] as number, true);
    v.setInt32(p + 32, hl.alt[id] as number, true);
    v.setUint32(p + 36, hl.hp[id] as number, true);
    v.setUint32(p + 40, hl.load[id] as number, true);
    v.setUint32(p + 44, hl.fuel[id] as number, true);
    v.setUint32(p + 48, hl.mode[id] as number, true);
    v.setUint32(p + 52, hl.target[id] as number, true);
    v.setUint32(p + 56, len, true);
    v.setUint32(p + 60, hl.routeIdx[id] as number, true);
    p += BYTES_PER_HELI;
    for (let k = 0; k < len; k++) {
      v.setUint32(p, hl.route[id * HELI_ROUTE_CAPACITY + k] as number, true);
      p += 4;
    }
  }
  const bh = state.beachheads;
  v.setUint32(p, bh.liveCount, true);
  p += 4;
  for (let i = 0; i < BEACHHEAD_CAPACITY; i++) {
    if (bh.owner[i] === 0) continue;
    v.setUint32(p, i, true);
    v.setUint32(p + 4, bh.owner[i] as number, true);
    v.setUint32(p + 8, bh.seed[i] as number, true);
    v.setUint32(p + 12, bh.landTick[i] as number, true);
    v.setUint32(p + 16, bh.status[i] as number, true);
    p += BYTES_PER_BEACHHEAD;
  }
  const st = state.structures;
  v.setUint32(p, st.highWater, true);
  v.setUint32(p + 4, st.recycledCount, true);
  p += 8;
  for (let i = 0; i < st.recycledCount; i++) {
    v.setUint32(p, st.recycled[i] as number, true);
    p += 4;
  }
  p = putU32s(v, p, st.deleteReady);
  out.set(st.embargo, p);
  p += st.embargo.length;
  v.setUint32(p, st.liveCount, true);
  p += 4;
  for (let id = 0; id < st.highWater; id++) {
    if (st.owner[id] === 0) continue;
    v.setUint32(p, id, true);
    v.setUint32(p + 4, st.type[id] as number, true);
    v.setUint32(p + 8, st.owner[id] as number, true);
    v.setUint32(p + 12, st.cell[id] as number, true);
    v.setUint32(p + 16, st.level[id] as number, true);
    v.setUint32(p + 20, st.buildTick[id] as number, true);
    v.setUint32(p + 24, st.readyTick[id] as number, true);
    v.setUint32(p + 28, st.upgradeReadyTick[id] as number, true);
    v.setUint32(p + 32, st.salvoTick[id] as number, true);
    p += BYTES_PER_STRUCTURE;
  }
  v.setUint32(p, st.districtCount, true);
  p += 4;
  if (st.districtCount > 0) {
    for (let id = 0; id < st.highWater; id++) {
      for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) {
        const at = id * DISTRICT_MAX_SLOTS + slot;
        if (st.districtKind[at] === 0) continue;
        v.setUint32(p, id, true);
        v.setUint32(p + 4, slot, true);
        v.setUint32(p + 8, st.districtKind[at] as number, true);
        v.setUint32(p + 12, st.districtLevel[at] as number, true);
        v.setUint32(p + 16, st.districtReadyTick[at] as number, true);
        v.setUint32(p + 20, st.districtUpgradeReadyTick[at] as number, true);
        p += BYTES_PER_DISTRICT;
      }
    }
  }
  const w = state.header.config.win;
  const m = state.match;
  const scalars = [winFlagsOf(w), w === undefined ? 0 : w.timeLimitTicks, w === undefined ? 0 : w.landSharePct, w === undefined ? 0 : w.holdTicks, m.ended, m.winner, m.reason, m.endTick, m.holdOwner, m.holdCount];
  for (let i = 0; i < scalars.length; i++) v.setUint32(p + i * 4, scalars[i] as number, true);
  p += 40;
  for (let o = 0; o < m.eliminated.length; o++) v.setUint32(p + o * 4, m.eliminated[o] as number, true);
  p += m.eliminated.length * 4;
  for (let o = 0; o < m.capitalLost.length; o++) v.setUint32(p + o * 4, m.capitalLost[o] as number, true);
  p += m.capitalLost.length * 4;
  p = putU32s(v, p, m.peakLand);
  p = putU32s(v, p, m.built);
  p = putU32s(v, p, m.conquered);
  p = putU32s(v, p, m.districts);
  for (let o = 0; o < m.techMask.length; o++) v.setUint32(p + o * 4, m.techMask[o] as number, true);
  p += m.techMask.length * 4;
  for (let o = 0; o < m.techCurrent.length; o++) v.setUint32(p + o * 4, m.techCurrent[o] as number, true);
  p += m.techCurrent.length * 4;
  p = putU32s(v, p, m.techDone);
  p = putDiplomacy(v, p, state);
  v.setUint32(p, hashState(state), true);
  return out;
}

/** Writes the diplomacy block (see the layout at the top of this file). */
function putDiplomacy(v: DataView, at: number, state: GameState): number {
  const d = state.diplo;
  const s = d.slots;
  const counts = diplomacyCounts(d);
  let p = at;
  v.setUint32(p, counts.pairs, true);
  p += 4;
  for (let a = 1; a < s; a++) {
    for (let b = a + 1; b < s; b++) {
      if (d.relation[a * s + b] === 0 && d.relation[b * s + a] === 0 && d.until[a * s + b] === 0 && d.until[b * s + a] === 0) continue;
      v.setUint32(p, a, true);
      v.setUint32(p + 4, b, true);
      v.setUint32(p + 8, d.relation[a * s + b] as number, true);
      v.setUint32(p + 12, d.until[a * s + b] as number, true);
      p += 16;
    }
  }
  v.setUint32(p, counts.embargoes, true);
  p += 4;
  for (let i = 0; i < d.embargoBy.length; i++) {
    if (d.embargoBy[i] === 0) continue;
    v.setUint32(p, Math.floor(i / s), true);
    v.setUint32(p + 4, i % s, true);
    p += 8;
  }
  p = putU32s(v, p, d.cooldownUntil);
  v.setUint32(p, d.propCount, true);
  p += 4;
  for (let i = 0; i < d.propCount; i++) {
    v.setUint32(p, d.propFrom[i] as number, true);
    v.setUint32(p + 4, d.propTo[i] as number, true);
    v.setUint32(p + 8, d.propKind[i] as number, true);
    v.setUint32(p + 12, d.propExpire[i] as number, true);
    p += 16;
  }
  p = putU32s(v, p, state.match.treatiesMade);
  p = putU32s(v, p, state.match.treatiesBroken);
  v.setUint32(p, p + 4 - at, true);
  return p + 4;
}

/**
 * Reads and checks the diplomacy block at `at` into `d` and the two statistics arrays of `m`. Returns the position after the block, or -1 when anything is wrong:
 * a count that does not fit the bytes, a pair that is not two distinct players in strictly ascending order, a relation other than truce or alliance, a truce
 * that has already ended or lasts longer than the rules allow, an alliance with an end tick, a proposal between non-players, a duplicate or an out-of-range tick.
 */
function readDiplomacy(v: DataView, at: number, end: number, players: number, tick: number, d: DiplomacyTable, m: MatchState): number {
  const s = d.slots;
  let p = at;
  if (p + 4 > end) return -1;
  const pairCount = v.getUint32(p, true);
  p += 4;
  if (pairCount > (players * (players - 1)) / 2 || p + pairCount * 16 + 4 > end) return -1;
  let last = -1;
  for (let k = 0; k < pairCount; k++) {
    const a = v.getUint32(p, true);
    const b = v.getUint32(p + 4, true);
    const rel = v.getUint32(p + 8, true);
    const until = v.getUint32(p + 12, true);
    p += 16;
    if (a < 1 || b <= a || b > players || rel < 1 || rel > 2 || a * s + b <= last) return -1;
    last = a * s + b;
    if (rel === RELATION_TRUCE ? until < tick || until > tick + TRUCE_TICKS : until !== 0 && !(rel === RELATION_ALLIANCE && until === ALLIANCE_FEDERATION)) return -1;
    d.relation[a * s + b] = rel;
    d.relation[b * s + a] = rel;
    d.until[a * s + b] = until;
    d.until[b * s + a] = until;
  }
  const embargoCount = v.getUint32(p, true);
  p += 4;
  if (embargoCount > players * (players - 1) || p + embargoCount * 8 + s * 4 + 4 > end) return -1;
  last = -1;
  for (let k = 0; k < embargoCount; k++) {
    const a = v.getUint32(p, true);
    const b = v.getUint32(p + 4, true);
    p += 8;
    if (a < 1 || a > players || b < 1 || b > players || a === b || a * s + b <= last) return -1;
    last = a * s + b;
    d.embargoBy[a * s + b] = 1;
  }
  for (let o = 0; o < s; o++) {
    const c = v.getUint32(p + o * 4, true);
    if (c !== 0 && (o === 0 || o > players || c > tick + TREATY_BREAK_COOLDOWN_TICKS)) return -1;
    d.cooldownUntil[o] = c;
  }
  p += s * 4;
  const propCount = v.getUint32(p, true);
  p += 4;
  if (propCount > PROPOSAL_CAPACITY || p + propCount * 16 + s * 8 + 4 > end) return -1;
  for (let k = 0; k < propCount; k++) {
    const from = v.getUint32(p, true);
    const to = v.getUint32(p + 4, true);
    const kind = v.getUint32(p + 8, true);
    const expire = v.getUint32(p + 12, true);
    p += 16;
    if (from < 1 || from > players || to < 1 || to > players || from === to || kind < 1 || kind > 2 || expire < tick || expire > tick + PROPOSAL_TTL_TICKS) return -1;
    if (d.findProposal(from, to) >= 0) return -1;
    d.addProposal(from, to, kind, expire);
  }
  p = getU32s(v, p, m.treatiesMade);
  p = getU32s(v, p, m.treatiesBroken);
  if (m.treatiesMade[0] !== 0 || m.treatiesBroken[0] !== 0) return -1;
  if (v.getUint32(p, true) !== p + 4 - at) return -1;
  return p + 4;
}

/** The config of the flag word with the win block put back (the normal form, so that a round trip compares equal). */
function normalConfigOf(config: MatchConfig, win: WinConfig | undefined): MatchConfig {
  return normalConfig(config.debugIntents, config.spawnPhase === true, config.homeRules === true, win);
}

/**
 * Reads and checks the match block at `p` into `m`. Returns the win config (undefined = none) or 'bad'. Every value is range checked:
 * the result fields must agree (no winner before the end), the arrays have an empty slot 0 and flags are 0 or 1.
 */
function readMatch(v: DataView, p: number, slots: number, seats: number, m: MatchState): WinConfig | undefined | 'bad' {
  const flags = v.getUint32(p, true);
  const limit = v.getUint32(p + 4, true);
  const pct = v.getUint32(p + 8, true);
  const hold = v.getUint32(p + 12, true);
  let win: WinConfig | undefined;
  if (flags > (WIN_FLAG_LAND | WIN_FLAG_LAST | WIN_FLAG_SCORE)) return 'bad';
  if (flags === 0) {
    if (limit !== 0 || pct !== 0 || hold !== 0) return 'bad';
  } else {
    if (limit < 1 || limit > 2147483647 || pct < 1 || pct > 100 || hold < 1 || hold > 2147483647) return 'bad';
    win = normalWin({ land: (flags & WIN_FLAG_LAND) !== 0, last: (flags & WIN_FLAG_LAST) !== 0, score: (flags & WIN_FLAG_SCORE) !== 0, timeLimitTicks: limit, landSharePct: pct, holdTicks: hold });
  }
  m.ended = v.getUint32(p + 16, true);
  m.winner = v.getUint32(p + 20, true);
  m.reason = v.getUint32(p + 24, true);
  m.endTick = v.getUint32(p + 28, true);
  m.holdOwner = v.getUint32(p + 32, true);
  m.holdCount = v.getUint32(p + 36, true);
  if (m.ended > 1 || m.winner > seats || m.reason > 3 || m.holdOwner > seats) return 'bad';
  if (m.ended === 0 && (m.winner !== 0 || m.reason !== 0 || m.endTick !== 0)) return 'bad';
  if (m.ended === 1 && (m.winner === 0) !== (m.reason === 0)) return 'bad';
  if (m.holdOwner === 0 ? m.holdCount !== 0 : m.holdCount === 0 || (win === undefined ? true : m.holdCount > win.holdTicks)) return 'bad';
  let q = p + 40;
  for (let o = 0; o < slots; o++) {
    const e = v.getUint32(q + o * 4, true);
    const c = v.getUint32(q + (slots + o) * 4, true);
    if (e > 1 || c > 1 || (o === 0 && (e !== 0 || c !== 0))) return 'bad';
    m.eliminated[o] = e;
    m.capitalLost[o] = c;
  }
  q += 2 * slots * 4;
  q = getU32s(v, q, m.peakLand);
  q = getU32s(v, q, m.built);
  q = getU32s(v, q, m.conquered);
  q = getU32s(v, q, m.districts);
  if (m.peakLand[0] !== 0 || m.built[0] !== 0 || m.conquered[0] !== 0 || m.districts[0] !== 0) return 'bad';
  // Technology (M18d-1): a closed mask (every step has its predecessor), a running research that is not yet researched and whose predecessor is, a finish tick
  // that exists exactly with a running research; slot 0 stays empty.
  for (let o = 0; o < slots; o++) {
    const mask = v.getUint32(q + o * 4, true);
    const cur = v.getUint32(q + (slots + o) * 4, true);
    const done = v.getUint32(q + (2 * slots + o) * 4, true);
    if (!techMaskValid(mask) || cur > TECH_COUNT || (cur === 0) !== (done === 0)) return 'bad';
    if (o === 0 && (mask !== 0 || cur !== 0)) return 'bad';
    if (cur !== 0 && ((mask & (1 << (cur - 1))) !== 0 || (techPrereqOf(cur - 1) >= 0 && (mask & (1 << techPrereqOf(cur - 1))) === 0))) return 'bad';
    m.techMask[o] = mask;
    m.techCurrent[o] = cur;
    m.techDone[o] = done;
  }
  m.rebuildTechFx();
  return win;
}

/** Fix-4A2: the trade flag of the structure table is exactly the embargoes of the diplomacy table, either way round (an embargo without an imposer could never be lifted). */
function embargoAgrees(structures: StructureTable, d: DiplomacyTable): boolean {
  const s = d.slots;
  for (let a = 0; a < s; a++) {
    for (let b = 0; b < s; b++) {
      if ((structures.embargo[a * s + b] === 1) !== (d.embargoBy[a * s + b] === 1 || d.embargoBy[b * s + a] === 1)) return false;
    }
  }
  return true;
}

/** Fix-4A2: an eliminated seat owns no land and no helicopter and is in no treaty, embargo or proposal (the elimination clears them); Fix-5A1: nor a running research. */
function eliminatedAgrees(m: MatchState, d: DiplomacyTable, owner: Uint16Array, helis: HeliTable, seats: number): boolean {
  const s = d.slots;
  let any = false;
  for (let o = 1; o <= seats; o++) {
    if (m.eliminated[o] !== 1) continue;
    any = true;
    if (m.techCurrent[o] !== 0 || m.techDone[o] !== 0) return false; // Fix-5A1: no running research
    for (let q = 0; q < s; q++) {
      if (d.relation[o * s + q] !== 0 || d.embargoBy[o * s + q] !== 0 || d.embargoBy[q * s + o] !== 0) return false;
    }
    for (let i = 0; i < d.propCount; i++) if (d.propFrom[i] === o || d.propTo[i] === o) return false;
    for (let id = 0; id < helis.highWater; id++) if (helis.owner[id] === o) return false;
  }
  if (!any) return true;
  for (let i = 0; i < owner.length; i++) {
    const o = owner[i] as number;
    if (o !== 0 && m.eliminated[o] === 1) return false;
  }
  return true;
}

function isBytes(x: unknown): x is Uint8Array {
  return Object.prototype.toString.call(x) === '[object Uint8Array]';
}

function fail(error: DeserializeError): DeserializeResult {
  return { ok: false, error };
}

/** What a restored state needs that is not game state (M12a-1): the occluder layer of the world it was played on, for the Los / Nav queries. */
export interface DeserializeOptions {
  readonly maxElev?: ArrayLike<number>;
}

/** Rebuilds a state from bytes made by serialize(). Checks the layout, the ranges and the checksum. Never throws. The Los / Nav caches are never in the bytes: they are built on demand from `options.maxElev`. */
export function deserialize(bytes: Uint8Array, options?: DeserializeOptions): DeserializeResult {
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
  if (options?.maxElev !== undefined && options.maxElev.length !== n) return fail('header');
  if (bytes.length < serializedLength(width, height, seats)) return fail('size');

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
  const exposure = new Uint16Array(n);
  p = getU16s(v, p, exposure);
  // An exposure record is 0 or (an attacker that exists, a depth in range).
  for (let i = 0; i < n; i++) {
    const e = exposure[i] as number;
    if (e !== 0 && ((e >>> 8) < 1 || (e >>> 8) > seats || (e & 255) > D_MAX_CELLS)) return fail('exposure-range');
  }
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

  // The attack table and the enclave queue are variable in length: every count is checked against the bytes that are left
  // before anything is allocated, so a hostile count cannot make this function allocate or throw.
  const end = bytes.length - CHECKSUM_BYTES;
  const slots = ownerSlots(seats);
  const attacks = new AttackTable(slots);
  const enclaves = new EnclaveQueues(n);
  if (p + 8 > end) return fail('size');
  attacks.seq = v.getUint32(p, true);
  const attackCount = v.getUint32(p + 4, true);
  p += 8;
  if (attackCount > seats * slots || p + attackCount * BYTES_PER_ATTACK > end) return fail('attack-range');
  let lastId = 0;
  for (let k = 0; k < attackCount; k++) {
    if (p + BYTES_PER_ATTACK > end) return fail('attack-range');
    const id = v.getUint32(p, true);
    const attacker = v.getUint32(p + 4, true);
    const target = v.getUint32(p + 8, true);
    const a = new Attack(id, attacker, target, v.getUint32(p + 12, true));
    a.costFrac = v.getUint32(p + 16, true);
    a.progress = v.getInt32(p + 20, true);
    a.compactAt = v.getUint32(p + 24, true);
    a.picks = v.getUint32(p + 28, true);
    const bagCount = v.getUint32(p + 32, true);
    p += BYTES_PER_ATTACK;
    if (id <= lastId || id > attacks.seq || attacker < 1 || attacker > seats || target > seats || target === attacker) return fail('attack-range');
    if (attacks.slotOf[attacker * slots + target] !== -1) return fail('attack-range');
    if (a.costFrac >= MILLI_QT_PER_QT || a.progress >= MICRO_CELLS_PER_CELL || a.progress < -PROGRESS_DEBT_MAX || a.compactAt < 1) return fail('attack-range');
    if (bagCount > D_MAX_CELLS + 1 || bagCount * BYTES_PER_BAG > end - p) return fail('attack-range');
    let lastDepth = -1;
    for (let k2 = 0; k2 < bagCount; k2++) {
      if (p + BYTES_PER_BAG > end) return fail('attack-range');
      const depth = v.getUint32(p, true);
      const count = v.getUint32(p + 4, true);
      p += BYTES_PER_BAG;
      if (depth > D_MAX_CELLS || depth <= lastDepth || count < 1 || count > (end - p) / 4) return fail('attack-range');
      const bag = new Int32Array(count);
      for (let i = 0; i < count; i++) {
        const cell = v.getUint32(p, true);
        p += 4;
        if (cell >= n) return fail('attack-range');
        bag[i] = cell;
      }
      a.load(depth, bag);
      lastDepth = depth;
    }
    a.recount();
    lastId = id;
    attacks.slotOf[attacker * slots + target] = k;
    attacks.list.push(a);
  }
  for (let b = 0; b < ENCLAVE_FLIP_TICKS; b++) {
    if (p + 4 > end) return fail('enclave-range');
    const count = v.getUint32(p, true);
    p += 4;
    if (count > (end - p) / 4) return fail('enclave-range');
    const list = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const cell = v.getUint32(p, true);
      p += 4;
      if (cell >= n || enclaves.queued[cell] === 1 || enclaveBucket(seed, cell) !== b) return fail('enclave-range');
      enclaves.queued[cell] = 1;
      list[i] = cell;
    }
    enclaves.buckets[b] = list;
    enclaves.counts[b] = count;
  }
  let home: HomeRules | null = null;
  if (config.homeRules === true) {
    if (p + homeBytes(n, seats) > end) return fail('size');
    const country = new Uint8Array(n);
    country.set(bytes.subarray(p, p + n));
    p += n;
    const homeLand = new Uint8Array(slots);
    homeLand.set(bytes.subarray(p, p + slots));
    p += slots;
    const portMilli = new Uint16Array(slots);
    p = getU16s(v, p, portMilli);
    const defenceMilli = new Uint16Array(slots);
    p = getU16s(v, p, defenceMilli);
    // The trait cap is a rule of the state, not only of the setter: nothing outside 1000 +- TRAIT_CAP_MILLI is a legal state (D113).
    if (homeLand[0] !== 0) return fail('home-range');
    for (let o = 0; o < slots; o++) {
      const port = portMilli[o] as number;
      const def = defenceMilli[o] as number;
      if (port < TRAIT_MIN_MILLI || port > TRAIT_MAX_MILLI || def < TRAIT_MIN_MILLI || def > TRAIT_MAX_MILLI) return fail('home-range');
    }
    home = { country, homeLand, portMilli, defenceMilli };
  }
  // The air block (M12a-1, between the home block and the structure block): the helicopter table, then the beachheads. Every count is checked against the bytes that are left before it is trusted.
  const helis = new HeliTable(slots);
  const beachheads = new BeachheadTable();
  if (p + EMPTY_AIR_BYTES > end) return fail('size');
  helis.highWater = v.getUint32(p, true);
  helis.recycledCount = v.getUint32(p + 4, true);
  p += 8;
  if (helis.highWater > HELI_CAPACITY || helis.recycledCount > helis.highWater || p + helis.recycledCount * 4 + 4 + 4 > end) return fail('air-range');
  for (let i = 0; i < helis.recycledCount; i++) {
    const id = v.getUint32(p, true);
    p += 4;
    if (id >= helis.highWater) return fail('air-range');
    helis.recycled[i] = id;
  }
  const heliLive = v.getUint32(p, true);
  p += 4;
  if (heliLive + helis.recycledCount !== helis.highWater) return fail('air-range');
  let lastHeli = -1;
  let airborne = false;
  const nowTick = v.getUint32(36, true);
  const worldCells = n;
  for (let k = 0; k < heliLive; k++) {
    if (p + BYTES_PER_HELI + 4 > end) return fail('air-range');
    const id = v.getUint32(p, true);
    const ownerId = v.getUint32(p + 4, true);
    const hs = v.getUint32(p + 8, true);
    const factory = v.getUint32(p + 12, true);
    const readyTick = v.getUint32(p + 16, true);
    const stateTick = v.getUint32(p + 20, true);
    const hx = v.getInt32(p + 24, true);
    const hy = v.getInt32(p + 28, true);
    const alt = v.getInt32(p + 32, true);
    const hp = v.getUint32(p + 36, true);
    const load = v.getUint32(p + 40, true);
    const fuel = v.getUint32(p + 44, true);
    const mode = v.getUint32(p + 48, true);
    const target = v.getUint32(p + 52, true);
    const routeLen = v.getUint32(p + 56, true);
    const routeIdx = v.getUint32(p + 60, true);
    p += BYTES_PER_HELI;
    if (id <= lastHeli || id >= helis.highWater || ownerId < 1 || ownerId > seats || hs < HELI_BUILDING || hs > HELI_STATE_MAX || factory >= STRUCT_CAPACITY) return fail('air-range');
    if (hx < 0 || hx >= width * 256 || hy < 0 || hy >= height * 256 || alt < 0 || alt > 65535) return fail('air-range');
    if (hp > HELI_HP_TENTHS || load > HELI_MAX_TROOPS + Math.floor((HELI_MAX_TROOPS * (TECH_FX_CAP[TECH_FX_LOAD] as number)) / 100) || fuel > HELI_FUEL_MAX_Q8 + Math.floor((HELI_FUEL_MAX_Q8 * (TECH_FX_CAP[TECH_FX_FUEL] as number)) / 100) || mode > 1 || target > worldCells || routeLen > HELI_ROUTE_CAPACITY || routeIdx > routeLen) return fail('air-range');
    // A queued helicopter has the production time the rules set (its Factory is checked below, once the structure table is read).
    if (hs === HELI_BUILDING && readyTick !== stateTick + HELI_BUILD_TICKS) return fail('air-range');
    // Fix-4A2: a state cannot have been entered in the future, and a ready tick is at most one production time ahead (a forged future stateTick would overflow the altitude, or keep a DOWNED helicopter for ever).
    if (stateTick > nowTick || readyTick > nowTick + HELI_BUILD_TICKS) return fail('air-range');
    if (hs >= HELI_LIFT && hs <= HELI_RETURN) airborne = true;
    if (p + routeLen * 4 + 4 > end) return fail('air-range');
    lastHeli = id;
    helis.owner[id] = ownerId;
    helis.state[id] = hs;
    helis.factory[id] = factory;
    helis.readyTick[id] = readyTick;
    helis.stateTick[id] = stateTick;
    helis.x[id] = hx;
    helis.y[id] = hy;
    helis.alt[id] = alt;
    helis.hp[id] = hp;
    helis.load[id] = load;
    helis.fuel[id] = fuel;
    helis.mode[id] = mode;
    helis.target[id] = target;
    helis.routeLen[id] = routeLen;
    helis.routeIdx[id] = routeIdx;
    for (let r = 0; r < routeLen; r++) {
      const cell = v.getUint32(p, true);
      p += 4;
      if (cell >= n) return fail('air-range');
      helis.route[id * HELI_ROUTE_CAPACITY + r] = cell;
    }
  }
  // The recycled ids must be exactly the unused slots below highWater (no duplicate, none of them alive).
  for (let i = 0; i < helis.recycledCount; i++) {
    const id = helis.recycled[i] as number;
    if (helis.owner[id] !== 0) return fail('air-range');
    helis.owner[id] = 0xffff;
  }
  for (let i = 0; i < helis.recycledCount; i++) {
    const id = helis.recycled[i] as number;
    if (helis.owner[id] === 0) return fail('air-range');
    helis.owner[id] = 0;
  }
  // Fix-4A2: step() never throws, so a blob with helicopters in the air needs the occluder layer the flight reads (MissingOccluderError otherwise).
  if (airborne && options?.maxElev === undefined) return fail('no-occluders');
  const beachCount = v.getUint32(p, true);
  p += 4;
  if (beachCount > BEACHHEAD_CAPACITY || p + beachCount * BYTES_PER_BEACHHEAD > end) return fail('air-range');
  let lastBeach = -1;
  for (let k = 0; k < beachCount; k++) {
    const i = v.getUint32(p, true);
    const ownerId = v.getUint32(p + 4, true);
    const seed = v.getUint32(p + 8, true);
    const landTick = v.getUint32(p + 12, true);
    const status = v.getUint32(p + 16, true);
    p += BYTES_PER_BEACHHEAD;
    if (i <= lastBeach || i >= BEACHHEAD_CAPACITY || ownerId < 1 || ownerId > seats || seed >= n || status < 1 || status > BEACH_STATUS_MAX) return fail('air-range');
    if (landTick > nowTick) return fail('air-range'); // Fix-4A2: a landing in the future would never revert
    lastBeach = i;
    beachheads.owner[i] = ownerId;
    beachheads.seed[i] = seed;
    beachheads.landTick[i] = landTick;
    beachheads.status[i] = status;
  }
  const structures = new StructureTable(n, slots);
  if (p + 8 > end) return fail('size');
  structures.highWater = v.getUint32(p, true);
  structures.recycledCount = v.getUint32(p + 4, true);
  p += 8;
  if (structures.highWater > STRUCT_CAPACITY || structures.recycledCount > structures.highWater || p + structures.recycledCount * 4 + slots * 4 + slots * slots + 4 > end) return fail(structures.highWater > STRUCT_CAPACITY || structures.recycledCount > structures.highWater ? 'structure-range' : 'size');
  for (let i = 0; i < structures.recycledCount; i++) {
    const id = v.getUint32(p, true);
    p += 4;
    if (id >= structures.highWater) return fail('structure-range');
    structures.recycled[i] = id;
  }
  p = getU32s(v, p, structures.deleteReady);
  for (let i = 0; i < slots * slots; i++) {
    const e = bytes[p + i] as number;
    if (e > 1) return fail('structure-range');
    structures.embargo[i] = e;
  }
  p += slots * slots;
  const liveCount = v.getUint32(p, true);
  p += 4;
  if (liveCount + structures.recycledCount !== structures.highWater) return fail('structure-range');
  if (p + liveCount * BYTES_PER_STRUCTURE + 4 > end) return fail('size');
  let lastStruct = -1;
  for (let k = 0; k < liveCount; k++) {
    const id = v.getUint32(p, true);
    const type = v.getUint32(p + 4, true);
    const ownerId = v.getUint32(p + 8, true);
    const cell = v.getUint32(p + 12, true);
    const level = v.getUint32(p + 16, true);
    const buildTick = v.getUint32(p + 20, true);
    const readyTick = v.getUint32(p + 24, true);
    const upgradeReadyTick = v.getUint32(p + 28, true);
    const salvoTick = v.getUint32(p + 32, true);
    p += BYTES_PER_STRUCTURE;
    if (id <= lastStruct || id >= structures.highWater || type < 1 || type >= STRUCT_TYPE_SLOTS || ownerId < 1 || ownerId > seats || cell >= n) return fail('structure-range');
    if (level < 1 || level > maxLevelOf(type) || readyTick !== buildTick + (BUILD_TICKS[type] as number) || structures.byCell[cell] !== 0) return fail('structure-range');
    if (upgradeReadyTick !== 0 && level >= maxLevelOf(type)) return fail('structure-range');
    // M12b: only a SAM site has a salvo clock, and it never runs more than one period ahead of the saved tick.
    if (salvoTick !== 0 && (type !== STRUCT_SAM || salvoTick > v.getUint32(36, true) + SAM_SALVO_PERIOD_TICKS)) return fail('structure-range');
    lastStruct = id;
    structures.type[id] = type;
    structures.owner[id] = ownerId;
    structures.cell[id] = cell;
    structures.level[id] = level;
    structures.buildTick[id] = buildTick;
    structures.readyTick[id] = readyTick;
    structures.upgradeReadyTick[id] = upgradeReadyTick;
    structures.salvoTick[id] = salvoTick;
    structures.byCell[cell] = id + 1;
  }
  const districtCount = v.getUint32(p, true);
  p += 4;
  // The diplomacy block ends with its own byte length, so the tail is found from the end: the districts, the match block and that block must fill the bytes exactly.
  const diploBytes = end - p >= 4 ? v.getUint32(end - 4, true) : 0;
  if (districtCount > liveCount * DISTRICT_MAX_SLOTS || diploBytes < diploEmptyBytes(seats) || p + districtCount * BYTES_PER_DISTRICT + matchBytes(seats) + diploBytes !== end) return fail(districtCount > liveCount * DISTRICT_MAX_SLOTS ? 'structure-range' : 'size');
  let lastDistrict = -1;
  for (let k = 0; k < districtCount; k++) {
    const id = v.getUint32(p, true);
    const slot = v.getUint32(p + 4, true);
    const kind = v.getUint32(p + 8, true);
    const level = v.getUint32(p + 12, true);
    const readyTick = v.getUint32(p + 16, true);
    const upgradeReadyTick = v.getUint32(p + 20, true);
    p += BYTES_PER_DISTRICT;
    // Only a live City holds districts, in a slot its level has, strictly ascending by (id, slot); a district is built no earlier than tick 0.
    if (id >= structures.highWater || structures.owner[id] === 0 || structures.type[id] !== STRUCT_CITY) return fail('structure-range');
    if (slot >= DISTRICT_MAX_SLOTS || slot >= districtSlotsOf(structures.level[id] as number)) return fail('structure-range');
    const key = id * DISTRICT_MAX_SLOTS + slot;
    if (key <= lastDistrict || !isDistrictKind(kind) || level < 1 || level > STRUCT_LEVEL_HARD_CAP) return fail('structure-range');
    if (readyTick < (DISTRICT_BUILD_TICKS[kind] as number) || (upgradeReadyTick !== 0 && level >= STRUCT_LEVEL_HARD_CAP)) return fail('structure-range');
    lastDistrict = key;
    structures.districtKind[key] = kind;
    structures.districtLevel[key] = level;
    structures.districtReadyTick[key] = readyTick;
    structures.districtUpgradeReadyTick[key] = upgradeReadyTick;
  }
  // The recycled ids must be exactly the unused slots below highWater (no duplicate, none of them alive).
  for (let i = 0; i < structures.recycledCount; i++) {
    const id = structures.recycled[i] as number;
    if (structures.owner[id] !== 0) return fail('structure-range');
    structures.owner[id] = 0xffff;
  }
  for (let i = 0; i < structures.recycledCount; i++) {
    const id = structures.recycled[i] as number;
    if (structures.owner[id] === 0) return fail('structure-range');
    structures.owner[id] = 0;
  }
  // A queued or parked helicopter has a live Factory of its owner (conquest, Delete and destruction scrap them).
  for (let id = 0; id < helis.highWater; id++) {
    const hs = helis.state[id] as number;
    if (helis.owner[id] === 0 || (hs !== HELI_BUILDING && hs !== HELI_PAD)) continue;
    const f = helis.factory[id] as number;
    if (structures.owner[f] !== helis.owner[id] || structures.type[f] !== STRUCT_FACTORY) return fail('air-range');
  }
  const m = new MatchState(slots);
  const win = readMatch(v, p, slots, seats, m);
  if (win === 'bad') return fail('match-range');
  p += matchBytes(seats);
  const diplo = new DiplomacyTable(slots);
  p = readDiplomacy(v, p, end, players, v.getUint32(36, true), diplo, m);
  if (p < 0) return fail('diplomacy-range');
  if (!embargoAgrees(structures, diplo)) return fail('diplomacy-range');
  if (!eliminatedAgrees(m, diplo, owner, helis, seats)) return fail('match-range');
  if (p !== end) return fail('size');

  const finalConfig = Object.freeze(normalConfigOf(config, win));
  const header: MatchHeader = Object.freeze({ engineVersion, mapHash, seed, config: finalConfig, seats, players });
  let state: GameState;
  try {
    state = assembleState({ header, width, height, tick: v.getUint32(36, true), rejects: v.getUint32(40, true), rng, terrain, elevation, owner, stamp, exposure, rowCos, troops, troopFrac, gold, capital, attacks, enclaves, structures, helis, beachheads, match: m, diplo, home, env: new SimEnv(options?.maxElev === undefined ? null : Int16Array.from(options.maxElev)) });
  } catch {
    return fail('header');
  }
  if (v.getUint32(p, true) !== hashState(state)) return fail('checksum');
  return { ok: true, state };
}
