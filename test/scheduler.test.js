'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Scheduler } = require('../src/main/scheduler');
const { isWithinActiveHours, isFullscreenState, nextActiveStart, AwayTracker } = require('../src/main/rules');
const { mergeDefaults, DEFAULTS } = require('../src/main/settings');
const { reminderDefs, reminderList, normalizeCustom, cleanItems, LIMITS, TIMER_MIN_SEC } = require('../src/main/reminders');
const content = require('../src/main/content');

const MIN = 1000; // 1 "minute" = 1s in tests
const TICK = 1000;
const ON = { counting: true, canShow: true };
const OFF = { enabled: false, intervalMin: 60 };

function cfg(over = {}) {
  return {
    move: { enabled: true, intervalMin: 60 },
    water: { enabled: true, intervalMin: 20 },
    posture: { enabled: true, intervalMin: 30 },
    custom: [],
    ...over,
  };
}

function make(over = {}) {
  return new Scheduler({ reminders: reminderDefs(cfg(over)), minuteMs: MIN, tickMs: TICK, now: 0 });
}

/** Tick forward `minutes`, answering every card that comes on screen with `action`. Returns the cards shown. */
function run(s, fromMs, minutes, cond = ON, action = 'done') {
  const events = [];
  let t = fromMs;
  for (let i = 0; i < minutes; i++) {
    t += TICK;
    const card = s.tick(t, cond);
    if (card) {
      events.push({ at: t / MIN, ...card });
      if (action) s.resolve(action);
    }
  }
  return { events, t };
}

// ---------------------------------------------------------------- timing

test('water fires every 20 minutes, posture staggered to 25, then every 30', () => {
  const s = make({ move: OFF });
  const { events } = run(s, 0, 56);
  assert.deepStrictEqual(events.map((e) => [e.at, e.id]), [[20, 'water'], [25, 'posture'], [40, 'water'], [55, 'posture']]);
});

test('a countdown never shows more than the interval', () => {
  const s = make();
  for (const [id, min] of [['move', 60], ['water', 20], ['posture', 30]]) {
    assert.ok(s.remainingMs(id) <= min * MIN, `${id}: ${s.remainingMs(id) / MIN} > ${min}`);
  }
});

test('reminders due together each get their own card, bigger first, answered separately', () => {
  const s = make();
  const { events, t } = run(s, 0, 60); // water 20, posture 25, water 40, posture 55; at 60 move and water together
  assert.deepStrictEqual(events.map((e) => [e.at, e.id]), [[20, 'water'], [25, 'posture'], [40, 'water'], [55, 'posture'], [60, 'move']]);
  // Answering Move only restarts Move: water is still due, as its own card.
  assert.strictEqual(s.remainingMs('move'), 60 * MIN);
  assert.strictEqual(s.remainingMs('water'), 0);
  assert.deepStrictEqual(s.tick(t + TICK, ON), { id: 'water', manual: false });
});

test('snooze re-fires after the snooze length', () => {
  const s = make({ move: OFF, posture: OFF });
  let { events, t } = run(s, 0, 20, ON, null);
  assert.strictEqual(events.length, 1);
  s.resolve('snooze', 3);
  ({ events } = run(s, t, 3, ON, null));
  assert.deepStrictEqual(events.map((e) => e.at), [23]);
});

test('time does not accrue while not counting (away / outside active hours)', () => {
  const s = make();
  let { events, t } = run(s, 0, 10);
  ({ events, t } = run(s, t, 100, { counting: false, canShow: false }));
  assert.strictEqual(events.length, 0);
  ({ events } = run(s, t, 10));
  assert.deepStrictEqual(events.map((e) => e.id), ['water']);
});

test('returning from away resets move and clears a move card', () => {
  const s = make();
  run(s, 0, 50);
  assert.strictEqual(s.remainingMs('move'), 10 * MIN);
  assert.strictEqual(s.returnedFromAway(), false);
  assert.strictEqual(s.remainingMs('move'), 60 * MIN);

  const s2 = make({ water: OFF, posture: OFF });
  run(s2, 0, 60, ON, null);
  assert.strictEqual(s2.front.id, 'move');
  assert.strictEqual(s2.returnedFromAway(), true);
  assert.strictEqual(s2.front, null);
});

