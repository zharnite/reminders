'use strict';

// Reminders tab, When to remind tab and the mute switch on Home: plain form controls bound to settings.

(() => {
  const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ROW_SWITCHES = {
    move: 'move-enabled',
    water: 'water-enabled',
    posture: 'posture-enabled',
    login: 'login-enabled',
    away: 'away-enabled',
    hours: 'hours-enabled',
    fullscreen: 'fullscreen-enabled',
  };

  function render(data) {
    const r = data.reminders;
    const sm = data.smart;
    for (const t of ['move', 'water', 'posture']) {
      $(`${t}-enabled`).checked = r[t].enabled;
      $(`${t}-interval`).value = r[t].intervalMin;
    }
    $('move-chime').checked = r.move.chime;
    $('water-fade-auto').checked = r.water.autoFade;
    $('water-fade-stay').checked = !r.water.autoFade;
    $('posture-fade-auto').checked = r.posture.autoFade;
    $('posture-fade-stay').checked = !r.posture.autoFade;
    $('posture-fade-sec').value = r.posture.fadeSec;
    $('login-enabled').checked = data.launchAtLogin;
    $('mute-enabled').checked = data.muted;
    const look = document.querySelector(`input[name="appearance"][value="${data.appearance}"]`);
    (look || document.querySelector('input[name="appearance"][value="system"]')).checked = true;
    if (!data._meta.packaged) {
      $('login-note').textContent =
        'Launch Reminders in the tray when you sign in. (Takes effect in the installed app, not when run with npm start.)';
    }

    $('away-enabled').checked = sm.pauseWhenAway.enabled;
    $('away-idle').value = sm.pauseWhenAway.idleMin;
    const mode = sm.pauseWhenAway.mode === 'catchup' ? 'catchup' : 'pause';
    document.querySelector(`input[name="away-mode"][value="${mode}"]`).checked = true;
    $('hours-enabled').checked = sm.activeHours.enabled;
    $('hours-start').value = sm.activeHours.start;
    $('hours-end').value = sm.activeHours.end;
    $('fullscreen-enabled').checked = sm.quietFullscreen.enabled;
    renderDays(sm.activeHours.days);
    syncRowStates();
  }

  function renderDays(selected) {
    const days = $('hours-days');
    days.innerHTML = '';
    [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
      // Monday first
      const on = selected.includes(d);
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = DAY_LABELS[d];
      b.title = DAY_NAMES[d];
      b.className = on ? 'on' : '';
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', () => {
        const set = new Set(App.data.smart.activeHours.days);
        set.has(d) ? set.delete(d) : set.add(d);
        App.data.smart.activeHours.days = [...set].sort();
        renderDays(App.data.smart.activeHours.days);
        App.save();
      });
      days.appendChild(b);
    });
  }

  function syncRowStates() {
    for (const [row, id] of Object.entries(ROW_SWITCHES)) {
      document.querySelector(`[data-row="${row}"]`).classList.toggle('off', !$(id).checked);
    }
    $('posture-fade-sec').disabled = !$('posture-fade-auto').checked;
  }

  function collect() {
    const { reminders: r, smart: sm } = App.data;
    for (const t of ['move', 'water', 'posture']) {
      r[t].enabled = $(`${t}-enabled`).checked;
      r[t].intervalMin = clampInt($(`${t}-interval`).value, 1, 600, r[t].intervalMin);
    }
    r.move.chime = $('move-chime').checked;
    r.water.autoFade = $('water-fade-auto').checked;
    r.posture.autoFade = $('posture-fade-auto').checked;
    r.posture.fadeSec = clampInt($('posture-fade-sec').value, 5, 120, r.posture.fadeSec);
    App.data.launchAtLogin = $('login-enabled').checked;
    App.data.muted = $('mute-enabled').checked;
    const look = document.querySelector('input[name="appearance"]:checked');
    App.data.appearance = look ? look.value : 'system';

    sm.pauseWhenAway.enabled = $('away-enabled').checked;
    sm.pauseWhenAway.idleMin = clampInt($('away-idle').value, 1, 120, sm.pauseWhenAway.idleMin);
    const mode = document.querySelector('input[name="away-mode"]:checked');
    sm.pauseWhenAway.mode = mode ? mode.value : 'pause';
    sm.activeHours.enabled = $('hours-enabled').checked;
    if ($('hours-start').value) sm.activeHours.start = $('hours-start').value;
    if ($('hours-end').value) sm.activeHours.end = $('hours-end').value;
    sm.quietFullscreen.enabled = $('fullscreen-enabled').checked;
  }

  function onChange(e) {
    if (!(e.target instanceof HTMLInputElement)) return;
    if (e.target.closest('[data-custom]')) return; // "Your reminders" has its own handler (tab-custom.js)
    collect();
    syncRowStates();
    App.save();
  }

  App.register('settings', {
    render,
    init() {
      document.querySelector('[data-panel="reminders"]').addEventListener('change', onChange);
      document.querySelector('[data-panel="smart"]').addEventListener('change', onChange);
      $('mute-enabled').addEventListener('change', onChange);
    },
  });
})();
