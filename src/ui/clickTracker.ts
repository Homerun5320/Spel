// Tells a click from a drag by the distance a press has moved, so that a short click spawns or attacks while a drag still
// rotates the globe. Pure (no DOM, no clock): the caller feeds pointer positions. A press that has once moved farther than the
// threshold stays a drag even if it returns to its start.
import { CLICK_MOVE_PX } from './uiConfig';

export class ClickTracker {
  private active = false;
  private startX = 0;
  private startY = 0;
  private dragged = false;

  constructor(private readonly thresholdPx: number = CLICK_MOVE_PX) {}

  down(x: number, y: number): void {
    this.active = true;
    this.dragged = false;
    this.startX = x;
    this.startY = y;
  }

  move(x: number, y: number): void {
    if (!this.active || this.dragged) return;
    const dx = x - this.startX;
    const dy = y - this.startY;
    if (dx * dx + dy * dy > this.thresholdPx * this.thresholdPx) this.dragged = true;
  }

  /** Ends the press; true when it was a click (it never moved past the threshold). */
  up(x: number, y: number): boolean {
    if (!this.active) return false;
    this.move(x, y);
    this.active = false;
    return !this.dragged;
  }

  cancel(): void {
    this.active = false;
  }

  get isDragging(): boolean {
    return this.active && this.dragged;
  }
}
