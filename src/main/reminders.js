'use strict';

// The reminder catalog: the three built-in reminders plus the user's own
// (settings.reminders.custom). Everything that lists reminders (scheduler,
// tray, Home cards, popups) goes through here.

// How a reminder looks on screen. Priority decides which one wins when several
// are due together (bigger cards go first); staleMin drops a held
// reminder that is not worth showing late.
const STYLES = {
  pill: { priority: 1, staleMin: 10, label: 'Slim card' },
  card: { priority: 2, staleMin: 0, label: 'Fading card' },
  sticky: { priority: 3, staleMin: 0, label: 'Waiting card' },
};

const BUILTIN = [
  { id: 'move', name: 'Move', style: 'sticky', icon: 'move', startMin: 0 },
  { id: 'water', name: 'Water', style: 'pill', icon: 'water', startMin: 0 },
  // Stagger the first posture reminder by 5 minutes so it does not land on a water reminder.
  { id: 'posture', name: 'Posture', style: 'card', icon: 'posture', startMin: -5 },
];
const BUILTIN_IDS = new Set(BUILTIN.map((b) => b.id));

const ICONS = ['bell', 'eye', 'wind', 'sun', 'heart', 'star', 'capsule', 'book'];

const LIMITS = {
  customMax: 12,
  nameMax: 40,
  messageMax: 160,
  intervalMin: 1,
  intervalMax: 600,
  fadeMin: 5,
  fadeMax: 120,
  itemsMax: 20, // things a reminder can rotate through (like Move's exercises)
};

// Activities (Move's exercises, items in your own reminders' lists).
const ITEM_TITLE_MAX = 60;
const ITEM_DETAIL_MAX = 200;
const TIMER_MIN_SEC = 15;
const TIMER_MAX_SEC = 3600;

/** A timer length in seconds: 0 (no timer) or within the allowed range. */
function clampTimer(sec) {
  const n = Math.round(Number(sec) || 0);
  if (n <= 0) return 0;
  return Math.min(TIMER_MAX_SEC, Math.max(TIMER_MIN_SEC, n));
}

/** Clean a list a reminder rotates through: titles required, lengths and timers clamped, unique ids. */
function cleanItems(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (out.length >= LIMITS.itemsMax) break;
    if (!raw || typeof raw !== 'object') continue;
    const title = String(raw.title || '').trim().slice(0, ITEM_TITLE_MAX);
    if (!title) continue;
    let id = String(raw.id || '').trim().slice(0, 40) || `i-${out.length}`;
    while (seen.has(id)) id = `${id}-${out.length}`;
    seen.add(id);
    out.push({ id, title, detail: String(raw.detail || '').trim().slice(0, ITEM_DETAIL_MAX), timerSec: clampTimer(raw.timerSec) });
  }
  return out;
}

// How long a slim card (the "pill" style) stays before fading (unless set to stay until clicked).
const PILL_FADE_SEC = 8;

function clamp(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function cleanCustom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, LIMITS.nameMax);
  if (!name) return null;
  return {
    id: String(raw.id || '').trim().slice(0, 40),
    name,
    message: String(raw.message || '').trim().slice(0, LIMITS.messageMax),
    intervalMin: clamp(raw.intervalMin, LIMITS.intervalMin, LIMITS.intervalMax, 30),
    style: STYLES[raw.style] ? raw.style : 'card',
    icon: ICONS.includes(raw.icon) ? raw.icon : 'bell',
    fadeSec: clamp(raw.fadeSec, LIMITS.fadeMin, LIMITS.fadeMax, 15),
    chime: raw.chime !== false,
    keep: raw.keep === true, // pill only: stay until clicked instead of fading
    // Optional list to rotate through, one item per card (not for slim cards, which show the message).
    items: cleanItems(raw.items),
    enabled: raw.enabled !== false,
  };
}

/** Clean the stored list of the user's own reminders: valid fields, unique ids, at most customMax. */
function normalizeCustom(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set(BUILTIN_IDS);
  for (const raw of list) {
    if (out.length >= LIMITS.customMax) break;
    const c = cleanCustom(raw);
    if (!c) continue;
    let id = c.id || `r-${out.length}`;
    while (seen.has(id)) id = `${id}-${out.length}`;
    seen.add(id);
    out.push({ ...c, id });
  }
  return out;
}

/** One reminder from a draft (e.g. the add/edit form), for previews. */
function draftCustom(raw) {
  return cleanCustom({ ...raw, name: (raw && String(raw.name || '').trim()) || 'Your reminder' });
}

function findCustom(reminders, id) {
  return normalizeCustom(reminders.custom).find((c) => c.id === id) || null;
}

/** Everything the UI needs to list reminders, built-ins first. */
function reminderList(reminders) {
  const builtins = BUILTIN.map((b) => ({
    id: b.id,
    name: b.name,
    style: b.style,
    icon: b.icon,
    builtin: true,
    enabled: reminders[b.id].enabled !== false,
    intervalMin: reminders[b.id].intervalMin,
  }));
  const custom = normalizeCustom(reminders.custom).map((c) => ({
    id: c.id,
    name: c.name,
    style: c.style,
    icon: c.icon,
    builtin: false,
    enabled: c.enabled,
    intervalMin: c.intervalMin,
  }));
  return [...builtins, ...custom];
}

/** Timing config for the scheduler. */
function reminderDefs(reminders) {
  const start = Object.fromEntries(BUILTIN.map((b) => [b.id, b.startMin]));
  return reminderList(reminders).map((r) => ({
    id: r.id,
    enabled: r.enabled,
    intervalMin: r.intervalMin,
    priority: STYLES[r.style].priority,
    staleMin: STYLES[r.style].staleMin,
    startMin: start[r.id] || 0,
  }));
}

module.exports = {
  STYLES,
  BUILTIN,
  ICONS,
  LIMITS,
  PILL_FADE_SEC,
  ITEM_TITLE_MAX,
  ITEM_DETAIL_MAX,
  TIMER_MIN_SEC,
  TIMER_MAX_SEC,
  clampTimer,
  cleanItems,
  normalizeCustom,
  draftCustom,
  findCustom,
  reminderList,
  reminderDefs,
};
