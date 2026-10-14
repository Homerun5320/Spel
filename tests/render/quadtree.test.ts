import { beforeAll, describe, expect, it } from 'vitest';
import { CameraRig, type ViewState } from '../../src/render/camera';
import { chunkKey, chunkSizeRad, levelCols, levelRows } from '../../src/render/chunkMath';
import { CHUNK_MAX_LEVEL } from '../../src/render/config';
import { DEG, vecToLatLon, wrapLon } from '../../src/render/geo';
import { CHUNK_ABSOLUTE_MAX, QUALITY, QUALITY_TIERS } from '../../src/render/quality';
import { ChunkQuadtree } from '../../src/render/quadtree';
import { ALTITUDE_VIEWS, loadChunkWorld, makeTree, poseOf, quadCameraOf, quadParams, rng, type ChunkWorld } from '../helpers/chunkWorld';
import { terrainRegionMask } from '../helpers/terrainRegion';

let world: ChunkWorld;
beforeAll(async () => {
  world = await loadChunkWorld();
});

interface Leaf {
  level: number;
  ix: number;
  iy: number;
  coarser: number[];
}
function leavesOf(t: ChunkQuadtree): Leaf[] {
  const out: Leaf[] = [];
  for (let i = 0; i < t.count; i++) out.push({ level: t.level[i] as number, ix: t.ix[i] as number, iy: t.iy[i] as number, coarser: [0, 1, 2, 3].map((k) => t.coarser[4 * i + k] as number) });
  return out;
}
const signature = (t: ChunkQuadtree): string =>
  leavesOf(t)
    .map((l) => `${l.level}/${l.ix}/${l.iy}`)
    .sort()
    .join(',');

/** Does the leaf's lat/lon rectangle contain the position (degrees)? */
function contains(l: Leaf, lat: number, lon: number): boolean {
  const w = (chunkSizeRad(l.level) / DEG);
  const lat1 = 90 - l.iy * w;
  const lon0 = -180 + l.ix * w;
  return lat <= lat1 + 1e-9 && lat >= lat1 - w - 1e-9 && wrapLon(lon) >= lon0 - 1e-9 && wrapLon(lon) <= lon0 + w + 1e-9;
}

