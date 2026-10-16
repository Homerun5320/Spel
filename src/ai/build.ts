// The AI's build move (M09 part B): once per think a nation asks for ONE structure, in this order of need: a Factory when it has fewer
// than cities / AI_BUILD_CITIES_PER_FACTORY, a City, a Port (from the second City, one per AI_BUILD_CITIES_PER_PORT Cities), a Defense Post
// (from the fourth City, one per AI_BUILD_CITIES_PER_POST). SAM and Silo do nothing before M14 and are not built. The AI waits until it can
// pay the next one (no cheaper substitute: that would starve the Cities), a City also needs troops of AI_BUILD_CITY_TROOP_PCT of the cap.
// Places are sampled in a window around the capital and checked with validateBuild, the very function the sim runs on the Build.
import {
  AI_BUILD_CITIES_PER_FACTORY,
  AI_CITY_LEVEL_CAP,
  AI_DISTRICT_LEVEL_CAP,
  AI_STRUCT_LEVEL_CAP,
  AI_BUILD_CITIES_PER_PORT,
  AI_BUILD_CITIES_PER_POST,
  AI_BUILD_CITY_TROOP_PCT,
  AI_BUILD_RETRY_TICKS,
  AI_BUILD_RICH_PCT,
  AI_BUILD_TRIES,
  AI_CITY_UPGRADE_LEVELS_PER_CITY,
  AI_BUILD_WINDOW_CELLS,
  AI_DISTRICT_MIN_CITIES,
  AI_DISTRICT_RETRY_TICKS,
  AI_THINK_PERIOD_TICKS,
  DISTRICT_BARRACKS,
  DISTRICT_BASE_GOLD,
  DISTRICT_HOUSING,
  DISTRICT_MARKET,
  DISTRICT_MAX_SLOTS,
  DISTRICT_WALLS,
  districtBuildPriceMilli,
  districtIndex,
  districtSlotsOf,
  districtUpgradePriceGold,
  validateBuildDistrict,
  validateUpgradeDistrict,
  buildDistrictBody,
  upgradeDistrictBody,
  PHASE_SPAWN,
  REJECT_NONE,
  STRUCT_CITY,
  STRUCT_FACTORY,
  STRUCT_PORT,
  STRUCT_POST,
  buildBody,
  buildPriceMilli,
  upgradeBody,
  upgradePriceNowMilli,
  MILLI_GOLD_PER_GOLD,
  nextBelow,
  ownerToSeat,
  seatToOwner,
  validateBuild,
  type IntentBody,
  type SimView,
} from '../sim/public';
import type { AiMemory } from './memory';

/** The type the seat wants next, or 0 for none. */
function wantedType(view: SimView, owner: number): number {
  const s = view.structures;
  const cities = s.ownedCount(owner, STRUCT_CITY);
  const factories = s.ownedCount(owner, STRUCT_FACTORY);
  if ((factories + 1) * AI_BUILD_CITIES_PER_FACTORY <= cities) return STRUCT_FACTORY;
  const ports = s.ownedCount(owner, STRUCT_PORT);
  const posts = s.ownedCount(owner, STRUCT_POST);
  // After the first City and Factory the order of need is: Port, Post, then the next City.
  if (cities >= 2 && (ports + 1) * AI_BUILD_CITIES_PER_PORT <= cities + 1) return STRUCT_PORT;
  if (cities >= 4 && (posts + 1) * AI_BUILD_CITIES_PER_POST <= cities) return STRUCT_POST;
  return STRUCT_CITY;
}

/** The level the AI lets its Cities rise to while it owns `cities` of them: 1 + cities * AI_CITY_UPGRADE_LEVELS_PER_CITY, at most AI_CITY_LEVEL_CAP. A City below it may be upgraded; the limit rises with every new City. */
function cityLevelTarget(cities: number): number {
  const target = 1 + cities * AI_CITY_UPGRADE_LEVELS_PER_CITY;
  return target > AI_CITY_LEVEL_CAP ? AI_CITY_LEVEL_CAP : target;
}

/**
 * The City to upgrade instead of building a new one: the finished, idle City of the lowest level below the top whose upgrade is cheaper
 * than the next new City (prices escalate with every City, an upgrade does not). Returns its id or -1.
 */
function cheaperUpgrade(view: SimView, owner: number, newCityMilli: number): number {
  const s = view.structures;
  let best = -1;
  let bestLevel = cityLevelTarget(s.ownedCount(owner, STRUCT_CITY));
  for (let id = 0; id < s.highWater; id++) {
    if (s.owner[id] !== owner || s.type[id] !== STRUCT_CITY || view.tick < (s.readyTick[id] as number) || (s.upgradeReadyTick[id] as number) !== 0) continue;
    const level = s.level[id] as number;
    const cell = s.cell[id] as number;
    if (level < bestLevel && interior(view, owner, cell, cell % view.width, Math.floor(cell / view.width))) {
      best = id;
      bestLevel = level;
    }
  }
  if (best < 0 || upgradePriceNowMilli(view, ownerToSeat(owner), STRUCT_CITY, bestLevel + 1) >= newCityMilli) return -1;
  return best;
}

