// The nation labels (M20a-2): a pool of at most LABELS.max DOM elements over the globe, one per living nation whose land is big enough to see, showing its name, its troops, the
// relation badges to the local player (V / A / E of the diplomacy) and its colour. The page asks `update` every frame; what it does:
//  - the DATA (centroids, names, troop text, badges, box widths) is refreshed at most every LABELS.dataIntervalS fx seconds (and at once when forced or the language changed);
//  - the PLACEMENT follows the camera: a frame in which neither the camera pose nor the data moved returns at once (no projection, no DOM, no allocation);
//  - the layout (`LabelLayout`) takes the biggest nations first, the local player's nation before all, moves a box inside the window and drops one that would overlap;
//  - the DOM is written only when a value changed (text, width, colour, visibility, the integer pixel of the transform); the placement uses `transform` alone, and the box sizes are
//    fixed numbers (LABELS), so nothing is ever measured (no layout read per frame).
// The labels are hidden when the whole globe is in view, fade in with the zoom and grow from a small size to the full one (see LABELS in uiConfig.ts).
import { NationCentroids } from '../app/nationCentroids';
import type { SimView } from '../sim/public';
import { BADGE_ALLIANCE, BADGE_EMBARGO, BADGE_TRUCE, relationBadges } from './diploModel';
import { formatFixed, getLanguage, t } from './i18n';
import { LabelLayout } from './labelLayout';
import { LABELS } from './uiConfig';

/** The screen position of a point on the globe (what `Globe.project` answers). */
export interface LabelHit {
  x: number;
  y: number;
  inView: boolean;
  facing: boolean;
}

/** What the labels read from the match (the page fills it). */
export interface LabelSource {
  readonly view: SimView;
  readonly localSeat: number;
  nameOf(seat: number): string;
  colorOf(seat: number): string;
}

/** What the labels read from the camera. `poseKey` changes whenever the picture moves (any camera value, the window size). */
export interface LabelCamera {
  project(lat: number, lon: number): LabelHit;
  /** Camera altitude over the sea-level sphere in Earth radii. */
  readonly altR: number;
  readonly viewW: number;
  readonly viewH: number;
  readonly poseKey: number;
  /** The projection scale: pixels per kilometre on the ground at the camera's distance (for the apparent size of a nation). */
  readonly pxPerKm: number;
}

/** A shown label as the tests see it (the box in window pixels). */
export interface LabelInfo {
  seat: number;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t01 = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t01 * t01 * (3 - 2 * t01);
};

/** The opacity of the whole label layer at a camera altitude: 0 from LABELS.hideAltR up, 1 from LABELS.fadeFullAltR down. */
export function labelOpacity(altR: number): number {
  return 1 - smooth(LABELS.fadeFullAltR, LABELS.hideAltR, altR);
}

/** The scale of a label at a camera altitude: LABELS.smallScale from scaleFromAltR up, 1 from scaleFullAltR down. */
export function labelScale(altR: number): number {
  return 1 - (1 - LABELS.smallScale) * smooth(LABELS.scaleFullAltR, LABELS.scaleFromAltR, altR);
}

/** Troops for a label: whole numbers below 1 000, then 1,2k / 12k / 1,2M (cut, not rounded; the decimal sign follows the language). */
export function compactTroops(n: number): string {
  const v = Math.max(0, Math.floor(n));
  if (v < 1000) return String(v);
  if (v < 10000) return `${formatFixed(Math.floor(v / 100) / 10, 1)}k`;
  if (v < 1000000) return `${Math.floor(v / 1000)}k`;
  if (v < 10000000) return `${formatFixed(Math.floor(v / 100000) / 10, 1)}M`;
  return `${Math.floor(v / 1000000)}M`;
}

/** The width of a box that holds `chars` characters. */
export function labelWidth(chars: number): number {
  return Math.min(LABELS.maxWidthPx, Math.max(LABELS.minWidthPx, Math.ceil(chars * LABELS.charPx + 2 * LABELS.padPx)));
}