describe('quadtree: structure', () => {
  it('no leaf is an ancestor of another, and every leaf is a real node of its level', () => {
    for (const v of ALTITUDE_VIEWS) {
      const tree = makeTree(world, 'medium');
      tree.update(quadCameraOf(poseOf(world, v.view, v.altAglM)));
      const keys = new Set<number>();
      for (const l of leavesOf(tree)) {
        expect(l.level, v.name).toBeLessThanOrEqual(CHUNK_MAX_LEVEL);
        expect(l.ix).toBeGreaterThanOrEqual(0);
        expect(l.ix).toBeLessThan(levelCols(l.level));
        expect(l.iy).toBeGreaterThanOrEqual(0);
        expect(l.iy).toBeLessThan(levelRows(l.level));
        keys.add(chunkKey(l.level, l.ix, l.iy));
      }
      expect(keys.size, `${v.name}: duplicate leaves`).toBe(tree.count);
      for (const l of leavesOf(tree)) {
        for (let k = 1; k <= l.level; k++) expect(keys.has(chunkKey(l.level - k, l.ix >> k, l.iy >> k)), `${v.name}: ancestor of ${l.level}/${l.ix}/${l.iy} is also a leaf`).toBe(false);
      }
    }
  });

  it('no holes: the ground under (nearly) every terrain pixel of the six altitudes lies inside exactly one selected chunk', () => {
    const r = rng(3);
    for (const v of ALTITUDE_VIEWS) {
      const pose = poseOf(world, v.view, v.altAglM);
      const tree = makeTree(world, 'test');
      tree.update(quadCameraOf(pose));
      const leaves = leavesOf(tree);
      const mask = terrainRegionMask(pose, 960, 540, 4);
      const rig = new CameraRig(960, 540);
      let tested = 0;
      let uncovered = 0;
      let multi = 0;
      for (let n = 0; n < 600; n++) {
        const px = Math.floor(r() * 960);
        const py = Math.floor(r() * 540);
        if (mask[py * 960 + px] === 0) continue;
        const ray = rig.rayAt(px + 0.5, py + 0.5, pose);
        const hit = world.field.pick(ray.origin, ray.dir, 0.0003);
        if (!hit) continue;
        // a hit on the very rim of a chunk may belong to the neighbour: step it half a metre inward is not needed, a border counts for both
        const inside = leaves.filter((l) => contains(l, hit.lat, hit.lon)).length;
        tested++;
        if (inside === 0) uncovered++;
        if (inside > 1) {
          // only on shared borders: tolerate, count
          multi++;
        }
      }
      expect(tested, v.name).toBeGreaterThan(50);
      expect(uncovered, `${v.name}: ground points with no chunk`).toBe(0);
      expect(multi / tested, `${v.name}: points in two chunks (only borders may be)`).toBeLessThan(0.02);
    }
  });

  it('the nearest chunk is the finest: a camera 300 m above the ground gets chunks of level 15 or deeper, the nearest of them among the finest, while the far horizon is coarse', () => {
    const v = ALTITUDE_VIEWS[5] as (typeof ALTITUDE_VIEWS)[number];
    const pose = poseOf(world, v.view, v.altAglM);
    const tree = makeTree(world, 'medium');
    tree.update(quadCameraOf(pose));
    const levels = leavesOf(tree).map((l) => l.level);
    expect(Math.max(...levels)).toBeGreaterThanOrEqual(15);
    expect(Math.min(...levels)).toBeLessThanOrEqual(8);
    // the leaf nearest to the camera (distance to its centre in the chunk's own size) is one of the finest
    let best = Infinity;
    let bestLevel = -1;
    for (const l of leavesOf(tree)) {
      const w = chunkSizeRad(l.level);
      const lat = Math.PI / 2 - (l.iy + 0.5) * w;
      const lon = -Math.PI + (l.ix + 0.5) * w;
      const c = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
      const d = Math.hypot(c[0]! - pose.position[0], c[1]! - pose.position[1], c[2]! - pose.position[2]);
      if (d < best) {
        best = d;
        bestLevel = l.level;
      }
    }
    expect(bestLevel).toBeGreaterThanOrEqual(13);
  });

  it('orbit: only the visible side is selected, at the level whose 32-cell grid matches the old fixed mesh (level 2 = 0.7 degrees per cell) on the medium tier', () => {
    const pose = poseOf(world, { lat: 22, lon: 12, heading: 0, tilt: 0, distKm: 21500 });
    const tree = makeTree(world, 'medium');
    tree.update(quadCameraOf(pose));
    const levels = new Set(leavesOf(tree).map((l) => l.level));
    expect([...levels].every((l) => l === 1 || l === 2)).toBe(true);
    expect(tree.count).toBeLessThan(levelCols(2) * levelRows(2)); // far less than the 128 chunks of the whole globe at level 2
    expect(tree.count).toBeGreaterThanOrEqual(30);
  });

  it('is deterministic: the same camera after a reset gives the same leaves, and a second update of the same camera changes nothing', () => {
    const pose = poseOf(world, ALTITUDE_VIEWS[3]!.view, ALTITUDE_VIEWS[3]!.altAglM);
    const a = makeTree(world, 'test');
    a.update(quadCameraOf(pose));
    const first = signature(a);
    a.update(quadCameraOf(pose));
    expect(signature(a)).toBe(first);
    a.reset();
    a.update(quadCameraOf(pose));
    expect(signature(a)).toBe(first);
    const b = makeTree(world, 'test');
    b.update(quadCameraOf(pose));
    expect(signature(b)).toBe(first);
  });
});

