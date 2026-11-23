'use strict';

// Reminders tab → "Your reminders": add, edit, preview and delete your own reminders.

(() => {
  let editing = null; // null | reminder id | 'new'

  const STYLE_HINTS = {
    pill: 'One line, silent. Click to dismiss, or let it fade.',
    card: 'Silent card with a "Got it" button. Fades after a few seconds.',
    sticky: 'Stays until you click Done, Snooze or Skip.',
  };

  // One-click starting points in the "new reminder" form.
  const IDEAS = [
    { name: 'Rest your eyes', message: 'Look at something about 20 feet (6 m) away for 20 seconds.', intervalMin: 20, style: 'pill', icon: 'eye', items: [] },
    {
      name: 'Take a deep breath', message: '', intervalMin: 45, style: 'card', icon: 'wind',
      items: [
        { title: 'Box breathing', detail: 'In for 4, hold for 4, out for 4, hold for 4.', timerSec: 60 },
        { title: '4-7-8 breath', detail: 'In for 4, hold for 7, out for 8. Three rounds.', timerSec: 60 },
        { title: 'Physiological sigh', detail: 'Two short breaths in through the nose, one long breath out.', timerSec: 0 },
      ],
    },
    {
      name: 'Stretch break', message: '', intervalMin: 90, style: 'sticky', icon: 'heart',
      items: [
        { title: 'Neck rolls', detail: 'Slowly, five each way.', timerSec: 0 },
        { title: 'Wrist circles', detail: 'Ten each way, then shake out your hands.', timerSec: 30 },
        { title: 'Doorway chest stretch', detail: 'Forearms on the frame, lean through gently.', timerSec: 30 },
        { title: 'Seated twist', detail: 'Hand on the opposite knee, look over your shoulder. Both sides.', timerSec: 0 },
      ],
    },
    { name: 'Take your medicine', message: '', intervalMin: 240, style: 'sticky', icon: 'capsule', items: [] },
  ];

  // Timer choices for list items (an item adjusted on a card may hold another length; it is kept).
  const TIMER_CHOICES = [0, 15, 30, 45, 60, 90, 120, 180, 300, 600];
  const fmtTimer = (sec) => (sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} timer` : 'No timer');

  function itemRowHtml(it = {}) {
    const timer = it.timerSec || 0;
    const choices = TIMER_CHOICES.includes(timer) ? TIMER_CHOICES : [...TIMER_CHOICES, timer].sort((a, b) => a - b);
    return `
      <li class="item-row" data-item-id="${esc(it.id || '')}">
        <input type="text" name="itemTitle" maxlength="60" value="${esc(it.title || '')}" placeholder="Wrist circles" aria-label="Item title">
        <input type="text" name="itemDetail" maxlength="200" value="${esc(it.detail || '')}" placeholder="Ten each way (optional)" aria-label="Item detail">
        <select name="itemTimer" aria-label="Timer">
          ${choices.map((s) => `<option value="${s}" ${s === timer ? 'selected' : ''}>${fmtTimer(s)}</option>`).join('')}
        </select>
        <button class="icon-btn" type="button" data-remove-item aria-label="Remove item" title="Remove">✕</button>
      </li>`;
  }

  const list = () => App.data.reminders.custom;
  const meta = () => App.data._meta.custom;

  function rowHtml(r) {
    return `
      <li class="${r.enabled ? '' : 'off'}" data-id="${esc(r.id)}">
        <label class="switch" title="${r.enabled ? 'On' : 'Off'}">
          <input type="checkbox" data-toggle ${r.enabled ? 'checked' : ''} aria-label="${esc(r.name)} on or off"><span></span>
        </label>
        <span class="cr-badge tone-${r.icon}">${iconSvg(r.icon)}</span>
        <div class="ex-main">
          <div class="ex-title">${esc(r.name)}
            <span class="tag muted">${esc(meta().styles[r.style].label)}${r.style === 'pill' && r.keep ? ', stays' : ''}</span>
            <span class="tag muted">every ${r.intervalMin} min</span>
            ${r.items.length && r.style !== 'pill' ? `<span class="tag muted">${r.items.length} ${r.items.length === 1 ? 'item' : 'items'}</span>` : ''}
          </div>
          ${r.message ? `<div class="ex-detail">${esc(r.message)}</div>` : ''}
        </div>
        <div class="ex-actions">
          <button class="icon-btn" type="button" data-preview-id>Preview</button>
          <button class="icon-btn" type="button" data-edit>Edit</button>
          <button class="icon-btn danger" type="button" data-delete>Delete</button>
        </div>
      </li>`;
  }

  function formHtml(r, isNew) {
    const L = meta().limits;
    const styles = Object.entries(meta().styles)
      .map(
        ([key, s]) => `
        <label class="style-opt">
          <input type="radio" name="style" value="${key}" ${r.style === key ? 'checked' : ''}>
          <span><b>${esc(s.label)}</b><small>${STYLE_HINTS[key]}</small></span>
        </label>`
      )
      .join('');
    const icons = meta().icons
      .map(
        (name) => `
        <label class="icon-opt tone-${name}" title="${ICON_NAMES[name] || name}">
          <input type="radio" name="icon" value="${name}" ${r.icon === name ? 'checked' : ''} aria-label="${ICON_NAMES[name] || name}">
          <span>${iconSvg(name, 18)}</span>
        </label>`
      )
      .join('');
    const ideas = isNew
      ? `<div class="ideas"><span>Ideas:</span>${IDEAS.map((x, i) => `<button class="chip-btn" type="button" data-idea="${i}">${esc(x.name)}</button>`).join('')}</div>`
      : '';
    return `
      <form class="ex-form ${isNew ? 'new' : ''}" data-form novalidate>
        ${ideas}
        <label class="field"><span>Name</span>
          <input type="text" name="name" maxlength="${L.nameMax}" value="${esc(r.name)}" placeholder="e.g. Rest your eyes" required>
        </label>
        <label class="field"><span>Message <span class="opt">(optional)</span></span>
          <textarea name="message" maxlength="${L.messageMax}" placeholder="A short line shown under the name">${esc(r.message)}</textarea>
        </label>
        <div class="timer-fields">
          Every <input type="number" name="intervalMin" min="${L.intervalMin}" max="${L.intervalMax}" value="${r.intervalMin}" aria-label="Interval in minutes"> min
        </div>
        <fieldset class="field-set">
          <legend>Style <a href="#styles" data-goto="styles" class="opt">what do these look like?</a></legend>
          <div class="style-opts">${styles}</div>
          <div class="style-extra" data-for="card">
            Fades after <input type="number" name="fadeSec" min="${L.fadeMin}" max="${L.fadeMax}" step="5" value="${r.fadeSec}" aria-label="Fade after seconds"> seconds (hover to keep it)
          </div>
          <label class="check style-extra" data-for="pill"><input type="checkbox" name="keep" ${r.keep ? 'checked' : ''}> Stays until I click it (instead of fading after 8 seconds)</label>
          <label class="check style-extra" data-for="sticky"><input type="checkbox" name="chime" ${r.chime ? 'checked' : ''}> Soft chime</label>
        </fieldset>
        <fieldset class="field-set style-extra" data-for="card sticky">
          <legend>Rotate through a list <span class="opt">(optional)</span></legend>
          <p class="hint">Each time it comes up, the card shows the next item, with ↻ Swap and an optional timer, like Move's exercises. Leave it empty to show the message instead.</p>
          <ul class="item-list" data-items>${(r.items || []).map(itemRowHtml).join('')}</ul>
          <div><button class="btn small" type="button" data-add-item>+ Add item</button></div>
        </fieldset>
        <fieldset class="field-set">
          <legend>Icon</legend>
          <div class="icon-opts">${icons}</div>
        </fieldset>
        <p class="form-error" data-error hidden></p>
        <div class="form-actions">
          <button class="btn primary" type="submit">${isNew ? 'Add reminder' : 'Save'}</button>
          <button class="btn" type="button" data-preview-draft>Preview</button>
          <button class="btn" type="button" data-cancel>Cancel</button>
        </div>
      </form>`;
  }

  const blank = () => ({ name: '', message: '', intervalMin: 30, style: 'card', icon: 'bell', fadeSec: 15, chime: true, keep: false, items: [] });

  /** Show only the options that apply to the chosen style (data-for lists the styles). */
  function syncStyleExtras(form) {
    const style = form.querySelector('input[name="style"]:checked').value;
    form.querySelectorAll('.style-extra').forEach((el) => (el.hidden = !el.dataset.for.split(' ').includes(style)));
    syncAddItem(form);
  }

  function syncAddItem(form) {
    const full = form.querySelectorAll('[data-items] li').length >= meta().limits.itemsMax;
    form.querySelector('[data-add-item]').disabled = full;
  }

  function readItems(form) {
    return [...form.querySelectorAll('[data-items] li')]
      .map((li) => ({
        id: li.dataset.itemId || `i-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        title: li.querySelector('[name="itemTitle"]').value.trim(),
        detail: li.querySelector('[name="itemDetail"]').value.trim(),
        timerSec: Number(li.querySelector('[name="itemTimer"]').value) || 0,
      }))
      .filter((it) => it.title)
      .slice(0, meta().limits.itemsMax);
  }

  function render() {
    const ul = $('custom-list');
    ul.innerHTML = list().length
      ? list().map((r) => (editing === r.id ? `<li data-id="${esc(r.id)}">${formHtml(r, false)}</li>` : rowHtml(r))).join('')
      : '<li class="empty">No reminders of your own yet.</li>';
    const atMax = list().length >= meta().limits.customMax;
    $('custom-add-wrap').innerHTML =
      editing === 'new'
        ? formHtml(blank(), true)
        : `<button class="btn primary" type="button" data-add ${atMax ? 'disabled' : ''}>+ Add reminder</button>
           ${atMax ? `<span class="note">You can have up to ${meta().limits.customMax}.</span>` : ''}`;
    const form = document.querySelector('[data-custom] [data-form]');
    if (form) {
      syncStyleExtras(form);
      form.querySelector('input[name="name"]').focus();
    }
  }

  function readForm(form) {
    const L = meta().limits;
    const f = new FormData(form);
    const name = String(f.get('name') || '').trim();
    const interval = Number(f.get('intervalMin'));
    const fadeSec = Number(f.get('fadeSec'));
    const v = {
      name,
      message: String(f.get('message') || '').trim(),
      intervalMin: interval,
      style: String(f.get('style')),
      icon: String(f.get('icon')),
      fadeSec: clampInt(fadeSec, L.fadeMin, L.fadeMax, 15),
      chime: !!f.get('chime'),
      keep: !!f.get('keep'),
      items: readItems(form),
    };
    if (!name) return { error: 'Give the reminder a name.', value: v };
    if (!Number.isInteger(interval) || interval < L.intervalMin || interval > L.intervalMax) {
      return { error: `Interval must be between ${L.intervalMin} and ${L.intervalMax} minutes.`, value: v };
    }
    return { value: v };
  }

  function showError(form, msg) {
    const err = form.querySelector('[data-error]');
    err.textContent = msg;
    err.hidden = !msg;
  }

  async function preview(req, btn) {
    const ok = await window.api.preview(req);
    if (!ok && btn) {
      btn.title = 'A reminder is on screen right now';
      btn.classList.add('shake');
      setTimeout(() => btn.classList.remove('shake'), 400);
    }
  }

  function commit() {
    editing = null;
    render();
    App.save();
  }

  function onSubmit(e) {
    const form = e.target.closest('[data-form]');
    if (!form || !form.closest('[data-custom]')) return;
    e.preventDefault();
    const { error, value } = readForm(form);
    if (error) return showError(form, error);
    if (editing === 'new') {
      const id = `r-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      list().push({ id, ...value, enabled: true });
    } else {
      Object.assign(list().find((x) => x.id === editing), value);
    }
    commit();
  }

  function fillForm(form, idea) {
    form.elements.name.value = idea.name;
    form.elements.message.value = idea.message;
    form.elements.intervalMin.value = idea.intervalMin;
    form.querySelector(`input[name="style"][value="${idea.style}"]`).checked = true;
    form.querySelector(`input[name="icon"][value="${idea.icon}"]`).checked = true;
    form.querySelector('[data-items]').innerHTML = idea.items.map(itemRowHtml).join('');
    syncStyleExtras(form);
    showError(form, '');
  }

  function onClick(e) {
    const t = e.target;
    if (t.closest('[data-add]')) {
      editing = 'new';
      return render();
    }
    const form = t.closest('[data-form]');
    if (form) {
      if (t.closest('[data-cancel]')) {
        editing = null;
        return render();
      }
      if (t.closest('[data-idea]')) return fillForm(form, IDEAS[Number(t.closest('[data-idea]').dataset.idea)]);
      if (t.closest('[data-add-item]')) {
        form.querySelector('[data-items]').insertAdjacentHTML('beforeend', itemRowHtml());
        form.querySelector('[data-items] li:last-child input').focus();
        return syncAddItem(form);
      }
      if (t.closest('[data-remove-item]')) {
        t.closest('li').remove();
        return syncAddItem(form);
      }
      if (t.closest('[data-preview-draft]')) return preview({ draft: readForm(form).value }, t.closest('button'));
      return;
    }
    const li = t.closest('li[data-id]');
    if (!li) return;
    const r = list().find((x) => x.id === li.dataset.id);
    if (t.closest('[data-preview-id]')) {
      preview({ id: r.id }, t.closest('button'));
    } else if (t.closest('[data-edit]')) {
      editing = r.id;
      render();
    } else if (t.closest('[data-delete]')) {
      if (!confirm(`Delete the reminder "${r.name}"?`)) return;
      App.data.reminders.custom = list().filter((x) => x !== r);
      commit();
    }
  }

  function onChange(e) {
    const form = e.target.closest('[data-form]');
    if (form) {
      if (e.target.name === 'style') syncStyleExtras(form);
      return;
    }
    const cb = e.target.closest('[data-toggle]');
    if (!cb) return;
    list().find((x) => x.id === cb.closest('li').dataset.id).enabled = cb.checked;
    commit();
  }

  App.register('custom', {
    render() {
      if (editing === null) render(); // don't wipe a half-filled form on background refresh
    },
    init() {
      const section = document.querySelector('[data-custom]');
      section.addEventListener('click', onClick);
      section.addEventListener('submit', onSubmit);
      section.addEventListener('change', onChange);
    },
  });
})();
