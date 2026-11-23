'use strict';

// Reminder icons, shared by the popups and the main window. Each icon's colour
// comes from tones.css (class "tone-<name>").

const ICON_SHAPES = {
  // built-in reminders
  move: '<circle cx="14" cy="4" r="2"/><path d="M10 21l2-6 3 3v3M7 12l3-4 4 1 2 4 3 1M12 15l-2-4"/>',
  water: { fill: '<path d="M12 2.5c-.3 0-.6.1-.8.4C9.4 5.3 5 11.1 5 15a7 7 0 0 0 14 0c0-3.9-4.4-9.7-6.2-12.1a1 1 0 0 0-.8-.4z"/>' },
  posture: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7.5v8M8 21l4-5.5 4 5.5M8 11h8"/>',
  // for your own reminders
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/>',
  capsule: '<rect x="6" y="8" width="12" height="13" rx="2"/><path d="M5 3h14v5H5zM9.5 14.5h5M12 12v5"/>',
  book: '<path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"/><path d="M5 18a2 2 0 0 1 2-2h12"/>',
};

const ICON_NAMES = {
  bell: 'Bell',
  eye: 'Eyes',
  wind: 'Breathe',
  sun: 'Daylight',
  heart: 'Heart',
  star: 'Star',
  capsule: 'Medicine',
  book: 'Book',
};

function iconSvg(name, size = 16) {
  const shape = ICON_SHAPES[name] || ICON_SHAPES.bell;
  const paint = typeof shape === 'string'
    ? 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    : 'fill="currentColor"';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" ${paint} aria-hidden="true">${typeof shape === 'string' ? shape : shape.fill}</svg>`;
}
