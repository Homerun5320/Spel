// The `?perf=1` overlay (Artifact: `#perf`): renderer string, fps (mean and p95), renderer.info counters, texture memory
// and the button "Kopiera rapport". The numbers are pushed in by the frame driver; this module reads no clock.
import { DEV_PANEL_EVENT, rectsOverlap, type DevPanelEventDetail } from './events';
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
  /** The match numbers (M05), when a match runs: the report gets a `match` section. Additive; the schema version stays 1. */
  match?: () => MatchPerf | null;
}

/** What the match adds to the perf report: the cost of the simulation per frame and the ownership uploads. */
export interface MatchPerf {
  tick: number;
  speed: number;
  /** Cost in ms of `host.advance` on the frames that ran ticks (the sim stepping, measured in the browser). */
  hostAdvanceMs: { mean: number; p95: number; max: number; frames: number };
  ownershipUploads: number;
  ownershipGpuUploads: number;
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
  match?: MatchPerf;
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
    ...matchSection(ctx),
  };
}

function matchSection(ctx: PerfContext): { match?: MatchPerf } {
  const m = ctx.match?.() ?? null;
  if (m === null) return {};
  return { match: { ...m, hostAdvanceMs: { mean: round(m.hostAdvanceMs.mean, 3), p95: round(m.hostAdvanceMs.p95, 3), max: round(m.hostAdvanceMs.max, 3), frames: m.hostAdvanceMs.frames } } };
}

export function perfLines(r: PerfReport): string[] {
  const fps = r.fps.frames > 0 ? `${r.fps.mean.toFixed(1)} medel, ${r.fps.p95.toFixed(1)} p95 (${r.fps.p95FrameMs.toFixed(1)} ms)` : 'ingen ram än (testläge: ingen rAF-loop)';
  const match = r.match
    ? [`match: tick ${r.match.tick}, fart ${r.match.speed}x, sim-steg per bildruta ${r.match.hostAdvanceMs.mean.toFixed(2)} ms medel / ${r.match.hostAdvanceMs.p95.toFixed(2)} p95 / ${r.match.hostAdvanceMs.max.toFixed(2)} max, ägarkarta ${r.match.ownershipUploads} uppladdn.`]
    : [];
  return [
    `Renderer: ${r.renderer}`,
    `GL: ${r.glVersion}`,
    `fps: ${fps}`,
    `anrop ${r.renderInfo.calls}  trianglar ${r.renderInfo.triangles}  geometrier ${r.renderInfo.geometries}  texturer ${r.renderInfo.textures}`,
    `texturminne ${r.textureMB.toFixed(1)} MB  nivå ${r.tier}  ${r.viewport.width}x${r.viewport.height} @${r.viewport.dpr}x`,
    ...match,
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
    // Top left, at most 520 px wide, and narrow enough to leave a 16 px gap to the 48 px Dev button in the top right corner
    // (8 + 48 + 8 + 16 = 80). On a desktop the open Dev panel (300 px at the right) then stays clear of it; on a phone the panel
    // would cover it, so the overlay steps aside while the panel is open (DEV_PANEL_EVENT).
    'position:absolute;left:8px;top:8px;z-index:20;box-sizing:border-box;max-width:min(calc(100vw - 80px),520px);padding:6px 8px;border-radius:4px;background:rgba(0,0,0,0.72);' +
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
  // The open Dev panel covers this overlay on a phone: step aside (hidden) while the panel would overlap it, show it again after.
  const onDevPanel = (e: Event): void => {
    const d = (e as CustomEvent<DevPanelEventDetail>).detail;
    box.hidden = false; // measure it visible
    if (d?.open && d.rect) box.hidden = rectsOverlap(box.getBoundingClientRect(), d.rect);
  };
  window.addEventListener(DEV_PANEL_EVENT, onDevPanel);
  const update = (): void => {
    pre.textContent = perfLines(buildPerfReport(ctx)).join('\n');
  };
  update();
  return {
    element: box,
    update,
    dispose: () => {
      window.removeEventListener(DEV_PANEL_EVENT, onDevPanel);
      box.remove();
    },
  };
}
