// Made By FALCREB
// Yapılandırma sayfası: form değerlerini URL'ye çevirir. Hiçbir sunucuya veri göndermez.

import { buildOverlayUrl, parseConfig, parseKickKey, THEMES } from '../core/config.js';
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
    // Overlay anahtarı ayar sorgusuna girmez; bağlantının # bölümüne ayrıca yazılır.
    if (!element.name || element.name === 'customColors' || element.name === 'kickkey') continue;
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
    kick: '',
  });
  if (url === lastPreview) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    lastPreview = url;
    preview.src = url;
  }, lastPreview ? PREVIEW_DELAY_MS : 0);
}

function describe(config, kickKey) {
  if (config.demo) return 'Demo mode is on: this link shows simulated chat only.';
  const bridgeText = field('kick').value.trim();
  if (bridgeText && !config.kick) {
    return 'That bridge address is not valid. Use only https://your-bridge.workers.dev with nothing after it.';
  }
  if (config.kick && !kickKey) return 'Enter the overlay key for your Kick bridge. It is 32 or more characters.';
  if (config.kick) return 'This link holds your overlay key. Keep it private and never show it on stream.';
  if (config.twitch) return `Reads #${config.twitch} anonymously. Nothing is sent to chat.`;
  return 'Enter a Twitch channel, or the link will show setup help only.';
}

function refresh() {
  syncColorsToTheme();
  const config = readForm();
  const kickKey = parseKickKey(`kickkey=${encodeURIComponent(field('kickkey').value.trim())}`);
  const url = buildOverlayUrl(location.href, config, { kickKey });
  linkField.value = url;
  openLink.href = url;
  hint.textContent = describe(config, kickKey);
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
