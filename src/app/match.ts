// The match session: the simulation (a MainThreadHost behind the SimHost interface), the page's read-only mirror of it and the
// small amount of game-flow state the UI needs (speed, pause, commitment). The UI talks to the sim ONLY through intents
// (`submit`); it reads ONLY through `view` (a ViewMirror, which implements SimView). Nothing here touches three or the DOM.
import type { MainThreadHost } from '../host/mainThreadHost';
import type { Speed } from '../host/protocol';
import { ViewMirror } from '../host/viewMirror';
import type { IntentBody } from '../sim/intents';
import { MATCH_AI_NATIONS, MATCH_TRIBES, TICK_MS } from '../sim/rules';
import { seatToOwner } from '../sim/state';
import { scheduledTurn } from '../sim/time';
import { createSimWorld, createWorldState, type SimWorldInput } from '../sim/world';
import type { SeatLabels } from '../ui/seatLabels';
import type { WinConfig } from '../sim/public';
import { defaultWinConfig, type BuiltMatch } from './matchSetup';
import { COMMIT_DEFAULT_PCT, COMMIT_MAX_PCT, COMMIT_MIN_PCT, COMMIT_STEP_PCT, SPEED_STEPS } from '../ui/uiConfig';
import { StatInterpolator } from '../ui/hudValues';

/** You are seat 0; seats 1..MATCH_AI_NATIONS are the AI nations, the seats after them the tribes. */
export const LOCAL_SEAT = 0;
export const MATCH_PLAYERS = 1 + MATCH_AI_NATIONS;
export const MATCH_SEATS = MATCH_PLAYERS + MATCH_TRIBES;

export interface MatchOptions {
  readonly seed: number;
  /** Allows the test-only intents (DebugPaint, DebugGive): only `?test=1` sets it. */
  readonly debugIntents?: boolean;
  /** Smooth the HUD numbers between ticks (the live page). Test mode turns it off so the HUD shows exactly the sim's values. */
  readonly interpolate?: boolean;
  /** The AI nations and the tribes act (default true). `?ai=0` / `#ai-0` turns them off: the 25 other seats stay empty, as in the first M05 parts' tests. */
  readonly ai?: boolean;
  /** M18-2: the win conditions of the match (the live page passes the defaults; `?test=1` passes none, so the tests' matches never end). */
  readonly win?: WinConfig | undefined;
}

/** The win block of the plain Play match: the defaults of the world outside test mode, none in test mode (so the tests' matches never end). */
export function winForPlay(test: boolean): WinConfig | undefined {
  return test ? undefined : defaultWinConfig('world');
}

/** The options of a match built by the setup screen (`createMatch`): the state is already placed, so only the live-page switches remain. */
export interface BuiltMatchOptions {
  readonly interpolate?: boolean;
  /** The AI nations and the tribes act (default true). */
  readonly ai?: boolean;
}

/**
 * Bundle-diet-1 (step 3): the sim host, the AI driver and `src/ai` are separate chunks that load when a match is started (Play / Start), not with the
 * page. Both factories below are async already, so no caller changes; the sim modules the page also uses stay in one shared chunk.
 */
async function loadHost(): Promise<{ MainThreadHost: typeof import('../host/mainThreadHost').MainThreadHost; AiDriver: typeof import('../host/aiDriver').AiDriver }> {
  const [{ MainThreadHost }, { AiDriver }] = await Promise.all([import('../host/mainThreadHost'), import('../host/aiDriver')]);
  return { MainThreadHost, AiDriver };
}

export class MatchSession {
  /** Your seat (seat 0 in the standard match; the human seat of a match built by the setup screen). */
  readonly localSeat: number;
  readonly localOwner: number;
  /** Names and flags of the seats when the match came from the setup screen (null in the standard match: the HUD uses its numbered names). */
  readonly labels: SeatLabels | null;
  /** The match built by the setup screen, or null for the standard match. */
  readonly built: BuiltMatch | null;
  /** The speed the player chose; `paused` stops the host without forgetting it. */
  private chosenSpeed: 1 | 2 | 4 = 1;
  private paused = false;
  commitPct = COMMIT_DEFAULT_PCT;
  /** Previous and current statistics of every seat, for smooth HUD numbers. */
  readonly stats: StatInterpolator;
  /** Real milliseconds since the last frame that ran ticks (the fraction of the current tick for the interpolation). */
  sinceTickMs = 0;
  /** Key of the last refusal the UI showed (tick and reason), so that each is reported once. */
  private lastReject = 0;
  /** The ticks at which our own intents run; a refusal is only reported when it happened at one of them (the view does not say whose intent it was). */
  private expected: number[] = [];
  /** Cost in ms of the last host.advance call (the browser measures it; logged in the perf report). */
  lastAdvanceMs = 0;
  private readonly stopMirror: () => void;
  private readonly stopFrames: () => void;

  private constructor(
    private readonly host: MainThreadHost,
    readonly view: ViewMirror,
    stop: () => void,
    private readonly interpolate: boolean,
    built: BuiltMatch | null = null,
  ) {
    this.built = built;
    this.localSeat = built === null ? LOCAL_SEAT : built.humanSeat;
    this.localOwner = seatToOwner(this.localSeat);
    this.labels = built === null ? null : built.labels;
    this.stopMirror = stop;
    this.stats = new StatInterpolator(view.seats);
    this.stats.push(view.packedStats);
    this.stopFrames = view.onFrame((m) => {
      this.stats.push(m.packedStats);
      this.sinceTickMs = 0;
    });
  }

