// The `?perf=1` overlay (Artifact: `#perf`): renderer string, fps (mean and p95), renderer.info counters, texture memory
// and the button "Kopiera rapport". The numbers are pushed in by the frame driver; this module reads no clock.
import type { FrameStats } from './frameStats';
import { showReport } from './report';

/** Version of the perf JSON. M08 and M24a extend it (new fields, version bump), they never add a second button. */
export const PERF_SCHEMA_VERSION = 1;

export interface PerfSnapshot {
  renderer: string;
  vendor: string;
  glVersion: string;
  webgl2: boolean;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  textureMB: number;
  width: number;
  height: number;
  dpr: number;
  tier: string;
}

export interface PerfContext {
  snapshot(): PerfSnapshot;
  stats: FrameStats;
  /** Mode flags worth putting into the report (test, quality, scene...). */
  mode: Record<string, string>;
}

export interface PerfReport {
  schemaVersion: number;
  kind: 'perf';
  renderer: string;
  vendor: string;
  glVersion: string;
  webgl2: boolean;
  tier: string;
  viewport: { width: number; height: number; dpr: number };
  fps: { mean: number; p95: number; p95FrameMs: number; frames: number; windowFrames: number };
  renderInfo: { calls: number; triangles: number; geometries: number; textures: number };
  textureMB: number;
  mode: Record<string, string>;
  userAgent: string;
}

const round = (x: number, d = 2): number => Math.round(x * 10 ** d) / 10 ** d;

export function buildPerfReport(ctx: PerfContext): PerfReport {
  const s = ctx.snapshot();
  const st = ctx.stats;
  return {
    schemaVersion: PERF_SCHEMA_VERSION,
    kind: 'perf',
    renderer: s.renderer,
    vendor: s.vendor,
    glVersion: s.glVersion,
    webgl2: s.webgl2,
    tier: s.tier,
    viewport: { width: s.width, height: s.height, dpr: s.dpr },
    fps: { mean: round(st.meanFps()), p95: round(st.p95Fps()), p95FrameMs: round(st.p95Ms()), frames: st.frames, windowFrames: Math.min(st.frames, st.capacity) },
    renderInfo: { calls: s.drawCalls, triangles: s.triangles, geometries: s.geometries, textures: s.textures },
    textureMB: round(s.textureMB),
    mode: ctx.mode,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
  };
}

export function perfLines(r: PerfReport): string[] {
  const fps = r.fps.frames > 0 ? `${r.fps.mean.toFixed(1)} medel, ${r.fps.p95.toFixed(1)} p95 (${r.fps.p95FrameMs.toFixed(1)} ms)` : 'ingen ram än (testläge: ingen rAF-loop)';
  return [
    `Renderer: ${r.renderer}`,
    `GL: ${r.glVersion}`,
    `fps: ${fps}`,
    `anrop ${r.renderInfo.calls}  trianglar ${r.renderInfo.triangles}  geometrier ${r.renderInfo.geometries}  texturer ${r.renderInfo.textures}`,
    `texturminne ${r.textureMB.toFixed(1)} MB  nivå ${r.tier}  ${r.viewport.width}x${r.viewport.height} @${r.viewport.dpr}x`,
  ];
}

export interface PerfOverlay {
  element: HTMLElement;
  /** Re-reads the numbers (call a few times per second, not every frame). */
  update(): void;
  dispose(): void;
}

export function createPerfOverlay(parent: HTMLElement, ctx: PerfContext): PerfOverlay {
  const box = document.createElement('div');
  box.dataset.perf = '1';
  box.style.cssText =
    'position:absolute;left:8px;top:8px;z-index:20;max-width:calc(100vw - 80px);padding:6px 8px;border-radius:4px;background:rgba(0,0,0,0.72);' +
    'color:#cfe;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;';
  const pre = document.createElement('pre');
  pre.style.cssText = 'margin:0 0 6px 0;white-space:pre-wrap;word-break:break-word;font:inherit;';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Kopiera rapport';
  button.dataset.perfCopy = '1';
  button.style.cssText = 'padding:10px 14px;border-radius:6px;border:1px solid #3a5a9a;background:#16294a;color:#e8f0ff;font:13px system-ui,sans-serif;cursor:pointer;';
  // The clipboard call happens inside showReport, synchronously within this click handler.
  button.addEventListener('click', () => {
    showReport(buildPerfReport(ctx), { title: 'Prestandarapport', filename: 'perf-rapport.json' });
  });
  box.append(pre, button);
  parent.appendChild(box);
  const update = (): void => {
    pre.textContent = perfLines(buildPerfReport(ctx)).join('\n');
  };
  update();
  return { element: box, update, dispose: () => box.remove() };
}
