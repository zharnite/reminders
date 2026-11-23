'use strict';

// One popup window holds a stack of reminder cards: the card on screen, with the
// ones waiting behind it peeking out above. Answering the card sends only that
// card away; the main process then sends the next one (it comes forward from
// behind) or closes the window when the stack is empty.

const root = document.getElementById('root'); // the card on screen is drawn in here
const stack = document.getElementById('stack'); // root plus the two cards peeking out behind it
const next = document.getElementById('next');

let shownSeq = 0; // the last card drawn (cards carry an increasing seq)
let firstCard = true;
let finished = false;
let waiting = []; // reminders lined up behind this one: [{ id, name, icon }]
let timers = []; // timeouts/intervals that belong to the card on screen

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function later(fn, ms) {
  timers.push(setTimeout(fn, ms));
}
function every(fn, ms) {
  const id = setInterval(fn, ms);
  timers.push(id);
  return id;
}
function clearTimers() {
  timers.forEach((t) => {
    clearTimeout(t);
    clearInterval(t);
  });
  timers = [];
}

/**
 * Answer the card on screen. With more cards behind, a copy of it slides away on top
 * while the next one comes forward underneath straight away (no empty moment). With
 * none left, it slides away and then the popup closes.
 */
function finish(action) {
  if (finished) return;
  finished = true;
  const card = root.querySelector('.card');
  if (waiting.length && card) {
    outgoing(card, 'leaving');
    card.style.visibility = 'hidden'; // until the next card replaces it, a moment from now
    window.api.act(action);
    return;
  }
  if (card) card.classList.add('leaving');
  stack.classList.add('closing');
  later(() => window.api.act(action), 300);
}

/**
 * A static copy of the card, laid over it, that animates away ('leaving' slides off,
 * 'fading' fades out) while the real card changes underneath.
 */
function outgoing(card, how) {
  const copy = card.cloneNode(true);
  copy.classList.remove('enter', 'forward', 'refresh', 'leaving');
  copy.classList.add('outgoing');
  copy.style.height = `${card.offsetHeight}px`;
  copy.style.visibility = '';
  copy.querySelectorAll('.timer').forEach((el) => el.remove());
  copy.setAttribute('aria-hidden', 'true');
  stack.appendChild(copy);
  requestAnimationFrame(() => requestAnimationFrame(() => copy.classList.add(how)));
  setTimeout(() => copy.remove(), 360);
}

// Every button with data-act (Done, Snooze, Skip, ✕, Got it…) answers the reminder.
root.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) finish(b.dataset.act);
});

/**
 * Auto-fade with a progress bar along the bottom. The bar is a CSS animation that
 * pauses while the card is hovered (see .timer in popup.css); when it ends, the card goes.
 */
function autoFade(card, ms) {
  const bar = document.createElement('div');
  bar.className = 'timer';
  bar.style.animationDuration = `${ms}ms`;
  bar.addEventListener('animationend', () => finish('timeout'));
  card.appendChild(bar);
}

// Created only when a chime actually plays: an <audio> element in the page would
// start Chromium's audio process for every popup (even silent ones).
let chime = null;
function playChime() {
  if (!chime) {
    chime = new Audio('../../assets/chime.wav');
    chime.volume = 0.5;
  }
  chime.currentTime = 0;
  chime.play().catch(() => {});
}

function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- card types

/** Slim card (water, and your own reminders in the "pill" style): one line, silent, click anywhere. */
function renderSlim({ tone, title, sub, fadeSec }) {
  root.innerHTML = `
    <div class="card pill tone-${esc(tone)}" title="Click to dismiss">
      <div class="icon">${iconSvg(tone)}</div>
      <div class="pill-text">
        <div class="text">${esc(title)}</div>
        ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
      </div>
      <span class="pill-x" aria-hidden="true">✕</span>
    </div>`;
  const card = root.querySelector('.card');
  card.addEventListener('click', () => finish('done'));
  if (fadeSec > 0) autoFade(card, fadeSec * 1000);
}

