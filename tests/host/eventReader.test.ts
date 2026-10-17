// Fix-6B [2.7]: the side facts of the mirror have one cursor PER CONSUMER (`EventReader`), so a second consumer sees every fact even when the first has read and marked its
// window in the same frame, in either order; the ring's cap shows up as `dropped` for the reader that was too slow. Ring level and through a real mirror.
import { describe, expect, it } from 'vitest';
import { EventReader, ViewEventRing } from '../../src/host/viewEventRing';
import { MainThreadHost } from '../../src/host/mainThreadHost';
import { ViewMirror } from '../../src/host/viewMirror';
import { OUTBOX_ELIMINATED } from '../../src/sim/outbox';
import { createState } from '../../src/sim/state';
import { step, type StepFn } from '../../src/sim/step';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { VIEW_EVENTS_CAP, type ViewEventsView } from '../../src/sim/view';

const list = (v: ViewEventsView): number[] => Array.from({ length: v.length }, (_, i) => v.aAt(i));

describe('EventReader', () => {
  it('two readers over one ring each see every event once, whoever reads first, and one commit does not hide events from the other', () => {
    const ring = new ViewEventRing();
    const a = new EventReader(ring);
    const b = new EventReader(ring);
    for (let i = 0; i < 3; i++) ring.push(1, 10, i, 0);
    expect(list(a.read())).toEqual([0, 1, 2]);
    a.commit();
    expect(list(a.read())).toEqual([]);
    expect(list(b.read()), 'b is not affected by a\'s commit').toEqual([0, 1, 2]);
    ring.push(1, 11, 3, 0);
    expect(list(a.read())).toEqual([3]);
    expect(list(b.read())).toEqual([0, 1, 2, 3]);
    b.commit();
    a.commit();
    expect(list(a.read())).toEqual([]);
    expect(list(b.read())).toEqual([]);
  });

  it('a reader that falls more than the cap behind gets the newest and the number it lost; clear() of the legacy consumer does not rewind the cursors', () => {
    const ring = new ViewEventRing();
    const slow = new EventReader(ring);
    const n = VIEW_EVENTS_CAP + 5;
    for (let i = 0; i < n; i++) ring.push(1, 1, i, 0);
    const v = slow.read();
    expect(v.length).toBe(VIEW_EVENTS_CAP);
    expect(v.dropped).toBe(5);
    expect(v.aAt(0)).toBe(5);
    expect(v.aAt(VIEW_EVENTS_CAP - 1)).toBe(n - 1);
    slow.commit();
    ring.push(1, 2, 999, 0);
    ring.clear(); // the single-consumer way still works for its own user
    expect(list(slow.read())).toEqual([]);
    ring.push(1, 3, 7, 0);
    expect(list(slow.read())).toEqual([7]);
  });
});

describe('two consumers of one ViewMirror', () => {
  it('both see the elimination fact of the same tick, the second one reading after the first has committed', async () => {
    const W = 64;
    const H = 32;
    const s = createState({ width: W, height: H, seed: 1, seats: 2, config: { debugIntents: true }, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
    const stepFn: StepFn = (st, input) => {
      const r = step(st, input);
      st.outbox.push(OUTBOX_ELIMINATED, st.tick, 1, 0);
      return r;
    };
    const host = new MainThreadHost(s, { stepFn });
    const { mirror, stop } = await ViewMirror.attach(host);
    const first = mirror.eventReader();
    const second = mirror.eventReader();
    host.runTicks(2);
    expect(first.read().length).toBeGreaterThanOrEqual(2);
    const seenByFirst = first.read().length;
    first.commit();
    expect(second.read().length, 'the second consumer still sees what the first has read').toBe(seenByFirst);
    second.commit();
    expect(first.read().length + second.read().length).toBe(0);
    host.runTicks(1);
    expect(first.read().length).toBeGreaterThanOrEqual(1);
    stop();
  });
});
