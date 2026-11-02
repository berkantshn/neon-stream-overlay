// Made By FALCREB
// Yapılandırma sayfası: form değerlerini URL'ye çevirir. Hiçbir sunucuya veri göndermez.

import { buildOverlayUrl, parseConfig, THEMES } from '../core/config.js';
import './config.css';

const form = document.getElementById('form');
const linkField = document.getElementById('link');
const openLink = document.getElementById('open');
const copyButton = document.getElementById('copy');
const hint = document.getElementById('hint');
const preview = document.getElementById('preview');
const PREVIEW_DELAY_MS = 350;

const field = (name) => form.elements.namedItem(name);

// Form ham metin üretir; doğrulama overlay ile aynı parseConfig üzerinden yapılır.
function readForm() {
  const params = new URLSearchParams();
  for (const element of form.elements) {
    if (!element.name || element.name === 'customColors') continue;
    if (element.name === 'c1' || element.name === 'c2') continue;
    if (element.type === 'checkbox') {
      if (element.checked) params.set(element.name, element.value);
      else if (element.name === 'status' || element.name === 'credit') params.set(element.name, '0');
    } else if (element.value !== '' || element.name === 'commands') {
      params.set(element.name, element.value);
    }
  }
  if (field('customColors').checked) {
    params.set('c1', field('c1').value);
    params.set('c2', field('c2').value);
  }
  return parseConfig(params);
}

function syncColorsToTheme() {
  if (field('customColors').checked) return;
  const theme = THEMES[field('theme').value];
  field('c1').value = theme.c1;
  field('c2').value = theme.c2;
}

let previewTimer = 0;
let lastPreview = '';
function schedulePreview(config) {
  // Önizleme her zaman demo modundadır; kanal girilse bile hiçbir yere bağlanmaz.
  const url = buildOverlayUrl(location.href, {
    ...config,
    demo: true,
    twitch: '',
  });
  if (url === lastPreview) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    lastPreview = url;
    preview.src = url;
  }, lastPreview ? PREVIEW_DELAY_MS : 0);
}

function describe(config) {
  if (config.demo) return 'Demo mode is on: this link shows simulated chat only.';
  if (config.twitch) return `Reads #${config.twitch} anonymously. Nothing is sent to chat.`;
  return 'Enter a Twitch channel, or the link will show setup help only.';
}

function refresh() {
  syncColorsToTheme();
  const config = readForm();
  const url = buildOverlayUrl(location.href, config);
  linkField.value = url;
  openLink.href = url;
  hint.textContent = describe(config);
  schedulePreview(config);
}

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(linkField.value);
    hint.textContent = 'Link copied.';
  } catch {
    // Pano izni yoksa metin seçili bırakılır; kullanıcı elle kopyalar.
    linkField.select();
    hint.textContent = 'Press Ctrl+C to copy the selected link.';
  }
});

form.addEventListener('input', refresh);
form.addEventListener('submit', (event) => event.preventDefault());
refresh();
