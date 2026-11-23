'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  reminders: {
    // exercises: [] means "use the built-in list"; once edited it holds the full list
    // (see content.normalizeExercises).
    move: { enabled: true, intervalMin: 60, chime: true, exercises: [] },
    // autoFade false = the slim card stays until clicked
    water: { enabled: true, intervalMin: 20, autoFade: true },
    // autoFade false = the card stays until dismissed
    posture: { enabled: true, intervalMin: 30, autoFade: true, fadeSec: 15 },
    // The user's own reminders (see reminders.normalizeCustom).
    custom: [],
  },
  smart: {
    pauseWhenAway: { enabled: true, idleMin: 5 },
    activeHours: { enabled: true, start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    quietFullscreen: { enabled: true },
  },
  launchAtLogin: true,
  // Mute every sound in the app (the move chime and waiting-card chimes).
  muted: false,
  // 'system' follows the Windows light/dark setting; 'light' or 'dark' picks one.
  appearance: 'system',
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge `value` over `defaults`, keeping only keys known in defaults and matching types. */
function mergeDefaults(defaults, value) {
  if (!isPlainObject(defaults)) {
    if (Array.isArray(defaults)) return Array.isArray(value) ? value : defaults;
    return typeof value === typeof defaults ? value : defaults;
  }
  const out = {};
  for (const key of Object.keys(defaults)) {
    out[key] = mergeDefaults(defaults[key], isPlainObject(value) ? value[key] : undefined);
  }
  return out;
}

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = this._load();
  }

  _load() {
    try {
      return mergeDefaults(DEFAULTS, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return mergeDefaults(DEFAULTS, {});
    }
  }

  get() {
    return JSON.parse(JSON.stringify(this.data));
  }

  set(next) {
    this.data = mergeDefaults(DEFAULTS, next);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
    return this.get();
  }
}

module.exports = { Settings, DEFAULTS, mergeDefaults };
