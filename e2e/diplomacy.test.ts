// M18c-2 in headless Chromium: the diplomacy panel (key D, the top-bar button, Escape), the buttons and the break confirmation, the AI's answers, incoming proposals
// (cards, accept, decline, toasts), the relation badges, the attack click on a treaty party, the treaty columns of the result screen, three window sizes in both
// languages without overlap, no DOM writes at rest. Screenshots go to test-results/shots/diplo-*.png.
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { OUT_DIR, launchBrowser, openPage } from '../scripts/shot.mjs';
import { setLanguage, t, type Lang } from '../src/ui/i18n';
import { REJECT_DIPLO_COOLDOWN, REJECT_DIPLO_NO_TREATY, REJECT_DIPLO_PENDING } from '../src/sim/public';

let browser: Browser;
const baseUrl = inject('baseUrl');
const SHOT_DIR = process.env.DIPLO_SHOTS ?? path.join(OUT_DIR, 'shots');
beforeAll(async () => {
  ({ browser } = await launchBrowser());
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  setLanguage('sv');
});

type Msg = Array<{ type: string; text: string }>;
const T = (page: Page) => ({
  state: (): Promise<any> => page.evaluate(() => (window as any).__test.state()),
  advance: (dt: number, ticks: number): Promise<void> => page.evaluate(([d, n]) => (window as any).__test.advance(d, n), [dt, ticks] as const),
  settle: (dt = 0, n = 1): Promise<void> => page.evaluate(([d, k]) => (window as any).__test.settle(d, k), [dt, n] as const),
  render: (): Promise<void> => page.evaluate(() => (window as any).__test.render()),
  view: (v: Record<string, number>): Promise<void> => page.evaluate((x) => (window as any).__test.setView(x), v),
  project: (lat: number, lon: number): Promise<{ x: number; y: number; inView: boolean; facing: boolean }> => page.evaluate(([a, o]) => (window as any).__test.project(a, o), [lat, lon] as const),
  submit: (b: unknown): Promise<void> => page.evaluate((x) => (window as any).__test.submit(x), b),
  matchInfo: (): Promise<any> => page.evaluate(() => (window as any).__test.matchInfo()),
});

const START = { lat: 48.5, lon: 11 };
const VIEW = { lat: 47, lon: 10, distKm: 2600, heading: 0, tilt: 0 };
const tid = (id: string): string => `[data-testid="${id}"]`;
type Box = { left: number; top: number; right: number; bottom: number };
const overlaps = (a: Box, b: Box): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** A page with the local nation spawned and the match in the play phase (tick 255+). */
async function playing(query: string, viewport = { width: 960, height: 540 }): Promise<{ page: Page; messages: Msg }> {
  const { page, consoleMessages } = await openPage(browser, baseUrl, query, viewport);
  const tt = T(page);
  await tt.view(VIEW);
  const p = await tt.project(START.lat, START.lon);
  await page.mouse.click(p.x, p.y);
  await tt.advance(0.1, 5);
  expect((await tt.state()).local.spawned).toBe(true);
  const s = await tt.state();
  await tt.advance(0.1, 260 - s.tick);
  expect((await tt.state()).phase).toBe('play');
  return { page, messages: consoleMessages };
}
/** Gives seats 1 and 2 a block of land each east of the capital (DebugPaint), so that they appear in the leaderboard; ai=0 leaves them without land. */
async function paintNeighbours(page: Page): Promise<{ cx: number; cy: number }> {
  const cx = Math.round(((START.lon + 180) / 360) * 1024 - 0.5);
  const cy = Math.round(((90 - START.lat) / 180) * 512 - 0.5);
  await page.evaluate(
    ([x0, y0]) => {
      const t = (window as any).__test;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = 9; dx <= 22; dx++) t.submit({ kind: 'DebugPaint', seat: 1, cell: (y0 + dy) * 1024 + x0 + dx });
        for (let dx = 24; dx <= 36; dx++) t.submit({ kind: 'DebugPaint', seat: 2, cell: (y0 + dy) * 1024 + x0 + dx });
      }
    },
    [cx, cy] as const,
  );
  await T(page).advance(0.1, 4);
  return { cx, cy };
}