/** Posture: three short cues on one line. Fixed it, or the full guide. */
function renderPosture(p) {
  root.innerHTML = `
    <div class="card posture tone-posture">
      <button class="close-x" title="Dismiss" data-act="dismiss">✕</button>
      <div class="body">
        <div class="head">
          <div class="badge">${iconSvg('posture')}</div>
          <div class="label">Posture check</div>
        </div>
        <div class="title">Sit tall</div>
        <p class="cue-line">${p.cues.map(esc).join('<span class="dot">·</span>')}</p>
      </div>
      <div class="actions">
        <button class="btn primary" data-act="done">Fixed it</button>
        <button class="link" data-guide>How to sit →</button>
      </div>
    </div>`;
  const card = root.querySelector('.card');
  card.querySelector('[data-guide]').addEventListener('click', () => {
    window.api.openGuide();
    finish('done');
  });
  if (p.fadeSec > 0) autoFade(card, p.fadeSec * 1000); // 0 = stays until dismissed
}

/** Your own reminder without a list: "card" fades after fadeSec, "sticky" waits for Done / Snooze / Skip. */
function renderCustomCard(p) {
  const sticky = p.style === 'sticky';
  root.innerHTML = `
    <div class="card custom tone-${esc(p.icon)}">
      ${sticky ? '' : '<button class="close-x" title="Dismiss" data-act="dismiss">✕</button>'}
      <div class="body">
        <div class="head">
          <div class="badge">${iconSvg(p.icon)}</div>
          <div class="label">Reminder</div>
        </div>
        <div class="title">${esc(p.name)}</div>
        ${p.message ? `<p class="detail">${esc(p.message)}</p>` : ''}
      </div>
      <div class="actions">${answerButtons(sticky)}</div>
    </div>`;
  const card = root.querySelector('.card');
  if (!sticky && p.fadeSec > 0) autoFade(card, p.fadeSec * 1000);
  if (sticky && p.chime) playChime();
}

function answerButtons(sticky) {
  return sticky
    ? `<button class="btn primary" data-act="done">Done</button>
       <button class="btn" data-act="snooze">Snooze 10m</button>
       <button class="btn" data-act="skip">Skip</button>`
    : '<button class="btn primary" data-act="done">Got it</button>';
}

// ---------------------------------------------------------------- activity card

// Move, and your own reminders with a list: one item at a time, ↻ Swap, optional timer.
let activityIndex = 0;

const isSticky = (p) => p.type === 'move' || p.style === 'sticky';

function activityHead(p) {
  const icon = p.type === 'move' ? 'move' : p.icon;
  const label = p.type === 'move' ? 'Time to move' : p.name;
  return `
    <div class="head">
      <div class="badge">${iconSvg(icon)}</div>
      <div class="label">${esc(label)}</div>
    </div>`;
}

function renderActivity(p, { chime = true } = {}) {
  const sticky = isSticky(p);
  const a = p.activities[activityIndex % p.activities.length];
  const canSwap = p.activities.length > 1;
  const tone = p.type === 'move' ? 'move' : p.icon;
  root.innerHTML = `
    <div class="card activity ${p.type === 'move' ? 'move' : 'custom'} tone-${esc(tone)}">
      ${sticky ? '' : '<button class="close-x" title="Dismiss" data-act="dismiss">✕</button>'}
      ${canSwap ? `<button class="swap ${sticky ? '' : 'beside-x'}" data-swap title="Show a different one">↻ Swap</button>` : ''}
      <div class="body">
        ${activityHead(p)}
        <div class="title">${esc(a.title)}</div>
        ${a.detail ? `<p class="detail">${esc(a.detail)}</p>` : ''}
        ${
          a.timerSec
            ? `<div class="timer-row">
                 <button class="adj" data-adj="-1" title="Shorter" aria-label="Shorter timer">−</button>
                 <button class="start" data-start>▶ Start ${fmtClock(a.timerSec)} timer</button>
                 <button class="adj" data-adj="1" title="Longer" aria-label="Longer timer">+</button>
               </div>`
            : ''
        }
      </div>
      <div class="actions">${answerButtons(sticky)}</div>
    </div>`;
  const card = root.querySelector('.card');

  const swap = card.querySelector('[data-swap]');
  if (swap) {
    swap.addEventListener('click', () =>
      refresh(() => {
        activityIndex++;
        renderActivity(p, { chime: false });
      })
    );
  }

  const start = card.querySelector('[data-start]');
  if (start) {
    start.addEventListener('click', () => refresh(() => runTimer(p, a)));
    let saveTimer = null;
    card.querySelectorAll('[data-adj]').forEach((b) =>
      b.addEventListener('click', () => {
        const { min, max, step } = p.timerLimits;
        a.timerSec = Math.min(max, Math.max(min, a.timerSec + Number(b.dataset.adj) * step));
        start.textContent = `▶ Start ${fmtClock(a.timerSec)} timer`;
        // Remember the new length for this item (debounced while clicking repeatedly).
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => window.api.setActivityTimer(p.id, a.id, a.timerSec), 400);
      })
    );
  }
  if (!sticky && p.fadeSec > 0) autoFade(card, p.fadeSec * 1000);
  if (chime && p.chime) playChime();
}

