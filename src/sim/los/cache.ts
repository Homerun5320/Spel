// The LOS cache (M11a): the masks of the sites, the composite coverage per owner and the queries. Everything here is DERIVED data
// outside the game state and its hash: it is rebuilt lazily when the set of sensor sites differs from the one the cache was built for
// (a SAM finished, upgraded, deleted or conquered, a Post finished, an added test site), so a deserialized match needs no hook: the
// first query after the load rebuilds. No per-tick cost: `sync` runs only inside a query, and an unchanged set costs one scan of the
// structure table and no rebuild (counters `maskBuilds`, `compositeBuilds`).
import { ALT_HIGH_AGL_M, ALT_LOW_AGL_M, LOS_MASK_UNIT_GM, LOS_TILE_CELLS, POST_RADIUS_CELLS } from '../rules';
import { CLASS_MOUNTAIN } from '../terrain';
import { samRadiusCells } from '../structureEffects';
import { STRUCT_POST, STRUCT_SAM, type StructureView } from '../structureRules';
import { MASK_NONE, buildMask, maskSide } from './mask';
import type { LosTerrain } from './terrain';

export const ALT_MODE_LOW = 0;
export const ALT_MODE_HIGH = 1;
export type AltMode = 0 | 1;
export const EXPOSED_NONE = 0;
/** Seen by the owner's SAM / radar coverage. */
export const EXPOSED_DETECTED = 1;
/** Inside a finished Defense Post's radius (always exposed, both modes). */
export const EXPOSED_POST = 2;

/** What a view must offer to be synced against (a SimView is one). */
export interface LosSource {
  readonly tick: number;
  readonly structures: StructureView;
  readonly terrainClass: { readonly [index: number]: number };
}

interface Site {
  owner: number;
  cell: number;
  radius: number;
  mask: Uint16Array;
}

interface Want {
  owner: number;
  /** Structure id, or -1 - n for the n-th added site. */
  handle: number;
  cell: number;
  radius: number;
}

const TILE = LOS_TILE_CELLS;

export class Los {
  readonly terrain: LosTerrain;
  /** Times a site mask was built, and times an owner's composite was rebuilt (tests assert that an unchanged set costs none). */
  maskBuilds = 0;
  compositeBuilds = 0;
  private readonly tilesX: number;
  private readonly tilesY: number;
  private readonly extra: Array<{ owner: number; cell: number; radius: number }> = [];
  private maskCache = new Map<number, Uint16Array>();
  private posts = new Map<number, number[]>();
  private composite = new Map<number, Array<Uint16Array | null>>();
  private keyOf = new Map<number, string>();
  private handles = new Map<number, Site>();
  private sigNow = new Int32Array(0);
  private sigPrev = new Int32Array(0);
  private sigPrevLen = -1;

  constructor(terrain: LosTerrain) {
    this.terrain = terrain;
    this.tilesX = Math.ceil(terrain.width / TILE);
    this.tilesY = Math.ceil(terrain.height / TILE);
  }

  /** Adds a sensor site for tests and for later milestones' radars: owner id, cell, radius in cells. Returns its handle (negative). */
  addSite(ownerId: number, cell: number, radius: number): number {
    this.extra.push({ owner: ownerId, cell, radius });
    return -this.extra.length;
  }

  clearExtraSites(): void {
    this.extra.length = 0;
  }

