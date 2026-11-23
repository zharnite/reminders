'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, ipcMain, powerMonitor } = require('electron');
const path = require('path');
const { Settings } = require('./settings');
const { Scheduler } = require('./scheduler');
const { Conditions } = require('./conditions');
const { Popups } = require('./popups');
const { nextActiveStart, AwayTracker } = require('./rules');
const { reminderList, reminderDefs, normalizeCustom, draftCustom, STYLES, ICONS, LIMITS } = require('./reminders');
const {
  buildPayload,
  customPayload,
  normalizeExercises,
  clampTimer,
  BUILTIN_EXERCISES,
  TIMER_MIN_SEC,
  TIMER_MAX_SEC,
  TITLE_MAX,
  DETAIL_MAX,
} = require('./content');

// --fast (or REMINDERS_FAST=1): one "minute" lasts one second, for trying things out.
const FAST = process.argv.includes('--fast') || process.env.REMINDERS_FAST === '1';
const MINUTE_MS = FAST ? 1000 : 60000;
const TICK_MS = FAST ? 1000 : 15000;
const SNOOZE_MIN = 10;
const MAX_PAUSE_MS = 7 * 24 * 60 * 60 * 1000;
const ROOT = path.join(__dirname, '..', '..');
const TABS = ['home', 'reminders', 'exercises', 'smart', 'styles', 'guide'];

// The UI is a few small static windows; software rendering is plenty and avoids
// keeping a GPU process (~60 MB) alive while the app idles in the tray.
app.disableHardwareAcceleration();
// Play the occasional chime in-process: otherwise the first chime starts a separate
// audio process (~10 MB) that then stays alive for the rest of the session.
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess');

