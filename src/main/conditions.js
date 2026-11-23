'use strict';

const { powerMonitor } = require('electron');
const { isWithinActiveHours, isFullscreenState } = require('./rules');

let queryNotificationState = null;
let fullscreenUnavailable = false;

/** Ask Windows whether a fullscreen app / presentation is running (SHQueryUserNotificationState). */
function isFullscreen() {
  if (process.platform !== 'win32' || fullscreenUnavailable) return false;
  try {
    if (!queryNotificationState) {
      const koffi = require('koffi');
      const shell32 = koffi.load('shell32.dll');
      queryNotificationState = shell32.func(
        'long __stdcall SHQueryUserNotificationState(_Out_ int *pquns)'
      );
    }
    const out = [0];
    const hr = queryNotificationState(out);
    return hr === 0 && isFullscreenState(out[0]);
  } catch (err) {
    console.warn('Fullscreen detection unavailable:', err.message);
    fullscreenUnavailable = true;
    return false;
  }
}

class Conditions {
  constructor() {
    this.locked = false;
    this.suspended = false;
    powerMonitor.on('lock-screen', () => (this.locked = true));
    powerMonitor.on('unlock-screen', () => (this.locked = false));
    powerMonitor.on('suspend', () => (this.suspended = true));
    powerMonitor.on('resume', () => (this.suspended = false));
  }

  /** Snapshot of everything the scheduler cares about. */
  evaluate(smart, now = new Date()) {
    const idleSec = powerMonitor.getSystemIdleTime();
    const absent = this.locked || this.suspended;
    const idle = idleSec >= smart.pauseWhenAway.idleMin * 60;
    return {
      absent, // screen locked or asleep: nobody can see a popup
      away: smart.pauseWhenAway.enabled && (absent || idle),
      inHours: !smart.activeHours.enabled || isWithinActiveHours(now, smart.activeHours),
      fullscreen: smart.quietFullscreen.enabled && isFullscreen(),
    };
  }
}

module.exports = { Conditions, isFullscreen };