/** The style sheet of the labels (one <style> per root, tokens from LABELS). No transitions: CSS time is not the fx clock. */
export function labelCss(): string {
  return `
.nl-root { position: absolute; inset: 0; z-index: ${LABELS.z}; pointer-events: none; overflow: hidden; user-select: none; -webkit-user-select: none; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: ${LABELS.fontPx}px; line-height: 1.25; }
.nl-root[hidden], .nl[hidden] { display: none !important; }
.nl { position: absolute; left: 0; top: 0; height: ${LABELS.heightPx}px; box-sizing: border-box; padding: 2px ${LABELS.padPx}px 2px ${LABELS.padPx - 2}px; border-left: 3px solid #888; border-radius: 4px; background: ${LABELS.bg}; color: ${LABELS.text}; transform-origin: 0 0; overflow: hidden; white-space: nowrap; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7); }
.nl-name { display: block; font-weight: 700; overflow: hidden; text-overflow: ellipsis; }
.nl-sub { display: block; color: ${LABELS.dim}; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; }
.nl-rel { color: ${LABELS.badge}; font-weight: 800; margin-left: 0.4em; }
`;
}

interface Slot {
  readonly el: HTMLElement;
  readonly name: HTMLElement;
  readonly troops: HTMLElement;
  readonly rel: HTMLElement;
  seat: number;
  shownName: string;
  shownTroops: string;
  shownRel: string;
  shownColor: string;
  shownW: number;
  shownX: number;
  shownY: number;
  shownScale: number;
  visible: boolean;
}

export class NationLabels {
  readonly root: HTMLElement;
  /** Where the HUD panels live: their boxes are kept clear (read at the data refresh, never per frame). */
  private readonly avoidRoot: HTMLElement;
  private readonly style: HTMLStyleElement;
  private readonly slots: Slot[] = [];
  private readonly layout = new LabelLayout(64);
  private centroids: NationCentroids | null = null;
  private enabled = true;
  private shownOpacity = -1;
  private lastData = -Infinity;
  private lastOwnerVersion = -1;
  private lastPoseKey = Number.NaN;
  private lastLang = '';
  private dirty = true;
  // per seat (grown on the first update)
  private seatAlive = new Uint8Array(0);
  private seatName: string[] = [];
  private seatTroops: string[] = [];
  private seatRel: string[] = [];
  private seatW = new Float32Array(0);
  private seatCells = new Float64Array(0);
  private seatLat = new Float32Array(0);
  private seatLon = new Float32Array(0);
  private seatSizeKm = new Float32Array(0);
  private slotOfSeat = new Int16Array(0);
  /** Labels shown after the last update, for tests. */
  shownCount = 0;
  /** DOM writes made so far (a test checks that a still picture makes none). */
  writes = 0;

