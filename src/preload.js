'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Popup
  getPayload: () => ipcRenderer.invoke('popup:payload'),
  act: (action) => ipcRenderer.send('popup:act', action),
  onWaiting: (cb) => ipcRenderer.on('popup:waiting', (_e, waiting) => cb(waiting)),
  openGuide: () => ipcRenderer.send('open:guide'),
  setActivityTimer: (reminderId, itemId, sec) => ipcRenderer.send('activity:set-timer', reminderId, itemId, sec),
  onCard: (cb) => ipcRenderer.on('popup:card', (_e, payload) => cb(payload)),
  setHitArea: (rect) => ipcRenderer.send('popup:hit-area', rect),

  // Main window: settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', () => cb()),

  // Main window: live status, pause, remind now
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => ipcRenderer.on('state:update', (_e, state) => cb(state)),
  remindNow: (id) => ipcRenderer.invoke('app:remind-now', id),
  preview: (req) => ipcRenderer.invoke('app:preview', req),
  pause: (req) => ipcRenderer.invoke('app:pause', req),
  resume: () => ipcRenderer.invoke('app:resume'),
  onNavigate: (cb) => ipcRenderer.on('main:navigate', (_e, tab, focus) => cb(tab, focus)),
});
