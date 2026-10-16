// Fix-UI: the pure logic of the selection panel and the build refusals (src/ui/structureInfo.ts, buildReasons.ts, hudLogic.rejectKey). Every case is
// there to kill a mutant of the independent audit: levels of Factory and Port, the Silo that is not a SAM, the price of the NEXT level, finished versus
// under construction, not-owner and gone states, the delete seconds, one distinct text key per refusal code.
import { describe, expect, it } from 'vitest';
import { withId } from '../../src/sim/intents';
import { cityGoldMilliAt, cityTroopCapAt, factoryCityBonusPctAt, factoryGoldMilliAt, factoryRadiusCellsAt, portGoldMilliAt, portTradePctAt } from '../../src/sim/levelCurves';
import {
  CAP_CITY_LEVEL_TROOPS,
  DELETE_COOLDOWN_TICKS,
  FACTORY_CITY_BONUS_PCT_BY_LEVEL,
  FACTORY_GOLD_MILLI_BY_LEVEL,
  FACTORY_RADIUS_CELLS_BY_LEVEL,
  PORT_GOLD_MILLI_BY_LEVEL,
  PORT_TRADE_PCT_BY_LEVEL,
  POST_RADIUS_CELLS,
  REJECT_BUILD_GOLD,
  REJECT_DELETE_COOLDOWN,
  REJECT_NONE,
  REJECT_STRUCT_BUSY,
  REJECT_STRUCT_ID,
  REJECT_STRUCT_MAX_LEVEL,
  REJECT_STRUCT_NOT_OWNER,
  SAM_MOUNTAIN_PCT,
  STRUCT_CITY,
  STRUCT_FACTORY,
  STRUCT_LEVEL_HARD_CAP,
  STRUCT_PORT,
  STRUCT_POST,
  STRUCT_SAM,
  STRUCT_SILO,
  TICK_HZ,
  cityGoldMilli,
  cityTroopCap,
  maxLevelOf,
  samRadiusCells,
  upgradePriceGold,
  upgradeTicksOf,
} from '../../src/sim/public';
import { BUILD_BASE_GOLD, BUILD_TICKS, MILLI_GOLD_PER_GOLD } from '../../src/sim/rules';
import { createState, rebuildAggregates, type GameState } from '../../src/sim/state';
import { applyIntent, step } from '../../src/sim/step';
import { CLASS_PLAINS } from '../../src/sim/terrain';
import { StateView } from '../../src/sim/view';
import { buildRejectKey, structureRefusalKey } from '../../src/ui/buildReasons';
import { rejectKey } from '../../src/ui/hudLogic';
import { formatGold, formatGoldRate, formatInt, formatShownGold, t } from '../../src/ui/i18n';
import { GOLD_DISPLAY_FACTOR } from '../../src/ui/uiConfig';
import {
  DELETE_ARM_MS,
  deleteArmed,
  deleteClick,
  deleteWhyKey,
  effectLines,
  rangeRingCells,
  selectionInfo,
  structureNameKey,
  upgradeWhyKey,
} from '../../src/ui/structureInfo';

/** Gold per second as the panel shows it: the sim number times GOLD_DISPLAY_FACTOR, at most two decimals, the Swedish decimal comma (derived from the constant, not from the formatter under test). */
const shown = (goldPerSec: number): string => String(Math.round(goldPerSec * GOLD_DISPLAY_FACTOR * 100) / 100).replace('.', ',');