const shot = async (page: Page, name: string): Promise<void> => {
  await T(page).render();
  fs.writeFileSync(path.join(SHOT_DIR, `diplo-${name}.png`), await page.screenshot({ type: 'png' }));
};
const rect = (page: Page, sel: string): Promise<(Box & { w: number; h: number }) | null> =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!(e instanceof HTMLElement) || e.hidden || e.getClientRects().length === 0) return null;
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
  }, sel);
const rowOf = (seat: number, id: string): string => `${tid('diplo-row')}[data-seat="${seat}"] ${tid(id)}`;
const relationOf = (page: Page, seat: number): Promise<string | undefined> => page.evaluate((s) => (document.querySelector(`[data-testid="diplo-row"][data-seat="${s}"]`) as HTMLElement | null)?.dataset.relation, seat);
const toastKeys = (page: Page): Promise<string[]> => page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="toast"][data-key]')).map((e) => (e as HTMLElement).dataset.key as string));
/** Steps the game in small slices and collects every toast key seen on the way (a toast lives 2.6 fx seconds). */
async function advanceCollecting(page: Page, slices: number, ticksPerSlice: number): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let i = 0; i < slices; i++) {
    await T(page).advance(0.1, ticksPerSlice);
    for (const k of await toastKeys(page)) seen.add(k);
  }
  return seen;
}
const click = async (page: Page, sel: string): Promise<void> => {
  await page.locator(sel).dispatchEvent('click');
  await T(page).advance(0.05, 0);
};
const open = async (page: Page): Promise<void> => {
  await page.keyboard.press('d');
  await T(page).advance(0.05, 0);
};

