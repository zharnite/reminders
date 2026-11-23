# Working on Reminders (guide for coding agents)

Reminders is a small Windows tray app built with Electron. It nudges you to move, drink water and sit well, plus reminders the user creates. There is no build step, no framework and no bundler: plain CommonJS in the main process, plain browser scripts in the windows. Read this before changing anything; the README is the user-facing guide.

## Commands

```powershell
npm install        # deps go into node_modules (Electron 45, koffi, electron-builder)
npm test           # unit tests: node --test (test/scheduler.test.js), no Electron needed
npm start          # run the app (tray icon near the clock)
npm run fast       # 1 minute = 1 second, separate profile in %APPDATA%\Reminders-dev
npm run dist       # unsigned NSIS installer -> dist\Reminders-Setup-<version>.exe
npm run assets     # regenerate assets/icon.png, tray.png, chime.wav (scripts/make-assets.js)
```

Useful flags (combine with `--fast`): `--show=<id>` pops a reminder at once (`move`, `water`, `posture`, or a custom id such as `r-abc123`); `--open=<tab>` opens the main window (`home`, `reminders`, `exercises`, `smart`, `styles`, `guide`). `REMINDERS_CAPTURE=<dir>` saves a PNG of every window that opens.

Always run `npm test` after changing anything under `src/main`. For UI changes, run the app in fast mode and look at it; unit tests don't cover the windows.

## How it fits together

```
conditions.js (idle, lock, fullscreen) ─┐
settings.js (settings.json) ────────────┤
                                        ▼
            main.js tick() every 15 s (1 s in fast mode)
                                        │
            scheduler.js  ── queue of cards (pure logic, unit tested)
                                        │  card id
            content.js    ── payload for that card (text, exercise list, fade time)
                                        │
            popups.js     ── one popup window: popup.html / popup.js draw the stack
```

- **`src/main/scheduler.js`** is pure (no Electron). Each reminder accrues active time only while counting (present, inside active hours, not paused). When due it joins a queue as its own card. `queue[0]` is on screen; the rest wait behind it. Coming back after the screen was locked or the PC slept restarts Move (`rules.AwayTracker` decides; plain inactivity only pauses timers). Rules that must hold: one card per reminder, never two cards for the same reminder, answering a card resets only that reminder, reminders due in the same tick are ordered by style priority (waiting card > fading card > slim card), held slim cards go stale after 10 minutes.
- **`src/main/reminders.js`** is the catalog: the three built-ins (`move`, `water`, `posture`), the three styles (`pill` = "Slim card", `card` = "Fading card", `sticky` = "Waiting card"), icons, limits, and cleaning of user-made reminders (`normalizeCustom`, `cleanItems`).
- **`src/main/content.js`** turns a reminder id into a popup payload: built-in exercises, posture cues, water lines, rotation through lists.
- **`src/main/main.js`** owns the tray, the main window, the tick loop, pause/mute/appearance, and all IPC handlers.
- **`src/main/popups.js`** owns the single popup window. It is a fixed size (384 x 410), transparent and click-through except over the cards: the popup reports where its cards are (`popup:hit-area`), and while the window is open the main process checks the cursor against that area every 60 ms and switches `setIgnoreMouseEvents`. Don't rely on Electron's `forward` option for this: on some PCs no mouse events are forwarded at all, and the cards become unclickable. The window never resizes while open: resizing a transparent window makes its content jump for a frame. The next card is sent into the same window (`popup:card`); the window closes when the queue is empty.
- **`src/renderer/popup.js`** draws one card at a time into `#root`, with the two "peeking" cards (`.ghost`) as permanent elements in `popup.html`. Transitions: the first card slides in; when answered with more waiting, a copy of it slides off on top (`outgoing()`) while the next comes forward underneath; height changes ease (`easeHeight()`); Swap/timer changes fade the changing parts (`refresh()`).
- **The main window** is `app.html` + `app-core.js` (navigation, settings load/save, `App.register`) + one `tab-*.js` per tab. Tabs read and change `App.data` (the settings object) and call `App.save()`, which debounces and sends the whole object to `settings:save`.
- **`src/preload.js`** is the only bridge (`window.api`). IPC channels: `popup:payload|act|card|waiting|hit-area`, `activity:set-timer`, `open:guide`, `settings:get|save|changed`, `state:get|update`, `app:remind-now|preview|pause|resume`, `main:navigate`.

## Settings

`settings.js` holds `DEFAULTS` and `mergeDefaults()`, which keeps only keys that exist in `DEFAULTS` and only values of the same type. **Any new setting must be added to `DEFAULTS` or it is silently dropped.** Arrays (`exercises`, `custom`) pass through as-is and are cleaned by `normalizeExercises` / `normalizeCustom`. Settings live in `%APPDATA%\Reminders\settings.json` (fast mode: `%APPDATA%\Reminders-dev`). Pause state is not saved.

## Constraints and gotchas

- **Content-Security-Policy is `default-src 'self'`**: no inline `<style>`, no inline event handlers, no `style="..."` in HTML strings. Setting `element.style.x` from script (CSSOM) is fine.
- **Windows are sandboxed** with `contextIsolation`; renderer code only talks to the main process through `window.api`.
- **Popups never take focus** (`focusable: false`, `showInactive()`); don't add anything that needs keyboard input in a popup.
- **Colours come from icon tones**: `tones.css` defines `--tone` / `--tone-soft` per icon (`.tone-move`, `.tone-eye`…). Cards, badges and buttons use those variables. A new icon needs an entry in `icons.js` (shape + name), `tones.css` (light and dark) and `ICONS` in `reminders.js`.
- **Dark mode** is `prefers-color-scheme`, driven by `nativeTheme.themeSource` from the Appearance setting. Every colour needs a dark value.
- **Resource use matters** (it idles in the tray all day): hardware acceleration is off, audio runs in-process and the chime `Audio` is created only when a chime plays, windows are created when shown and destroyed when closed, the tick only pushes state to the main window while it is visible. Idle is about 56 to 70 MB and under 20 ms of CPU per minute; keep it there.
- **Single instance per profile**: a second launch with the same profile just opens the first one's window. Fast mode has its own profile, so a fast copy and a normal copy can run side by side.
- **Layout of popups**: every card is the same width (336 px); height fits the content. The shadow must fade out inside the window's 24 px transparent margin (`body` padding) or it shows a hard edge.

## Making common changes

- **New built-in exercise:** add to `BUILTIN_EXERCISES` in `content.js` (users can switch built-ins off but not delete them).
- **New field on user reminders:** add it in `cleanCustom()` (`reminders.js`), the form in `tab-custom.js` (`formHtml`, `readForm`, `blank`), the payload in `customPayload()` (`content.js`), and the drawing in `popup.js`. Add a unit test.
- **New setting:** `DEFAULTS` in `settings.js`, a control in `app.html`, `render()` and `collect()` in `tab-settings.js`, then use it in `main.js`.
- **New main-window tab:** a `<section data-panel="...">` and a sidebar button in `app.html`, a `tab-<name>.js` that calls `App.register`, and the name in `TABS` in `main.js`.

## Style

- Plain English in the UI, short and concrete; sentence case; no exclamation marks except "Nice work!" when a timer finishes.
- Comments explain *why*, not what. Keep functions small and pure where they can be (anything in `scheduler.js`, `reminders.js`, `content.js` and `rules.js` must stay free of Electron imports so it stays testable).
- Two-space indent, single quotes, semicolons, `'use strict'` at the top of each file.
