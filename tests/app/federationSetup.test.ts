// M18b-2: the setup choice "Dela upp stormakter" (off by default, stored, carried into the config) and the related colours of a federation.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PreparedWorld } from '../../src/app/matchWorld';
import { checkDraft, defaultDraft, draftFromStored, storedOf, type SetupDraft } from '../../src/app/setupModel';
import { OWN_SEPARATION_DE, buildOwnerPalette, FEDERATION_SHADES } from '../../src/render/ownerPalette';
import { deltaE76Rgb } from '../../src/render/color';
import { loadPreparedWorld } from '../../tools/sim/realWorld';

let world: PreparedWorld;
beforeAll(async () => {
  world = await loadPreparedWorld();
});

const usa = (): number => world.countries.find((c) => c.a3 === 'USA')?.id as number;
const base = (patch: Partial<SetupDraft> = {}): SetupDraft => ({ ...defaultDraft(1, 'Nyland'), countryId: usa(), ...patch });

describe('the draft', () => {
  it('is off by default; an old stored setup without the field stays off; on is stored and comes back', () => {
    expect(defaultDraft(1, 'x').federations).toBe(false);
    const stored = storedOf(base(), world);
    const { federations: _f, ...old } = stored;
    void _f;
    expect(draftFromStored(old, world, base()).federations).toBe(false);
    const on = storedOf(base({ federations: true, subNation: 5 }), world);
    const back = draftFromStored(JSON.parse(JSON.stringify(on)), world, base());
    expect(back.federations).toBe(true);
    expect(back.subNation).toBe(0);
  });

  it('the config carries the option only when it is on', () => {
    const off = checkDraft(world, base());
    const on = checkDraft(world, base({ federations: true, subNation: 7 }));
    expect(off.ok && on.ok).toBe(true);
    if (!off.ok || !on.ok) return;
    expect('federations' in off.config).toBe(false);
    expect(on.config.federations).toBe(true);
    expect(on.config.subNation).toBe(7);
  });
});

describe('the colours of a federation', () => {
  it('members are close relatives of one colour, can be told apart, and keep away from the own colour', () => {
    const owners = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    const plain = buildOwnerPalette();
    const pal = buildOwnerPalette(undefined, [owners]);
    const rgb = (o: number): [number, number, number] => [pal[o * 4] as number, pal[o * 4 + 1] as number, pal[o * 4 + 2] as number];
    const own = rgb(1);
    expect(FEDERATION_SHADES.length).toBeGreaterThanOrEqual(owners.length - 1);
    // the first member keeps its colour; the others changed (they are shades of it)
    expect(Array.from(pal.subarray(8, 12))).toEqual(Array.from(plain.subarray(8, 12)));
    let changed = 0;
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const d = deltaE76Rgb(rgb(owners[i] as number), rgb(owners[j] as number));
        if (d < 8) throw new Error(`members ${owners[i]} and ${owners[j]} are only ${d.toFixed(1)} apart`);
      }
      if (i > 0 && !Array.from(pal.subarray((owners[i] as number) * 4, (owners[i] as number) * 4 + 4)).every((v, k) => v === plain[(owners[i] as number) * 4 + k])) changed++;
      expect(deltaE76Rgb(rgb(owners[i] as number), own)).toBeGreaterThanOrEqual(OWN_SEPARATION_DE - 1e-9);
    }
    expect(changed).toBeGreaterThan(6);
    // no group = the palette of before, byte for byte
    expect(Array.from(buildOwnerPalette(undefined, []))).toEqual(Array.from(plain));
  });
});
