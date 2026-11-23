'use strict';

// Pure helpers for the "smart behavior" conditions, kept free of Electron for testing.

function parseHHMM(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * @param {Date} date
 * @param {{start:string, end:string, days:number[]}} cfg  days: 0=Sun … 6=Sat
 * Supports overnight ranges (e.g. 22:00–02:00); the day check uses the day the range started.
 */
function isWithinActiveHours(date, cfg) {
  const start = parseHHMM(cfg.start);
  const end = parseHHMM(cfg.end);
  const days = Array.isArray(cfg.days) ? cfg.days : [];
  if (start === null || end === null) return true; // bad config: don't silently block reminders
  const minutes = date.getHours() * 60 + date.getMinutes();
  const day = date.getDay();
  if (start === end) return days.includes(day); // whole day
  if (start < end) return days.includes(day) && minutes >= start && minutes < end;
  // Overnight
  if (minutes >= start) return days.includes(day);
  if (minutes < end) return days.includes((day + 6) % 7);
  return false;
}

/**
 * When active hours next begin after `date` (for "back at Mon 09:00" while outside them).
 * @returns {Date|null} null if the config has no valid start or no days
 */
function nextActiveStart(date, cfg) {
  const start = parseHHMM(cfg.start);
  const days = Array.isArray(cfg.days) ? cfg.days : [];
  if (start === null || days.length === 0) return null;
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset, Math.floor(start / 60), start % 60);
    if (d > date && days.includes(d.getDay())) return d;
  }
  return null;
}

// SHQueryUserNotificationState results
// 1 NOT_PRESENT, 2 BUSY (fullscreen app), 3 RUNNING_D3D_FULL_SCREEN,
// 4 PRESENTATION_MODE, 5 ACCEPTS_NOTIFICATIONS, 6 QUIET_TIME, 7 APP
function isFullscreenState(code) {
  return code === 2 || code === 3 || code === 4;
}

module.exports = { parseHHMM, isWithinActiveHours, nextActiveStart, isFullscreenState };