/**
 * The structure to upgrade when the seat is rich: the finished, idle City, then Factory, then Port of the lowest level below the top whose
 * upgrade the purse pays. Returns its id or -1. Idle and finished are read from the table, the very conditions the sim checks on an Upgrade.
 */
function richUpgrade(view: SimView, owner: number, goldMilli: number): number {
  const s = view.structures;
  let best = -1;
  let bestKey = 1 << 30;
  for (let id = 0; id < s.highWater; id++) {
    const type = s.type[id] as number;
    if (s.owner[id] !== owner || (type !== STRUCT_CITY && type !== STRUCT_FACTORY && type !== STRUCT_PORT)) continue;
    if (view.tick < (s.readyTick[id] as number) || (s.upgradeReadyTick[id] as number) !== 0) continue;
    const level = s.level[id] as number;
    if (level >= (type === STRUCT_CITY ? cityLevelTarget(s.ownedCount(owner, STRUCT_CITY)) : AI_STRUCT_LEVEL_CAP) || upgradePriceNowMilli(view, ownerToSeat(owner), type, level + 1) > goldMilli) continue;
    const cell = s.cell[id] as number;
    if (!interior(view, owner, cell, cell % view.width, Math.floor(cell / view.width))) continue; // a border structure may change hands before the Upgrade runs
    const key = level * 8 + type; // lowest level first, then City < Factory < Port, then the lowest id (the loop order)
    if (key < bestKey) {
      best = id;
      bestKey = key;
    }
  }
  return best;
}

/** The kind a free slot gets, by slot number: Market, Barracks, Housing, Walls, Market (five slots from City level 9). */
const DISTRICT_ORDER = [DISTRICT_MARKET, DISTRICT_BARRACKS, DISTRICT_HOUSING, DISTRICT_WALLS, DISTRICT_MARKET];
/** The cheapest district action there can be (the cheapest base price): a purse with less spare gold does not even look. */
const DISTRICT_CHEAPEST_MILLI = Math.min(DISTRICT_BASE_GOLD[DISTRICT_HOUSING] as number, DISTRICT_BASE_GOLD[DISTRICT_MARKET] as number, DISTRICT_BASE_GOLD[DISTRICT_BARRACKS] as number, DISTRICT_BASE_GOLD[DISTRICT_WALLS] as number) * MILLI_GOLD_PER_GOLD;

/**
 * The district move (Districts-1) of a rich seat: fill the first free slot of its finished interior Cities (lowest City id, lowest slot) with
 * the kind of that slot number, else upgrade the cheapest district below the top level. `spare` is the purse less the next wanted structure.
 * Every intent is checked with the validate*District functions the sim runs. Returns null (and sets the back-off) when there is nothing to do.
 */
function districtMove(view: SimView, memory: AiMemory, spareMilli: number): IntentBody | null {
  const seat = memory.seat;
  const owner = seatToOwner(seat);
  const s = view.structures;
  const d = view.districts;
  for (let id = 0; id < s.highWater; id++) {
    if (s.owner[id] !== owner || s.type[id] !== STRUCT_CITY || view.tick < (s.readyTick[id] as number)) continue;
    const cell = s.cell[id] as number;
    if (!interior(view, owner, cell, cell % view.width, Math.floor(cell / view.width))) continue;
    const slots = districtSlotsOf(s.level[id] as number);
    for (let slot = 0; slot < slots && slot < DISTRICT_MAX_SLOTS; slot++) {
      if (d.districtKind[districtIndex(id, slot)] !== 0) continue;
      const kind = DISTRICT_ORDER[slot] as number;
      if (spareMilli >= districtBuildPriceMilli(d, owner, kind) && validateBuildDistrict(view, seat, id, slot, kind) === REJECT_NONE) return buildDistrictBody(seat, id, slot, kind);
    }
  }
  let best = -1;
  let bestSlot = 0;
  let bestPrice = 1 << 30;
  for (let id = 0; id < s.highWater; id++) {
    if (s.owner[id] !== owner || s.type[id] !== STRUCT_CITY || view.tick < (s.readyTick[id] as number)) continue;
    const cell = s.cell[id] as number;
    if (!interior(view, owner, cell, cell % view.width, Math.floor(cell / view.width))) continue;
    for (let slot = 0; slot < DISTRICT_MAX_SLOTS; slot++) {
      const at = districtIndex(id, slot);
      const kind = d.districtKind[at] as number;
      const level = d.districtLevel[at] as number;
      if (kind === 0 || level >= AI_DISTRICT_LEVEL_CAP) continue;
      const price = districtUpgradePriceGold(kind, level + 1) * MILLI_GOLD_PER_GOLD;
      if (price < bestPrice && spareMilli >= price && validateUpgradeDistrict(view, seat, id, slot) === REJECT_NONE) {
        best = id;
        bestSlot = slot;
        bestPrice = price;
      }
    }
  }
  if (best >= 0) return upgradeDistrictBody(seat, best, bestSlot);
  memory.districtRetryAt = view.tick + AI_DISTRICT_RETRY_TICKS;
  return null;
}