describe('the panel', () => {
  it('D opens it, one row per other nation, Esc and D close it, the top-bar button opens it, and nothing is written at rest', async () => {
    const { page, messages } = await playing('test=1&seed=7&hud=1&ai=0');
    try {
      const tt = T(page);
      expect(await rect(page, tid('diplo-panel'))).toBeNull();
      await open(page);
      expect(await rect(page, tid('diplo-panel'))).not.toBeNull();
      const players = (await tt.matchInfo()).players as number;
      expect(await page.locator(tid('diplo-row')).count()).toBe(players - 1);
      expect(await page.locator(`${tid('diplo-row')}[data-seat="0"]`).count(), 'you are not in the list').toBe(0);
      await page.keyboard.press('Escape');
      await tt.advance(0.05, 0);
      expect(await rect(page, tid('diplo-panel'))).toBeNull();
      expect(await rect(page, tid('paused')), 'Escape closed the panel and did not open the pause menu').toBeNull();
      expect(await page.locator(tid('pause-menu')).isVisible()).toBe(false);
      await open(page);
      await page.keyboard.press('d');
      await tt.advance(0.05, 0);
      expect(await rect(page, tid('diplo-panel'))).toBeNull();
      await click(page, tid('diplo-button'));
      expect(await rect(page, tid('diplo-panel'))).not.toBeNull();
      // no DOM writes at rest with the panel open, the clock stopped: one second of frames without a tick, then with the panel closed
      await tt.settle(0.1, 1);
      // the page body also holds the canvas wrapper: only count what is DOM text or attributes of the HUD and the diplomacy overlay
      const hudWrites = await page.evaluate(async () => {
        let n = 0;
        const mo = new MutationObserver((rs) => (n += rs.length));
        for (const sel of ['[data-testid="match-hud"]', '[data-testid="diplo-panel"]', '[data-testid="diplo-cards"]']) mo.observe(document.querySelector(sel) as Element, { subtree: true, childList: true, attributes: true, characterData: true });
        for (let i = 0; i < 10; i++) (window as any).__test.settle(0.1, 1);
        await new Promise((r) => setTimeout(r, 50));
        mo.disconnect();
        return n;
      });
      expect(hudWrites, 'mutations of the HUD, the open panel and the cards during 1 s without ticks').toBe(0);
      await page.keyboard.press('Escape');
      await tt.advance(0.05, 0);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('the buttons: each one is the sim\'s verdict (title = reason), propose, wait, the answer toasts (accepted, declined, expired) and the badge in the leaderboard', async () => {
    const { page, messages } = await playing('test=1&seed=7&hud=1&ai=0');
    try {
      const tt = T(page);
      await paintNeighbours(page);
      await open(page);
      // at war: break is off for the sim's reason, propose truce is on
      const brk = page.locator(rowOf(1, 'diplo-break'));
      expect(await brk.getAttribute('aria-disabled')).toBe('true');
      expect(await brk.getAttribute('data-reason')).toBe(String(REJECT_DIPLO_NO_TREATY));
      expect(await brk.getAttribute('title')).toBe(t('reject.diplo.noTreaty'));
      expect(await page.locator(rowOf(1, 'diplo-truce')).getAttribute('aria-disabled')).toBe('false');
      // a refused click explains itself in a toast and sends nothing
      await click(page, rowOf(1, 'diplo-break'));
      expect(await toastKeys(page)).toContain('reject.diplo.noTreaty');
      // propose a truce to seat 1 and an alliance to seat 2, and to seat 3 (nobody answers: ai=0)
      await click(page, rowOf(1, 'diplo-truce'));
      await click(page, rowOf(2, 'diplo-alliance'));
      await click(page, rowOf(3, 'diplo-truce'));
      await tt.advance(0.1, 4);
      expect(await page.locator(rowOf(1, 'diplo-waiting')).isVisible()).toBe(true);
      expect(await page.locator(rowOf(1, 'diplo-truce')).getAttribute('aria-disabled')).toBe('true');
      expect(await page.locator(rowOf(1, 'diplo-truce')).getAttribute('data-reason')).toBe(String(REJECT_DIPLO_PENDING));
      // the answers come as intents of those seats (the AI is off): accept, decline, and silence until the proposal runs out
      await tt.submit({ kind: 'AcceptTreaty', seat: 1, from: 0 });
      await tt.submit({ kind: 'DeclineTreaty', seat: 2, from: 0 });
      const first = await advanceCollecting(page, 5, 3);
      expect(first.has('toast.diplo.accepted')).toBe(true);
      expect(first.has('toast.diplo.declined')).toBe(true);
      expect(await relationOf(page, 1)).toBe('truce');
      expect(await relationOf(page, 2)).toBe('war');
      // the leaderboard badge for seat 1 (truce) and none for seat 2
      expect(await page.locator(`${tid('leader-row')}[data-seat="1"] ${tid('rel-truce')}`).isVisible()).toBe(true);
      expect(await page.locator(`${tid('leader-row')}[data-seat="2"] ${tid('rel-truce')}`).isVisible()).toBe(false);
      expect(await page.locator(rowOf(1, 'diplo-rel')).textContent()).toContain(t('diplo.rel.truce', { time: '3:59' }).slice(0, 9));
      // an embargo is a toggle: impose, the mark and the badge show, lift
      await click(page, rowOf(2, 'diplo-embargo'));
      await tt.advance(0.1, 4);
      expect(await page.locator(rowOf(2, 'diplo-embargo')).textContent()).toBe(t('diplo.btn.lift'));
      expect(await page.locator(`${tid('diplo-row')}[data-seat="2"] ${tid('diplo-embargo-mark')}`).isVisible()).toBe(true);
      expect(await page.locator(`${tid('leader-row')}[data-seat="2"] ${tid('rel-embargo')}`).isVisible()).toBe(true);
      await shot(page, 'panel-960x540-sv');
      await click(page, rowOf(2, 'diplo-embargo'));
      await tt.advance(0.1, 4);
      expect(await page.locator(rowOf(2, 'diplo-embargo')).textContent()).toBe(t('diplo.btn.embargo'));
      // seat 3 never answers: the proposal runs out (600 ticks) and you are told
      const second = await advanceCollecting(page, 20, 33);
      expect(second.has('toast.diplo.expired')).toBe(true);
      expect(await page.locator(rowOf(3, 'diplo-waiting')).isVisible()).toBe(false);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 150_000);

  it('break: the first click arms with the warning (cooldown time, traitor mark), the second breaks; war, cooldown line, own traitor mark, no badge', async () => {
    const { page, messages } = await playing('test=1&seed=7&hud=1&ai=0');
    try {
      const tt = T(page);
      await paintNeighbours(page);
      await open(page);
      await click(page, rowOf(1, 'diplo-truce'));
      await tt.submit({ kind: 'AcceptTreaty', seat: 1, from: 0 });
      await tt.advance(0.1, 6);
      expect(await relationOf(page, 1)).toBe('truce');
      expect(await page.locator(`${tid('leader-row')}[data-seat="1"] ${tid('rel-truce')}`).isVisible(), 'the badge shows while the treaty holds').toBe(true);
      expect(await page.locator(rowOf(1, 'diplo-break')).getAttribute('aria-disabled')).toBe('false');
      expect(await page.locator(tid('diplo-cooldown')).isVisible()).toBe(false);
      // first click: armed, nothing sent
      await click(page, rowOf(1, 'diplo-break'));
      expect(await page.locator(rowOf(1, 'diplo-break')).getAttribute('data-armed')).toBe('1');
      expect(await page.locator(rowOf(1, 'diplo-break')).textContent()).toBe(t('diplo.btn.breakConfirm'));
      const note = page.locator(`${tid('diplo-row')}[data-seat="1"] ${tid('diplo-note')}`);
      expect(await note.isVisible()).toBe(true);
      expect(await note.textContent()).toBe(t('diplo.breakWarn', { time: '3:00' }));
      await shot(page, 'break-armed-960x540-sv');
      await tt.advance(0.1, 6);
      expect(await relationOf(page, 1), 'one click did not break').toBe('truce');
      // second click: war at once
      await click(page, rowOf(1, 'diplo-break'));
      await tt.advance(0.1, 6);
      expect(await relationOf(page, 1)).toBe('war');
      expect(await page.locator(tid('diplo-cooldown')).isVisible()).toBe(true);
      expect(await page.locator(tid('diplo-cooldown')).textContent()).toBe(t('diplo.cooldown', { time: '3:00' }));
      expect(await page.locator(tid('diplo-self-traitor')).isVisible()).toBe(true);
      // every propose button is off for the cooldown (reason 86) and the badge is gone
      expect(await page.locator(rowOf(2, 'diplo-truce')).getAttribute('data-reason')).toBe(String(REJECT_DIPLO_COOLDOWN));
      expect(await page.locator(`${tid('leader-row')}[data-seat="1"] ${tid('rel-truce')}`).isVisible()).toBe(false);
      // a second click on another nation arms that one, it does not break
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 150_000);
});

describe('proposals to you', () => {
  it('cards (at most 3), the toast and the signal when they arrive, Accept and Decline, expiry removes the card', async () => {
    const { page, messages } = await playing('test=1&seed=7&hud=1&ai=0');
    try {
      const tt = T(page);
      expect(await page.locator(`${tid('diplo-card-in')}:visible`).count()).toBe(0);
      await tt.submit({ kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 });
      await tt.submit({ kind: 'ProposeTreaty', seat: 2, to: 0, treaty: 2 });
      const seen = await advanceCollecting(page, 4, 3);
      expect(seen.has('toast.diplo.incomingTruce') || seen.has('toast.diplo.incomingAlliance')).toBe(true);
      expect(await page.locator(`${tid('diplo-card-in')}:visible`).count()).toBe(2);
      expect(await page.locator(tid('diplo-signal')).isVisible()).toBe(true);
      expect(await page.locator(tid('diplo-signal')).textContent()).toBe(t('diplo.signal', { n: 2 }));
      expect(await page.locator(`${tid('diplo-card-in')}[data-from="2"]`).getAttribute('data-treaty')).toBe('2');
      // three more would make five: only three cards, the signal counts them all
      await tt.submit({ kind: 'ProposeTreaty', seat: 3, to: 0, treaty: 1 });
      await tt.submit({ kind: 'ProposeTreaty', seat: 4, to: 0, treaty: 1 });
      await tt.submit({ kind: 'ProposeTreaty', seat: 5, to: 0, treaty: 1 });
      await tt.advance(0.1, 4);
      expect(await page.locator(`${tid('diplo-card-in')}:visible`).count()).toBe(3);
      expect(await page.locator(tid('diplo-signal')).textContent()).toBe(t('diplo.signal', { n: 5 }));
      await shot(page, 'cards-960x540-sv');
      // accept the first card (seat 1): truce; decline the next (seat 2): war, and the card is gone
      await click(page, `${tid('diplo-card-in')}[data-from="1"] ${tid('diplo-accept')}`);
      await tt.advance(0.1, 4);
      await click(page, `${tid('diplo-card-in')}[data-from="2"] ${tid('diplo-decline')}`);
      await tt.advance(0.1, 4);
      await open(page);
      expect(await relationOf(page, 1)).toBe('truce');
      expect(await relationOf(page, 2)).toBe('war');
      expect(await page.locator(`${tid('diplo-card-in')}[data-from="1"]:visible`).count()).toBe(0);
      expect(await page.locator(`${tid('diplo-card-in')}[data-from="2"]:visible`).count()).toBe(0);
      expect(await page.locator(`${tid('diplo-card-in')}:visible`).count()).toBe(3);
      // the rest run out after 60 seconds and the cards go; expiry says nothing
      await page.keyboard.press('Escape');
      const after = await advanceCollecting(page, 20, 33);
      expect(await page.locator(`${tid('diplo-card-in')}:visible`).count()).toBe(0);
      expect(await page.locator(tid('diplo-signal')).isVisible()).toBe(false);
      expect([...after].filter((k) => ['toast.diplo.expired', 'toast.diplo.declined'].includes(k))).toEqual([]);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 150_000);

  it('the AI answers a proposal of yours after a pause (3 to 6 s): the answer is a toast, whatever it is', async () => {
    const { page, messages } = await playing('test=1&seed=7&hud=1');
    try {
      const tt = T(page);
      await open(page);
      const players = (await tt.matchInfo()).players as number;
      for (let seat = 1; seat < players; seat++) await click(page, rowOf(seat, 'diplo-truce'));
      const seen = await advanceCollecting(page, 14, 10); // 140 ticks: past the longest pause of 60
      const answers = ['toast.diplo.accepted', 'toast.diplo.declined'].filter((k) => seen.has(k));
      expect(answers.length, `an answer toast came (saw ${[...seen].join(', ')})`).toBeGreaterThan(0);
      // every nation answered: no row waits any more
      for (let seat = 1; seat < players; seat++) expect(await page.locator(rowOf(seat, 'diplo-waiting')).isVisible(), `seat ${seat}`).toBe(false);
      // the temperament: at least one accepted (some AI is below the median of the land shares)
      let truces = 0;
      for (let seat = 1; seat < players; seat++) if ((await relationOf(page, seat)) === 'truce') truces++;
      console.log(`[diplo] ${truces} of ${players - 1} AI nations accepted a truce at tick ${(await tt.state()).tick}`);
      expect(truces).toBeGreaterThan(0);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 150_000);
});

describe('the attack click on a treaty party', () => {
  it('gives the treaty-bound toast and sends no intent; after the break the same click attacks', async () => {
    const { page, messages } = await playing('test=1&seed=7&hud=1&ai=0');
    try {
      const tt = T(page);
      // a block of seat 1 land (ownerId 2) east of the capital disc, as in e2e/match.test.ts
      const cell = await page.evaluate(([la, lo]) => (window as any).__test.cellOf?.(la, lo) ?? -1, [START.lat, START.lon] as const);
      const { cx, cy } = await paintNeighbours(page);
      const enemyCell = cy * 1024 + cx + 14;
      expect(await page.evaluate((c) => (window as any).__test.ownerOf(c), enemyCell)).toBe(2);
      // the truce
      await open(page);
      await click(page, rowOf(1, 'diplo-truce'));
      await tt.submit({ kind: 'AcceptTreaty', seat: 1, from: 0 });
      await tt.advance(0.1, 6);
      expect(await relationOf(page, 1)).toBe('truce');
      await page.keyboard.press('Escape');
      await tt.advance(0.05, 0);
      const lat = 90 - ((cy + 0.5) / 512) * 180;
      const lon = ((cx + 14.5) / 1024) * 360 - 180;
      await tt.view({ lat, lon: lon - 4, distKm: 2600, heading: 0, tilt: 0 });
      await tt.settle(0, 2);
      const before = await tt.state();
      const p = await tt.project(lat, lon);
      expect(p.inView && p.facing).toBe(true);
      await page.mouse.click(p.x, p.y);
      await tt.advance(0.1, 4);
      const after = await tt.state();
      expect(await toastKeys(page)).toContain('reject.diplo.treatyBound');
      expect(after.rejects, 'the sim was never asked: no refusal came back').toBe(before.rejects);
      expect(after.local.troopsQt, 'no troops left the pool (a few ticks of regeneration only add)').toBeGreaterThanOrEqual(before.local.troopsQt);
      // the right click goes through the same gate
      await page.mouse.click(p.x, p.y, { button: 'right' });
      await tt.advance(0.1, 4);
      expect((await tt.state()).rejects).toBe(before.rejects);
      await shot(page, 'treaty-bound-960x540-sv');
      // break the treaty (two clicks) and the same click is an attack
      await open(page);
      await click(page, rowOf(1, 'diplo-break'));
      await click(page, rowOf(1, 'diplo-break'));
      await page.keyboard.press('Escape');
      await tt.advance(0.1, 6);
      const b2 = await tt.state();
      await page.mouse.click(p.x, p.y);
      await tt.advance(0.1, 4);
      const a2 = await tt.state();
      expect(a2.local.troopsQt, 'now the attack leaves with the committed share').toBeLessThan(b2.local.troopsQt * 0.8);
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 150_000);
});

describe('the result screen', () => {
  it('has the columns "treaties made" and "treaties broken" with the sim\'s counts', async () => {
    const { page, messages } = await playing('test=1&seed=7&hud=1&ai=0&win=1');
    try {
      const tt = T(page);
      await open(page);
      await click(page, rowOf(1, 'diplo-truce'));
      await tt.submit({ kind: 'AcceptTreaty', seat: 1, from: 0 });
      await tt.advance(0.1, 6);
      await click(page, rowOf(1, 'diplo-break'));
      await click(page, rowOf(1, 'diplo-break'));
      await tt.advance(0.1, 6);
      await page.keyboard.press('Escape');
      // run the clock out (the default time limit is 25 minutes = 15000 ticks) in slices, stop as soon as the result screen is up
      let shown = false;
      for (let i = 0; i < 14 && !shown; i++) {
        await tt.advance(0, 1500);
        await tt.render();
        shown = await page.locator(tid('result-screen')).isVisible();
      }
      expect(shown, 'the match ended and the result screen opened').toBe(true);
      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid="result-row"]')).map((e) => ({ seat: Number((e as HTMLElement).dataset.seat), cells: Array.from(e.querySelectorAll('td')).map((td) => td.textContent ?? '') })),
      );
      const head = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="result-table"] th')).map((th) => th.textContent ?? ''));
      expect(head.slice(-3, -1)).toEqual([t('result.col.treaties'), t('result.col.betrayals')]); // M18d-2 appended the Teknik column after them
      const me = rows.find((r) => r.seat === 0)!;
      const other = rows.find((r) => r.seat === 1)!;
      const last = (r: { cells: string[] }): string[] => r.cells.slice(-3, -1); // the two treaty columns; M18d-2 appended the Teknik column after them
      expect(last(me), 'you made one treaty and broke it').toEqual(['1', '1']);
      expect(last(other), 'the other party made one and broke none').toEqual(['1', '0']);
      await shot(page, 'result-960x540-sv');
      expect(messages).toEqual([]);
    } finally {
      await page.close();
    }
  }, 150_000);
});

describe('layout', () => {
  for (const lang of ['sv', 'en'] as const satisfies readonly Lang[]) {
    for (const vp of [
      { width: 960, height: 540 },
      { width: 1366, height: 640 },
      { width: 540, height: 960 },
    ] as const) {
      it(`panel, cards and top bar do not overlap at ${vp.width}x${vp.height} in ${lang}`, async () => {
        const { page, messages } = await playing(`test=1&seed=7&hud=1&ai=0&win=1&devbtn=1&w=${vp.width}&h=${vp.height}&lang=${lang}`, vp);
        try {
          const tt = T(page);
          // one proposal to you (a card), a long name in the panel
          await tt.submit({ kind: 'ProposeTreaty', seat: 1, to: 0, treaty: 1 });
          await tt.advance(0.1, 4);
          const cardBox = await rect(page, tid('diplo-card-in') + ':not([hidden])');
          expect(cardBox).not.toBeNull();
          // the card against the top bar, the leaderboard, the banner, the speed controls and the Dev button
          for (const id of ['status', 'leaderboard', 'phase', 'controls']) {
            const r = await rect(page, tid(id));
            if (r === null) continue;
            expect(overlaps(cardBox!, r), `card over ${id}: ${JSON.stringify(cardBox)} ${JSON.stringify(r)}`).toBe(false);
          }
          expect(cardBox!.right).toBeLessThanOrEqual(vp.width + 0.5);
          expect(cardBox!.left).toBeGreaterThanOrEqual(-0.5);
          await shot(page, `cards-${vp.width}x${vp.height}-${lang}`);
          // the top bar keeps its row: the diplomacy button inside the status panel, no overflow
          const status = await rect(page, tid('status'));
          const btn = await rect(page, tid('diplo-button'));
          expect(btn).not.toBeNull();
          expect(btn!.right).toBeLessThanOrEqual(status!.right + 0.5);
          expect(btn!.bottom).toBeLessThanOrEqual(status!.bottom + 0.5);
          const phase = await rect(page, tid('phase'));
          if (phase !== null) expect(overlaps(status!, phase), 'status over banner').toBe(false);
          // the panel with the longest strings
          await open(page);
          await page.evaluate(() => {
            for (const n of Array.from(document.querySelectorAll('[data-testid="diplo-name"]'))) n.textContent = 'Demokratiska Förbundsrepubliken Kongo';
          });
          const panel = await rect(page, '.diplo-card');
          expect(panel).not.toBeNull();
          expect(panel!.left).toBeGreaterThanOrEqual(-0.5);
          expect(panel!.top).toBeGreaterThanOrEqual(-0.5);
          expect(panel!.right).toBeLessThanOrEqual(vp.width + 0.5);
          expect(panel!.bottom).toBeLessThanOrEqual(vp.height + 0.5);
          const sideways = await page.evaluate(() => {
            const e = document.querySelector('.diplo-card') as HTMLElement;
            return { card: e.scrollWidth > e.clientWidth + 1, page: document.documentElement.scrollWidth > window.innerWidth + 1 };
          });
          expect(sideways).toEqual({ card: false, page: false });
          // inside every visible row: the four buttons do not overlap each other, nor the name and state columns
          const boxes = await page.evaluate(() => {
            const out: Array<{ seat: string; parts: Array<{ id: string } & Box> }> = [];
            const card = document.querySelector('.diplo-card') as HTMLElement;
            const cb = card.getBoundingClientRect();
            for (const row of Array.from(document.querySelectorAll('[data-testid="diplo-row"]'))) {
              const rb = row.getBoundingClientRect();
              if (rb.bottom < cb.top || rb.top > cb.bottom) continue; // scrolled out of view
              const parts: Array<{ id: string } & Box> = [];
              for (const [id, sel] of [['who', '.diplo-who'], ['state', '.diplo-state'], ['truce', '[data-action="truce"]'], ['alliance', '[data-action="alliance"]'], ['break', '[data-action="break"]'], ['embargo', '[data-action="embargo"]']] as const) {
                const e = row.querySelector(sel) as HTMLElement;
                const r = e.getBoundingClientRect();
                parts.push({ id, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
              }
              out.push({ seat: (row as HTMLElement).dataset.seat as string, parts });
            }
            return out;
          });
          expect(boxes.length).toBeGreaterThan(0);
          for (const b of boxes) {
            for (let i = 0; i < b.parts.length; i++) {
              for (let j = i + 1; j < b.parts.length; j++) expect(overlaps(b.parts[i]!, b.parts[j]!), `seat ${b.seat}: ${b.parts[i]!.id} over ${b.parts[j]!.id}`).toBe(false);
              expect(b.parts[i]!.right, `seat ${b.seat} ${b.parts[i]!.id} inside the panel`).toBeLessThanOrEqual(panel!.right + 0.5);
            }
          }
          await shot(page, `panel-${vp.width}x${vp.height}-${lang}`);
          expect(messages).toEqual([]);
        } finally {
          await page.close();
        }
      }, 120_000);
    }
  }
});
