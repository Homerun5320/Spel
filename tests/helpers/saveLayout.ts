// Fix-4A2 (audit 3, 2.10): the ONE place where tests learn the offsets of the trailing blocks of a saved state. The layout is read from the end
// (the diplomacy block stores its own byte length in its last word), so a new block in front of the checksum changes this file only,
// not every test that patches a byte. Sizes are described in the header comment of src/sim/serialize.ts.
const CHECKSUM = 4;
const MATCH_FIXED = 40;
const MATCH_PER_SLOT = 24;
const BYTES_PER_STRUCTURE = 32;
const BYTES_PER_DISTRICT = 24;
/** The air block of a state without helicopters and beachheads. */
const EMPTY_AIR = 16;

export interface SaveLayout {
  readonly slots: number;
  /** Position of the 4 checksum bytes. */
  readonly checksumAt: number;
  /** Start of the diplomacy block (its first word is the pair count). */
  readonly diploAt: number;
  readonly diploBytes: number;
  /** Start of the match block (its first word is the win flag set). */
  readonly matchAt: number;
  /** Start of the district records, given how many there are. */
  districtsAt(districtCount: number): number;
  /** Position of the district count word. */
  districtCountAt(districtCount: number): number;
  /** Start of the first live structure record. */
  structureRecordsAt(liveCount: number, districtCount?: number): number;
  /** Start of the structure block (its first word is highWater) of a state with `liveCount` live structures, no recycled ids and the given districts. */
  structureBlockAt(liveCount: number, districtCount?: number): number;
  /** Start of the air block of a state that has no helicopters and no beachheads; it ends where the structure block starts. */
  emptyAirBlockAt(liveCount: number, districtCount?: number): number;
}

/** `seats` is the header seat count (the per-owner arrays hold seats + 1 words). */
export function saveLayout(bytes: Uint8Array, seats: number): SaveLayout {
  const slots = seats + 1;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const checksumAt = bytes.length - CHECKSUM;
  const diploBytes = v.getUint32(checksumAt - 4, true);
  const diploAt = checksumAt - diploBytes;
  const matchAt = diploAt - (MATCH_FIXED + MATCH_PER_SLOT * slots);
  const districtsAt = (n: number): number => matchAt - n * BYTES_PER_DISTRICT;
  const districtCountAt = (n: number): number => districtsAt(n) - 4;
  const structureRecordsAt = (live: number, n = 0): number => districtCountAt(n) - live * BYTES_PER_STRUCTURE;
  const structureBlockAt = (live: number, n = 0): number => structureRecordsAt(live, n) - 4 - slots * slots - slots * 4 - 8;
  return { slots, checksumAt, diploAt, diploBytes, matchAt, districtsAt, districtCountAt, structureRecordsAt, structureBlockAt, emptyAirBlockAt: (live, n = 0) => structureBlockAt(live, n) - EMPTY_AIR };
}

const BYTES_PER_HELI = 64;
const BYTES_PER_BEACHHEAD = 20;

export interface AirLayout {
  /** Position of highWater; recycledCount follows at +4, then the recycled ids, the live count and the records. */
  readonly highWaterAt: number;
  readonly recycledCountAt: number;
  readonly recycledAt: (i: number) => number;
  readonly liveCountAt: number;
  /** Start of the k-th live helicopter record (ascending id); fields in u32 units at +0 id, +4 owner, +8 state, +12 factory, +16 readyTick, +20 stateTick, +24 x, +28 y, +32 alt, +36 hp, +40 load, +44 fuel, +48 mode, +52 target, +56 routeLen, +60 routeIdx. */
  readonly heliAt: (k: number) => number;
  readonly routeAt: (k: number, r: number) => number;
  readonly beachCountAt: number;
  /** Start of the k-th beachhead record: +0 index, +4 owner, +8 seed, +12 landTick, +16 status. */
  readonly beachAt: (k: number) => number;
}

/** Offsets in the air block of a saved state (`s` is the state the bytes were made from; structures: no recycled ids). */
export function airLayout(s: { readonly helis: { readonly highWater: number; readonly recycledCount: number; readonly owner: ArrayLike<number>; readonly routeLen: ArrayLike<number> }; readonly beachheads: { readonly liveCount: number }; readonly structures: { readonly liveCount: number; readonly districtCount: number } }, bytes: Uint8Array, seats: number): AirLayout {
  const lay = saveLayout(bytes, seats);
  const h = s.helis;
  const starts: number[] = [];
  let size = 8 + 4 * h.recycledCount + 4;
  const recordsAt = size;
  for (let id = 0; id < h.highWater; id++) {
    if (h.owner[id] === 0) continue;
    starts.push(size - recordsAt);
    size += BYTES_PER_HELI + 4 * (h.routeLen[id] as number);
  }
  size += 4 + BYTES_PER_BEACHHEAD * s.beachheads.liveCount;
  const start = lay.structureBlockAt(s.structures.liveCount, s.structures.districtCount) - size;
  const heliAt = (k: number): number => start + recordsAt + (starts[k] as number);
  const beachCountAt = start + size - 4 - BYTES_PER_BEACHHEAD * s.beachheads.liveCount;
  return {
    highWaterAt: start,
    recycledCountAt: start + 4,
    recycledAt: (i) => start + 8 + 4 * i,
    liveCountAt: start + recordsAt - 4,
    heliAt,
    routeAt: (k, r) => heliAt(k) + BYTES_PER_HELI + 4 * r,
    beachCountAt,
    beachAt: (k) => beachCountAt + 4 + BYTES_PER_BEACHHEAD * k,
  };
}

export interface DiploLayout {
  readonly pairCountAt: number;
  /** Start of the k-th pair record: +0 a, +4 b, +8 relation, +12 until. */
  readonly pairAt: (k: number) => number;
  readonly embargoCountAt: number;
  /** Start of the k-th embargo record: +0 imposer, +4 target. */
  readonly embargoAt: (k: number) => number;
  readonly cooldownAt: (ownerId: number) => number;
  readonly propCountAt: number;
  /** Start of the k-th proposal record: +0 from, +4 to, +8 kind, +12 expire. */
  readonly propAt: (k: number) => number;
  readonly madeAt: (ownerId: number) => number;
  readonly brokenAt: (ownerId: number) => number;
  readonly lengthAt: number;
}

/** Offsets in the diplomacy block of a saved state (the counts are read from the bytes, so the blob must be a valid one). */
export function diploLayout(bytes: Uint8Array, seats: number): DiploLayout {
  const lay = saveLayout(bytes, seats);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = lay.diploAt;
  const pairs = v.getUint32(at, true);
  const embargoCountAt = at + 4 + 16 * pairs;
  const embargoes = v.getUint32(embargoCountAt, true);
  const cooldownAt = embargoCountAt + 4 + 8 * embargoes;
  const propCountAt = cooldownAt + 4 * lay.slots;
  const props = v.getUint32(propCountAt, true);
  const madeAt = propCountAt + 4 + 16 * props;
  const brokenAt = madeAt + 4 * lay.slots;
  return {
    pairCountAt: at,
    pairAt: (k) => at + 4 + 16 * k,
    embargoCountAt,
    embargoAt: (k) => embargoCountAt + 4 + 8 * k,
    cooldownAt: (o) => cooldownAt + 4 * o,
    propCountAt,
    propAt: (k) => propCountAt + 4 + 16 * k,
    madeAt: (o) => madeAt + 4 * o,
    brokenAt: (o) => brokenAt + 4 * o,
    lengthAt: brokenAt + 4 * lay.slots,
  };
}
