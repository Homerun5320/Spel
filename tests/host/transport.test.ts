import { describe, expect, it, vi } from 'vitest';
import { createLocalTransport } from '../../src/host/transport';

type Msg = { n: number; data?: Uint8Array; nested?: { list: number[] } };

describe('LocalTransport', () => {
  it('delivers copies: no object, typed array or nested array is shared with the sender', async () => {
    const t = createLocalTransport<Msg, Msg>();
    const got: Msg[] = [];
    t.host.onMessage((m) => got.push(m));
    const sent: Msg = { n: 1, data: new Uint8Array([1, 2, 3]), nested: { list: [1, 2] } };
    t.client.post(sent);
    sent.data![0] = 99;
    sent.nested!.list.push(3);
    await t.idle();
    expect(got).toHaveLength(1);
    expect(got[0]).not.toBe(sent);
    expect(Array.from(got[0]!.data!)).toEqual([1, 2, 3]);
    expect(got[0]!.nested!.list).toEqual([1, 2]);
    expect(got[0]!.data!.buffer).not.toBe(sent.data!.buffer);
    expect(t.copies).toBe(1);
  });

  it('delivery is asynchronous (never inside post) and in order, in both directions', async () => {
    const t = createLocalTransport<Msg, Msg>();
    const atHost: number[] = [];
    const atClient: number[] = [];
    t.host.onMessage((m) => {
      atHost.push(m.n);
      t.host.post({ n: m.n * 10 });
    });
    t.client.onMessage((m) => atClient.push(m.n));
    for (let i = 1; i <= 5; i++) t.client.post({ n: i });
    expect(atHost).toEqual([]);
    await t.idle();
    expect(atHost).toEqual([1, 2, 3, 4, 5]);
    expect(atClient).toEqual([10, 20, 30, 40, 50]);
  });

  it('a message carrying a function or a class instance cannot cross (functions throw, instances lose their prototype)', async () => {
    const t = createLocalTransport<unknown, unknown>();
    expect(() => t.client.post({ f: () => 1 })).toThrow();
    class Secret {
      value = 5;
      get double(): number {
        return this.value * 2;
      }
    }
    const got: unknown[] = [];
    t.host.onMessage((m) => got.push(m));
    t.client.post({ s: new Secret() });
    await t.idle();
    const s = (got[0] as { s: Record<string, unknown> }).s;
    expect(s).toEqual({ value: 5 });
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype);
  });

  it('a transferred buffer moves instead of copying (the sender\'s array is detached)', async () => {
    const t = createLocalTransport<Msg, Msg>();
    const got: Msg[] = [];
    t.host.onMessage((m) => got.push(m));
    const data = new Uint8Array([5, 6, 7]);
    t.client.post({ n: 0, data }, [data.buffer]);
    await t.idle();
    expect(data.byteLength).toBe(0);
    expect(Array.from(got[0]!.data!)).toEqual([5, 6, 7]);
  });

  it('messages posted before a handler exists wait for the first handler', async () => {
    const t = createLocalTransport<Msg, Msg>();
    t.client.post({ n: 1 });
    t.client.post({ n: 2 });
    await Promise.resolve();
    const got: number[] = [];
    t.host.onMessage((m) => got.push(m.n));
    await t.idle();
    expect(got).toEqual([1, 2]);
  });

  it('unsubscribe and close stop delivery', async () => {
    const t = createLocalTransport<Msg, Msg>();
    const a = vi.fn();
    const stop = t.host.onMessage(a);
    t.client.post({ n: 1 });
    await t.idle();
    stop();
    t.client.post({ n: 2 });
    await t.idle();
    expect(a).toHaveBeenCalledTimes(1);
    const b = vi.fn();
    t.host.onMessage(b);
    t.host.close();
    t.client.post({ n: 3 });
    await t.idle();
    expect(b).not.toHaveBeenCalled();
    t.client.close();
    t.client.post({ n: 4 });
    expect(t.copies).toBe(3);
  });
});