// Fast mode uses its own profile so experimenting never touches your real settings.
if (FAST) app.setPath('userData', path.join(app.getPath('appData'), 'Reminders-dev'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let settings, scheduler, conditions, popups, tray;
let pausedUntil = 0;
const awayTracker = new AwayTracker();
let lastCond = { away: false, absent: false, inHours: true, fullscreen: false };
let mainWin = null;
let shownWaitingKey = ''; // the line behind the popup on screen, as last drawn
let lastTooltip = '';

app.setAppUserModelId('local.reminders.app');

app.whenReady().then(() => {
  // Dev only: REMINDERS_CAPTURE=<dir> saves PNG snapshots of every window that opens.
  if (process.env.REMINDERS_CAPTURE) {
    const fs = require('fs');
    let n = 0;
    app.on('browser-window-created', (_e, win) => {
      win.webContents.once('did-finish-load', () =>
        setTimeout(async () => {
          if (win.isDestroyed()) return;
          const img = await win.webContents.capturePage();
          const name = path.basename(win.webContents.getURL()).replace(/\W+/g, '_');
          fs.writeFileSync(path.join(process.env.REMINDERS_CAPTURE, `${++n}-${name}.png`), img.toPNG());
        }, 1200)
      );
    });
  }

  settings = new Settings(app.getPath('userData'));
  applyAppearance();
  scheduler = new Scheduler({ reminders: reminderDefs(settings.get().reminders), minuteMs: MINUTE_MS, tickMs: TICK_MS });
  conditions = new Conditions();
  popups = new Popups();
  popups.onUnexpectedClose = () => {
    scheduler.resolve('dismiss');
    tick(); // the next card in the stack (if any) gets a fresh popup
  };

  applyLoginItem();
  createTray();
  registerIpc();

  tick();
  setInterval(tick, TICK_MS);
  // Back from a locked screen or sleep: show what waited for you right away, not at the next tick.
  for (const ev of ['unlock-screen', 'resume']) powerMonitor.on(ev, () => setTimeout(tick, 500));

  // --show=<id> (move, water, posture or a custom reminder's id): pop a reminder right away
  const show = process.argv.find((a) => a.startsWith('--show='));
  if (show) setTimeout(() => remindNow(show.split('=')[1]), 800);
  // --open=<tab> : open the main window on a tab (home, reminders, exercises, smart, styles, guide)
  const open = process.argv.find((a) => a.startsWith('--open='));
  if (open) openMain(open.split('=')[1]);
  else if (settings.firstRun) {
    // A fresh install would otherwise start silently in the tray: show where things are, once.
    settings.set(settings.get());
    openMain('home');
  }
});

app.on('second-instance', () => openMain('home'));
app.on('window-all-closed', () => {
  // Keep running in the tray.
});

// ---------------------------------------------------------------- core loop

function tick() {
  const now = Date.now();
  const s = settings.get();
  const cond = conditions.evaluate(s.smart, new Date(now));
  lastCond = cond;

  // Back after locking the screen or the PC sleeping: you got up, so restart the move
  // timer (and drop a move card). Plain inactivity only pauses the timers. In "catch up"
  // mode Move isn't restarted: its card is waiting for you like the others.
  const catchUp = isCatchUp(s);
  const leftDesk = awayTracker.update(cond);
  const moveCleared = leftDesk && !catchUp && scheduler.returnedFromAway();

  const paused = now < pausedUntil;
  // Catch-up mode keeps counting while you're away, but holds the cards until you're back.
  const counting = !paused && cond.inHours && (catchUp || !cond.away);
  const canShow = !cond.absent && !cond.fullscreen && !(catchUp && cond.away);
  const card = scheduler.tick(now, { counting, canShow, catchUp: catchUp && cond.away });
  if (card) showCard(card);
  else if (moveCleared || (popups.isOpen() && !popups.isPreview() && !onScreen())) popups.close();
  else syncWaiting();

  refreshStatus();
}

/** "When you're away: keep counting, catch up when I'm back". */
function isCatchUp(s = settings.get()) {
  const a = s.smart.pauseWhenAway;
  return a.enabled && a.mode === 'catchup';
}

/** A real card is on screen (not just a preview). */
function onScreen() {
  return !!scheduler.front && scheduler.front.shown;
}

/** Update the tray tooltip (only when it changed) and the Home tab. */
function refreshStatus() {
  const text = tooltip();
  if (tray && text !== lastTooltip) {
    tray.setToolTip(text);
    lastTooltip = text;
  }
  pushState();
}

function showCard(card) {
  if (FAST) console.log(`[reminders] show ${card.id}`, scheduler.waiting().length ? `(waiting: ${scheduler.waiting()})` : '', JSON.stringify(lastCond));
  const payload = buildPayload(card.id, settings.get());
  if (payload) {
    // A card that waited for you to come back stays until you answer it, instead of fading.
    if (card.waited) payload.fadeSec = 0;
    popups.show(withMute({ ...payload, waiting: waitingInfo() }));
    shownWaitingKey = scheduler.waiting().join();
  } else {
    scheduler.resolve('dismiss'); // its reminder was deleted meanwhile
    tick();
  }
  pushState();
}

/** Name and icon of each reminder waiting behind the one on screen (drawn as cards peeking out behind it). */
function waitingInfo() {
  const byId = new Map(reminderList(settings.get().reminders).map((r) => [r.id, r]));
  return scheduler
    .waiting()
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((r) => ({ id: r.id, name: r.name, icon: r.icon }));
}

/** Tell the popup on screen when the line behind it changes. */
function syncWaiting() {
  if (!popups.isOpen() || popups.isPreview()) return;
  const key = scheduler.waiting().join();
  if (key === shownWaitingKey) return;
  shownWaitingKey = key;
  popups.setWaiting(waitingInfo());
}

/** Mute all sounds: strip the chime from a payload. */
function withMute(payload) {
  return settings.get().muted ? { ...payload, chime: false } : payload;
}

function setMuted(muted) {
  settings.set({ ...settings.get(), muted: !!muted });
  pushSettings();
  refreshStatus();
}

/** "Remind me now": shows it right away, or adds it to the stack if a card is on screen. */
function remindNow(id) {
  const result = scheduler.triggerNow(String(id));
  if (result === 'queued') syncWaiting();
  else if (result) showCard(result);
  pushState();
  return !!result;
}

/**
 * Show a sample popup without touching any timer. `req` is { id } for an existing
 * reminder, or { draft } for an unsaved one from the add/edit form.
 */
function preview(req = {}) {
  if (popups.isOpen() && !popups.isPreview()) return false; // a real reminder is on screen
  let payload = null;
  if (req.draft) payload = customPayload(draftCustom(req.draft));
  else if (scheduler.ids().includes(req.id)) payload = buildPayload(req.id, settings.get());
  if (!payload) return false;
  popups.show(withMute({ ...payload, preview: true }));
  pushState();
  return true;
}

// ---------------------------------------------------------------- status & pause

function fmtRemaining(ms) {
  if (ms === null) return 'off';
  const min = Math.ceil(ms / MINUTE_MS);
  if (min <= 0) return 'now';
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtUntil(ts) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? fmtTime(ts) : `${d.toLocaleDateString([], { weekday: 'short' })} ${fmtTime(ts)}`;
}

function statusKind() {
  if (Date.now() < pausedUntil) return 'paused';
  if (!lastCond.inHours) return 'outside';
  if (lastCond.away) return isCatchUp() ? 'catchup' : 'away';
  if (lastCond.fullscreen) return 'fullscreen';
  return 'running';
}

function statusLine() {
  const muted = settings && settings.get().muted ? ' · sounds muted' : '';
  return baseStatus() + muted;
}

function baseStatus() {
  switch (statusKind()) {
    case 'paused': return `Paused until ${fmtUntil(pausedUntil)}`;
    case 'outside': {
      const next = nextActiveStart(new Date(), settings.get().smart.activeHours);
      return next ? `Outside active hours · back ${fmtUntil(next.getTime())}` : 'Outside active hours';
    }
    case 'away': return 'Away — timers paused';
    case 'catchup': return 'Away — reminders will wait for you';
    case 'fullscreen': return 'Fullscreen — reminders held';
    default: return FAST ? 'Running (fast mode: 1 min = 1 s)' : 'Running';
  }
}

function tooltip() {
  if (!scheduler) return 'Reminders';
  const d = scheduler.nextDue();
  // Soonest first; Windows cuts tray tooltips at 127 characters.
  const lines = reminderList(settings.get().reminders)
    .filter((r) => d[r.id] != null)
    .sort((a, b) => d[a.id] - d[b.id])
    .map((r) => `${r.name} ${fmtRemaining(d[r.id])}`);
  let text = `Reminders — ${statusLine()}`;
  for (const line of lines) {
    if (text.length + line.length + 1 > 127) break;
    text += `\n${line}`;
  }
  return text;
}

function pauseFor(ms) {
  pausedUntil = ms > 0 ? Date.now() + Math.min(ms, MAX_PAUSE_MS) : 0;
  tick();
}

function msUntilTomorrow() {
  const t = new Date();
  t.setHours(24, 0, 0, 0);
  return t.getTime() - Date.now();
}

/** Snapshot for the Home tab. */
function appState() {
  const s = settings.get();
  const paused = Date.now() < pausedUntil;
  return {
    status: statusLine(),
    kind: statusKind(),
    nextDue: scheduler.nextDue(),
    reminders: reminderList(s.reminders),
    pausedUntil: paused ? pausedUntil : 0,
    pausedLabel: paused ? fmtUntil(pausedUntil) : '',
    popupOpen: popups.isOpen() && !popups.isPreview(),
    queued: scheduler.queue.map((c) => c.id), // on screen or waiting
    minuteMs: MINUTE_MS,
    fast: FAST,
  };
}

function pushState() {
  if (mainWin && !mainWin.isDestroyed() && mainWin.isVisible()) {
    mainWin.webContents.send('state:update', appState());
  }
}

// ---------------------------------------------------------------- tray

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png'));
  tray = new Tray(icon);
  lastTooltip = tooltip();
  tray.setToolTip(lastTooltip);
  tray.on('click', () => openMain('home'));
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
}

function buildMenu() {
  const d = scheduler.nextDue();
  const paused = Date.now() < pausedUntil;
  const list = reminderList(settings.get().reminders);
  // Menu labels treat & as an accelerator marker; double it to show a literal &.
  const name = (r) => r.name.replace(/&/g, '&&');
  return Menu.buildFromTemplate([
    { label: statusLine(), enabled: false },
    { type: 'separator' },
    ...list.map((r) => ({ label: `${name(r)} — ${fmtRemaining(d[r.id] ?? null)}`, enabled: false })),
    { type: 'separator' },
    {
      label: 'Remind me now',
      submenu: list.map((r) => ({ label: name(r), click: () => remindNow(r.id) })),
    },
    {
      label: paused ? `Paused until ${fmtUntil(pausedUntil)}` : 'Pause',
      submenu: [
        { label: '30 minutes', click: () => pauseFor(30 * MINUTE_MS) },
        { label: '1 hour', click: () => pauseFor(60 * MINUTE_MS) },
        { label: '2 hours', click: () => pauseFor(120 * MINUTE_MS) },
        { label: 'Until tomorrow', click: () => pauseFor(msUntilTomorrow()) },
        { label: 'Custom…', click: () => openMain('home', 'pause') },
        { type: 'separator' },
        { label: 'Resume', enabled: paused, click: () => pauseFor(0) },
      ],
    },
    { label: 'Mute sounds', type: 'checkbox', checked: !!settings.get().muted, click: (item) => setMuted(item.checked) },
    { type: 'separator' },
    { label: 'Open Reminders', click: () => openMain('home') },
    { label: 'How to sit (posture guide)', click: () => openMain('guide') },
    { type: 'separator' },
    { label: 'Quit Reminders', click: () => app.quit() },
  ]);
}

// ---------------------------------------------------------------- main window

/** Open (or focus) the main window on a tab. `focus` names a control to focus, e.g. 'pause'. */
function openMain(tab = 'home', focus = '') {
  if (!TABS.includes(tab)) tab = 'home';
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
    mainWin.webContents.send('main:navigate', tab, focus);
    return;
  }
  mainWin = new BrowserWindow({
    width: 900,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    title: 'Reminders',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(ROOT, 'assets', 'icon.png'),
    backgroundColor: windowBackground(), // no light flash when opening in dark mode
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWin.setMenu(null);
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('show', pushState);
  mainWin.on('closed', () => (mainWin = null));
  mainWin.loadFile(path.join(__dirname, '..', 'renderer', 'app.html'), {
    hash: focus ? `${tab}:${focus}` : tab,
  });
}

function settingsForRenderer() {
  const data = settings.get();
  data.reminders.move.exercises = normalizeExercises(data.reminders.move.exercises);
  data.reminders.custom = normalizeCustom(data.reminders.custom);
  data._meta = {
    packaged: app.isPackaged,
    fast: FAST,
    builtins: BUILTIN_EXERCISES,
    limits: { timerMin: TIMER_MIN_SEC, timerMax: TIMER_MAX_SEC, titleMax: TITLE_MAX, detailMax: DETAIL_MAX },
    custom: { styles: STYLES, icons: ICONS, limits: LIMITS },
  };
  return data;
}

/** Tell the main window that settings changed elsewhere (e.g. a timer set on the move card). */
function pushSettings() {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('settings:changed');
}

/**
 * Light / dark for every window, popups included: they all style themselves with
 * prefers-color-scheme, which follows nativeTheme.themeSource.
 */
function applyAppearance() {
  const a = settings.get().appearance;
  nativeTheme.themeSource = ['light', 'dark'].includes(a) ? a : 'system';
}

const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#1a1c21' : '#f6f7f9');
nativeTheme.on('updated', () => {
  if (mainWin && !mainWin.isDestroyed()) mainWin.setBackgroundColor(windowBackground());
});

function applyLoginItem() {
  // Only register the installed app; in development this would register a bare electron.exe.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: settings.get().launchAtLogin });
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('popup:payload', (e) => popups.getPayload(e.sender));

  ipcMain.on('popup:act', (e, action) => {
    if (!popups.ownsSender(e.sender)) return;
    if (popups.isPreview()) {
      popups.close(); // previews never touch the timers
      pushState();
      return;
    }
    const allowed = ['done', 'dismiss', 'timeout', 'skip', 'snooze'];
    if (FAST) console.log(`[reminders] action ${action}`);
    scheduler.resolve(allowed.includes(action) ? action : 'dismiss', SNOOZE_MIN);
    tick(); // the next card in the stack (if any) comes forward; otherwise the popup closes
  });

  ipcMain.on('popup:hit-area', (e, rect) => {
    if (popups.ownsSender(e.sender)) popups.setHitArea(rect);
  });

  ipcMain.on('open:guide', () => openMain('guide'));

  // Remember a timer length picked on a card (Move's exercises, or an item in your own reminder's list).
  ipcMain.on('activity:set-timer', (e, reminderId, itemId, sec) => {
    if (!popups.ownsSender(e.sender) || popups.isPreview()) return;
    const s = settings.get();
    let list;
    if (reminderId === 'move') {
      list = s.reminders.move.exercises = normalizeExercises(s.reminders.move.exercises);
    } else {
      s.reminders.custom = normalizeCustom(s.reminders.custom);
      const c = s.reminders.custom.find((x) => x.id === reminderId);
      list = c ? c.items : [];
    }
    const item = list.find((x) => x.id === itemId);
    if (!item || !item.timerSec) return;
    item.timerSec = clampTimer(sec);
    settings.set(s);
    pushSettings();
  });

  ipcMain.handle('settings:get', () => settingsForRenderer());

  ipcMain.handle('settings:save', (_e, data) => {
    if (data && data.reminders && data.reminders.move) {
      data.reminders.move.exercises = normalizeExercises(data.reminders.move.exercises);
    }
    if (data && data.reminders) data.reminders.custom = normalizeCustom(data.reminders.custom);
    settings.set(data);
    scheduler.updateConfig(reminderDefs(settings.get().reminders));
    applyAppearance();
    applyLoginItem();
    tick();
    return settingsForRenderer();
  });

  ipcMain.handle('state:get', () => appState());
  ipcMain.handle('app:remind-now', (_e, id) => remindNow(id));
  ipcMain.handle('app:preview', (_e, req) => preview(req));
  ipcMain.handle('app:pause', (_e, req = {}) => {
    if (req.until) pauseFor(Number(req.until) - Date.now());
    else if (req.tomorrow) pauseFor(msUntilTomorrow());
    else pauseFor(Math.max(0, Number(req.minutes) || 0) * MINUTE_MS);
    return appState();
  });
  ipcMain.handle('app:resume', () => {
    pauseFor(0);
    return appState();
  });
}
