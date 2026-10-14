// A tiny software canvas for the flag tests: just the calls `drawFlag` uses (fillStyle as #rrggbb, fillRect, one filled path made of
// lines and full circles), no anti-aliasing, a pixel is painted when its centre is inside the shape. Node has no canvas, and the flag
// tests state the picture as data (the draw commands) AND check the colours that really come out.
import type { FlagCanvas } from '../../src/ui/flag';

type Shape = { readonly poly: Array<[number, number]> } | { readonly circle: readonly [number, number, number] };

export class SoftCanvas implements FlagCanvas {
  /** RGBA, row by row. */
  readonly data: Uint8Array;
  private color: [number, number, number] = [0, 0, 0];
  private style: string | CanvasGradient | CanvasPattern = '#000000';
  private shapes: Shape[] = [];
  private current: Array<[number, number]> | null = null;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  get fillStyle(): string | CanvasGradient | CanvasPattern {
    return this.style;
  }
  set fillStyle(v: string | CanvasGradient | CanvasPattern) {
    this.style = v;
    const m = /^#([0-9a-f]{6})$/.exec(String(v));
    if (m === null) throw new Error(`SoftCanvas takes #rrggbb, got ${String(v)}`);
    const n = parseInt(m[1] as string, 16);
    this.color = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  private paint(x: number, y: number): void {
    const i = (y * this.width + x) * 4;
    this.data[i] = this.color[0];
    this.data[i + 1] = this.color[1];
    this.data[i + 2] = this.color[2];
    this.data[i + 3] = 255;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    for (let py = 0; py < this.height; py++) {
      for (let px = 0; px < this.width; px++) {
        if (px + 0.5 >= x && px + 0.5 < x + w && py + 0.5 >= y && py + 0.5 < y + h) this.paint(px, py);
      }
    }
  }
  beginPath(): void {
    this.shapes = [];
    this.current = null;
  }
  moveTo(x: number, y: number): void {
    this.current = [[x, y]];
    this.shapes.push({ poly: this.current });
  }
  lineTo(x: number, y: number): void {
    if (this.current === null) throw new Error('lineTo without moveTo');
    this.current.push([x, y]);
  }
  closePath(): void {
    this.current = null;
  }
  arc(x: number, y: number, r: number): void {
    this.shapes.push({ circle: [x, y, r] });
  }
  fill(): void {
    for (let py = 0; py < this.height; py++) {
      for (let px = 0; px < this.width; px++) {
        const cx = px + 0.5;
        const cy = py + 0.5;
        let inside = false;
        for (const s of this.shapes) {
          if ('circle' in s) {
            const dx = cx - s.circle[0];
            const dy = cy - s.circle[1];
            if (dx * dx + dy * dy <= s.circle[2] * s.circle[2]) inside = !inside;
          } else {
            const p = s.poly;
            let hit = false;
            for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
              const [xi, yi] = p[i] as [number, number];
              const [xj, yj] = p[j] as [number, number];
              if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) hit = !hit;
            }
            if (hit) inside = !inside;
          }
        }
        if (inside) this.paint(px, py);
      }
    }
  }

  /** The colour of a pixel as 0xRRGGBB. */
  pixel(x: number, y: number): number {
    const i = (y * this.width + x) * 4;
    return ((this.data[i] as number) << 16) | ((this.data[i + 1] as number) << 8) | (this.data[i + 2] as number);
  }

  /** How many pixels have each colour (0xRRGGBB), most frequent first. */
  histogram(region?: (x: number, y: number) => boolean): Array<[number, number]> {
    const counts = new Map<number, number>();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (region !== undefined && !region(x, y)) continue;
        const c = this.pixel(x, y);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  }
}
