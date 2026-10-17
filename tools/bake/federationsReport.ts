// `npm run bake:federations` (M18b-1): prints the sub-nations per candidate country from the COMMITTED pack (no network), and
// can draw them: `-- --png=<file> [--country=RUS,USA]` writes a coloured PNG of the sub-nation raster (rows of the named
// countries, whole width, 2 x scale; other land grey). Used to look at the result; the PNG is never committed.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseFederations } from '../../src/data/federations';
import { SIM_HEIGHT, SIM_WIDTH } from '../../src/data/format';
import { formatReport, type CountryRef } from './federations';
import { simGridView } from '../../src/data/world';

const DIR = path.resolve(import.meta.dirname, '../../public/data');

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : undefined;
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const v of b) c = (crcTable[(c ^ v) & 255] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function png(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(zlib.deflateSync(raw))), chunk('IEND', new Uint8Array(0))];
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return all;
}

function main(): void {
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8')) as { countries: CountryRef[] };
  const fed = parseFederations(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(DIR, 'federations.bin.gz')))), meta.countries.length);
  console.log(formatReport(fed, meta.countries));
  const out = arg('png');
  if (!out) return;
  const sim = simGridView(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(DIR, 'sim.bin.gz')))));
  const want = new Set((arg('country') ?? 'RUS,USA,CHN,BRA').split(','));
  let y0 = SIM_HEIGHT;
  let y1 = 0;
  for (let i = 0; i < SIM_WIDTH * SIM_HEIGHT; i++) {
    const c = sim.country[i] as number;
    if (c > 0 && want.has((meta.countries[c - 1] as CountryRef).a3)) {
      const y = Math.floor(i / SIM_WIDTH);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const S = 2;
  const w = SIM_WIDTH * S;
  const h = (y1 - y0 + 1) * S;
  const rgb = new Uint8Array(w * h * 3).fill(0);
  const colour = (id: number): [number, number, number] => {
    // Golden-angle hue steps so neighbours differ.
    const hue = (id * 137.508) % 360;
    const f = (n: number): number => {
      const k = (n + hue / 30) % 12;
      return Math.round(255 * (0.6 - 0.35 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  };
  for (let y = y0; y <= y1; y++) {
    for (let x = 0; x < SIM_WIDTH; x++) {
      const i = y * SIM_WIDTH + x;
      let c: [number, number, number] = [10, 20, 40];
      if (sim.land[i] === 1) c = [70, 70, 70];
      const f = fed.federationRaster[i] as number;
      const cn = sim.country[i] as number;
      if (f !== 0 && want.has((meta.countries[cn - 1] as CountryRef).a3)) c = colour(f);
      // Dark line where the sub-nation changes towards the east or south neighbour.
      const e = fed.federationRaster[y * SIM_WIDTH + ((x + 1) % SIM_WIDTH)] as number;
      const s = y + 1 < SIM_HEIGHT ? (fed.federationRaster[i + SIM_WIDTH] as number) : f;
      const edge = f !== 0 && ((e !== f && e !== 0) || (s !== f && s !== 0));
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          const o = (((y - y0) * S + dy) * w + x * S + dx) * 3;
          const dark = edge && (dx === S - 1 || dy === S - 1);
          rgb[o] = dark ? 0 : c[0];
          rgb[o + 1] = dark ? 0 : c[1];
          rgb[o + 2] = dark ? 0 : c[2];
        }
      }
    }
  }
  fs.writeFileSync(out, png(w, h, rgb));
  console.log(`wrote ${out} (${w}x${h}, rows ${y0}..${y1})`);
}

main();
