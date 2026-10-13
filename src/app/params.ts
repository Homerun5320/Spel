// URL parameter parsing for the client. Pure (no DOM access) so it can be unit-tested.

export interface AppParams {
  /** `?test=1`: deterministic mode (no rAF loop, fixed seed, DPR 1, MSAA off, preserveDrawingBuffer). */
  test: boolean;
  /** `?blank=1`: debug parameter, renders a deliberately empty canvas (negative e2e test). */
  blank: boolean;
  /** `?seed=N`: PRNG seed for the spike noise texture (default 1). */
  seed: number;
  /** `?w=` / `?h=`: test-mode canvas size (default 960x540; leak tests use 320x180). */
  width: number;
  height: number;
}

export const TEST_WIDTH = 960;
export const TEST_HEIGHT = 540;

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || !/^-?\d+$/.test(value)) return fallback;
  const n = Number(value);
  return n >= min && n <= max ? n : fallback;
}

export function parseParams(search: string): AppParams {
  const q = new URLSearchParams(search);
  return {
    test: q.get('test') === '1',
    blank: q.get('blank') === '1',
    seed: intParam(q.get('seed'), 1, -2147483648, 2147483647),
    width: intParam(q.get('w'), TEST_WIDTH, 16, 4096),
    height: intParam(q.get('h'), TEST_HEIGHT, 16, 4096),
  };
}
