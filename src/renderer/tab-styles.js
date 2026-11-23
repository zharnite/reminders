'use strict';

// Notification styles tab: what each style looks like, with live previews.

(() => {
  let popupOpen = false;

  function render(data) {
    document.querySelectorAll('[data-panel="styles"] [data-icon]').forEach((el) => {
      el.innerHTML = iconSvg(el.dataset.icon, 12);
    });
    renderPreviews(data);
  }

  /** One "Preview …" button per reminder that uses each style (built-in first). */
  async function renderPreviews() {
    const s = await window.api.getState();
    popupOpen = s.popupOpen;
    document.querySelectorAll('[data-panel="styles"] .style-card').forEach((card) => {
      const users = s.reminders.filter((r) => r.style === card.dataset.style);
      card.querySelector('[data-previews]').innerHTML = users
        .map(
          (r) => `<button class="btn small" type="button" data-preview="${esc(r.id)}">
                    <span class="mini-icon tone-${r.icon}">${iconSvg(r.icon, 12)}</span>Preview ${esc(r.name)}</button>`
        )
        .join('');
    });
    syncBusy();
  }

  function syncBusy() {
    document.querySelectorAll('[data-panel="styles"] [data-preview]').forEach((b) => (b.disabled = popupOpen));
    $('styles-busy').hidden = !popupOpen;
  }

  App.register('styles', {
    render,
    init() {
      document.querySelector('[data-panel="styles"]').addEventListener('click', (e) => {
        const b = e.target.closest('[data-preview]');
        if (b) window.api.preview({ id: b.dataset.preview });
      });
      window.api.onState((s) => {
        if (s.popupOpen !== popupOpen) {
          popupOpen = s.popupOpen;
          syncBusy();
        }
      });
    },
    onShow() {
      renderPreviews();
    },
  });
})();
