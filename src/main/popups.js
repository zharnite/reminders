'use strict';

const { BrowserWindow, screen } = require('electron');
const path = require('path');

// Every card has the same width so the cards waiting behind line up with the one in
// front. The window never changes size while it is open (resizing a transparent window
// makes its content jump for a frame); it is tall enough for the biggest stack, sits in
// the bottom-right corner above the taskbar, and lets clicks through everywhere except
// over the cards (the popup switches that as the pointer comes and goes).
// The window has a transparent margin around the cards (popup.css: body padding) so
// their soft shadow fades out fully instead of being cut off at the window's edge.
const WIDTH = 384; // cards are 384 - 2 x 24 = 336 px wide
const HEIGHT = 410;
const MARGIN = 0; // the transparent margin already keeps the card off the screen edge

class Popups {
  constructor() {
    this.win = null;
    this.payload = null;
    this.seq = 0; // increases with every card sent, so the popup can ignore stale ones
    this.onUnexpectedClose = null; // called if the window closes without close() (e.g. renderer crash)
  }

  isOpen() {
    return !!this.win && !this.win.isDestroyed();
  }

  /** A preview popup (from the main window) is on screen; it is not tied to the scheduler. */
  isPreview() {
    return this.isOpen() && !!this.payload && !!this.payload.preview;
  }

  /** Put a card on screen: in the open popup if there is one (the next card in the stack), else in a new one. */
  show(payload) {
    this.payload = { ...payload, seq: ++this.seq };
    if (this.isOpen()) {
      this.win.webContents.send('popup:card', this.payload);
      return;
    }
    const { workArea } = screen.getPrimaryDisplay();
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      x: Math.round(workArea.x + workArea.width - WIDTH - MARGIN),
      y: Math.round(workArea.y + workArea.height - HEIGHT - MARGIN),
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false, // never steal keyboard focus
      hasShadow: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true);
    win.setIgnoreMouseEvents(true, { forward: true }); // click-through until the pointer is over a card
    this.win = win;
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.showInactive();
    });
    win.on('closed', () => {
      if (this.win === win) {
        const wasPreview = !!(this.payload && this.payload.preview);
        this.win = null;
        this.payload = null;
        if (this.onUnexpectedClose && !wasPreview) this.onUnexpectedClose();
      }
    });
    win.webContents.on('render-process-gone', () => this.close());
    win.loadFile(path.join(__dirname, '..', 'renderer', 'popup.html'));
  }

  /** The pointer is over the cards (catch clicks) or not (let them through to what's underneath). */
  setInteractive(on) {
    if (this.isOpen()) this.win.setIgnoreMouseEvents(!on, { forward: true });
  }

  /** The reminders waiting behind the card on screen changed: redraw the stack. */
  setWaiting(waiting) {
    if (!this.isOpen() || !this.payload) return;
    this.payload = { ...this.payload, waiting };
    this.win.webContents.send('popup:waiting', waiting);
  }

  getPayload(webContents) {
    return this.win && webContents === this.win.webContents ? this.payload : null;
  }

  ownsSender(webContents) {
    return !!this.win && !this.win.isDestroyed() && webContents === this.win.webContents;
  }

  close() {
    const win = this.win;
    this.win = null;
    this.payload = null;
    if (win && !win.isDestroyed()) win.destroy();
  }
}

module.exports = { Popups };
