// GPU time of the draw call, when the browser allows it (M08, the performance scene). `EXT_disjoint_timer_query_webgl2` measures how long
// the GPU spent on the commands between `begin` and `end`; the result arrives a few frames later, so a small pool of queries is kept in
// flight and `take()` hands out the finished ones. Without the extension (SwiftShader, some browsers) `available` is false and every call
// is a no-op. The numbers answer one question of the user's feedback: is a steady 30 fps the GPU's speed or something else (a cap)?
//
// The class talks to a structural subset of the WebGL2 context, so a unit test drives it with a fake.

/** The part of a WebGL2 context the timer uses. */
export interface TimerGl {
  getExtension(name: string): unknown;
  getParameter(pname: number): unknown;
  createQuery(): unknown;
  deleteQuery(q: unknown): void;
  beginQuery(target: number, q: unknown): void;
  endQuery(target: number): void;
  getQueryParameter(q: unknown, pname: number): unknown;
}

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** WebGL2 constants (not on the structural type above). */
const QUERY_RESULT_AVAILABLE = 0x8867;
const QUERY_RESULT = 0x8866;
/** Queries in flight at most; a frame that finds the pool full skips its measurement. */
const POOL = 6;

export class GpuTimer {
  private readonly ext: TimerExt | null;
  private readonly pending: unknown[] = [];
  private active: unknown = null;
  private readonly finished: number[] = [];

  constructor(private readonly gl: TimerGl) {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    this.ext = ext !== null && typeof ext === 'object' ? ext : null;
  }

  get available(): boolean {
    return this.ext !== null;
  }

  /** Starts timing the commands that follow; ignored without the extension, with a query still open, or with a full pool. */
  begin(): void {
    const ext = this.ext;
    if (ext === null || this.active !== null || this.pending.length >= POOL) return;
    const q = this.gl.createQuery();
    if (q === null || q === undefined) return;
    this.gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  /** Ends the open query (if any). */
  end(): void {
    const ext = this.ext;
    if (ext === null || this.active === null) return;
    this.gl.endQuery(ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Collects the queries that have finished (call once per frame); a disjoint event (the GPU was reset or throttled) drops them. */
  poll(): void {
    const ext = this.ext;
    if (ext === null) return;
    const disjoint = this.gl.getParameter(ext.GPU_DISJOINT_EXT) === true;
    while (this.pending.length > 0) {
      const q = this.pending[0];
      if (!disjoint && this.gl.getQueryParameter(q, QUERY_RESULT_AVAILABLE) !== true) break;
      this.pending.shift();
      if (!disjoint) {
        const ns = Number(this.gl.getQueryParameter(q, QUERY_RESULT));
        if (Number.isFinite(ns) && ns >= 0) this.finished.push(ns / 1e6);
      }
      this.gl.deleteQuery(q);
    }
  }

  /** The oldest finished measurement in milliseconds, or null when none is ready. Call until null. */
  take(): number | null {
    return this.finished.length > 0 ? (this.finished.shift() as number) : null;
  }

  dispose(): void {
    if (this.active !== null && this.ext !== null) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.active = null;
    for (const q of this.pending) this.gl.deleteQuery(q);
    this.pending.length = 0;
    this.finished.length = 0;
  }
}