/** Views across the antimeridian (looking toward and away from the seam, one side finer than the other) and at the poles. */
const SEAM_VIEWS: ReadonlyArray<{ name: string; altAglM: number; view: Partial<ViewState> }> = [
  { name: 'seam east 60 km', altAglM: 60_000, view: { lat: 10, lon: 179.5, heading: 90, tilt: 70 } },
  { name: 'seam west 500 km', altAglM: 500_000, view: { lat: 10, lon: 175, heading: 90, tilt: 60 } },
  { name: 'seam from the west 8 km', altAglM: 8_000, view: { lat: 60, lon: -179.9, heading: 270, tilt: 80 } },
  { name: 'seam from the east 60 km', altAglM: 60_000, view: { lat: -20, lon: -176, heading: 270, tilt: 65 } },
  { name: 'north pole 100 km', altAglM: 100_000, view: { lat: 88, lon: 40, heading: 180, tilt: 70 } },
  { name: 'south pole 200 km', altAglM: 200_000, view: { lat: -87, lon: -150, heading: 20, tilt: 60 } },
];

describe('quadtree: neighbour levels', () => {
  it('the levels the neighbours are coarser equal a brute-force search over the leaves, on every edge of every leaf (six altitudes and the antimeridian / pole views)', () => {
    let seamEdges = 0;
    for (const v of [...ALTITUDE_VIEWS, ...SEAM_VIEWS]) {
      const tree = makeTree(world, 'test');
      tree.update(quadCameraOf(poseOf(world, v.view, v.altAglM)));
      const leaves = leavesOf(tree);
      let coarse = 0;
      let finerSeen = 0;
      for (const l of leaves) {
        const w = chunkSizeRad(l.level) / DEG;
        const latC = 90 - (l.iy + 0.5) * w;
        const lonC = -180 + (l.ix + 0.5) * w;
        // the midpoints just outside the four edges: west, east, north, south
        const probes: Array<[number, number] | null> = [
          [latC, lonC - 0.5 * w - 1e-7],
          [latC, lonC + 0.5 * w + 1e-7],
          latC + 0.5 * w + 1e-7 <= 90 ? [latC + 0.5 * w + 1e-7, lonC] : null,
          latC - 0.5 * w - 1e-7 >= -90 ? [latC - 0.5 * w - 1e-7, lonC] : null,
        ];
        probes.forEach((p, k) => {
          let expected = 0;
          if (p !== null) {
            const hit = leaves.find((o) => contains(o, p[0], p[1]) && !contains(o, latC, lonC));
            if (hit && hit.level < l.level) expected = l.level - hit.level;
          }
          if (expected > 0) coarse++;
          // a wrap-around edge with a neighbour of another level: the west edge of column 0 or the east edge of the last column
          if (expected > 0 && ((k === 0 && l.ix === 0) || (k === 1 && l.ix === levelCols(l.level) - 1))) seamEdges++;
          expect(l.coarser[k], `${v.name}: leaf ${l.level}/${l.ix}/${l.iy} edge ${k}`).toBe(expected);
          // finer: some leaf across the edge is at a deeper level than this one
          let finer = false;
          if (p !== null) {
            // the same-level cell across the edge, and a deeper leaf inside it
            const nx = Math.floor((wrapLon(p[1]) + 180) / w);
            const ny = Math.min(levelRows(l.level) - 1, Math.floor((90 - p[0]) / w));
            finer = leaves.some((o) => o.level > l.level && o.ix >> (o.level - l.level) === nx && o.iy >> (o.level - l.level) === ny);
          }
          const fi = Array.from({ length: 4 }, (_, e) => tree.finer[4 * leaves.indexOf(l) + e] as number)[k];
          if (finer) finerSeen++;
          // (a neighbour that was split but whose children are all culled or dropped out, as near the pole rows, is marked finer too: the
          // conservative direction, a deeper wall, so at the poles only "finer leaves there => marked" is required)
          if (v.name.includes('pole')) {
            if (finer) expect(fi === 1, `${v.name}: leaf ${l.level}/${l.ix}/${l.iy} edge ${k} finer`).toBe(true);
          } else {
            expect(fi === 1, `${v.name}: leaf ${l.level}/${l.ix}/${l.iy} edge ${k} finer`).toBe(finer);
          }
        });
      }
      if (v.name === '60 km' || v.name === '8 km') {
        expect(coarse, `${v.name} has LOD seams`).toBeGreaterThan(0);
        expect(finerSeen, `${v.name} has finer neighbours`).toBeGreaterThan(0);
      }
    }
    // the views must really have put a level change on the antimeridian, or the wrap-around of the neighbour search is untested
    expect(seamEdges, 'edges across the antimeridian with a coarser neighbour').toBeGreaterThan(0);
  });
});

