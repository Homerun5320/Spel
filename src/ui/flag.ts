// Procedural flags (M06, item 2): no image assets, nothing copied from a real flag. A flag is a FlagSpec, a pure function of a seed
// (a pattern, two colours, a vector emblem and its size), and `drawFlag(ctx, spec, w, h)` draws it with a handful of canvas calls
// (fillRect, one filled path at a time). The same generator makes the flag of a custom nation and of every AI nation.
//
// The tests pin the flag as DATA: the spec and the list of draw commands (`flagCommands`, hashed by `flagHash`), never the raster,
// because the raster depends on the browser's anti-aliasing and the commands do not. All emblem geometry is integer tables (no
// sin or cos at run time), so the commands are the same in every engine.
import { createRng, nextBelow } from '../sim/public';
import { deltaE76, rgbToLab, type Rgb8 } from '../render/color';

/** The canvas calls a flag uses; a CanvasRenderingContext2D satisfies it, and so does the recorder below. */
export type FlagCanvas = Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'arc' | 'fill'>;

export const FLAG_PATTERN_COUNT = 12;
export const FLAG_EMBLEM_COUNT = 12;
export const FLAG_SIZE_COUNT = 3;

export interface FlagSpec {
  /** 0 .. FLAG_PATTERN_COUNT - 1 */
  readonly pattern: number;
  /** The field colour and the accent colour, 0xRRGGBB. The emblem is drawn in the accent colour on a badge in the field colour. */
  readonly colors: readonly [number, number];
  /** 0 .. FLAG_EMBLEM_COUNT - 1 */
  readonly emblem: number;
  /** 0 .. FLAG_SIZE_COUNT - 1: small, medium, large. */
  readonly size: number;
}

/** The flag colours: strong, well separated hues plus white, black and two earth tones. */
export const FLAG_PALETTE: readonly number[] = Object.freeze([
  0xc8102e, // red
  0xf26b21, // orange
  0xfcd116, // yellow
  0x2e9e44, // green
  0x0b5d3b, // dark green
  0x00a3a1, // teal
  0x5bb4e5, // light blue
  0x1f4fb8, // blue
  0x0b1f5c, // navy
  0x6a2d91, // purple
  0xd1318f, // magenta
  0xffffff, // white
  0x111111, // black
  0x8c8c8c, // grey
  0x7a4a21, // brown
  0xe8d9a8, // sand
]);

/** The two colours of a flag are at least this far apart (CIE76), so that the accent never vanishes into the field. */
export const FLAG_MIN_COLOR_DE = 40;