describe('effectLines: the numbers of the structure\'s own level, from the sim tables', () => {
  it('Factory: gold, City bonus and reach per level', () => {
    for (const level of [1, 2, 3]) {
      const l = effectLines(STRUCT_FACTORY, level)[0];
      expect(l?.key).toBe('sel.fx.factory');
      expect(l?.params.pct).toBe(FACTORY_CITY_BONUS_PCT_BY_LEVEL[level]);
      expect(l?.params.radius).toBe(FACTORY_RADIUS_CELLS_BY_LEVEL[level]);
      expect(l?.params.gold).toBe(shown([0, 2, 2.5, 2.8][level] as number)); // Sim-Levels2: the concave curve 2 / 2,5 / 2,8 gold/s, shown x GOLD_DISPLAY_FACTOR (Look-2)
      expect(l?.params.gold).toBe(formatGoldRate(factoryGoldMilliAt(level)));
      expect(FACTORY_GOLD_MILLI_BY_LEVEL[level]).toBe([0, 2000, 2500, 2800][level]);
    }
    expect(new Set([1, 2, 3].map((l) => JSON.stringify(effectLines(STRUCT_FACTORY, l)))).size).toBe(3);
  });

  it('Port: gold and trade share per level', () => {
    for (const level of [1, 2, 3]) {
      const l = effectLines(STRUCT_PORT, level)[0];
      expect(l?.key).toBe('sel.fx.port');
      expect(l?.params.pct).toBe(PORT_TRADE_PCT_BY_LEVEL[level]);
    }
    // Sim-Levels2: 2 / 2,5 / 2,8 gold/s, shown x GOLD_DISPLAY_FACTOR (Look-2)
    expect(effectLines(STRUCT_PORT, 1)[0]?.params.gold).toBe(shown(2));
    expect(effectLines(STRUCT_PORT, 2)[0]?.params.gold).toBe(shown(2.5));
    expect(effectLines(STRUCT_PORT, 3)[0]?.params.gold).toBe(shown(2.8));
    expect(PORT_GOLD_MILLI_BY_LEVEL[2]).toBe(2500);
  });

  it('Factory, Port and the City follow the Sim-Levels2 curve functions of the structure\'s own level far beyond level 10 (up to the hard cap)', () => {
    for (const level of [1, 2, 3, 10, 11, 50, 100, 500, STRUCT_LEVEL_HARD_CAP]) {
      expect(effectLines(STRUCT_FACTORY, level)[0]?.params).toEqual({ gold: formatGoldRate(factoryGoldMilliAt(level)), pct: factoryCityBonusPctAt(level), radius: factoryRadiusCellsAt(level) });
      expect(effectLines(STRUCT_PORT, level)[0]?.params).toEqual({ gold: formatGoldRate(portGoldMilliAt(level)), pct: portTradePctAt(level) });
      expect(effectLines(STRUCT_CITY, level)[0]?.params).toEqual({ gold: formatGoldRate(cityGoldMilliAt(level)), troops: formatInt(cityTroopCapAt(level)) });
    }
    // concave: the step from level 10 to 999 is smaller than the step from level 1 to 10, and a level 999 City stays under its asymptote 3 gold/s (30 shown)
    expect(factoryGoldMilliAt(999) - factoryGoldMilliAt(10)).toBeLessThan(factoryGoldMilliAt(10) - factoryGoldMilliAt(1));
    expect(cityGoldMilliAt(STRUCT_LEVEL_HARD_CAP)).toBeLessThan(3000);
    expect(effectLines(STRUCT_CITY, STRUCT_LEVEL_HARD_CAP)[0]?.params.gold).toBe(formatGoldRate(cityGoldMilliAt(STRUCT_LEVEL_HARD_CAP)));
  });

  it('City: gold and troop cap follow the sim per level, levels 1 to 10 (thousands grouped)', () => {
    expect(effectLines(STRUCT_CITY, 1)[0]?.params).toEqual({ gold: shown(1.5), troops: formatInt(CAP_CITY_LEVEL_TROOPS) });
    for (const level of [2, 3, 5, 10, maxLevelOf(STRUCT_CITY)]) {
      // Look-2: gold per second is shown x GOLD_DISPLAY_FACTOR with up to two decimals (formatGoldRate)
      expect(effectLines(STRUCT_CITY, level)[0]?.params.gold).toBe(formatGoldRate(cityGoldMilli(level)));
      expect(effectLines(STRUCT_CITY, level)[0]?.params.troops).toBe(formatInt(cityTroopCap(level)));
    }
    // Sim-Levels2 pins: the concave curve (level 2: 1,875 gold/s; level 3: 2,1 gold/s and 1 440 troops; level 10: 2,625 and 2 000), the gold shown x GOLD_DISPLAY_FACTOR with up to two decimals
    expect(effectLines(STRUCT_CITY, 2)[0]?.params.gold).toBe(shown(1.875));
    expect(effectLines(STRUCT_CITY, 3)[0]?.params).toEqual({ gold: shown(2.1), troops: formatInt(1440) });
    expect(effectLines(STRUCT_CITY, 10)[0]?.params).toEqual({ gold: shown(2.625), troops: formatInt(2000) });
  });

  it('the Silo has no function yet (no radius, not the SAM text); the SAM takes its mountain percent from the sim; the Post says 2,5 times', () => {
    const silo = effectLines(STRUCT_SILO, 1)[0];
    expect(silo).toEqual({ key: 'sel.fx.silo', params: {} });
    expect(t('sel.fx.silo')).not.toMatch(/\d/);
    const sam = effectLines(STRUCT_SAM, 2, true)[0];
    expect(sam?.key).toBe('sel.fx.sam');
    expect(sam?.params).toEqual({ radius: samRadiusCells(2, true), pct: SAM_MOUNTAIN_PCT - 100 });
    expect(effectLines(STRUCT_SAM, 2, false)[0]?.params.radius).toBe(samRadiusCells(2, false));
    expect(effectLines(STRUCT_POST, 1)[0]?.params).toEqual({ mult: '2,5', radius: POST_RADIUS_CELLS });
    expect(effectLines(99, 1)).toEqual([]);
  });

  it('the ring radius and the names: Silo and SAM are different things', () => {
    expect(rangeRingCells(STRUCT_SILO, 1, false)).toBe(0);
    expect(rangeRingCells(STRUCT_SAM, 3, true)).toBe(samRadiusCells(3, true));
    const names = [STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_SILO, STRUCT_SAM, STRUCT_POST].map(structureNameKey);
    expect(new Set(names).size).toBe(6);
    expect(structureNameKey(STRUCT_SILO)).toBe('hud.build.silo');
    expect(structureNameKey(STRUCT_SAM)).toBe('hud.build.sam');
  });
});