test('held during fullscreen, shown once fullscreen ends', () => {
  const s = make({ water: OFF, posture: OFF });
  const held = { counting: true, canShow: false };
  let { events, t } = run(s, 0, 70, held);
  assert.strictEqual(events.length, 0);
  ({ events } = run(s, t, 1));
  assert.deepStrictEqual(events.map((e) => e.id), ['move']);
});

test('stale held water reminders are dropped instead of shown late', () => {
  const s = make({ move: OFF, posture: OFF });
  const held = { counting: true, canShow: false };
  let { t } = run(s, 0, 20, held); // due at 20, held
  ({ t } = run(s, t, 11, held)); // held > 10 minutes -> dropped and reset
  assert.strictEqual(s.front, null);
  const { events } = run(s, t, 1);
  assert.strictEqual(events.length, 0);
});

test('large clock jumps (sleep) are capped', () => {
  const s = make();
  s.tick(10 * 60 * MIN, ON);
  assert.strictEqual(s.remainingMs('water'), 20 * MIN - 4 * TICK);
});

test('remind me now: shows at once, or joins the stack; never twice', () => {
  const s = make();
  assert.deepStrictEqual(s.triggerNow('posture', 0), { id: 'posture', manual: true });
  assert.strictEqual(s.triggerNow('water', 0), 'queued'); // behind the card on screen
  assert.strictEqual(s.triggerNow('water', 0), null); // already waiting
  assert.strictEqual(s.triggerNow('posture', 0), null); // already on screen
  assert.strictEqual(s.triggerNow('nope', 0), null);
  s.resolve('done');
  // A card you asked for comes forward even outside active hours.
  assert.deepStrictEqual(s.tick(TICK, { counting: false, canShow: true }), { id: 'water', manual: true });
});

test('disabling a held reminder drops its card', () => {
  const s = make();
  run(s, 0, 20, { counting: true, canShow: false });
  assert.strictEqual(s.front.id, 'water');
  s.updateConfig(reminderDefs(cfg({ water: OFF })));
  assert.strictEqual(s.front, null);
});

// ---------------------------------------------------------------- the stack

test('one card at a time: reminders due meanwhile wait in line', () => {
  const s = make();
  const { events } = run(s, 0, 59, ON, null); // never answer
  // water at 20; posture comes due at 25 and waits behind it; water due again
  // at 40 is not queued twice, since it is already on screen.
  assert.deepStrictEqual(events.map((e) => [e.at, e.id]), [[20, 'water']]);
  assert.deepStrictEqual(s.waiting(), ['posture']);
});

test('the stack: each reminder at most once, shown in order as you answer', () => {
  const s = make({ posture: OFF });
  let { events, t } = run(s, 0, 20, ON, null); // water shows at 20 and is left there
  assert.deepStrictEqual(events.map((e) => e.id), ['water']);
  ({ events, t } = run(s, t, 50, ON, null)); // water due again at 40, move at 60
  assert.strictEqual(events.length, 0); // nothing replaces the card on screen
  assert.deepStrictEqual(s.waiting(), ['move']); // move waits; water is never queued twice
  s.resolve('done'); // answer water
  assert.strictEqual(s.remainingMs('water'), 20 * MIN);
  assert.deepStrictEqual(s.tick(t + TICK, ON), { id: 'move', manual: false }); // move comes forward
  assert.deepStrictEqual(s.waiting(), []);
});