export function rgbOfHex(hex: number): Rgb8 {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function labOfHex(hex: number): ReturnType<typeof rgbToLab> {
  const [r, g, b] = rgbOfHex(hex);
  return rgbToLab(r, g, b);
}

/** CIE76 distance of two 0xRRGGBB colours. */
export function hexDeltaE(a: number, b: number): number {
  return deltaE76(labOfHex(a), labOfHex(b));
}

/** The CSS colour of a 0xRRGGBB value. */
export function cssOfHex(hex: number): string {
  return `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;
}

export interface FlagOptions {
  /** Fixes the field colour (a custom nation's own colour, 0xRRGGBB); the accent is still drawn from the seed. */
  readonly primary?: number;
}

/**
 * The flag of a seed. Pure: the same seed (and options) always give the same spec. The accent colour is the first palette colour, in a
 * seeded order, that is FLAG_MIN_COLOR_DE away from the field colour.
 */
export function makeFlagSpec(seed: number, options: FlagOptions = {}): FlagSpec {
  const rng = createRng(((seed | 0) ^ 0x464c4147) | 0); // 'FLAG'
  const pattern = nextBelow(rng, FLAG_PATTERN_COUNT);
  const emblem = nextBelow(rng, FLAG_EMBLEM_COUNT);
  const size = nextBelow(rng, FLAG_SIZE_COUNT);
  const field = options.primary !== undefined ? options.primary & 0xffffff : (FLAG_PALETTE[nextBelow(rng, FLAG_PALETTE.length)] as number);
  const start = nextBelow(rng, FLAG_PALETTE.length);
  let accent = field === 0xffffff ? 0x111111 : 0xffffff;
  for (let i = 0; i < FLAG_PALETTE.length; i++) {
    const c = FLAG_PALETTE[(start + i) % FLAG_PALETTE.length] as number;
    if (hexDeltaE(c, field) >= FLAG_MIN_COLOR_DE) {
      accent = c;
      break;
    }
  }
  return { pattern, colors: [field, accent], emblem, size };
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry. The pattern lives on a 100 x 100 grid stretched over the flag (x by w / 100, y by h / 100); the emblem on a -100 .. 100
// box scaled to its radius and centred, kept round (the unit is the shorter side).

type Poly = ReadonlyArray<readonly [number, number]>;

const P = (...pts: Array<[number, number]>): Poly => pts;

/** The pattern shapes after the field: rectangles [x, y, w, h] and polygons, all in the accent colour. */
type Shape = { readonly rect: readonly [number, number, number, number] } | { readonly poly: Poly };

const PATTERNS: ReadonlyArray<readonly Shape[]> = [
  /* 0 three horizontal bands */ [{ rect: [0, 33, 100, 34] }],
  /* 1 three vertical bands */ [{ rect: [33, 0, 34, 100] }],
  /* 2 top and bottom */ [{ rect: [0, 50, 100, 50] }],
  /* 3 left and right */ [{ rect: [50, 0, 50, 100] }],
  /* 4 off-centre cross */ [{ rect: [24, 0, 16, 100] }, { rect: [0, 42, 100, 16] }],
  /* 5 diagonal split */ [{ poly: P([100, 0], [100, 100], [0, 100]) }],
  /* 6 saltire */ [{ poly: P([0, 0], [14, 0], [100, 86], [100, 100], [86, 100], [0, 14]) }, { poly: P([100, 0], [100, 14], [14, 100], [0, 100], [0, 86], [86, 0]) }],
  /* 7 canton */ [{ rect: [0, 0, 45, 50] }],
  /* 8 hoist triangle */ [{ poly: P([0, 0], [48, 50], [0, 100]) }],
  /* 9 chevron band */ [{ poly: P([0, 0], [30, 0], [66, 50], [30, 100], [0, 100], [36, 50]) }],
  /* 10 quarters */ [{ rect: [0, 0, 50, 50] }, { rect: [50, 50, 50, 50] }],
  /* 11 five stripes */ [{ rect: [0, 20, 100, 20] }, { rect: [0, 60, 100, 20] }],
];

/** An emblem part: a polygon or a circle, drawn in the accent colour (colour 1) or the field colour (colour 0, a hole). */
type Part = { readonly poly: Poly; readonly color: 0 | 1 } | { readonly circle: readonly [number, number, number]; readonly color: 0 | 1 };

const EMBLEMS: ReadonlyArray<readonly Part[]> = [
  /* 0 star */ [{ poly: P([0, -100], [24, -32], [95, -31], [38, 12], [59, 81], [0, 40], [-59, 81], [-38, 12], [-95, -31], [-24, -32]), color: 1 }],
  /* 1 eight-pointed star */ [{ poly: P([0, -100], [22, -54], [71, -71], [54, -22], [100, 0], [54, 22], [71, 71], [22, 54], [0, 100], [-22, 54], [-71, 71], [-54, 22], [-100, 0], [-54, -22], [-71, -71], [-22, -54]), color: 1 }],
  /* 2 diamond */ [{ poly: P([0, -100], [70, 0], [0, 100], [-70, 0]), color: 1 }],
  /* 3 triangle */ [{ poly: P([0, -100], [92, 72], [-92, 72]), color: 1 }],
  /* 4 crescent */ [
    {
      poly: P([68, -73], [40, -91], [9, -100], [-24, -97], [-55, -84], [-79, -62], [-95, -33], [-100, 0], [-95, 33], [-79, 62], [-55, 84], [-24, 97], [9, 100], [40, 91], [68, 73], [46, 79], [24, 79], [2, 72], [-17, 60], [-32, 43], [-41, 22], [-44, 0], [-41, -22], [-32, -43], [-17, -60], [2, -72], [24, -79], [46, -79]),
      color: 1,
    },
  ],
  /* 5 cross */ [{ poly: P([-28, -100], [28, -100], [28, -28], [100, -28], [100, 28], [28, 28], [28, 100], [-28, 100], [-28, 28], [-100, 28], [-100, -28], [-28, -28]), color: 1 }],
  /* 6 hexagon */ [{ poly: P([0, -100], [87, -50], [87, 50], [0, 100], [-87, 50], [-87, -50]), color: 1 }],
  /* 7 bolt */ [{ poly: P([22, -100], [-56, 8], [-6, 8], [-26, 100], [56, -22], [4, -22]), color: 1 }],
  /* 8 arrow */ [{ poly: P([0, -100], [80, 0], [34, 0], [34, 92], [-34, 92], [-34, 0], [-80, 0]), color: 1 }],
  /* 9 ring */ [
    { circle: [0, 0, 100], color: 1 },
    { circle: [0, 0, 56], color: 0 },
  ],
  /* 10 shield */ [{ poly: P([0, -100], [82, -32], [62, 92], [-62, 92], [-82, -32]), color: 1 }],
  /* 11 sun */ [
    { circle: [0, 0, 46], color: 1 },
    { poly: P([62, 14], [100, 0], [62, -14]), color: 1 },
    { poly: P([34, 54], [71, 71], [54, 34]), color: 1 },
    { poly: P([-14, 62], [0, 100], [14, 62]), color: 1 },
    { poly: P([-54, 34], [-71, 71], [-34, 54]), color: 1 },
    { poly: P([-62, -14], [-100, 0], [-62, 14]), color: 1 },
    { poly: P([-34, -54], [-71, -71], [-54, -34]), color: 1 },
    { poly: P([14, -62], [0, -100], [-14, -62]), color: 1 },
    { poly: P([54, -34], [71, -71], [34, -54]), color: 1 },
  ],
];

/** Emblem radius as a share of the flag's shorter side, in percent, per size index. The badge behind it is a fifth larger. */
const EMBLEM_RADIUS_PCT: readonly number[] = [20, 26, 32];
const BADGE_NUM = 6;
const BADGE_DEN = 5;

function fillPoly(ctx: FlagCanvas, pts: Poly, sx: number, sy: number, ox: number, oy: number): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i] as readonly [number, number];
    if (i === 0) ctx.moveTo(ox + x * sx, oy + y * sy);
    else ctx.lineTo(ox + x * sx, oy + y * sy);
  }
  ctx.closePath();
  ctx.fill();
}

function fillCircle(ctx: FlagCanvas, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 6.283185307179586);
  ctx.closePath();
  ctx.fill();
}

/** The pattern layer: the field in the first colour and the pattern shapes in the second. */
export function drawFlagPattern(ctx: FlagCanvas, spec: FlagSpec, w: number, h: number): void {
  const field = cssOfHex(spec.colors[0]);
  const accent = cssOfHex(spec.colors[1]);
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, w, h);
  const shapes = PATTERNS[spec.pattern % FLAG_PATTERN_COUNT] as readonly Shape[];
  ctx.fillStyle = accent;
  for (const s of shapes) {
    if ('rect' in s) ctx.fillRect((s.rect[0] * w) / 100, (s.rect[1] * h) / 100, (s.rect[2] * w) / 100, (s.rect[3] * h) / 100);
    else fillPoly(ctx, s.poly, w / 100, h / 100, 0, 0);
  }
}

/** The radius in pixels of the emblem (its badge is a fifth larger). */
export function emblemRadius(spec: FlagSpec, w: number, h: number): number {
  return (Math.min(w, h) * (EMBLEM_RADIUS_PCT[spec.size % FLAG_SIZE_COUNT] as number)) / 100;
}

/** The emblem layer: a badge in the field colour, so that the emblem differs from the pattern whatever lies behind it, then the emblem in the accent colour. */
export function drawFlagEmblem(ctx: FlagCanvas, spec: FlagSpec, w: number, h: number): void {
  const field = cssOfHex(spec.colors[0]);
  const accent = cssOfHex(spec.colors[1]);
  const radius = emblemRadius(spec, w, h);
  const cx = w / 2;
  const cy = h / 2;
  ctx.fillStyle = field;
  fillCircle(ctx, cx, cy, (radius * BADGE_NUM) / BADGE_DEN);
  const unit = radius / 100;
  for (const part of EMBLEMS[spec.emblem % FLAG_EMBLEM_COUNT] as readonly Part[]) {
    ctx.fillStyle = part.color === 1 ? accent : field;
    if ('circle' in part) fillCircle(ctx, cx + part.circle[0] * unit, cy + part.circle[1] * unit, part.circle[2] * unit);
    else fillPoly(ctx, part.poly, unit, unit, cx, cy);
  }
}

/** Draws the flag into the rectangle (0, 0, w, h) of the canvas. Deterministic: the same spec and size always issue the same calls. */
export function drawFlag(ctx: FlagCanvas, spec: FlagSpec, w: number, h: number): void {
  drawFlagPattern(ctx, spec, w, h);
  drawFlagEmblem(ctx, spec, w, h);
}

// ---------------------------------------------------------------------------------------------------------------------
// The commands as data (what the golden tests hash).

/** Rounds to thousandths so that the text of a command does not depend on the last bit of a float. */
function num(x: number): string {
  const r = Math.round(x * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/** A canvas that only records what is drawn into it, one text line per call. */
export class FlagRecorder implements FlagCanvas {
  readonly commands: string[] = [];
  private style: string | CanvasGradient | CanvasPattern = '#000000';
  get fillStyle(): string | CanvasGradient | CanvasPattern {
    return this.style;
  }
  set fillStyle(v: string | CanvasGradient | CanvasPattern) {
    this.style = v;
    this.commands.push(`fillStyle ${String(v)}`);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.commands.push(`fillRect ${num(x)} ${num(y)} ${num(w)} ${num(h)}`);
  }
  beginPath(): void {
    this.commands.push('beginPath');
  }
  moveTo(x: number, y: number): void {
    this.commands.push(`moveTo ${num(x)} ${num(y)}`);
  }
  lineTo(x: number, y: number): void {
    this.commands.push(`lineTo ${num(x)} ${num(y)}`);
  }
  closePath(): void {
    this.commands.push('closePath');
  }
  arc(x: number, y: number, r: number, a0: number, a1: number): void {
    this.commands.push(`arc ${num(x)} ${num(y)} ${num(r)} ${num(a0)} ${num(a1)}`);
  }
  fill(): void {
    this.commands.push('fill');
  }
}

/** The draw commands of a flag at a size, as text lines (the tests compare and hash them). */
export function flagCommands(spec: FlagSpec, w = 96, h = 64): string[] {
  const rec = new FlagRecorder();
  drawFlag(rec, spec, w, h);
  return rec.commands;
}

/** FNV-1a of the draw commands: two flags with the same hash are the same picture. */
export function flagHash(spec: FlagSpec, w = 96, h = 64): number {
  let x = 0x811c9dc5;
  for (const line of flagCommands(spec, w, h)) {
    for (let i = 0; i < line.length; i++) x = Math.imul(x ^ line.charCodeAt(i), 0x01000193);
    x = Math.imul(x ^ 10, 0x01000193);
  }
  return x >>> 0;
}

/** The spec as one text line, for goldens and logs. */
export function flagSpecText(spec: FlagSpec): string {
  return `p${spec.pattern} ${cssOfHex(spec.colors[0])} ${cssOfHex(spec.colors[1])} e${spec.emblem} s${spec.size}`;
}
