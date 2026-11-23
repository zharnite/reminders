'use strict';

// Exercises tab: switch exercises on/off, edit any of them, add/delete your own.

(() => {
  let editing = null; // null | exercise id | 'new'

  const list = () => App.data.reminders.move.exercises;
  const builtinById = (id) => App.data._meta.builtins.find((b) => b.id === id);

  function isEdited(ex) {
    const b = builtinById(ex.id);
    return !!b && (b.title !== ex.title || b.detail !== ex.detail || b.timerSec !== ex.timerSec);
  }

  function rowHtml(ex) {
    const tags = [
      ex.timerSec ? `<span class="tag">${fmtClock(ex.timerSec)} timer</span>` : '',
      !ex.builtin ? '<span class="tag muted">Custom</span>' : '',
      isEdited(ex) ? '<span class="tag muted">Edited</span>' : '',
    ].join('');
    return `
      <li class="${ex.enabled ? '' : 'off'}" data-id="${esc(ex.id)}">
        <label class="switch" title="${ex.enabled ? 'In the rotation' : 'Not in the rotation'}">
          <input type="checkbox" data-toggle ${ex.enabled ? 'checked' : ''} aria-label="Include ${esc(ex.title)}"><span></span>
        </label>
        <div class="ex-main">
          <div class="ex-title">${esc(ex.title)} ${tags}</div>
          ${ex.detail ? `<div class="ex-detail">${esc(ex.detail)}</div>` : ''}
        </div>
        <div class="ex-actions">
          <button class="icon-btn" type="button" data-edit>Edit</button>
          ${isEdited(ex) ? '<button class="icon-btn" type="button" data-reset title="Back to the original">Reset</button>' : ''}
          ${!ex.builtin ? '<button class="icon-btn danger" type="button" data-delete>Delete</button>' : ''}
        </div>
      </li>`;
  }

  function formHtml(ex, isNew) {
    const { titleMax, detailMax, timerMin, timerMax } = App.data._meta.limits;
    const t = ex.timerSec || 60;
    return `
      <form class="ex-form ${isNew ? 'new' : ''}" data-form novalidate>
        <label class="field"><span>Name</span>
          <input type="text" name="title" maxlength="${titleMax}" value="${esc(ex.title)}" placeholder="e.g. 30-second plank" required>
        </label>
        <label class="field"><span>Description <span class="opt">(optional)</span></span>
          <textarea name="detail" maxlength="${detailMax}" placeholder="A short how-to shown on the card">${esc(ex.detail)}</textarea>
        </label>
        <div class="timer-fields">
          <label class="check"><input type="checkbox" name="hasTimer" ${ex.timerSec ? 'checked' : ''}> Timer</label>
          <input type="number" name="min" min="0" max="${Math.floor(timerMax / 60)}" value="${Math.floor(t / 60)}" aria-label="Minutes"> min
          <input type="number" name="sec" min="0" max="59" step="5" value="${t % 60}" aria-label="Seconds"> sec
          <span>(${timerMin} sec to ${timerMax / 60} min)</span>
        </div>
        <p class="form-error" data-error hidden></p>
        <div class="form-actions">
          <button class="btn primary" type="submit">${isNew ? 'Add exercise' : 'Save'}</button>
          <button class="btn" type="button" data-cancel>Cancel</button>
        </div>
      </form>`;
  }

  function render() {
    const ul = $('ex-list');
    ul.innerHTML = list()
      .map((ex) => (editing === ex.id ? `<li data-id="${esc(ex.id)}">${formHtml(ex, false)}</li>` : rowHtml(ex)))
      .join('');
    const addWrap = $('ex-add-wrap');
    addWrap.innerHTML =
      editing === 'new'
        ? formHtml({ title: '', detail: '', timerSec: 0 }, true)
        : '<button class="btn primary" type="button" id="ex-add">+ Add exercise</button>';
    const form = document.querySelector('[data-form] input[name="title"]');
    if (form) form.focus();
  }

  function readForm(form) {
    const { timerMin, timerMax } = App.data._meta.limits;
    const f = new FormData(form);
    const title = String(f.get('title') || '').trim();
    const detail = String(f.get('detail') || '').trim();
    let timerSec = 0;
    if (f.get('hasTimer')) {
      timerSec = clampInt(f.get('min') || 0, 0, 999, 0) * 60 + clampInt(f.get('sec') || 0, 0, 59, 0);
      if (timerSec < timerMin || timerSec > timerMax) {
        return { error: `Timer must be between ${timerMin} seconds and ${timerMax / 60} minutes.` };
      }
    }
    if (!title) return { error: 'Give the exercise a name.' };
    return { title, detail, timerSec };
  }

  function commit() {
    editing = null;
    render();
    App.save();
  }

  function onSubmit(e) {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const v = readForm(form);
    if (v.error) {
      const err = form.querySelector('[data-error]');
      err.textContent = v.error;
      err.hidden = false;
      return;
    }
    if (editing === 'new') {
      const id = `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      list().push({ id, ...v, enabled: true, builtin: false });
    } else {
      Object.assign(list().find((x) => x.id === editing), v);
    }
    commit();
  }

  function onClick(e) {
    const t = e.target;
    if (t.id === 'ex-add') {
      editing = 'new';
      return render();
    }
    if (t.closest('[data-cancel]')) {
      editing = null;
      return render();
    }
    const li = t.closest('li[data-id]');
    if (!li) return;
    const ex = list().find((x) => x.id === li.dataset.id);
    if (t.closest('[data-edit]')) {
      editing = ex.id;
      render();
    } else if (t.closest('[data-reset]')) {
      Object.assign(ex, builtinById(ex.id));
      commit();
    } else if (t.closest('[data-delete]')) {
      if (!confirm(`Delete "${ex.title}"?`)) return;
      App.data.reminders.move.exercises = list().filter((x) => x !== ex);
      commit();
    }
  }

  function onToggle(e) {
    const cb = e.target.closest('[data-toggle]');
    if (!cb) return;
    const ex = list().find((x) => x.id === cb.closest('li').dataset.id);
    if (!cb.checked && list().filter((x) => x.enabled).length === 1) {
      cb.checked = true; // keep at least one exercise in the rotation
      alert('Keep at least one exercise switched on.');
      return;
    }
    ex.enabled = cb.checked;
    commit();
  }

  App.register('exercises', {
    render() {
      if (editing === null) render(); // don't wipe a half-filled form on background refresh
    },
    init() {
      const panel = document.querySelector('[data-panel="exercises"]');
      panel.addEventListener('click', onClick);
      panel.addEventListener('submit', onSubmit);
      panel.addEventListener('change', onToggle);
    },
    onShow() {
      if (editing !== null) {
        editing = null;
        render();
      }
    },
  });
})();