/** The Build the seat asks for now, or null. Draws from `rng` only when it looks for a place. */
export function buildMove(view: SimView, memory: AiMemory, rng: Uint32Array): IntentBody | null {
  if (memory.tribe || view.phase === PHASE_SPAWN) return null;
  const seat = memory.seat;
  if ((view.tick + memory.phase) % AI_THINK_PERIOD_TICKS !== 0 || view.tick < memory.buildRetryAt) return null;
  const stats = view.stats;
  if ((stats.alive[seat] as number) === 0 || (stats.capital[seat] as number) === 0) return null;
  const owner = seatToOwner(seat);
  const type = wantedType(view, owner);
  const price = buildPriceMilli(view.structures, owner, type);
  if (type === STRUCT_CITY) {
    const up = cheaperUpgrade(view, owner, price);
    if (up >= 0) {
      const level = view.structures.level[up] as number;
      return (stats.goldMilli[seat] as number) >= upgradePriceNowMilli(view, seat, STRUCT_CITY, level + 1) ? upgradeBody(seat, up) : null;
    }
  }
  if ((stats.goldMilli[seat] as number) * 100 >= price * AI_BUILD_RICH_PCT) {
    const rich = richUpgrade(view, owner, stats.goldMilli[seat] as number);
    if (rich >= 0) return upgradeBody(seat, rich);
  }
  // Rich (Districts-1): no structure upgrade to buy, and what is left after the next wanted structure still pays a district, so districts never delay the Cities.
  const spare = (stats.goldMilli[seat] as number) - price;
  if (spare >= DISTRICT_CHEAPEST_MILLI && view.tick >= memory.districtRetryAt && view.structures.ownedCount(owner, STRUCT_CITY) >= AI_DISTRICT_MIN_CITIES) {
    const district = districtMove(view, memory, spare);
    if (district !== null) return district;
  }
  if ((stats.goldMilli[seat] as number) < price) return null;
  if (type === STRUCT_CITY && (stats.troopsQt[seat] as number) * 100 < (stats.capQt[seat] as number) * AI_BUILD_CITY_TROOP_PCT) return null;
  // The wanted type first; when it finds no place (a Port without a coast cell in the window) a City is tried instead, so the seat never stalls.
  let cell = findPlace(view, memory, rng, type);
  let built = type;
  if (cell < 0 && type !== STRUCT_CITY && (stats.goldMilli[seat] as number) >= buildPriceMilli(view.structures, owner, STRUCT_CITY)) {
    cell = findPlace(view, memory, rng, STRUCT_CITY);
    built = STRUCT_CITY;
  }
  if (cell < 0) {
    memory.buildRetryAt = view.tick + AI_BUILD_RETRY_TICKS;
    return null;
  }
  memory.builds++;
  return buildBody(seat, built, cell);
}

/** Whether the cell is `owner`'s and none of its four neighbours (x wrapping) belongs to ANOTHER owner (sea and free land are fine: a Port stands on a coast). */
function interior(view: SimView, owner: number, cell: number, x: number, y: number): boolean {
  const w = view.width;
  const o = view.owner;
  if (o[cell] !== owner) return false;
  const e = o[y * w + ((x + 1) % w)] as number;
  const west = o[y * w + ((x + w - 1) % w)] as number;
  const n = y > 0 ? (o[cell - w] as number) : 0;
  const so = y + 1 < view.height ? (o[cell + w] as number) : 0;
  return (e === 0 || e === owner) && (west === 0 || west === owner) && (n === 0 || n === owner) && (so === 0 || so === owner);
}

/** A cell in the window around the capital where `type` can be built now, or -1. */
function findPlace(view: SimView, memory: AiMemory, rng: Uint32Array, type: number): number {
  const seat = memory.seat;
  const w = view.width;
  const owner = seatToOwner(seat);
  const capital = (view.stats.capital[seat] as number) - 1;
  const cx = capital % w;
  const cy = (capital - cx) / w;
  const span = 2 * AI_BUILD_WINDOW_CELLS + 1;
  // A Port needs a coast cell, which is rare in a square window: it gets more tries.
  const tries = type === STRUCT_PORT ? 4 * AI_BUILD_TRIES : AI_BUILD_TRIES;
  for (let i = 0; i < tries; i++) {
    const x = (cx + nextBelow(rng, span) - AI_BUILD_WINDOW_CELLS + w) % w;
    const y = cy + nextBelow(rng, span) - AI_BUILD_WINDOW_CELLS;
    if (y < 0 || y >= view.height) continue;
    const cell = y * w + x;
    // A cell without a foreign neighbour only: the Build runs 2 ticks later and a border cell may be conquered by then (REJECT_BUILD_NOT_OWNED).
    if (!interior(view, owner, cell, x, y)) continue;
    if (validateBuild(view, seat, type, cell) === REJECT_NONE) return cell;
  }
  return -1;
}