// ---- selectionInfo over a real sim state --------------------------------------------------------------------------------------------------

const W = 128;
const H = 64;
const at = (x: number, y: number): number => y * W + x;
function world(): GameState {
  const terrain = new Uint8Array(W * H).fill(CLASS_PLAINS);
  const s = createState({ width: W, height: H, seed: 3, seats: 2, config: { debugIntents: true }, terrain, elevation: new Uint16Array(W * H) });
  for (let c = 0; c < W * H; c++) s.owner[c] = c % W < 64 ? 1 : 2;
  rebuildAggregates(s);
  s.gold[1] = 1000000 * MILLI_GOLD_PER_GOLD;
  s.gold[2] = 1000000 * MILLI_GOLD_PER_GOLD;
  return s;
}
let nextId = 0;
const send = (s: GameState, body: Record<string, unknown>): number => applyIntent(s, withId(body as never, nextId++));
const idle = (s: GameState, n: number): void => {
  for (let i = 0; i < n; i++) step(s, { turn: s.tick, intents: [] });
};

describe('selectionInfo', () => {
  it('under construction, finished, upgrading, the price of the NEXT level, and the top level', () => {
    const s = world();
    send(s, { kind: 'Build', seat: 0, type: STRUCT_FACTORY, cell: at(10, 10) });
    const id = s.structures.idAt(at(10, 10));
    let info = selectionInfo(new StateView(s), 0, id);
    expect(info?.finished).toBe(false);
    expect(info?.owned).toBe(true);
    expect(info?.type).toBe(STRUCT_FACTORY);
    expect(info?.upgradeReason).toBe(REJECT_STRUCT_BUSY);
    idle(s, BUILD_TICKS[STRUCT_FACTORY] as number);
    info = selectionInfo(new StateView(s), 0, id);
    expect(info?.finished).toBe(true);
    expect(info?.upgrading).toBe(false);
    expect(info?.level).toBe(1);
    expect(info?.upgradePrice).toBe(upgradePriceGold(STRUCT_FACTORY, 2));
    expect(info?.upgradeReason).toBe(REJECT_NONE);
    send(s, { kind: 'Upgrade', seat: 0, structure: id });
    idle(s, 2);
    info = selectionInfo(new StateView(s), 0, id);
    expect(info?.upgrading).toBe(true);
    expect(info?.finished).toBe(true);
    idle(s, (BUILD_TICKS[STRUCT_FACTORY] as number) + 1);
    info = selectionInfo(new StateView(s), 0, id);
    expect(info?.level).toBe(2);
    expect(info?.upgradePrice).toBe(upgradePriceGold(STRUCT_FACTORY, 3)); // the price of level 3, not of the current level 2
    send(s, { kind: 'Upgrade', seat: 0, structure: id });
    idle(s, (BUILD_TICKS[STRUCT_FACTORY] as number) + 1);
    info = selectionInfo(new StateView(s), 0, id);
    expect([info?.level, info?.upgradePrice, info?.upgradeReason]).toEqual([3, upgradePriceGold(STRUCT_FACTORY, 4), REJECT_NONE]); // Sim-Levels2: level 3 is no top any more
  });

  it('a City climbs to level 10: the price of the next level is the sim\'s, 0 only at the top; the other types stop at level 3', () => {
    const s = world();
    const city = s.structures.add(STRUCT_CITY, 1, at(10, 10), 0);
    s.structures.readyTick[city] = 0;
    for (const level of [1, 3, 5, 9]) {
      s.structures.level[city] = level;
      const info = selectionInfo(new StateView(s), 0, city);
      expect(info?.upgradePrice).toBe(upgradePriceGold(STRUCT_CITY, level + 1));
      expect(info?.upgradeSeconds).toBe(upgradeTicksOf(STRUCT_CITY, level + 1) / TICK_HZ);
      expect(info?.upgradeSeconds).toBeGreaterThan(0);
    }
    s.structures.level[city] = maxLevelOf(STRUCT_CITY);
    const top = selectionInfo(new StateView(s), 0, city);
    expect([top?.level, top?.upgradePrice, top?.upgradeSeconds, top?.upgradeReason]).toEqual([maxLevelOf(STRUCT_CITY), 0, 0, REJECT_STRUCT_MAX_LEVEL]);
    const port = s.structures.add(STRUCT_PORT, 1, at(20, 10), 0);
    s.structures.readyTick[port] = 0;
    s.structures.level[port] = maxLevelOf(STRUCT_PORT);
    expect(selectionInfo(new StateView(s), 0, port)?.upgradePrice).toBe(0);
  });

  it('Integration Sim-Levels2 + Look-2: every type offers its upgrade at levels 10, 11, 100 and 998 for base x level (shown through the one formatter); only the hard cap closes it', () => {
    const s = world();
    let x = 10;
    for (const type of [STRUCT_CITY, STRUCT_FACTORY, STRUCT_PORT, STRUCT_SILO, STRUCT_SAM, STRUCT_POST]) {
      const id = s.structures.add(type, 1, at((x += 8), 10), 0);
      s.structures.readyTick[id] = 0;
      for (const level of [10, 11, 100, STRUCT_LEVEL_HARD_CAP - 1]) {
        s.structures.level[id] = level;
        const info = selectionInfo(new StateView(s), 0, id);
        expect(info?.upgradePrice, `type ${type} level ${level}`).toBe((BUILD_BASE_GOLD[type] as number) * (level + 1));
        expect(info?.upgradePrice).toBe(upgradePriceGold(type, level + 1));
        expect(info?.upgradeReason).toBe(REJECT_NONE);
        expect(info?.upgradeSeconds).toBe(upgradeTicksOf(type, level + 1) / TICK_HZ);
        expect(t('sel.upgrade', { price: formatGold(info?.upgradePrice as number) })).toBe(`Uppgradera (${formatGold((BUILD_BASE_GOLD[type] as number) * (level + 1))})`);
      }
      s.structures.level[id] = STRUCT_LEVEL_HARD_CAP;
      const top = selectionInfo(new StateView(s), 0, id);
      expect([top?.upgradePrice, top?.upgradeSeconds, top?.upgradeReason]).toEqual([0, 0, REJECT_STRUCT_MAX_LEVEL]);
    }
    // the dearest price of the game: a Silo to level 999 = 1 000 x 999 gold, a compact text whatever the display factor
    expect(formatGold(upgradePriceGold(STRUCT_SILO, STRUCT_LEVEL_HARD_CAP))).toBe(formatShownGold(999_000 * GOLD_DISPLAY_FACTOR));
  });

  it('somebody else\'s structure: not owned, not-owner reasons; a gone or out-of-range id gives null', () => {
    const s = world();
    send(s, { kind: 'Build', seat: 1, type: STRUCT_CITY, cell: at(100, 10) });
    const theirs = s.structures.idAt(at(100, 10));
    const info = selectionInfo(new StateView(s), 0, theirs);
    expect(info?.owned).toBe(false);
    expect(info?.upgradeReason).toBe(REJECT_STRUCT_NOT_OWNER);
    expect(info?.deleteReason).toBe(REJECT_STRUCT_NOT_OWNER);
    expect(selectionInfo(new StateView(s), 0, 57)).toBeNull();
    expect(selectionInfo(new StateView(s), 0, -1)).toBeNull();
    expect(selectionInfo(new StateView(s), 0, 0.5)).toBeNull();
    send(s, { kind: 'Delete', seat: 1, structure: theirs });
    idle(s, 3);
    expect(selectionInfo(new StateView(s), 1, theirs)).toBeNull(); // a deleted slot
  });

  it('the delete seconds count down from the sim cooldown', () => {
    const s = world();
    send(s, { kind: 'Build', seat: 0, type: STRUCT_POST, cell: at(10, 10) });
    send(s, { kind: 'Build', seat: 0, type: STRUCT_POST, cell: at(40, 40) });
    const a = s.structures.idAt(at(10, 10));
    const b = s.structures.idAt(at(40, 40));
    idle(s, BUILD_TICKS[STRUCT_POST] as number);
    expect(selectionInfo(new StateView(s), 0, b)?.deleteSeconds).toBe(0);
    send(s, { kind: 'Delete', seat: 0, structure: a });
    idle(s, 1);
    const info = selectionInfo(new StateView(s), 0, b);
    expect(info?.deleteReason).toBe(REJECT_DELETE_COOLDOWN);
    expect(info?.cooldownSeconds).toBe(DELETE_COOLDOWN_TICKS / 10);
    expect(info?.deleteSeconds).toBeGreaterThan(0);
    expect(info?.deleteSeconds).toBeLessThanOrEqual(info?.cooldownSeconds ?? 0);
    // rounded UP to whole seconds, one tick before the end still says 1 s
    const v = new StateView(s);
    const wait = v.structures.deleteReadyTick(1) - v.tick;
    expect(wait % 10).not.toBe(0); // a tick that is not a whole second, so that up and down differ
    expect(info?.deleteSeconds).toBe(Math.ceil(wait / 10));
    idle(s, wait - 1);
    expect(selectionInfo(new StateView(s), 0, b)?.deleteSeconds).toBe(1);
  });
});