  constructor(parent: HTMLElement) {
    this.avoidRoot = parent;
    this.style = document.createElement('style');
    this.style.dataset.nlStyle = '1';
    this.style.textContent = labelCss();
    this.root = document.createElement('div');
    this.root.className = 'nl-root';
    this.root.dataset.testid = 'nation-labels';
    this.root.append(this.style);
    parent.append(this.root);
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.dirty = true;
    if (!on) this.hideAll();
    this.root.hidden = !on;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Forces the next update to recompute the data and the placement (a new match, a language change). */
  invalidate(): void {
    this.dirty = true;
    this.lastData = -Infinity;
    this.lastOwnerVersion = -1;
  }

  /** Per frame. `force` recomputes everything now (test hooks). */
  update(src: LabelSource, cam: LabelCamera, now: number, force = false): void {
    if (!this.enabled) return;
    const opacity = Math.round(labelOpacity(cam.altR) * 20) / 20;
    if (opacity !== this.shownOpacity) {
      this.shownOpacity = opacity;
      this.root.style.opacity = String(opacity);
      this.root.hidden = opacity <= 0;
      this.writes++;
      this.dirty = true;
    }
    if (opacity <= 0) {
      this.hideAll();
      return;
    }
    const lang = getLanguage();
    const dataDue = force || lang !== this.lastLang || now - this.lastData >= LABELS.dataIntervalS || now < this.lastData;
    if (!force && !dataDue && !this.dirty && cam.poseKey === this.lastPoseKey) return;
    if (dataDue) this.refreshData(src, now, lang, force);
    this.lastPoseKey = cam.poseKey;
    this.dirty = false;
    this.place(src, cam);
  }

  private ensureSeats(players: number): void {
    if (this.seatAlive.length >= players) return;
    this.seatAlive = new Uint8Array(players);
    this.seatName = new Array<string>(players).fill('');
    this.seatTroops = new Array<string>(players).fill('');
    this.seatRel = new Array<string>(players).fill('');
    this.seatW = new Float32Array(players);
    this.seatCells = new Float64Array(players);
    this.seatLat = new Float32Array(players);
    this.seatLon = new Float32Array(players);
    this.seatSizeKm = new Float32Array(players);
    this.slotOfSeat = new Int16Array(players).fill(-1);
    for (const s of this.slots) s.seat = -1;
  }

  private refreshData(src: LabelSource, now: number, lang: string, force: boolean): void {
    const view = src.view;
    const players = view.players;
    this.ensureSeats(players);
    this.lastData = now;
    this.lastLang = lang;
    const w = view.width;
    const h = view.height;
    if (this.centroids === null || this.centroids.width !== w || this.centroids.height !== h || this.centroids.slots !== view.seats + 1) {
      this.centroids = new NationCentroids(view.seats + 1, w, h);
      this.lastOwnerVersion = -1;
    }
    const cen = this.centroids;
    if (force || view.ownerVersion !== this.lastOwnerVersion) {
      this.lastOwnerVersion = view.ownerVersion;
      cen.compute(view.owner);
    }
    const st = view.stats;
    // the ground size of one cell at the equator in km (the grid spans 360 degrees)
    const cellKm = 40075 / w;
    for (let seat = 0; seat < players; seat++) {
      const ownerId = seat + 1;
      const cells = cen.count[ownerId] as number;
      const alive = (st.alive[seat] as number) === 1 && cells > 0;
      this.seatAlive[seat] = alive ? 1 : 0;
      if (!alive) continue;
      const capital = (st.capital[seat] as number) - 1;
      const cell = cen.anchorCell(ownerId, view.owner, capital);
      const cx = cell % w;
      const cy = (cell - cx) / w;
      const lat = ((h - 2 * cy - 1) * 90) / h;
      this.seatLat[seat] = lat;
      this.seatLon[seat] = ((2 * cx + 1 - w) * 180) / w;
      this.seatCells[seat] = cells;
      // a nation of `cells` cells spans about sqrt(cells) cells; a cell is narrower east-west by cos(latitude)
      this.seatSizeKm[seat] = Math.sqrt(cells) * cellKm * Math.sqrt(Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
      const name = src.nameOf(seat);
      const troops = compactTroops((st.troopsQt[seat] as number) / 4);
      const bits = relationBadges(view, src.localSeat, seat);
      let rel = '';
      if ((bits & BADGE_ALLIANCE) !== 0) rel += t('diplo.badge.alliance');
      if ((bits & BADGE_TRUCE) !== 0) rel += (rel === '' ? '' : ' ') + t('diplo.badge.truce');
      if ((bits & BADGE_EMBARGO) !== 0) rel += (rel === '' ? '' : ' ') + t('diplo.badge.embargo');
      this.seatName[seat] = name;
      this.seatTroops[seat] = troops;
      this.seatRel[seat] = rel;
      this.seatW[seat] = labelWidth(Math.max(name.length * 1.06, troops.length + (rel === '' ? 0 : rel.length + 1)));
    }
    this.collectBlocked();
    this.dirty = true;
  }

  /** The HUD panels in window pixels (relative to the label root): the layout keeps the labels off them. Two layout reads a second at most. */
  private collectBlocked(): void {
    this.layout.clearBlocked();
    const origin = this.root.getBoundingClientRect();
    const panels = this.avoidRoot.querySelectorAll('.hud-panel');
    for (let i = 0; i < panels.length; i++) {
      const r = (panels[i] as HTMLElement).getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      this.layout.block(r.left - origin.left, r.top - origin.top, r.width, r.height);
    }
  }

  private place(src: LabelSource, cam: LabelCamera): void {
    const view = src.view;
    const players = view.players;
    const layout = this.layout;
    layout.clear();
    const scale = Math.round(labelScale(cam.altR) * 20) / 20;
    for (let seat = 0; seat < players; seat++) {
      if (this.seatAlive[seat] === 0) continue;
      if ((this.seatSizeKm[seat] as number) * cam.pxPerKm < LABELS.minNationPx) continue;
      const hit = cam.project(this.seatLat[seat] as number, this.seatLon[seat] as number);
      if (!hit.inView || !hit.facing) continue;
      const prio = (this.seatCells[seat] as number) + (seat === src.localSeat ? 1e12 : 0);
      layout.add(seat, hit.x, hit.y, (this.seatW[seat] as number) * scale, LABELS.heightPx * scale, prio);
    }
    const shown = layout.solve(cam.viewW, cam.viewH, LABELS.max, LABELS.gapPx, LABELS.edgePx);
    this.shownCount = shown;
    // release the slots of seats that are not shown now
    for (const s of this.slots) {
      if (s.seat < 0) continue;
      let keep = false;
      for (let q = 0; q < shown; q++) {
        if (layout.id[layout.placed[q] as number] === s.seat) {
          keep = true;
          break;
        }
      }
      if (!keep) this.release(s);
    }
    for (let q = 0; q < shown; q++) {
      const i = layout.placed[q] as number;
      const seat = layout.id[i] as number;
      const s = this.slotFor(seat);
      if (s === null) continue;
      const w = this.seatW[seat] as number;
      const left = Math.round((layout.x[i] as number) - (layout.w[i] as number) / 2);
      const top = Math.round((layout.y[i] as number) - (layout.h[i] as number) / 2);
      this.write(s, seat, this.seatName[seat] as string, this.seatTroops[seat] as string, this.seatRel[seat] as string, src.colorOf(seat), w, left, top, scale);
    }
  }

  private slotFor(seat: number): Slot | null {
    const have = this.slotOfSeat[seat] as number;
    if (have >= 0) return this.slots[have] as Slot;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i] as Slot;
      if (s.seat < 0) {
        s.seat = seat;
        this.slotOfSeat[seat] = i;
        return s;
      }
    }
    if (this.slots.length >= LABELS.max) return null;
    const el = document.createElement('div');
    el.className = 'nl';
    el.dataset.testid = 'nation-label';
    el.hidden = true;
    const name = document.createElement('span');
    name.className = 'nl-name';
    const sub = document.createElement('span');
    sub.className = 'nl-sub';
    const troops = document.createElement('span');
    troops.className = 'nl-troops';
    const rel = document.createElement('span');
    rel.className = 'nl-rel';
    sub.append(troops, rel);
    el.append(name, sub);
    this.root.append(el);
    const s: Slot = { el, name, troops, rel, seat, shownName: '', shownTroops: '', shownRel: '', shownColor: '', shownW: -1, shownX: NaN, shownY: NaN, shownScale: -1, visible: false };
    this.slots.push(s);
    this.slotOfSeat[seat] = this.slots.length - 1;
    return s;
  }