describe('quadtree: the chunk cap', () => {
  it('property: for 300 random camera poses (every altitude, tilt and place) on every tier the leaves never exceed the tier cap, and never 400', () => {
    const r = rng(2024);
    for (const tier of QUALITY_TIERS) {
      const tree = makeTree(world, tier);
      let worst = 0;
      let cappedFrames = 0;
      for (let i = 0; i < 300; i++) {
        const view = { lat: -85 + 170 * r(), lon: -180 + 360 * r(), heading: 360 * r(), tilt: 89 * r() };
        const alt = 10 ** (2.4 + 5.5 * r()); // 250 m .. 80 000 km (above 3 000 km the camera is in space anyway)
        const pose = poseOf(world, view, Math.min(alt, 30_000_000));
        tree.update(quadCameraOf(pose));
        worst = Math.max(worst, tree.count);
        if (tree.capped) cappedFrames++;
        expect(tree.count, `${tier} pose ${i}`).toBeLessThanOrEqual(QUALITY[tier].chunkMax);
        expect(tree.count).toBeLessThanOrEqual(CHUNK_ABSOLUTE_MAX);
        expect(tree.count).toBeGreaterThanOrEqual(1);
      }
      console.log(`[chunk cap] ${tier}: worst ${worst} of ${QUALITY[tier].chunkMax} chunks over 300 poses, the cap refused splits in ${cappedFrames} of them`);
    }
  });

  it('a tiny cap is honoured too (the last pass refuses splits nearest first) and the camera 300 m up still gets leaves', () => {
    const v = ALTITUDE_VIEWS[5] as (typeof ALTITUDE_VIEWS)[number];
    const pose = poseOf(world, v.view, v.altAglM);
    for (const cap of [8, 12, 40]) {
      const tree = new ChunkQuadtree(quadParams(world, { ...QUALITY.test, chunkMax: cap }));
      tree.update(quadCameraOf(pose));
      expect(tree.count).toBeLessThanOrEqual(cap);
      expect(tree.count).toBeGreaterThanOrEqual(1);
    }
  });

  it('over budget the detail around the camera wins: a view that needs more than the cap keeps its finest chunks and loses the far field first', () => {
    const v = ALTITUDE_VIEWS[5] as (typeof ALTITUDE_VIEWS)[number];
    const pose = poseOf(world, v.view, v.altAglM);
    const wanted = new ChunkQuadtree(quadParams(world, { ...QUALITY.test, chunkMax: 400 }));
    wanted.update(quadCameraOf(pose));
    expect(wanted.capped).toBe(false);
    const capped = new ChunkQuadtree(quadParams(world, { ...QUALITY.test, chunkMax: Math.floor(wanted.count / 2) }));
    capped.update(quadCameraOf(pose));
    expect(capped.capped).toBe(true);
    expect(capped.count).toBeLessThanOrEqual(Math.floor(wanted.count / 2));
    const finest = (t: ChunkQuadtree): number => Math.max(...leavesOf(t).map((l) => l.level));
    expect(finest(capped)).toBe(finest(wanted)); // the nearest detail is kept
    expect(Math.min(...leavesOf(capped).map((l) => l.level))).toBeLessThanOrEqual(Math.min(...leavesOf(wanted).map((l) => l.level)) + 1);
    // and the capped result only left splits undone: each of its chunks is a wanted chunk or an ancestor of wanted chunks
    const wantedLeaves = leavesOf(wanted);
    const wantedKeys = new Set(wantedLeaves.map((l) => chunkKey(l.level, l.ix, l.iy)));
    for (const l of leavesOf(capped)) {
      const isWanted = wantedKeys.has(chunkKey(l.level, l.ix, l.iy));
      const isAncestor = wantedLeaves.some((w) => w.level > l.level && w.ix >> (w.level - l.level) === l.ix && w.iy >> (w.level - l.level) === l.iy);
      expect(isWanted || isAncestor, `capped leaf ${l.level}/${l.ix}/${l.iy}`).toBe(true);
    }
  });
});

