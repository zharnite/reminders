'use strict';

// Shared plumbing for the main window: navigation, settings load/save, helpers.
// Each tab script registers itself with App.register(name, { render, ... }).

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || String(v).trim() === '') return fallback;
  return Math.min(max, Math.max(min, n));
}

function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const App = {
  data: null, // settings + _meta from the main process
  modules: {},
  saveTimer: null,

  register(name, mod) {
    this.modules[name] = mod;
  },

  /** Debounced save of the whole settings object. */
  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      const { _meta, ...payload } = this.data;
      this.data = await window.api.saveSettings(payload);
      const el = $('saved');
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 1200);
    }, 300);
  },

  renderAll() {
    for (const m of Object.values(this.modules)) if (m.render) m.render(this.data);
  },

  navigate(tab, focus) {
    const panels = document.querySelectorAll('[data-panel]');
    if (![...panels].some((p) => p.dataset.panel === tab)) tab = 'home';
    panels.forEach((p) => (p.hidden = p.dataset.panel !== tab));
    document.querySelectorAll('button.nav').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    document.querySelector('.content').scrollTop = 0;
    const mod = this.modules[tab];
    if (mod && mod.onShow) mod.onShow(focus);
  },
};

document.addEventListener('DOMContentLoaded', async () => {
  App.data = await window.api.getSettings();
  $('fast-banner').hidden = !App.data._meta.fast;
  App.renderAll();
  for (const m of Object.values(App.modules)) if (m.init) m.init();

  document.querySelectorAll('button.nav').forEach((b) =>
    b.addEventListener('click', () => App.navigate(b.dataset.tab))
  );
  // In-page links to another tab, e.g. <a href="#styles" data-goto="styles">
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-goto]');
    if (!a) return;
    e.preventDefault();
    App.navigate(a.dataset.goto);
  });
  const [tab, focus] = location.hash.slice(1).split(':');
  App.navigate(tab || 'home', focus);
  window.api.onNavigate((t, f) => App.navigate(t, f));

  // Settings changed outside this window (mute from the tray, a timer length set on the move card).
  window.api.onSettingsChanged(async () => {
    if (App.saveTimer) return;
    App.data = await window.api.getSettings();
    App.renderAll();
  });
});