test('the stack: quiet ones go stale while waiting, removed ones leave', () => {
  const eyes = { id: 'r-eyes', name: 'Eyes', style: 'pill', intervalMin: 25 };
  const s = make({ posture: OFF, custom: [eyes] });
  let { t } = run(s, 0, 20, ON, null); // water on screen at 20
  ({ t } = run(s, t, 5, ON, null)); // eyes due at 25 -> waits
  assert.deepStrictEqual(s.waiting(), ['r-eyes']);
  ({ t } = run(s, t, 11, ON, null)); // waited > 10 min: a quiet card is dropped, not shown late
  assert.deepStrictEqual(s.waiting(), []);
  assert.strictEqual(s.remainingMs('r-eyes'), 25 * MIN); // its timer restarted
  // removing a waiting reminder takes it out of line
  const card = { id: 'r-card', name: 'Card', style: 'sticky', intervalMin: 10 };
  const s2 = make({ water: OFF, posture: OFF, custom: [card] });
  let r = run(s2, 0, 10, ON, null); // card on screen at 10
  r = run(s2, r.t, 50, ON, null); // move due at 60 -> waits
  assert.deepStrictEqual(s2.waiting(), ['move']);
  s2.updateConfig(reminderDefs(cfg({ water: OFF, posture: OFF, move: OFF, custom: [card] })));
  assert.deepStrictEqual(s2.waiting(), []);
});

test('the stack: coming back from away drops a waiting move card', () => {
  const s = make({ posture: OFF });
  let { t } = run(s, 0, 20, ON, null);
  ({ t } = run(s, t, 40, ON, null));
  assert.deepStrictEqual(s.waiting(), ['move']);
  assert.strictEqual(s.returnedFromAway(), false); // the water card on screen stays
  assert.deepStrictEqual(s.waiting(), []);
});

test('held during fullscreen: unique reminders line up, shown one by one after', () => {
  const s = make({ posture: OFF });
  const held = { counting: true, canShow: false };
  // water held at 20 goes stale at 31 and restarts; due again at 51; move at 60
  const { t } = run(s, 0, 60, held, null);
  assert.deepStrictEqual(s.queue.map((c) => c.id), ['water', 'move']);
  assert.deepStrictEqual(s.tick(t + TICK, ON), { id: 'water', manual: false });
  assert.deepStrictEqual(s.waiting(), ['move']);
});

// ---------------------------------------------------------------- rules and settings

test('active hours', () => {
  const c = { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] };
  assert.strictEqual(isWithinActiveHours(new Date(2026, 10, 23, 9, 0), c), true); // Mon 09:00
  assert.strictEqual(isWithinActiveHours(new Date(2026, 10, 23, 18, 0), c), false); // Mon 18:00
  assert.strictEqual(isWithinActiveHours(new Date(2026, 10, 22, 12, 0), c), false); // Sun
  const night = { start: '22:00', end: '02:00', days: [5] }; // Fri night
  assert.strictEqual(isWithinActiveHours(new Date(2026, 10, 27, 23, 0), night), true); // Fri 23:00
  assert.strictEqual(isWithinActiveHours(new Date(2026, 10, 28, 1, 0), night), true); // Sat 01:00
  assert.strictEqual(isWithinActiveHours(new Date(2026, 10, 28, 23, 0), night), false); // Sat 23:00
});

