'use strict';

// Text shown in the reminder cards. Picked in the main process and sent to the popup.

const {
  BUILTIN,
  findCustom,
  PILL_FADE_SEC,
  clampTimer,
  TIMER_MIN_SEC,
  TIMER_MAX_SEC,
  ITEM_TITLE_MAX: TITLE_MAX,
  ITEM_DETAIL_MAX: DETAIL_MAX,
} = require('./reminders');

// Built-in exercises. Users can edit or switch these off, and add their own (ids start with "c-").
const BUILTIN_EXERCISES = [
  { id: 'walk', title: 'Take a short walk', detail: 'Around the room, the hallway, or to refill your water.', timerSec: 120 },
  { id: 'squats', title: '10 squats', detail: 'Feet shoulder-width apart, sit back like into a chair, chest up.', timerSec: 0 },
  { id: 'pushups', title: '10 desk push-ups', detail: 'Hands on the edge of a sturdy desk, body in a straight line.', timerSec: 0 },
  { id: 'calves', title: '20 calf raises', detail: 'Rise onto your toes slowly, lower slowly. Hold the desk for balance.', timerSec: 0 },
  { id: 'stretch', title: 'Stretch it out', detail: 'Reach overhead, then hug your knees or touch your toes. Breathe slowly.', timerSec: 30 },
  { id: 'stairs', title: 'Take the stairs', detail: 'One flight up and down, or march in place with high knees.', timerSec: 60 },
  { id: 'lunges', title: '10 lunges', detail: 'Alternate legs, keep the front knee over the ankle.', timerSec: 0 },
  { id: 'reset', title: 'Shoulder & hip reset', detail: '10 shoulder rolls back, 10 hip circles each way, 5 neck turns.', timerSec: 0 },
];
const BUILTIN_IDS = new Set(BUILTIN_EXERCISES.map((e) => e.id));

function defaultExercises() {
  return BUILTIN_EXERCISES.map((e) => ({ ...e, enabled: true, builtin: true }));
}

/**
 * Clean up a stored exercise list: drop invalid entries, clamp lengths and timers,
 * de-duplicate ids, and make sure every built-in exercise is present (they can be
 * switched off but not deleted). An empty or missing list means "the defaults".
 */
function normalizeExercises(list) {
  if (!Array.isArray(list) || list.length === 0) return defaultExercises();
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const title = String(raw.title || '').trim().slice(0, TITLE_MAX);
    if (!title) continue;
    let id = String(raw.id || '').trim().slice(0, 40) || `c-${out.length}`;
    while (seen.has(id)) id = `${id}-${out.length}`;
    seen.add(id);
    out.push({
      id,
      title,
      detail: String(raw.detail || '').trim().slice(0, DETAIL_MAX),
      timerSec: clampTimer(raw.timerSec),
      enabled: raw.enabled !== false,
      builtin: BUILTIN_IDS.has(id),
    });
  }
  for (const b of BUILTIN_EXERCISES) {
    if (!seen.has(b.id)) out.push({ ...b, enabled: true, builtin: true });
  }
  return out;
}

// Short enough to read at a glance: the posture card shows three of these on one line.
const POSTURE_CUES = [
  'Hips back',
  'Feet flat',
  'Shoulders down',
  'Chin tucked',
  'Back supported',
  'Screen at eye level',
  'Elbows close',
  'Jaw relaxed',
  'Weight centered',
  'Breathe out',
];

const WATER_LINES = ['Sip of water', 'Quick sip', 'Hydrate — one sip', 'Water break'];

class Rotator {
  constructor(items) {
    this.items = items;
    this.i = Math.floor(Math.random() * items.length);
  }
  next(n = 1) {
    const out = [];
    for (let k = 0; k < n; k++) {
      out.push(this.items[this.i % this.items.length]);
      this.i++;
    }
    return out;
  }
}

const rot = {
  move: Math.floor(Math.random() * BUILTIN_EXERCISES.length),
  posture: new Rotator(POSTURE_CUES),
  water: new Rotator(WATER_LINES),
  lists: new Map(), // custom reminder id -> next item index
};

/** Exercises in the rotation (switched on), or all of them if every one is off. */
function activeActivities(moveSettings) {
  const all = normalizeExercises(moveSettings.exercises);
  const on = all.filter((e) => e.enabled);
  return (on.length ? on : all).map(({ id, title, detail, timerSec }) => ({ id, title, detail, timerSec }));
}

const TIMER_LIMITS = { min: TIMER_MIN_SEC, max: TIMER_MAX_SEC, step: 15 };

/**
 * Payload for one of the user's own reminders (also used for previews from the edit form).
 * A card with a list rotates through it like Move does; `advance` moves to the next item.
 */
function customPayload(c, { advance = false } = {}) {
  const p = {
    type: 'custom',
    id: c.id,
    style: c.style,
    name: c.name,
    message: c.message,
    icon: c.icon,
    // seconds before it fades; 0 = stays until clicked / answered
    fadeSec: c.style === 'card' ? c.fadeSec : c.style === 'pill' && !c.keep ? PILL_FADE_SEC : 0,
    chime: c.style === 'sticky' && c.chime,
  };
  if (c.style !== 'pill' && c.items && c.items.length) {
    const i = rot.lists.get(c.id) || 0;
    if (advance) rot.lists.set(c.id, i + 1);
    p.activities = c.items;
    p.index = i % c.items.length;
    p.timerLimits = TIMER_LIMITS;
  }
  return p;
}

/** Build the popup payload for the reminder whose card comes on screen. */
function buildPayload(id, settings) {
  if (!BUILTIN.some((b) => b.id === id)) {
    const c = findCustom(settings.reminders, id);
    return c ? customPayload(c, { advance: true }) : null;
  }
  if (id === 'move') {
    const activities = activeActivities(settings.reminders.move);
    return {
      type: 'move',
      id,
      activities, // the card can swap between these
      index: rot.move++ % activities.length,
      timerLimits: TIMER_LIMITS,
      chime: !!settings.reminders.move.chime,
    };
  }
  if (id === 'posture') {
    const p = settings.reminders.posture;
    return {
      type: 'posture',
      id,
      cues: rot.posture.next(3),
      fadeSec: p.autoFade ? p.fadeSec : 0, // 0 = stay until dismissed
    };
  }
  const water = settings.reminders.water || {};
  return { type: 'water', id, title: rot.water.next()[0], fadeSec: water.autoFade === false ? 0 : PILL_FADE_SEC };
}

module.exports = {
  buildPayload,
  customPayload,
  normalizeExercises,
  defaultExercises,
  clampTimer,
  BUILTIN_EXERCISES,
  POSTURE_CUES,
  TIMER_MIN_SEC,
  TIMER_MAX_SEC,
  TITLE_MAX,
  DETAIL_MAX,
};
