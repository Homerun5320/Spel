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
