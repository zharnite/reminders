'use strict';

// Pure timing logic. No Electron imports, so it can be unit tested with node:test.
//
// Each reminder accumulates "active" time (only while the user is present and
// inside active hours). When its active time reaches its interval it becomes due
// and joins the queue as its own card. The front card is on screen; the others
// wait behind it and come forward one at a time as each is answered. Answering a
// card affects only that reminder, and a reminder is never in the queue twice.
//
// Reminders are described by defs (see reminders.reminderDefs):
//   { id, enabled, intervalMin, priority, staleMin, startMin }
// priority only orders reminders that come due in the same tick (bigger first).

class Scheduler {
  /**
   * @param {object} opts
   * @param {Array<{id:string,enabled:boolean,intervalMin:number,priority:number,staleMin?:number,startMin?:number}>} opts.reminders
   * @param {number} [opts.minuteMs=60000]  length of one "minute" (shrunk in fast/test mode)
   * @param {number} [opts.tickMs=15000]    expected tick period; deltas are capped at 4x this
   * @param {number} [opts.now=Date.now()]
   */
  constructor({ reminders, minuteMs = 60000, tickMs = 15000, now = Date.now() }) {
    this.minuteMs = minuteMs;
    this.maxDeltaMs = tickMs * 4;
    this.lastTick = now;
    this.queue = []; // cards: { id, manual, createdAt, shown }; queue[0] is on screen once shown
    this.state = new Map(); // id -> { enabled, intervalMs, elapsedMs, priority, staleMs }
    this.updateConfig(reminders);
  }

  /** Apply a new list of reminders. New ones start from zero; removed ones are forgotten. */
  updateConfig(defs) {
    const next = new Map();
    for (const d of defs) {
      const s = this.state.get(d.id) || { elapsedMs: (d.startMin || 0) * this.minuteMs };
      s.enabled = d.enabled !== false;
      s.intervalMs = Math.max(1, Number(d.intervalMin) || 1) * this.minuteMs;
      s.priority = d.priority || 0;
      s.staleMs = (d.staleMin || 0) * this.minuteMs;
      next.set(d.id, s);
    }
    this.state = next;
    // Drop waiting (not yet shown) cards whose reminder was just disabled or removed.
    this.queue = this.queue.filter((c) => c.shown || this._active(c.id));
  }

  /** The card on screen or next in line (null when the queue is empty). */
  get front() {
    return this.queue[0] || null;
  }

  /** Reminders waiting behind the card on screen, in the order they will show. */
  waiting() {
    return this.queue.slice(1).map((c) => c.id);
  }

  ids() {
    return [...this.state.keys()];
  }

  remainingMs(id) {
    const s = this.state.get(id);
    return s ? Math.max(0, s.intervalMs - s.elapsedMs) : 0;
  }

  /** Active-time remaining for each reminder; null when it is switched off. */
  nextDue() {
    const out = {};
    for (const [id, s] of this.state) out[id] = s.enabled ? this.remainingMs(id) : null;
    return out;
  }

  /**
   * Advance the clock.
   * @param {number} now
   * @param {{counting:boolean, canShow:boolean}} cond
   *   counting: active time accrues (user present, within active hours, not paused)
   *   canShow:  a popup may be displayed right now (e.g. not fullscreen)
   * @returns {null | {id:string, manual:boolean}} a card to bring on screen now
   */
  tick(now, { counting, canShow }) {
    const delta = Math.min(Math.max(0, now - this.lastTick), this.maxDeltaMs);
    this.lastTick = now;

    if (counting) {
      for (const s of this.state.values()) if (s.enabled) s.elapsedMs += delta;
    }

    // Quiet reminders are not worth showing late: drop ones that waited too long.
    this.queue = this.queue.filter((c) => {
      const st = this.state.get(c.id);
      if (c.shown || !st || !st.staleMs || now - c.createdAt <= st.staleMs) return true;
      this._reset(c.id);
      return false;
    });

    if (counting) {
      const queued = new Set(this.queue.map((c) => c.id));
      const prio = (id) => this.state.get(id).priority;
      this.ids()
        .filter((id) => !queued.has(id) && this._active(id) && this.remainingMs(id) === 0)
        .sort((a, b) => prio(b) - prio(a))
        .forEach((id) => this.queue.push({ id, manual: false, createdAt: now, shown: false }));
    }

    // Cards you asked for ("Remind me now") come forward even outside active hours.
    const manualNext = !!this.front && this.front.manual;
    return canShow && (counting || manualNext) ? this._showFront() : null;
  }

  /**
   * "Remind me now". Shows the reminder right away when nothing is on screen,
   * otherwise puts it at the back of the line.
   * @returns {{id:string, manual:boolean} | 'queued' | null}
   *   a card to show now, 'queued', or null (unknown, or already on screen / in line)
   */
  triggerNow(id, now = Date.now()) {
    if (!this.state.has(id)) return null;
    const onScreen = this.front && this.front.shown;
    if (onScreen) {
      if (this.queue.some((c) => c.id === id)) return null;
      this.queue.push({ id, manual: true, createdAt: now, shown: false });
      return 'queued';
    }
    // Nothing on screen (maybe some held): show it now, ahead of the rest.
    this.queue = this.queue.filter((c) => c.id !== id);
    this.queue.unshift({ id, manual: true, createdAt: now, shown: false });
    return this._showFront();
  }

  /**
   * The user (or the card's auto-fade) answered the card on screen. Only that
   * reminder's timer changes.
   * @param {'done'|'dismiss'|'timeout'|'skip'|'snooze'} action
   * @param {number} [snoozeMin=10]
   */
  resolve(action, snoozeMin = 10) {
    const front = this.front;
    if (!front || !front.shown) return;
    this.queue.shift();
    const s = this.state.get(front.id);
    if (!s) return;
    if (action === 'snooze') s.elapsedMs = Math.max(0, s.intervalMs - snoozeMin * this.minuteMs);
    else s.elapsedMs = 0;
  }

  /**
   * The user came back after being away (idle, locked, asleep). They just moved,
   * so the move timer restarts. A move card on screen or in line is no longer needed.
   * @returns {boolean} true if the card on screen was Move and has been removed
   */
  returnedFromAway() {
    this._reset('move');
    const onScreen = !!this.front && this.front.shown && this.front.id === 'move';
    this.queue = this.queue.filter((c) => c.id !== 'move');
    return onScreen;
  }

  _showFront() {
    const f = this.front;
    if (!f || f.shown) return null;
    f.shown = true;
    return { id: f.id, manual: f.manual };
  }

  _active(id) {
    const s = this.state.get(id);
    return !!s && s.enabled;
  }

  _reset(id) {
    const s = this.state.get(id);
    if (s) s.elapsedMs = 0;
  }
}

module.exports = { Scheduler };
