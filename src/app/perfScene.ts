// The performance scene (M08, `?scene=perf`, Artifact `#scene-perf`, Dev panel "Prestandascen"): a scripted flight over the Himalaya that
// the user runs on a real GPU and whose report they send back: orbit -> continent -> valley -> 300 m above the ground -> a short cruise at
// 300 m. The script is a state machine over the camera flights of `src/render/flyTo.ts` (all time is the fx clock, so a frozen clock freezes
// the scene and a test steps it); the numbers go into the `PerfRecorder` (`src/ui/perfSceneReport.ts`).
//
// This file has no DOM and no GL: the page hands it a `PerfSceneHost` (the globe's flight, counters and canvas facts). The live loop calls
//   probeFrame(ms)    for the first frames, with NOTHING drawn, to measure the display's refresh interval,
//   beforeFrame()     once per frame after the fx clock moved and before the draw (advances the script),
//   afterFrame(a, b)  once per frame after the draw with the frame interval and the JavaScript time of the frame.
// Test mode runs the shortened script (`quick`) with fixed fx steps and no probe.
import type { ViewState } from '../render/camera';
import type { FlyOptions } from '../render/flyTo';
import { PerfRecorder, type PerfSceneSection, type SectionMeta } from '../ui/perfSceneReport';

/** The phases of the script in order; the report names its frames by them. */
export const PERF_PHASE_NAMES = ['orbit', 'continent', 'valley', 'ground', 'cruise'] as const;

/** The Himalaya, where the relief is the tallest: the whole script stays over it. */
export const PERF_PLACE = { lat: 28.0, lon: 86.9 } as const;
/** The valley and the 300 m views look at the M07a valley view's place. */
export const PERF_VALLEY = { lat: 28.2, lon: 86.8 } as const;
/** The cruise at the end moves the camera this far north (degrees of latitude, 0.12 degrees = 13 km) at 300 m. */
export const PERF_CRUISE_DLAT = 0.12;
export const PERF_ORBIT_KM = 21_500;
export const PERF_CONTINENT_KM = 3_500;
export const PERF_VALLEY_AGL_M = 3_000;
export const PERF_GROUND_AGL_M = 300;
/** Seconds the camera rests at the end of each phase (live script). */
export const PERF_HOLD_S = { orbit: 3, continent: 2, valley: 3, ground: 3, cruise: 1 } as const;
/** The continent flight (classic, orbit to 3 500 km) takes this long in the live script; the ground flights take what `planGroundFlight` says. */
export const PERF_CONTINENT_FLIGHT_S = 4;
/** The shortened script of test mode: every flight lasts this long and every rest is `PERF_QUICK_HOLD_S`. */
export const PERF_QUICK_FLIGHT_S = 1;
export const PERF_QUICK_HOLD_S = 0.2;
/** Empty animation-frame callbacks measured for the refresh interval, after skipping the first few. */
export const PERF_PROBE_SKIP = 10;
export const PERF_PROBE_FRAMES = 60;

export interface PerfCounters {
  calls: number;
  triangles: number;
  chunks: number;
}

/** What the script needs from the page. */
export interface PerfSceneHost {
  setView(v: ViewState): void;
  flyTo(lat: number, lon: number, distKm: number, options?: FlyOptions): void;
  flightActive(): boolean;
  /** The camera's height over the displaced ground, metres. */
  cameraAglM(): number;
  /** The renderer's counters of the frame drawn last. */
  counters(): PerfCounters;
  canvas(): PerfSceneSection['canvas'];
  /** The next finished GPU time measurement in ms, or null (no timer or none ready). */
  gpuMs(): number | null;
  gpuAvailable(): boolean;
}

interface Step {
  name: (typeof PERF_PHASE_NAMES)[number];
  /** Starts the phase; returns true when it started a flight to wait for. */
  start(host: PerfSceneHost, quick: boolean): boolean;
  holdS: number;
}

const flightS = (quick: boolean, live: number | undefined): number | undefined => (quick ? PERF_QUICK_FLIGHT_S : live);

const STEPS: readonly Step[] = [
  {
    name: 'orbit',
    start: (h) => {
      h.setView({ lat: PERF_PLACE.lat, lon: PERF_PLACE.lon, distKm: PERF_ORBIT_KM, heading: 0, tilt: 0 });
      return false;
    },
    holdS: PERF_HOLD_S.orbit,
  },
  {
    name: 'continent',
    start: (h, q) => {
      h.flyTo(PERF_PLACE.lat, PERF_PLACE.lon, PERF_CONTINENT_KM, { tilt: 50, heading: 20, durationS: flightS(q, PERF_CONTINENT_FLIGHT_S) as number });
      return true;
    },
    holdS: PERF_HOLD_S.continent,
  },
  {
    name: 'valley',
    start: (h, q) => {
      const d = flightS(q, undefined);
      h.flyTo(PERF_VALLEY.lat, PERF_VALLEY.lon, 0, { altAglM: PERF_VALLEY_AGL_M, tilt: 78, heading: 0, ...(d === undefined ? {} : { durationS: d }) });
      return true;
    },
    holdS: PERF_HOLD_S.valley,
  },
  {
    name: 'ground',
    start: (h, q) => {
      const d = flightS(q, undefined);
      h.flyTo(PERF_VALLEY.lat, PERF_VALLEY.lon, 0, { altAglM: PERF_GROUND_AGL_M, tilt: 75, heading: 0, ...(d === undefined ? {} : { durationS: d }) });
      return true;
    },
    holdS: PERF_HOLD_S.ground,
  },
  {
    name: 'cruise',
    start: (h, q) => {
      const d = flightS(q, undefined);
      h.flyTo(PERF_VALLEY.lat + PERF_CRUISE_DLAT, PERF_VALLEY.lon, 0, { altAglM: PERF_GROUND_AGL_M, tilt: 75, heading: 0, ...(d === undefined ? {} : { durationS: d }) });
      return true;
    },
    holdS: PERF_HOLD_S.cruise,
  },
];