/** Countdown view for a timed item (walk, stairs, stretch, box breathing…). */
function runTimer(p, a) {
  let totalMs = a.timerSec * 1000;
  const RING = 2 * Math.PI * 34;
  let endAt = Date.now() + totalMs;
  let pausedLeft = null; // ms left while paused
  let completed = false;

  const card = root.querySelector('.card');
  card.querySelectorAll('[data-swap], .timer').forEach((el) => el.remove()); // no swapping, and no fading mid-timer
  card.querySelector('.body').innerHTML = `
    ${activityHead(p)}
    <div class="timer-view">
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 80 80" aria-hidden="true">
          <circle class="track" cx="40" cy="40" r="34"/>
          <circle class="prog" cx="40" cy="40" r="34" stroke-dasharray="${RING}" stroke-dashoffset="0"/>
        </svg>
        <div class="time" role="timer" aria-live="off">${fmtClock(a.timerSec)}</div>
      </div>
      <div class="timer-text">
        <div class="title">${esc(a.title)}</div>
        <p class="detail" data-status>Keep going…</p>
        <div class="nudge">
          <button class="chip" data-nudge="-15">−15s</button>
          <button class="chip" data-nudge="15">+15s</button>
        </div>
      </div>
    </div>`;
  const actions = card.querySelector('.actions');
  actions.innerHTML = `
    <button class="btn" data-pause>Pause</button>
    <button class="btn primary" data-act="done">Finish early</button>
    <button class="btn" data-cancel>Cancel</button>`;

  const timeEl = card.querySelector('.time');
  const prog = card.querySelector('.prog');
  const status = card.querySelector('[data-status]');
  const pauseBtn = card.querySelector('[data-pause]');
  let interval = null;

  const leftMs = () => (pausedLeft !== null ? pausedLeft : Math.max(0, endAt - Date.now()));
  function draw() {
    const left = leftMs();
    timeEl.textContent = fmtClock(left / 1000);
    prog.setAttribute('stroke-dashoffset', String(RING * (1 - left / totalMs)));
    if (left <= 0) complete();
  }
  function complete() {
    if (completed) return;
    completed = true;
    clearInterval(interval);
    const before = card.offsetHeight;
    card.querySelector('.ring-wrap').classList.add('done');
    card.querySelector('.nudge').remove();
    timeEl.textContent = '✓';
    status.textContent = 'Nice work!';
    actions.innerHTML = '<button class="btn primary" data-act="done">Done</button>';
    easeHeight(card, before);
    if (p.chime) playChime();
    later(() => finish('done'), 6000);
  }

  // Adjust just this run: change the time left (and the ring's total when adding).
  card.querySelectorAll('[data-nudge]').forEach((b) =>
    b.addEventListener('click', () => {
      const deltaMs = Number(b.dataset.nudge) * 1000;
      const left = Math.max(1000, leftMs() + deltaMs);
      if (deltaMs > 0) totalMs = Math.max(totalMs, left);
      if (pausedLeft !== null) pausedLeft = left;
      else endAt = Date.now() + left;
      draw();
    })
  );
  pauseBtn.addEventListener('click', () => {
    if (pausedLeft === null) {
      pausedLeft = leftMs();
      pauseBtn.textContent = 'Resume';
      status.textContent = 'Paused';
    } else {
      endAt = Date.now() + pausedLeft;
      pausedLeft = null;
      pauseBtn.textContent = 'Pause';
      status.textContent = 'Keep going…';
    }
  });
  card.querySelector('[data-cancel]').addEventListener('click', () => {
    clearInterval(interval);
    refresh(() => renderActivity(p, { chime: false }));
  });

  draw();
  interval = every(draw, 200);
}

// ---------------------------------------------------------------- the stack

/**
 * The reminders waiting behind the card peek out above it: the next one shows its
 * name, a second layer hints at more. Both layers are always in the page and slide
 * in or out (CSS) as the line changes, so nothing is rebuilt or pops.
 */