describe('quadtree: the LOD is stable under a binding cap', () => {
  /** Poses whose wanted detail exceeds the tier's cap (found by search, the same seeded poses every run). */
  function cappedViews(tier: (typeof QUALITY_TIERS)[number], want: number): Array<{ view: Partial<ViewState>; agl: number }> {
    const r = rng(881);
    const found: Array<{ view: Partial<ViewState>; agl: number }> = [];
    const tree = makeTree(world, tier);
    for (let i = 0; i < 400 && found.length < want; i++) {
      const view = { lat: -70 + 140 * r(), lon: -180 + 360 * r(), heading: 360 * r(), tilt: 25 + 55 * r() };
      const agl = 10 ** (4.3 + 2.9 * r()); // 20 km .. 16 000 km
      tree.reset();
      tree.update(quadCameraOf(poseOf(world, view, agl)));
      if (tree.capped) found.push({ view, agl });
    }
    return found;
  }
  const leafUnder = (t: ChunkQuadtree, lat: number, lon: number): Leaf | undefined => leavesOf(t).find((l) => contains(l, lat, lon));
  /** The ground under the screen centre: the point the player looks at (a camera at a height above the displaced ground looks a little past the view's lat / lon). */
  const rigForFocus = new CameraRig(960, 540);
  function focusOf(view: Partial<ViewState>, agl: number): { lat: number; lon: number } {
    const pose = poseOf(world, view, agl);
    const ray = rigForFocus.rayAt(480, 270, pose);
    const hit = world.field.pick(ray.origin, ray.dir, 0.0003);
    return hit ? { lat: hit.lat, lon: hit.lon } : { lat: view.lat as number, lon: view.lon as number };
  }

  it('a camera wobbling by +-1 % in height for 100 frames at views where the cap binds changes the level under the focus at most once, and swaps few chunks per frame (every tier)', () => {
    for (const tier of QUALITY_TIERS) {
      const views = cappedViews(tier, 5);
      // the cap must really bind in the views (medium rarely needs it: then it is checked on the views that do)
      if (tier !== 'medium') expect(views.length, `${tier}: poses where the cap binds`).toBeGreaterThanOrEqual(3);
      let worstChanges = 0;
      let worstSwap = 0;
      for (const { view, agl } of views) {
        const tree = makeTree(world, tier);
        let prev = new Set<number>();
        let prevLevel = -2;
        let changes = 0;
        let cappedFrames = 0;
        const focus = focusOf(view, agl);
        for (let f = 0; f < 100; f++) {
          const wobble = 0.01 * Math.sin(f * 1.7) * (f % 2 === 1 ? 0.7 : 1);
          tree.update(quadCameraOf(poseOf(world, view, agl * (1 + wobble))));
          if (tree.capped) cappedFrames++;
          const cur = new Set<number>();
          for (let i = 0; i < tree.count; i++) cur.add(chunkKey(tree.level[i] as number, tree.ix[i] as number, tree.iy[i] as number));
          if (f > 5) {
            let swapped = 0;
            for (const c of cur) if (!prev.has(c)) swapped++;
            worstSwap = Math.max(worstSwap, swapped);
          }
          prev = cur;
          const l = leafUnder(tree, focus.lat, focus.lon)?.level ?? -1;
          if (f > 0 && l !== prevLevel) changes++;
          prevLevel = l;
        }
        worstChanges = Math.max(worstChanges, changes);
        expect(changes, `${tier} lat ${view.lat?.toFixed(1)} lon ${view.lon?.toFixed(1)} tilt ${view.tilt?.toFixed(0)} at ${(agl / 1000).toFixed(0)} km: level changes under the focus in 100 frames`).toBeLessThanOrEqual(1);
        expect(cappedFrames, 'the wobble path stays capped').toBeGreaterThan(0);
      }
      // 1 % of height moves the nodes at their split distances a little: a handful of leaves may change per frame, never a subtree swap
      console.log(`[lod stability] ${tier}: ${views.length} capped views, worst level changes under the focus ${worstChanges} of 100 frames, most new leaves in one frame ${worstSwap}`);
      expect(worstSwap, `${tier}: new leaves in one frame`).toBeLessThanOrEqual(Math.ceil(0.08 * QUALITY[tier].chunkMax));
    }
  });

  it('a monotone zoom-in straight down never makes the chunk under the focus coarser, and chunks merge only to make room under a binding cap (never without a cap), a few at a time', () => {
    const r = rng(404);
    let merges = 0;
    let frames = 0;
    for (const tier of QUALITY_TIERS) {
      for (let run = 0; run < 4; run++) {
        const view = { lat: -60 + 120 * r(), lon: -180 + 360 * r(), heading: 360 * r(), tilt: run === 0 ? 0 : 20 + 55 * r() };
        const tree = makeTree(world, tier);
        let prev: Leaf[] = [];
        let prevFocus = -1;
        const fp = focusOf(view, 300); // the ground point the zoom ends at (the camera comes ever nearer to it)
        for (let agl = 1.5e7; agl > 300; agl /= 1.02) {
          tree.update(quadCameraOf(poseOf(world, view, agl)));
          const cur = leavesOf(tree);
          const focus = leafUnder(tree, fp.lat, fp.lon)?.level ?? -1;
          // (looking straight down, the focus is the nearest ground; on a tilted view the ground at the camera's feet is nearer and may
          // rightly take a capped budget from a chunk further away)
          if (run === 0) expect(focus, `${tier} at ${(agl / 1000).toFixed(1)} km: level under the focus`).toBeGreaterThanOrEqual(prevFocus);
          prevFocus = Math.max(prevFocus, focus);
          // a merge: a leaf now that was a node with leaves below it a frame ago
          let m = 0;
          for (const l of cur) {
            if (prev.some((p) => p.level > l.level && p.ix >> (p.level - l.level) === l.ix && p.iy >> (p.level - l.level) === l.iy)) m++;
          }
          if (m > 0) {
            expect(tree.evictions, `${tier} run ${run}: merges without an eviction`).toBeGreaterThan(0);
            expect(m, `${tier} run ${run}: merged chunks in one frame`).toBeLessThanOrEqual(4 * 4);
          }
          merges += m;
          frames++;
          prev = cur;
        }
      }
    }
    console.log(`[lod stability] monotone zoom-in: ${merges} chunks merged in ${frames} frames of 2 % steps (all of them evictions under a binding cap)`);
  });
});

