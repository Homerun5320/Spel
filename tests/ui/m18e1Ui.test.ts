// M18e-1: the UI model of the Airfield, Lab and Plant: the build bar entries and keys 7 to 9, the registry and the help overlay, the selection panel's effect lines (numbers from the
// sim's pure functions), the refusal texts and the research time shown with a Lab. The mutants are tabulated in the M18e-1 block of docs/DECISIONS.md.
import { describe, expect, it } from 'vitest';
import { HotkeyRegistry, registerGameHotkeys, type GameHotkeyActions, type HotkeyEvent } from '../../src/app/hotkeys';
import { InputStack, type InputMode } from '../../src/app/input';
import { applyIntent, step } from '../../src/sim/step';
import { withId } from '../../src/sim/intents';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { BUILD_TICKS, MILLI_GOLD_PER_GOLD, TECH_TICKS } from '../../src/sim/rules';
import {
  AIRFIELD_HELI_TIME_MAX_PCT,
  HELI_FLEET_AIRFIELD_MAX,
  LAB_RESEARCH_MAX_PCT,
  PLANT_NEAR_CELLS,
  REJECT_BUILD_MAX_COUNT,
  REJECT_BUILD_NO_NEIGHBOUR,
  STRUCT_AIRFIELD,
  STRUCT_LAB,
  STRUCT_PLANT,
  plantGoldMilli,
} from '../../src/sim/public';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';
import { buildBarKeys } from '../../src/ui/buildBar';
import { buildRejectKey } from '../../src/ui/buildReasons';
import { TABLES, formatGoldRate, setLanguage, t } from '../../src/ui/i18n';
import { effectLines, structureNameKey } from '../../src/ui/structureInfo';
import { techCell } from '../../src/ui/techModel';

const ev = (key: string, extra: Partial<HotkeyEvent> = {}): HotkeyEvent => ({ key, ctrlKey: false, altKey: false, metaKey: false, repeat: false, typing: false, ...extra });

describe('keys 7, 8 and 9', () => {
  function setup(): { reg: HotkeyRegistry; log: number[]; flags: { modal: boolean } } {
    const log: number[] = [];
    const reg = new HotkeyRegistry();
    const flags = { modal: false };
    reg.context = { matchOn: () => true, modalOpen: () => flags.modal };
    const base: InputMode = { id: 'base' };
    const actions: GameHotkeyActions = {
      stack: new InputStack(base),
      toggleOverlay: () => undefined,
      commit: () => undefined,
      togglePause: () => undefined,
      slower: () => undefined,
      faster: () => undefined,
      toggleHelp: () => undefined,
      buildType: (type) => void log.push(type),
    };
    registerGameHotkeys(reg, actions);
    return { reg, log, flags };
  }

  it('are a plain match entry of the registry (not a reserved stack key), call buildType with the digit, are listed in the help overlay and have texts in both languages', () => {
    const { reg, log, flags } = setup();
    const entry = reg.find('7');
    expect(entry?.id).toBe('build-extra');
    expect(entry?.scope).toBe('match');
    expect(entry?.keys).toEqual(['7', '8', '9']);
    expect(reg.listed().map((d) => d.id)).toContain('build-extra');
    expect(reg.handle(ev('7'))).toBe(true);
    expect(reg.handle(ev('8'))).toBe(true);
    expect(reg.handle(ev('9'))).toBe(true);
    expect(log).toEqual([7, 8, 9]);
    expect(reg.handle(ev('8', { repeat: true }))).toBe(false); // a held key does not place twice
    expect(reg.handle(ev('8', { typing: true }))).toBe(false);
    flags.modal = true;
    expect(reg.handle(ev('9'))).toBe(false); // dead behind a modal
    for (const lang of ['sv', 'en'] as const) expect((TABLES[lang] as Record<string, string>)[entry?.labelKey ?? '']?.length).toBeGreaterThan(5);
  });

  it('the build bar has one button per type 1 to 9 and the key of each is its type number', () => {
    const keys = buildBarKeys();
    expect(keys.map((k) => k.type)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const k of keys) expect(k.key).toBe(String(k.type));
    expect(keys.slice(6).map((k) => k.type)).toEqual([STRUCT_AIRFIELD, STRUCT_LAB, STRUCT_PLANT]);
  });
});