  /** Builds the world state for the standard match (you + 5 AI nations + 20 tribes) and starts the host, paused at speed 1x. */
  static async create(world: SimWorldInput, options: MatchOptions): Promise<MatchSession> {
    const simWorld = createSimWorld(world);
    const state = createWorldState(simWorld, {
      seed: options.seed,
      seats: MATCH_SEATS,
      players: MATCH_PLAYERS,
      config: { debugIntents: options.debugIntents === true, spawnPhase: true, ...(options.win === undefined ? {} : { win: options.win }) },
    });
    const { MainThreadHost, AiDriver } = await loadHost();
    const driver = options.ai === false ? undefined : new AiDriver(options.seed);
    const host = new MainThreadHost(state, { speed: 1, driver });
    const { mirror, stop } = await ViewMirror.attach(host);
    return new MatchSession(host, mirror, stop, options.interpolate !== false);
  }

  /**
   * Starts a match that `createMatch` built (the setup screen's path, M06): the state at tick 0 already holds every nation and tribe on a
   * whole start disc, so nothing is spawned here. The AI plays every seat but the human one, with its own stream per seat (the config's seed).
   */
  static async fromMatch(match: BuiltMatch, options: BuiltMatchOptions = {}): Promise<MatchSession> {
    const { MainThreadHost, AiDriver } = await loadHost();
    const driver = options.ai === false ? undefined : new AiDriver(match.config.seed, { humanSeats: [match.humanSeat] });
    const host = new MainThreadHost(match.state, { speed: 1, driver });
    const { mirror, stop } = await ViewMirror.attach(host);
    return new MatchSession(host, mirror, stop, options.interpolate !== false, match);
  }

  get speed(): Speed {
    return this.paused ? 0 : this.chosenSpeed;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Advances real time by `dtMs`: the host runs the ticks that are due (none while paused). */
  frame(dtMs: number): void {
    this.sinceTickMs += dtMs;
    this.host.advance(dtMs);
  }

  /** Runs exactly `n` ticks regardless of the clock and the speed (the test hook `advance`). */
  runTicks(n: number): void {
    if (n > 0) this.host.runTicks(n);
  }

  /** Fraction (0..1) of the current tick that has elapsed in real time, for HUD interpolation. */
  alpha(): number {
    const sp = this.speed;
    if (sp === 0 || !this.interpolate) return 1;
    return Math.min(1, (this.sinceTickMs * sp) / TICK_MS);
  }

  /** Sends an intent of the local player to the host (scheduled for T + 2). The only way the UI changes the game. */
  submit(body: IntentBody): void {
    this.expected.push(scheduledTurn(this.host.tick));
    this.host.submitIntent(body);
  }

  spawnAt(cell: number): void {
    this.submit({ kind: 'Spawn', seat: this.localSeat, cell });
  }

  /** Attacks the land of `target` (an ownerId, 0 = unowned) with the chosen share of the troops. */
  attack(target: number): void {
    this.submit({ kind: 'Attack', seat: this.localSeat, target, pct: this.commitPct });
  }

  setCommit(pct: number): void {
    const snapped = Math.round(pct / COMMIT_STEP_PCT) * COMMIT_STEP_PCT;
    this.commitPct = Math.max(COMMIT_MIN_PCT, Math.min(COMMIT_MAX_PCT, snapped));
  }

  adjustCommit(steps: number): void {
    this.setCommit(this.commitPct + steps * COMMIT_STEP_PCT);
  }

  private apply(): void {
    this.host.setSpeed(this.speed);
  }

  setSpeed(speed: 1 | 2 | 4): void {
    this.chosenSpeed = speed;
    this.apply();
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.apply();
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.apply();
  }

  /** One step along 1x - 2x - 4x (stays at the end). */
  slower(): void {
    const i = SPEED_STEPS.indexOf(this.chosenSpeed);
    this.setSpeed(SPEED_STEPS[Math.max(0, i - 1)] as 1 | 2 | 4);
  }

  faster(): void {
    const i = SPEED_STEPS.indexOf(this.chosenSpeed);
    this.setSpeed(SPEED_STEPS[Math.min(SPEED_STEPS.length - 1, i + 1)] as 1 | 2 | 4);
  }

  /** The refusal the UI has not shown yet (REJECT_* code), or 0. */
  takeNewReject(): number {
    const v = this.view;
    if (this.expected.length > 0 && (this.expected[0] as number) < v.tick - 2) this.expected = this.expected.filter((t) => t >= v.tick - 2);
    if (v.lastRejectReason === 0 || v.lastRejectTick < 0) return 0;
    const key = v.lastRejectTick * 64 + v.lastRejectReason;
    if (key === this.lastReject) return 0;
    this.lastReject = key;
    return this.expected.includes(v.lastRejectTick) ? v.lastRejectReason : 0;
  }

  /** The state hash of the sim (asks the host for a snapshot; test hook). */
  async hash(): Promise<number> {
    const snap = await this.host.requestSnapshot();
    return snap.hash;
  }

  dispose(): void {
    this.stopFrames();
    this.stopMirror();
    this.host.dispose();
  }
}