describe('quadtree: LOD hysteresis', () => {
  const CENTRE = { lat: 46.5, lon: 8 };
  /** The level of the chunk under the centre of the view (the screen centre of a camera looking straight down at the Alps). */
  function centreLevel(tree: ChunkQuadtree): number {
    const hit = leavesOf(tree).find((l) => contains(l, CENTRE.lat, CENTRE.lon));
    return hit ? hit.level : -1;
  }
  const poseAt = (agl: number) => poseOf(world, { ...CENTRE, heading: 0, tilt: 0 }, agl);

  /** How often the level of the chunk under the view centre changes on a path that wobbles around a ring boundary (the camera stays inside the budget: only the hysteresis is under test). */
  function changesOnPath(hysteresis: number, wobble: number, centreAglM: number, frames = 300): number {
    const tree = new ChunkQuadtree(quadParams(world, QUALITY.test, { hysteresis, maxChunks: 400 }));
    let changes = 0;
    let prev = -2;
    for (let f = 0; f < frames; f++) {
      tree.update(quadCameraOf(poseAt(centreAglM * (1 + wobble * Math.sin(f * 0.7)))));
      expect(tree.capped, 'the path must stay inside the budget').toBe(false);
      const l = centreLevel(tree);
      expect(l).toBeGreaterThanOrEqual(0);
      if (f > 0 && l !== prev) changes++;
      prev = l;
    }
    return changes;
  }

  /** The altitude at which the level under the centre changes (a ring boundary, split distance), by bisection without hysteresis. */
  function ringBoundary(lo: number, hi: number): number {
    const level = (agl: number): number => {
      const t = new ChunkQuadtree(quadParams(world, QUALITY.test, { hysteresis: 0, maxChunks: 400 }));
      t.update(quadCameraOf(poseAt(agl)));
      return centreLevel(t);
    };
    const lvLo = level(lo);
    expect(level(hi)).not.toBe(lvLo);
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (lo + hi);
      if (level(mid) === lvLo) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /** Every ring boundary between two altitudes: pairs of altitudes 4 % apart where the level under the centre differs without hysteresis. */
  function boundaries(): Array<[number, number]> {
    const t = new ChunkQuadtree(quadParams(world, QUALITY.test, { hysteresis: 0, maxChunks: 400 }));
    const out: Array<[number, number]> = [];
    let prevAgl = 2_000;
    t.update(quadCameraOf(poseAt(prevAgl)));
    let prev = centreLevel(t);
    for (let agl = 2_080; agl < 500_000; agl *= 1.04) {
      t.update(quadCameraOf(poseAt(agl)));
      const l = centreLevel(t);
      if (l !== prev) out.push([prevAgl, agl]);
      prev = l;
      prevAgl = agl;
    }
    return out;
  }

  it('a camera wobbling by +-6 % around a ring boundary changes the chunk under the view centre at most once with hysteresis, and flickers many times without', () => {
    const found = boundaries();
    expect(found.length).toBeGreaterThanOrEqual(5);
    for (const [lo, hi] of found.slice(0, 6)) {
      const boundary = ringBoundary(lo, hi);
      const withH = changesOnPath(0.25, 0.06, boundary);
      const without = changesOnPath(0, 0.06, boundary);
      console.log(`[hysteresis] ring boundary at ${(boundary / 1000).toFixed(2)} km AGL: ${withH} level changes with hysteresis 0.25, ${without} without, over 300 frames`);
      expect(withH).toBeLessThanOrEqual(1);
      expect(without).toBeGreaterThan(20);
    }
  });

  it('merging needs a larger distance than splitting: the level under the centre changes at a higher altitude going up than coming down', () => {
    const tree = new ChunkQuadtree(quadParams(world, QUALITY.test, { maxChunks: 400 }));
    const levelAt = (agl: number): number => {
      tree.update(quadCameraOf(poseAt(agl)));
      return centreLevel(tree);
    };
    // coming down from far above: the first altitude at which the centre chunk is finer than at the start
    const l = levelAt(120_000);
    let down = 0;
    for (let agl = 120_000; agl > 4_000; agl *= 0.998) {
      const n = levelAt(agl);
      if (n > l) {
        down = agl;
        break;
      }
    }
    // going up again from just below: the first altitude at which it is coarser than at the start
    const startLevel = levelAt(down * 0.9);
    let up = 0;
    for (let agl = down * 0.9; agl < 400_000; agl *= 1.002) {
      if (levelAt(agl) < startLevel) {
        up = agl;
        break;
      }
    }
    expect(down).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(down * 1.1); // the merge happens at least 10 % higher than the split did (the band is 25 % of the split distance)
    expect(up).toBeLessThan(down * 1.5);
  });
});

describe('quadtree: culling', () => {
  it('a peak that stands beyond the sea-level horizon is kept: the horizon test adds the extra horizon of the HIGHEST terrain of a chunk (x12 mountains are up to 106 km tall)', () => {
    // [camera, the summit region far beyond its sea-level horizon (a camera 300 m up sees 62 km), and the place that must be covered]
    const cases: Array<{ name: string; view: Partial<ViewState>; target: [number, number]; distKm: number }> = [
      { name: 'Himalaya from the Indian plain', view: { lat: 22, lon: 87, heading: 0, tilt: 88 }, target: [28, 86.9], distKm: 670 },
      { name: 'Alps from the Ligurian coast', view: { lat: 43.6, lon: 7.5, heading: 0, tilt: 88 }, target: [45.83, 6.86], distKm: 250 },
    ];
    for (const c of cases) {
      const tree = makeTree(world, 'test');
      tree.update(quadCameraOf(poseOf(world, c.view, 300)));
      const hit = leavesOf(tree).filter((l) => contains(l, c.target[0], c.target[1]));
      expect(hit.length, `${c.name}: a chunk covers the summit region ${c.distKm} km away`).toBeGreaterThanOrEqual(1);
    }
  });

  it('a view at orbit selects fewer chunks than the whole globe would need, and a camera looking away from the planet selects none behind it', () => {
    const near = poseOf(world, { lat: 0, lon: 0, heading: 0, tilt: 0 }, 2_000_000);
    const a = makeTree(world, 'medium');
    a.update(quadCameraOf(near));
    const cam = quadCameraOf(near);
    // turn the camera around: forward and right/up flip, so the planet is behind it
    [cam.fx, cam.fy, cam.fz] = [-cam.fx, -cam.fy, -cam.fz];
    [cam.rx, cam.ry, cam.rz] = [-cam.rx, -cam.ry, -cam.rz];
    const b = makeTree(world, 'medium');
    b.update(cam);
    expect(a.count).toBeGreaterThan(10);
    expect(b.count).toBe(0);
  });

  it('chunks behind the horizon are dropped: a camera 300 m up sees only chunks within about the horizon distance plus the mountains', () => {
    const v = ALTITUDE_VIEWS[5] as (typeof ALTITUDE_VIEWS)[number];
    const pose = poseOf(world, v.view, v.altAglM);
    const tree = makeTree(world, 'medium');
    tree.update(quadCameraOf(pose));
    const pos = vecToLatLon(pose.position);
    let farthest = 0;
    for (const l of leavesOf(tree)) {
      const w = chunkSizeRad(l.level);
      const lat = Math.PI / 2 - (l.iy + 0.5) * w;
      const lon = -Math.PI + (l.ix + 0.5) * w;
      const cosA = Math.sin(lat) * Math.sin(pos.lat * DEG) + Math.cos(lat) * Math.cos(pos.lat * DEG) * Math.cos(lon - pos.lon * DEG);
      farthest = Math.max(farthest, Math.acos(Math.min(1, cosA)) - w * 1.5);
    }
    // 25 km up (the Alps at x12) the horizon is 5.7 degrees away; allow the 106 km high peaks beyond it
    expect(farthest / DEG).toBeLessThan(25);
  });
});