describe('the selection panel and the refusal texts', () => {
  it('the effect lines carry the numbers of the sim functions at the level', () => {
    const air = effectLines(STRUCT_AIRFIELD, 2)[0];
    expect(air?.key).toBe('sel.fx.airfield');
    expect(air?.params).toEqual({ fleet: 2, pct: 10, fleetMax: HELI_FLEET_AIRFIELD_MAX, pctMax: AIRFIELD_HELI_TIME_MAX_PCT });
    expect(effectLines(STRUCT_AIRFIELD, 100)[0]?.params).toMatchObject({ fleet: HELI_FLEET_AIRFIELD_MAX, pct: AIRFIELD_HELI_TIME_MAX_PCT });
    expect(effectLines(STRUCT_LAB, 3)[0]).toEqual({ key: 'sel.fx.lab', params: { pct: 15, pctMax: LAB_RESEARCH_MAX_PCT } });
    expect(effectLines(STRUCT_PLANT, 1)[0]).toEqual({ key: 'sel.fx.plant', params: { gold: formatGoldRate(plantGoldMilli(1)), radius: PLANT_NEAR_CELLS } });
    expect(effectLines(STRUCT_PLANT, 5)[0]?.params.gold).toBe(formatGoldRate(plantGoldMilli(5)));
    expect(plantGoldMilli(5)).toBeGreaterThan(plantGoldMilli(1));
  });

  it('the names and the refusals of the new types have their own keys, in both languages with the same placeholders', () => {
    expect(structureNameKey(STRUCT_AIRFIELD)).toBe('hud.build.airfield');
    expect(structureNameKey(STRUCT_LAB)).toBe('hud.build.lab');
    expect(structureNameKey(STRUCT_PLANT)).toBe('hud.build.plant');
    expect(buildRejectKey(REJECT_BUILD_MAX_COUNT)).toBe('toast.build.maxCount');
    expect(buildRejectKey(REJECT_BUILD_NO_NEIGHBOUR)).toBe('toast.build.noNeighbour');
    setLanguage('sv');
    expect(t('hud.build.airfield')).toBe('Flygfält');
    expect(t('sel.fx.lab', { pct: 15, pctMax: 40 })).toContain('15');
    setLanguage('en');
    expect(t('hud.build.plant')).toBe('Power plant');
    expect(t('sel.fx.airfield', { fleet: 2, pct: 10, fleetMax: 6, pctMax: 40 })).toContain('10 %');
    setLanguage('sv');
  });
});

describe('the research time the panel shows', () => {
  function world(): GameState {
    const W = 64;
    const H = 32;
    const s = createState({ width: W, height: H, seed: 3, seats: 2, config: { debugIntents: true }, terrain: new Uint8Array(W * H).fill(CLASS_PLAINS), elevation: new Uint16Array(W * H) });
    for (let c = 0; c < W * H; c++) s.owner[c] = 1;
    rebuildAggregates(s);
    s.gold[1] = 100000 * MILLI_GOLD_PER_GOLD;
    return s;
  }
  const view = (s: GameState): StateView => {
    const v = new StateView(s);
    v.refresh();
    return v;
  };

  it('a start button shows the base time without a Lab and the shortened time with a finished one', () => {
    const s = world();
    expect(techCell(view(s), 0, 0).ticks).toBe(TECH_TICKS[0]);
    expect(applyIntent(s, withId({ kind: 'Build', seat: 0, type: STRUCT_LAB, cell: 5 * 64 + 5 }, 1))).toBe(0);
    for (let i = 0; i < (BUILD_TICKS[STRUCT_LAB] as number); i++) step(s, { turn: s.tick, intents: [] });
    expect(techCell(view(s), 0, 0).ticks).toBe((TECH_TICKS[0] as number) - Math.floor(((TECH_TICKS[0] as number) * 5) / 100)); // 570
    expect(techCell(view(s), 0, 4).ticks).toBe((TECH_TICKS[4] as number) - Math.floor(((TECH_TICKS[4] as number) * 5) / 100));
  });
});