  private release(s: Slot): void {
    if (s.seat >= 0) this.slotOfSeat[s.seat] = -1;
    s.seat = -1;
    if (s.visible) {
      s.visible = false;
      s.el.hidden = true;
      this.writes++;
    }
  }

  private write(s: Slot, seat: number, name: string, troops: string, rel: string, color: string, w: number, x: number, y: number, scale: number): void {
    if (name !== s.shownName) {
      s.shownName = name;
      s.name.textContent = name;
      this.writes++;
    }
    if (troops !== s.shownTroops) {
      s.shownTroops = troops;
      s.troops.textContent = troops;
      this.writes++;
    }
    if (rel !== s.shownRel) {
      s.shownRel = rel;
      s.rel.textContent = rel;
      s.rel.hidden = rel === '';
      this.writes++;
    }
    if (color !== s.shownColor) {
      s.shownColor = color;
      s.el.style.borderLeftColor = color;
      this.writes++;
    }
    if (w !== s.shownW) {
      s.shownW = w;
      s.el.style.width = `${w}px`;
      this.writes++;
    }
    if (x !== s.shownX || y !== s.shownY || scale !== s.shownScale) {
      s.shownX = x;
      s.shownY = y;
      s.shownScale = scale;
      s.el.style.transform = scale === 1 ? `translate(${x}px, ${y}px)` : `translate(${x}px, ${y}px) scale(${scale})`;
      this.writes++;
    }
    if (!s.visible) {
      s.visible = true;
      s.el.hidden = false;
      s.el.dataset.seat = String(seat);
      this.writes++;
    } else if (s.el.dataset.seat !== String(seat)) {
      s.el.dataset.seat = String(seat);
    }
  }

  private hideAll(): void {
    for (const s of this.slots) this.release(s);
    this.shownCount = 0;
  }

  /** The labels that are shown now (boxes in window pixels). */
  info(): LabelInfo[] {
    const out: LabelInfo[] = [];
    for (const s of this.slots) {
      if (!s.visible) continue;
      out.push({ seat: s.seat, text: `${s.shownName} ${s.shownTroops}${s.shownRel === '' ? '' : ` ${s.shownRel}`}`, x: s.shownX, y: s.shownY, w: s.shownW * s.shownScale, h: LABELS.heightPx * s.shownScale, scale: s.shownScale });
    }
    return out;
  }

  dispose(): void {
    this.root.remove();
  }
}