export interface PerfRunOptions {
  /** The shortened script of test mode: short flights and rests, no refresh probe. */
  quick: boolean;
  /** The fx clock (`fxNow`). */
  now: () => number;
}

export class PerfSceneRun {
  readonly recorder = new PerfRecorder();
  private readonly quick: boolean;
  private readonly now: () => number;
  private probeSeen = 0;
  private idx = -1;
  private flying = false;
  private holdFrom = 0;
  private holding = false;
  private t0 = 0;
  private tEnd = 0;
  private finished = false;

  constructor(
    private readonly host: PerfSceneHost,
    opts: PerfRunOptions,
  ) {
    this.quick = opts.quick;
    this.now = opts.now;
    this.probeSeen = opts.quick ? PERF_PROBE_SKIP + PERF_PROBE_FRAMES : 0;
  }

  /** True while the display's refresh interval is being measured (nothing is drawn then); never in quick mode. */
  get probing(): boolean {
    return this.probeSeen < PERF_PROBE_SKIP + PERF_PROBE_FRAMES;
  }

  /** Probe progress 0..1. */
  get probeProgress(): number {
    return Math.min(1, this.probeSeen / (PERF_PROBE_SKIP + PERF_PROBE_FRAMES));
  }

  get done(): boolean {
    return this.finished;
  }

  /** Index of the phase under way (-1 before the first frame). */
  get phaseIndex(): number {
    return this.idx;
  }

  /** One empty frame interval (ms) of the refresh probe. */
  probeFrame(intervalMs: number): void {
    if (!this.probing) return;
    this.probeSeen++;
    if (this.probeSeen > PERF_PROBE_SKIP) this.recorder.probe(intervalMs);
  }

  /** Advances the script. Call once per frame, after the fx clock moved and before the draw. */
  beforeFrame(): void {
    if (this.finished || this.probing) return;
    if (this.idx < 0) {
      this.t0 = this.now();
      this.begin(0);
      return;
    }
    if (this.flying && !this.host.flightActive()) {
      this.flying = false;
      this.holding = true;
      this.holdFrom = this.now();
    }
    if (this.holding && this.now() - this.holdFrom >= (this.quick ? PERF_QUICK_HOLD_S : (STEPS[this.idx] as Step).holdS)) {
      this.holding = false;
      if (this.idx + 1 >= STEPS.length) {
        this.finished = true;
        this.tEnd = this.now();
      } else this.begin(this.idx + 1);
    }
  }

  private begin(i: number): void {
    this.idx = i;
    const step = STEPS[i] as Step;
    this.flying = step.start(this.host, this.quick);
    this.holding = !this.flying;
    this.holdFrom = this.now();
  }

  /** Records the frame that was just drawn. Call once per frame after the draw. */
  afterFrame(intervalMs: number, cpuMs: number): void {
    if (this.finished || this.probing || this.idx < 0) return;
    const c = this.host.counters();
    this.recorder.frame(intervalMs, cpuMs, c.calls, c.triangles, c.chunks, this.host.cameraAglM(), this.idx);
    for (let g = this.host.gpuMs(); g !== null; g = this.host.gpuMs()) this.recorder.gpuSample(g);
  }

  /** The report section of what ran so far (a copy made before the end says `completed: false`). */
  section(): PerfSceneSection {
    const meta: SectionMeta = {
      completed: this.finished,
      quick: this.quick,
      fxDurationS: this.idx < 0 ? 0 : (this.finished ? this.tEnd : this.now()) - this.t0,
      canvas: this.host.canvas(),
      phaseNames: PERF_PHASE_NAMES,
    };
    return this.recorder.section(meta, this.host.gpuAvailable());
  }

  /** The line the overlay shows above the numbers (Swedish, developer tool). */
  line(): string {
    if (this.probing) return `Prestandascen: mäter skärmens bildfrekvens (${Math.round(this.probeProgress * 100)} %). Rör inte musen.`;
    if (this.finished) return 'Prestandascen: KLAR. Tryck "Kopiera rapport" och klistra in svaret i chatten.';
    const name = PERF_PHASE_NAMES[Math.max(0, this.idx)];
    return `Prestandascen: fas ${Math.max(0, this.idx) + 1} av ${STEPS.length} (${name}), ${this.recorder.frames} ramar. Rör inte musen.`;
  }
}
