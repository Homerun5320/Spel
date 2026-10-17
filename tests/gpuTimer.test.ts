// M08: the GPU timer (src/render/gpuTimer.ts) against a fake WebGL2 context: no extension is a quiet no-op, finished queries come out in order,
// a query that is not ready yet is kept, a disjoint event drops what was in flight, and the pool bounds the queries.
import { describe, expect, it } from 'vitest';
import { GpuTimer, type TimerGl } from '../src/render/gpuTimer';

const TIME_ELAPSED = 0x88bf;
const DISJOINT = 0x8fbb;

function fakeGl(withExt: boolean): TimerGl & { ready: Set<number>; results: Map<number, number>; disjoint: boolean; created: number; deleted: number; open: number[] } {
  let next = 1;
  const gl = {
    ready: new Set<number>(),
    results: new Map<number, number>(),
    disjoint: false,
    created: 0,
    deleted: 0,
    open: [] as number[],
    getExtension: (name: string) => (withExt && name === 'EXT_disjoint_timer_query_webgl2' ? { TIME_ELAPSED_EXT: TIME_ELAPSED, GPU_DISJOINT_EXT: DISJOINT } : null),
    getParameter: (p: number) => (p === DISJOINT ? gl.disjoint : null),
    createQuery: () => {
      gl.created++;
      return next++;
    },
    deleteQuery: () => {
      gl.deleted++;
    },
    beginQuery: (_t: number, q: unknown) => {
      gl.open.push(q as number);
    },
    endQuery: () => {
      gl.open.pop();
    },
    getQueryParameter: (q: unknown, p: number) => (p === 0x8867 ? gl.ready.has(q as number) : (gl.results.get(q as number) ?? 0)),
  };
  return gl;
}

describe('GpuTimer', () => {
  it('without the extension nothing is created and take() is null', () => {
    const gl = fakeGl(false);
    const t = new GpuTimer(gl);
    expect(t.available).toBe(false);
    t.begin();
    t.end();
    t.poll();
    expect(gl.created).toBe(0);
    expect(t.take()).toBeNull();
  });

  it('hands out finished queries in order, in milliseconds, and keeps the unfinished one', () => {
    const gl = fakeGl(true);
    const t = new GpuTimer(gl);
    expect(t.available).toBe(true);
    for (let i = 0; i < 3; i++) {
      t.begin();
      t.end();
    }
    gl.results.set(1, 4_000_000);
    gl.results.set(2, 6_500_000);
    gl.ready.add(1);
    gl.ready.add(2);
    t.poll();
    expect(t.take()).toBe(4);
    expect(t.take()).toBe(6.5);
    expect(t.take()).toBeNull(); // query 3 is not ready
    expect(gl.deleted).toBe(2);
    gl.results.set(3, 1_000_000);
    gl.ready.add(3);
    t.poll();
    expect(t.take()).toBe(1);
  });

  it('a disjoint event drops the queries in flight without a result', () => {
    const gl = fakeGl(true);
    const t = new GpuTimer(gl);
    t.begin();
    t.end();
    gl.ready.add(1);
    gl.results.set(1, 9_000_000);
    gl.disjoint = true;
    t.poll();
    expect(t.take()).toBeNull();
    expect(gl.deleted).toBe(1);
  });

  it('keeps at most a handful of queries in flight and ignores an end without a begin', () => {
    const gl = fakeGl(true);
    const t = new GpuTimer(gl);
    for (let i = 0; i < 20; i++) {
      t.begin();
      t.end();
    }
    expect(gl.created).toBe(6);
    t.end();
    expect(gl.open.length).toBe(0);
    t.dispose();
    expect(gl.deleted).toBe(6);
  });
});