describe('refusal keys', () => {
  it('every Upgrade / Delete reason has its own tooltip key; unknown codes fall to reject.other', () => {
    expect(upgradeWhyKey(REJECT_STRUCT_NOT_OWNER)).toBe('sel.why.notOwner');
    expect(upgradeWhyKey(REJECT_STRUCT_MAX_LEVEL)).toBe('sel.why.maxLevel');
    expect(upgradeWhyKey(REJECT_STRUCT_ID)).toBe('sel.why.gone');
    expect(upgradeWhyKey(REJECT_BUILD_GOLD)).toBe('sel.why.gold');
    expect(upgradeWhyKey(REJECT_STRUCT_BUSY)).toBe('sel.why.busy');
    expect(upgradeWhyKey(999)).toBe('reject.other');
    expect(deleteWhyKey(REJECT_STRUCT_NOT_OWNER)).toBe('sel.why.notOwner');
    expect(deleteWhyKey(REJECT_STRUCT_ID)).toBe('sel.why.gone');
    expect(deleteWhyKey(REJECT_DELETE_COOLDOWN)).toBe('sel.why.cooldown');
    expect(deleteWhyKey(999)).toBe('reject.other');
  });

  it('every Build / Upgrade / Delete refusal (21 to 38) maps to its own text, never to the raw "Avvisat (kod N)"', () => {
    const keys = new Set<string>();
    for (let code = 22; code <= 38; code++) {
      const k = rejectKey(code);
      expect(k, `code ${code}`).not.toBe('reject.other');
      expect(structureRefusalKey(code)).toBe(k);
      keys.add(k);
    }
    expect(keys.size).toBe(17); // 22..38 are 17 codes, one text each
    expect(buildRejectKey(23)).toBe('toast.build.peak'); // a peak is not a mountain
    expect(buildRejectKey(24)).toBe('toast.build.mountain');
    expect(buildRejectKey(REJECT_BUILD_GOLD)).toBe('toast.build.gold'); // not 'other'
    expect(rejectKey(0)).toBe('reject.other');
    expect(rejectKey(999)).toBe('reject.other');
    expect(t(rejectKey(29), { code: 29 })).not.toMatch(/Avvisat/);
    expect(t(rejectKey(REJECT_DELETE_COOLDOWN), { code: 38 })).not.toMatch(/Avvisat/);
  });
});