function renderStack() {
  const n = waiting.length;
  stack.classList.toggle('has-1', n === 1);
  stack.classList.toggle('has-2', n >= 2);
  if (!n) return;
  const first = waiting[0];
  const label = `Next: ${first.name}`;
  const relabel = next.querySelector('.g-name').textContent !== label && stack.classList.contains('shown');
  next.className = `ghost g1 tone-${first.icon}${relabel ? ' relabel' : ''}`;
  next.title = `Up next: ${waiting.map((w) => w.name).join(', ')}`;
  next.querySelector('.g-icon').innerHTML = iconSvg(first.icon, 12);
  next.querySelector('.g-name').textContent = label;
  next.querySelector('.g-more').textContent = n > 1 ? `+${n - 1}` : '';
  stack.classList.add('shown');
}

/**
 * The window is click-through except over the cards (see popups.js): tell the main
 * process where the cards are, i.e. the card on screen plus the edges peeking out above.
 */
let lastHit = '';
function reportHitArea() {
  const card = root.querySelector('.card');
  if (!card) return;
  const r = stack.getBoundingClientRect();
  const peek = waiting.length > 1 ? 30 : waiting.length ? 22 : 0;
  const rect = { x: Math.floor(r.left), y: Math.floor(r.top - peek), width: Math.ceil(r.width), height: Math.ceil(r.height + peek) };
  const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
  if (key === lastHit) return;
  lastHit = key;
  window.api.setHitArea(rect);
}
new ResizeObserver(reportHitArea).observe(root);

/**
 * Cards fit their content, so a card's height can change: the next card coming
 * forward, ↻ Swap, a timer starting or ending. Instead of jumping, the card eases
 * from its old height to the new one (and with `fade`, its new content fades in).
 */
function easeHeight(card, fromHeight, { fade = false } = {}) {
  if (fade) {
    card.classList.remove('refresh');
    void card.offsetWidth; // restart the fade if it is already running
    card.classList.add('refresh');
  }
  card.style.height = '';
  const toHeight = card.offsetHeight;
  if (!fromHeight || Math.abs(toHeight - fromHeight) < 2) return;
  card.style.height = `${fromHeight}px`;
  void card.offsetHeight; // apply the starting height before transitioning
  card.style.transition = 'height 240ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 300ms ease, transform 300ms ease';
  card.style.height = `${toHeight}px`;
  let done = false;
  const onEnd = (e) => e.propertyName === 'height' && end();
  const end = () => {
    if (done) return;
    done = true;
    card.removeEventListener('transitionend', onEnd);
    card.style.height = '';
    card.style.transition = '';
  };
  card.addEventListener('transitionend', onEnd);
  setTimeout(end, 400); // in case transitionend never fires
}

/**
 * Change what's on the card (↻ Swap, timer started or cancelled) smoothly: the parts
 * that change fade out quickly while the label stays put, then `draw` runs and the
 * card eases to its new height as the new content fades in.
 */
function refresh(draw) {
  const before = root.querySelector('.card');
  if (!before || before.classList.contains('out')) return; // already changing
  const fromHeight = before.offsetHeight;
  before.classList.add('out');
  later(() => {
    draw();
    const card = root.querySelector('.card');
    card.classList.remove('out');
    easeHeight(card, fromHeight, { fade: true });
  }, 90);
}

window.api.onWaiting((w) => {
  waiting = Array.isArray(w) ? w : [];
  renderStack();
  reportHitArea();
});

/** Draw the card for a payload: the first one slides in, later ones come forward from behind. */
function show(p) {
  if (!p) return window.api.act('dismiss');
  if (p.seq <= shownSeq) return;
  shownSeq = p.seq;
  const previous = root.querySelector('.card');
  const fromHeight = previous && !firstCard ? previous.offsetHeight : 0;
  clearTimers();
  finished = false;
  stack.classList.remove('closing');
  waiting = Array.isArray(p.waiting) ? p.waiting : [];
  renderStack();

  if (p.type === 'water') renderSlim({ tone: 'water', title: p.title, fadeSec: p.fadeSec });
  else if (p.type === 'posture') renderPosture(p);
  else if (p.type === 'custom' && p.style === 'pill') renderSlim({ tone: p.icon, title: p.name, sub: p.message, fadeSec: p.fadeSec });
  else if (p.activities && p.activities.length) {
    activityIndex = p.index || 0;
    renderActivity(p);
  } else renderCustomCard(p);

  const card = root.querySelector('.card');
  card.classList.add(firstCard ? 'enter' : 'forward');
  firstCard = false;
  easeHeight(card, fromHeight);
  reportHitArea();
}

window.api.onCard(show);
window.api.getPayload().then(show);
