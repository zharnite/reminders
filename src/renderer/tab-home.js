'use strict';

// Home tab: what's next, remind me now, pause / resume.

(() => {
  // The cards are rebuilt only when reminders are added, removed, renamed or get a new icon.
  let builtFor = '';
  const cardKey = (reminders) => reminders.map((r) => `${r.id}:${r.name}:${r.icon}`).join('|');

  function fmtRemaining(ms, minuteMs) {
    const min = Math.ceil(ms / minuteMs);
    if (min <= 0) return 'Now';
    if (min < 60) return `in ${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `in ${h} h ${m} min` : `in ${h} h`;
  }

  function buildCards(reminders) {
    $('next-cards').innerHTML = reminders
      .map(
        (r) => `
      <div class="panel next-card tone-${r.icon}" data-card="${esc(r.id)}">
        <div class="top"><span class="badge">${iconSvg(r.icon)}</span><span class="card-name">${esc(r.name)}</span></div>
        <div class="when" data-when>…</div>
        <div class="every" data-every></div>
        <button class="btn small" type="button" data-remind="${esc(r.id)}">Remind me now</button>
      </div>`
      )
      .join('');
    builtFor = cardKey(reminders);
  }

  function update(s) {
    const status = $('status');
    status.dataset.kind = s.kind;
    $('status-text').textContent = s.status;

    if (cardKey(s.reminders) !== builtFor) buildCards(s.reminders);
    for (const r of s.reminders) {
      const card = document.querySelector(`[data-card="${CSS.escape(r.id)}"]`);
      const due = s.nextDue[r.id];
      const off = due === null || due === undefined;
      card.classList.toggle('off', off);
      card.querySelector('[data-when]').textContent = off ? 'Off' : fmtRemaining(due, s.minuteMs);
      card.querySelector('[data-every]').textContent = off
        ? 'Turned off in Reminders'
        : `every ${r.intervalMin} min${s.kind === 'running' || s.kind === 'catchup' ? '' : ' · on hold'}`;
      const btn = card.querySelector('[data-remind]');
      const inStack = (s.queued || []).includes(r.id);
      btn.disabled = inStack;
      btn.title = inStack ? 'Already on screen or waiting in the stack' : s.popupOpen ? 'Adds it to the stack behind the card on screen' : '';
    }

    const paused = s.pausedUntil > 0;
    $('pause-active').hidden = !paused;
    $('pause-controls').hidden = paused;
    $('pause-until-label').textContent = s.pausedLabel;
  }

  function showError(msg) {
    const el = $('pause-error');
    el.textContent = msg;
    el.hidden = !msg;
  }

  async function pause(req) {
    showError('');
    update(await window.api.pause(req));
  }

  App.register('home', {
    init() {
      $('next-cards').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-remind]');
        if (!b) return;
        await window.api.remindNow(b.dataset.remind);
        update(await window.api.getState());
      });
      document.querySelectorAll('[data-pause-min]').forEach((b) =>
        b.addEventListener('click', () => pause({ minutes: Number(b.dataset.pauseMin) }))
      );
      document.querySelector('[data-pause-tomorrow]').addEventListener('click', () => pause({ tomorrow: true }));
      $('resume').addEventListener('click', async () => update(await window.api.resume()));

      $('pause-for-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const h = clampInt($('pause-hours').value || 0, 0, 168, 0);
        const m = clampInt($('pause-mins').value || 0, 0, 59, 0);
        if (h * 60 + m <= 0) return showError('Enter how long to pause.');
        pause({ minutes: h * 60 + m });
        $('pause-hours').value = '';
        $('pause-mins').value = '';
      });

      $('pause-until-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const v = $('pause-until-time').value;
        if (!v) return showError('Pick a time to pause until.');
        const [hh, mm] = v.split(':').map(Number);
        const until = new Date();
        until.setHours(hh, mm, 0, 0);
        if (until.getTime() <= Date.now()) until.setDate(until.getDate() + 1); // earlier time = tomorrow
        pause({ until: until.getTime() });
      });

      window.api.onState(update);
      window.api.getState().then(update);
    },
    async onShow(focus) {
      update(await window.api.getState());
      if (focus === 'pause' && !$('pause-controls').hidden) $('pause-hours').focus();
    },
  });
})();