describe('the two-step Delete', () => {
  it('the first click arms for DELETE_ARM_MS, the second inside the time deletes, a late or other-structure click arms again', () => {
    let r = deleteClick(null, 4, 1000);
    expect(r.send).toBe(false);
    expect(r.arm).toEqual({ id: 4, until: 1000 + DELETE_ARM_MS });
    expect(deleteArmed(r.arm, 4, 1000 + DELETE_ARM_MS - 1)).toBe(true);
    expect(deleteArmed(r.arm, 4, 1000 + DELETE_ARM_MS)).toBe(false);
    expect(deleteArmed(r.arm, 5, 1100)).toBe(false);
    expect(deleteArmed(null, 4, 0)).toBe(false);
    const late = deleteClick(r.arm, 4, 1000 + DELETE_ARM_MS + 1);
    expect(late.send).toBe(false);
    const other = deleteClick(r.arm, 5, 1500);
    expect(other.send).toBe(false);
    expect(other.arm?.id).toBe(5);
    r = deleteClick(r.arm, 4, 2000);
    expect(r.send).toBe(true);
    expect(r.arm).toBeNull();
    expect(DELETE_ARM_MS).toBe(3000);
  });
});

describe('a refusal in the spawn phase (Fix-Sim phase gate)', () => {
  it('maps the sim REJECT_PHASE of a Build / Upgrade / Delete to the phase text, not the generic one', async () => {
    const { REJECT_PHASE } = await import('../../src/ui/hudCodes');
    expect(structureRefusalKey(REJECT_PHASE)).toBe('reject.phase');
  });
});