  /**
   * Brings the sites and composites in line with the structure table: rebuilds only what differs from the last call. An unchanged set
   * costs one scan of the table into a scratch signature (4 integers per sensor: owner * 2 + isPost, handle, cell, radius) and no allocation.
   */
  sync(src: LosSource): void {
    const s = src.structures;
    const tick = src.tick;
    const need = (s.highWater + this.extra.length) * 4;
    if (this.sigNow.length < need) {
      this.sigNow = new Int32Array(need * 2);
      this.sigPrev = new Int32Array(need * 2);
      this.sigPrevLen = -1;
    }
    const sig = this.sigNow;
    let n = 0;
    for (let id = 0; id < s.highWater; id++) {
      const owner = s.owner[id] as number;
      if (owner === 0 || tick < (s.readyTick[id] as number)) continue;
      const type = s.type[id] as number;
      if (type === STRUCT_SAM) {
        const cell = s.cell[id] as number;
        sig[n++] = owner * 2;
        sig[n++] = id;
        sig[n++] = cell;
        sig[n++] = samRadiusCells(s.level[id] as number, src.terrainClass[cell] === CLASS_MOUNTAIN);
      } else if (type === STRUCT_POST) {
        sig[n++] = owner * 2 + 1;
        sig[n++] = id;
        sig[n++] = s.cell[id] as number;
        sig[n++] = 0;
      }
    }
    for (let e = 0; e < this.extra.length; e++) {
      const x = this.extra[e] as { owner: number; cell: number; radius: number };
      sig[n++] = x.owner * 2;
      sig[n++] = -1 - e;
      sig[n++] = x.cell;
      sig[n++] = x.radius;
    }
    if (n === this.sigPrevLen) {
      let same = true;
      for (let i = 0; i < n; i++) {
        if (sig[i] !== this.sigPrev[i]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    this.sigPrev.set(sig.subarray(0, n));
    this.sigPrevLen = n;
    const wants: Want[] = [];
    const nextPosts = new Map<number, number[]>();
    for (let i = 0; i < n; i += 4) {
      const k = sig[i] as number;
      const owner = k >> 1;
      if ((k & 1) === 1) {
        let l = nextPosts.get(owner);
        if (l === undefined) nextPosts.set(owner, (l = []));
        l.push(sig[i + 2] as number);
      } else wants.push({ owner, handle: sig[i + 1] as number, cell: sig[i + 2] as number, radius: sig[i + 3] as number });
    }
    this.posts = nextPosts;
    const keys = new Map<number, string>();
    for (const x of wants) keys.set(x.owner, `${keys.get(x.owner) ?? ''}${x.handle}:${x.cell}:${x.radius},`);
    let dirty = false;
    for (const [owner, key] of keys) if (this.keyOf.get(owner) !== key) dirty = true;
    for (const owner of this.keyOf.keys()) if (!keys.has(owner)) dirty = true;
    if (!dirty) return;
    const used = new Map<number, Uint16Array>();
    const handles = new Map<number, Site>();
    const sites: Site[] = [];
    for (const x of wants) {
      const mk = x.cell * 128 + x.radius;
      let mask = used.get(mk) ?? this.maskCache.get(mk);
      if (mask === undefined) {
        mask = buildMask(this.terrain, x.cell, x.radius);
        this.maskBuilds++;
      }
      used.set(mk, mask);
      const site = { owner: x.owner, cell: x.cell, radius: x.radius, mask };
      sites.push(site);
      handles.set(x.handle, site);
    }
    this.maskCache = used;
    this.handles = handles;
    for (const [owner, key] of keys) {
      if (this.keyOf.get(owner) === key) continue;
      this.composite.set(owner, this.buildComposite(owner, sites));
      this.compositeBuilds++;
    }
    for (const owner of this.keyOf.keys()) if (!keys.has(owner)) this.composite.delete(owner);
    this.keyOf = keys;
  }

  private buildComposite(owner: number, sites: Site[]): Array<Uint16Array | null> {
    const tiles: Array<Uint16Array | null> = new Array<Uint16Array | null>(this.tilesX * this.tilesY).fill(null);
    const w = this.terrain.width;
    const h = this.terrain.height;
    for (const site of sites) {
      if (site.owner !== owner) continue;
      const r = site.radius;
      const side = maskSide(r);
      const sx = site.cell % w;
      const sy = (site.cell - sx) / w;
      for (let py = -r; py <= r; py++) {
        const y = sy + py;
        if (y < 0 || y >= h) continue;
        for (let px = -r; px <= r; px++) {
          const v = site.mask[(py + r) * side + (px + r)] as number;
          if (v === MASK_NONE) continue;
          let x = (sx + px) % w;
          if (x < 0) x += w;
          const ti = ((y / TILE) | 0) * this.tilesX + ((x / TILE) | 0);
          let tile = tiles[ti];
          if (tile === undefined || tile === null) {
            tile = new Uint16Array(TILE * TILE).fill(MASK_NONE);
            tiles[ti] = tile;
          }
          const at = (y % TILE) * TILE + (x % TILE);
          if (v < (tile[at] as number)) tile[at] = v;
        }
      }
    }
    return tiles;
  }

  /** Composite tiles allocated for an owner (a site of R=24 touches at most 4). */
  tileCount(owner: number): number {
    const t = this.composite.get(owner);
    if (t === undefined) return 0;
    let n = 0;
    for (const x of t) if (x !== null && x !== undefined) n++;
    return n;
  }

  /** Writes the owner ids that have any sensor (a SAM mask or a Post) into `out` (cleared first) and returns how many. Call `sync` first (M11b: the route planner loops over these only). */
  sensorOwners(out: number[]): number {
    out.length = 0;
    for (const o of this.composite.keys()) out.push(o);
    for (const o of this.posts.keys()) if (!this.composite.has(o)) out.push(o);
    return out.length;
  }

  /** The composite mask value at a cell for an owner (MASK_NONE = not covered). Call `sync` first. */
  compositeAt(owner: number, cell: number): number {
    const tiles = this.composite.get(owner);
    if (tiles === undefined) return MASK_NONE;
    const x = cell % this.terrain.width;
    const y = (cell - x) / this.terrain.width;
    const tile = tiles[((y / TILE) | 0) * this.tilesX + ((x / TILE) | 0)];
    if (tile === undefined || tile === null) return MASK_NONE;
    return tile[(y % TILE) * TILE + (x % TILE)] as number;
  }

  /** Altitude of an aircraft of a mode over a cell in game metres. */
  altitudeGm(cell: number, mode: AltMode): number {
    return (this.terrain.groundGm[cell] as number) + (mode === ALT_MODE_LOW ? ALT_LOW_AGL_M : ALT_HIGH_AGL_M);
  }

  /** Is a target over `cell` seen by the union of the owner's sites? Low needs altitude >= mask, High only the range. Call `sync` first. */
  detected(owner: number, cell: number, mode: AltMode): boolean {
    const m = this.compositeAt(owner, cell);
    if (m === MASK_NONE) return false;
    if (mode === ALT_MODE_HIGH) return true;
    return this.altitudeGm(cell, mode) >= m * LOS_MASK_UNIT_GM;
  }

  /** Is `cell` inside a finished Defense Post radius of the owner? */
  inPostRadius(owner: number, cell: number): boolean {
    const list = this.posts.get(owner);
    if (list === undefined) return false;
    const w = this.terrain.width;
    const x = cell % w;
    const y = (cell - x) / w;
    const r2 = POST_RADIUS_CELLS * POST_RADIUS_CELLS;
    for (const p of list) {
      const px = p % w;
      const py = (p - px) / w;
      let dx = Math.abs(px - x);
      if (dx > w - dx) dx = w - dx;
      const dy = py - y;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }

  /** Fire control of ONE site (a structure id of a finished SAM, or an `addSite` handle): the site's own mask and radius. Call `sync` first. */
  fireControl(handle: number, cell: number, mode: AltMode): boolean {
    const site = this.handles.get(handle);
    if (site === undefined) return false;
    const w = this.terrain.width;
    const sx = site.cell % w;
    const sy = (site.cell - sx) / w;
    const x = cell % w;
    const y = (cell - x) / w;
    let dx = x - sx;
    if (dx > w / 2) dx -= w;
    else if (dx < -w / 2) dx += w;
    const r = site.radius;
    const dy = y - sy;
    if (dx < -r || dx > r || dy < -r || dy > r) return false;
    const m = site.mask[(dy + r) * maskSide(r) + (dx + r)] as number;
    if (m === MASK_NONE) return false;
    return mode === ALT_MODE_HIGH || this.altitudeGm(cell, mode) >= m * LOS_MASK_UNIT_GM;
  }
}

export function createLos(terrain: LosTerrain): Los {
  return new Los(terrain);
}