test('nextActiveStart: when active hours begin again', () => {
  const c = { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] };
  const fmt = (d) => `${d.getDay()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  assert.strictEqual(fmt(nextActiveStart(new Date(2026, 10, 22, 15, 0), c)), '1 9:00'); // Sunday -> Monday
  assert.strictEqual(fmt(nextActiveStart(new Date(2026, 10, 23, 7, 30), c)), '1 9:00'); // Monday early -> today
  assert.strictEqual(fmt(nextActiveStart(new Date(2026, 10, 27, 19, 0), c)), '1 9:00'); // Friday evening -> Monday
  assert.strictEqual(nextActiveStart(new Date(), { start: 'x', end: '18:00', days: [1] }), null);
  assert.strictEqual(nextActiveStart(new Date(), { start: '09:00', end: '18:00', days: [] }), null);
});

test('away: only a locked screen or sleep counts as getting up', () => {
  const t = new AwayTracker();
  const here = { away: false, absent: false };
  const idle = { away: true, absent: false }; // no mouse or keyboard for a while
  const locked = { away: true, absent: true };
  // Idle at the desk (reading, a call): timers pause, Move is not restarted.
  assert.deepStrictEqual([t.update(here), t.update(idle), t.update(idle), t.update(here)], [false, false, false, false]);
  // Idle, then locked, then back: you left the desk.
  assert.deepStrictEqual([t.update(idle), t.update(locked), t.update(idle), t.update(here)], [false, false, false, true]);
  // It doesn't carry over to the next stretch.
  assert.deepStrictEqual([t.update(idle), t.update(here)], [false, false]);
});

test('fullscreen states', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7].map(isFullscreenState), [false, true, true, true, false, false, false]);
});

test('settings merge keeps known keys and types only', () => {
  const merged = mergeDefaults(DEFAULTS, {
    reminders: { water: { intervalMin: 15, bogus: 1 }, move: { intervalMin: 'x' } },
    extra: true,
  });
  assert.strictEqual(merged.reminders.water.intervalMin, 15);
  assert.strictEqual(merged.reminders.water.bogus, undefined);
  assert.strictEqual(merged.reminders.move.intervalMin, 60);
  assert.strictEqual(merged.extra, undefined);
  assert.deepStrictEqual(merged.smart.activeHours.days, [1, 2, 3, 4, 5]);
});

test('mute is off by default', () => {
  assert.strictEqual(DEFAULTS.muted, false);
  assert.strictEqual(mergeDefaults(DEFAULTS, { muted: true }).muted, true);
});

test('appearance follows the system by default and keeps a choice', () => {
  assert.strictEqual(DEFAULTS.appearance, 'system');
  assert.strictEqual(mergeDefaults(DEFAULTS, { appearance: 'dark' }).appearance, 'dark');
  assert.strictEqual(mergeDefaults(DEFAULTS, { appearance: 3 }).appearance, 'system');
});

// ---------------------------------------------------------------- card content

test('normalizeExercises: defaults, cleaning, built-ins always present', () => {
  const { normalizeExercises, BUILTIN_EXERCISES, TIMER_MAX_SEC } = content;
  // Empty means defaults
  assert.strictEqual(normalizeExercises([]).length, BUILTIN_EXERCISES.length);
  assert.ok(normalizeExercises(undefined).every((e) => e.enabled && e.builtin));

  const out = normalizeExercises([
    { id: 'stairs', title: 'Stairs x2', detail: 'Twice', timerSec: 90, enabled: false },
    { id: 'c-1', title: '  Plank  ', detail: '', timerSec: 5 }, // timer clamped up
    { id: 'c-1', title: 'Duplicate id', timerSec: 99999 }, // id de-duplicated, timer clamped down
    { id: 'c-2', title: '   ' }, // no name: dropped
    null,
  ]);
  const stairs = out.find((e) => e.id === 'stairs');
  assert.deepStrictEqual(
    { title: stairs.title, timerSec: stairs.timerSec, enabled: stairs.enabled, builtin: stairs.builtin },
    { title: 'Stairs x2', timerSec: 90, enabled: false, builtin: true }
  );
  const customs = out.filter((e) => !e.builtin);
  assert.strictEqual(customs.length, 2);
  assert.strictEqual(customs[0].title, 'Plank');
  assert.strictEqual(customs[0].timerSec, TIMER_MIN_SEC);
  assert.notStrictEqual(customs[1].id, 'c-1');
  assert.strictEqual(customs[1].timerSec, TIMER_MAX_SEC);
  // Every built-in is still there even though only one was listed
  assert.strictEqual(out.filter((e) => e.builtin).length, BUILTIN_EXERCISES.length);
});

test('move payload uses only switched-on exercises, or all if none are on', () => {
  const base = content.normalizeExercises([]);
  const some = base.map((e) => ({ ...e, enabled: e.id === 'stairs' || e.id === 'walk' }));
  const p = content.buildPayload('move', { reminders: { move: { chime: true, exercises: some } } });
  assert.deepStrictEqual(p.activities.map((a) => a.id).sort(), ['stairs', 'walk']);
  assert.ok(p.index >= 0 && p.index < 2);
  assert.strictEqual(p.extras, undefined); // nothing rides along any more

  const none = base.map((e) => ({ ...e, enabled: false }));
  const all = content.buildPayload('move', { reminders: { move: { exercises: none } } });
  assert.strictEqual(all.activities.length, base.length);
});

test('posture payload: three short cues and the fade setting (0 = stay until dismissed)', () => {
  const mk = (autoFade, fadeSec) => content.buildPayload('posture', { reminders: { posture: { autoFade, fadeSec } } });
  assert.strictEqual(mk(true, 30).fadeSec, 30);
  assert.strictEqual(mk(false, 30).fadeSec, 0);
  const { cues } = mk(true, 15);
  assert.strictEqual(cues.length, 3);
  assert.ok(cues.every((c) => c.split(' ').length <= 4), JSON.stringify(cues)); // glanceable
});

test('slim cards fade after 8 s unless set to stay until clicked', () => {
  const water = (w) => content.buildPayload('water', { reminders: { water: w } }).fadeSec;
  assert.strictEqual(water({ autoFade: true }), 8);
  assert.strictEqual(water({ autoFade: false }), 0);
  assert.strictEqual(water(undefined), 8); // older settings files
  const pill = (keep) => content.buildPayload('r-p', { reminders: cfg({ custom: [{ id: 'r-p', name: 'P', style: 'pill', keep }] }) }).fadeSec;
  assert.strictEqual(pill(undefined), 8);
  assert.strictEqual(pill(true), 0);
});

// ---------------------------------------------------------------- your own reminders

const eyes = { id: 'r-eyes', name: 'Rest your eyes', intervalMin: 15, style: 'pill', icon: 'eye' };
const meds = { id: 'r-meds', name: 'Medicine', message: 'With food', intervalMin: 25, style: 'sticky', icon: 'capsule' };

test('custom reminders fire on their own interval', () => {
  const s = make({ move: OFF, water: OFF, posture: OFF, custom: [eyes, meds] });
  const { events } = run(s, 0, 31);
  assert.deepStrictEqual(events.map((e) => [e.at, e.id]), [[15, 'r-eyes'], [25, 'r-meds'], [30, 'r-eyes']]);
});

test('due together: a fading card and water are two cards, the card first', () => {
  const card = { id: 'r-card', name: 'Stretch', intervalMin: 20, style: 'card' };
  const s = make({ move: OFF, posture: OFF, custom: [card] });
  const { events } = run(s, 0, 21);
  assert.deepStrictEqual(events.map((e) => [e.at, e.id]), [[20, 'r-card'], [21, 'water']]);

  // A waiting card and move are the same size: they come one after the other.
  const s2 = make({ water: OFF, posture: OFF, custom: [{ ...meds, intervalMin: 60 }] });
  const r = run(s2, 0, 61);
  assert.deepStrictEqual(r.events.map((e) => [e.at, e.id]), [[60, 'move'], [61, 'r-meds']]);
});

test('adding and removing custom reminders mid-session', () => {
  const s = make({ move: OFF, water: OFF, posture: OFF });
  const { t } = run(s, 0, 10);
  s.updateConfig(reminderDefs(cfg({ move: OFF, water: OFF, posture: OFF, custom: [eyes] })));
  assert.strictEqual(s.remainingMs('r-eyes'), 15 * MIN); // a new reminder starts from zero
  const r = run(s, t, 15, { counting: true, canShow: false });
  assert.strictEqual(s.front.id, 'r-eyes'); // held
  s.updateConfig(reminderDefs(cfg({ move: OFF, water: OFF, posture: OFF })));
  assert.strictEqual(s.front, null); // removed: the held card goes too
  assert.strictEqual(s.nextDue()['r-eyes'], undefined);
  assert.strictEqual(s.triggerNow('r-eyes', r.t), null);
});

test('held custom slim cards go stale like water; waiting cards do not', () => {
  const held = { counting: true, canShow: false };
  const s = make({ move: OFF, water: OFF, posture: OFF, custom: [eyes] });
  run(s, 0, 26, held); // due at 15, held 11 min
  assert.strictEqual(s.front, null);

  const s2 = make({ move: OFF, water: OFF, posture: OFF, custom: [meds] });
  const { t } = run(s2, 0, 60, held);
  assert.strictEqual(s2.front.id, 'r-meds');
  assert.deepStrictEqual(run(s2, t, 1).events.map((e) => e.id), ['r-meds']);
});

test('normalizeCustom cleans stored reminders', () => {
  const out = normalizeCustom([
    { id: 'move', name: 'Clashes with a built-in id', style: 'nope', icon: 'nope', intervalMin: 0, fadeSec: 999 },
    { id: 'r-1', name: '  Breathe  ', message: 'x'.repeat(500), intervalMin: 99999, style: 'pill', icon: 'wind', enabled: false },
    { id: 'r-1', name: 'Same id' },
    { name: '   ' },
    'junk',
  ]);
  assert.strictEqual(out.length, 3);
  assert.notStrictEqual(out[0].id, 'move');
  assert.deepStrictEqual(
    [out[0].style, out[0].icon, out[0].intervalMin, out[0].fadeSec, out[0].items],
    ['card', 'bell', LIMITS.intervalMin, LIMITS.fadeMax, []]
  );
  assert.strictEqual(out[1].name, 'Breathe');
  assert.strictEqual(out[1].message.length, LIMITS.messageMax);
  assert.strictEqual(out[1].intervalMin, LIMITS.intervalMax);
  assert.strictEqual(out[1].enabled, false);
  assert.notStrictEqual(out[2].id, 'r-1');
  const many = Array.from({ length: 20 }, (_, i) => ({ name: `R${i}` }));
  assert.strictEqual(normalizeCustom(many).length, LIMITS.customMax);
  assert.deepStrictEqual(normalizeCustom(undefined), []);
});

test('reminder lists: cleaned like exercises, capped, unique ids', () => {
  const items = cleanItems([
    { id: 'a', title: '  Neck rolls ', detail: '5 each way', timerSec: 0 },
    { id: 'a', title: 'Wrist circles', timerSec: 3 }, // duplicate id, timer clamped up
    { title: '   ' }, // no title: dropped
    null,
  ]);
  assert.deepStrictEqual(items.map((i) => [i.title, i.timerSec]), [['Neck rolls', 0], ['Wrist circles', TIMER_MIN_SEC]]);
  assert.notStrictEqual(items[0].id, items[1].id);
  assert.strictEqual(cleanItems(Array.from({ length: 30 }, (_, i) => ({ title: `I${i}` }))).length, LIMITS.itemsMax);
  assert.deepStrictEqual(cleanItems('junk'), []);
});

test('a reminder with a list rotates through it on each card; slim cards ignore lists', () => {
  const list = [{ id: 'a', title: 'Neck rolls' }, { id: 'b', title: 'Wrist circles', timerSec: 30 }];
  const settings = { reminders: cfg({ custom: [{ id: 'r-s', name: 'Stretch break', style: 'sticky', items: list }] }) };
  const first = content.buildPayload('r-s', settings);
  const second = content.buildPayload('r-s', settings);
  assert.strictEqual(first.activities.length, 2);
  assert.deepStrictEqual([first.index, second.index], [0, 1]);
  assert.ok(first.timerLimits);
  const slim = content.buildPayload('r-p', { reminders: cfg({ custom: [{ id: 'r-p', name: 'P', style: 'pill', items: list }] }) });
  assert.strictEqual(slim.activities, undefined);
  // Previews don't move the rotation along.
  const c = normalizeCustom([{ id: 'r-q', name: 'Q', style: 'card', items: list }])[0];
  assert.deepStrictEqual([content.customPayload(c).index, content.customPayload(c).index], [0, 0]);
});

test('reminder list: built-ins first, then your own', () => {
  const list = reminderList(cfg({ custom: [eyes] }));
  assert.deepStrictEqual(list.map((r) => [r.id, r.style]), [
    ['move', 'sticky'], ['water', 'pill'], ['posture', 'card'], ['r-eyes', 'pill'],
  ]);
});

test('custom payloads', () => {
  const settings = { reminders: cfg({ custom: [eyes, meds] }) };
  const p = content.buildPayload('r-meds', settings);
  assert.deepStrictEqual([p.type, p.id, p.style, p.chime, p.fadeSec], ['custom', 'r-meds', 'sticky', true, 0]);
  const card = content.buildPayload('r-x', { reminders: cfg({ custom: [{ id: 'r-x', name: 'X', style: 'card', fadeSec: 20 }] }) });
  assert.strictEqual(card.fadeSec, 20);
  assert.strictEqual(card.chime, false);
  assert.strictEqual(content.buildPayload('r-gone', settings), null);
});
