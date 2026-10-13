// Colour maths for tests and for building palettes on the CPU (pure, no three): sRGB bytes <-> CIE L*a*b* (D65) and the CIE76
// colour difference (the Euclidean distance in L*a*b*). The acceptance of M05 states its limits in this unit (dE76).

export type Lab = readonly [number, number, number];
export type Rgb8 = readonly [number, number, number];

const WHITE_X = 0.95047;
const WHITE_Y = 1.0;
const WHITE_Z = 1.08883;

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return c * 255;
}

function labF(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
}

function labFInv(t: number): number {
  const t3 = t * t * t;
  return t3 > 216 / 24389 ? t3 : (116 * t - 16) / (24389 / 27);
}

/** sRGB bytes to CIE L*a*b* (D65). */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / WHITE_X;
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) / WHITE_Y;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / WHITE_Z;
  const fx = labF(x);
  const fy = labF(y);
  const fz = labF(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE L*a*b* to sRGB bytes (clamped to 0..255, rounded). */
export function labToRgb(l: number, a: number, b: number): [number, number, number] {
  const fy = (l + 16) / 116;
  const x = labFInv(fy + a / 500) * WHITE_X;
  const y = labFInv(fy) * WHITE_Y;
  const z = labFInv(fy - b / 200) * WHITE_Z;
  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  const q = (v: number): number => Math.max(0, Math.min(255, Math.round(linearToSrgb(Math.max(0, v)))));
  return [q(lr), q(lg), q(lb)];
}

/** CIE76 colour difference between two L*a*b* colours. */
export function deltaE76(p: Lab, q: Lab): number {
  const dl = p[0] - q[0];
  const da = p[1] - q[1];
  const db = p[2] - q[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** CIE76 colour difference between two sRGB byte colours. */
export function deltaE76Rgb(p: Rgb8, q: Rgb8): number {
  return deltaE76(rgbToLab(p[0], p[1], p[2]), rgbToLab(q[0], q[1], q[2]));
}
