// The ownership texture: who owns each sim cell, as a 1024x512 RGBA8 DataTexture the terrain shader reads with `texelFetch`.
//   R = ownerId low byte, G = ownerId high byte (ownerId is a u16), B = flags, A = reserve (kept 255).
//   B bit 0 (OWN_FLAG_PLAYABLE)  the cell can be owned (Plains .. Mountain);
//   B bit 1 (OWN_FLAG_WATER)     the cell is DeepSea or Shallows (the shader never draws a territory border against water).
// The CPU copy (`data`) is kept current in place by the host's diffs (`applyCells`, `setFromOwners` after an overflow). Only the
// GPU upload is throttled: the whole texture (about 2 MB) is re-uploaded at most every OWNERSHIP_MIN_UPLOAD_INTERVAL_S of FX
// time (src/render/clock.ts, so the test mode controls it) and only when something changed. `uploads` counts those uploads.
import { DataTexture, NearestFilter, NoColorSpace, RGBAFormat, RepeatWrapping, ClampToEdgeWrapping, UnsignedByteType } from 'three';
import { isPlayableClass } from '../sim/terrain';
import { OWNERSHIP_MIN_UPLOAD_INTERVAL_S } from './config';

export const OWN_FLAG_PLAYABLE = 1;
export const OWN_FLAG_WATER = 2;

export class OwnershipTexture {
  readonly texture: DataTexture;
  /** RGBA bytes, row 0 = north. Written in place; read it with `ownerAt`. */
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** Full uploads requested so far (the first is the one at creation). */
  uploads = 0;
  /** Uploads the GL layer really performed (counted in three's onUpdate callback; needs a render call). */
  gpuUploads = 0;
  private dirty = false;
  private lastUploadAt = Number.NEGATIVE_INFINITY;

  /** `terrainClass` is the class layer (width * height); the flags are derived from it once. */
  constructor(width: number, height: number, terrainClass: ArrayLike<number>) {
    if (terrainClass.length !== width * height) throw new Error('terrain layer size does not match the ownership texture');
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const cls = terrainClass[i] as number;
      this.data[i * 4 + 2] = (isPlayableClass(cls) ? OWN_FLAG_PLAYABLE : 0) | (cls <= 1 ? OWN_FLAG_WATER : 0);
      this.data[i * 4 + 3] = 255;
    }
    const t = new DataTexture(this.data, width, height, RGBAFormat, UnsignedByteType);
    t.colorSpace = NoColorSpace;
    t.flipY = false;
    t.premultiplyAlpha = false;
    t.generateMipmaps = false;
    t.minFilter = NearestFilter;
    t.magFilter = NearestFilter;
    t.wrapS = RepeatWrapping;
    t.wrapT = ClampToEdgeWrapping;
    t.onUpdate = () => {
      this.gpuUploads++;
    };
    t.needsUpdate = true; // the first upload (all zero owners)
    this.texture = t;
    this.uploads = 1;
    this.lastUploadAt = Number.NEGATIVE_INFINITY;
  }

  /** The ownerId of a cell as the texture holds it. */
  ownerAt(cell: number): number {
    return (this.data[cell * 4] as number) | ((this.data[cell * 4 + 1] as number) << 8);
  }

  flagsAt(cell: number): number {
    return this.data[cell * 4 + 2] as number;
  }

  /** Writes changed cells in place (cells[i] now belongs to owners[i]) and marks the texture dirty. */
  applyCells(cells: ArrayLike<number>, owners: ArrayLike<number>): void {
    const d = this.data;
    for (let i = 0; i < cells.length; i++) {
      const o = owners[i] as number;
      const p = (cells[i] as number) * 4;
      d[p] = o & 255;
      d[p + 1] = o >> 8;
    }
    if (cells.length > 0) this.dirty = true;
  }

  /** Replaces every owner (a full owner array: the start, or after an outbox overflow). */
  setFromOwners(owner: ArrayLike<number>): void {
    const d = this.data;
    const n = this.width * this.height;
    for (let i = 0; i < n; i++) {
      const o = owner[i] as number;
      d[i * 4] = o & 255;
      d[i * 4 + 1] = o >> 8;
    }
    this.dirty = true;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  /**
   * Schedules the full upload when the texture is dirty and at least OWNERSHIP_MIN_UPLOAD_INTERVAL_S of FX time (`now`, seconds)
   * passed since the previous one (`force` ignores the interval). Returns whether an upload was scheduled. The upload itself
   * happens at the next render call.
   */
  flush(now: number, force = false): boolean {
    if (!this.dirty) return false;
    if (!force && now - this.lastUploadAt < OWNERSHIP_MIN_UPLOAD_INTERVAL_S) return false;
    this.texture.needsUpdate = true;
    this.lastUploadAt = now;
    this.dirty = false;
    this.uploads++;
    return true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
