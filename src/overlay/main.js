// Made By FALCREB
// Overlay giriş noktası: ayarı okur, kaynakları başlatır, mesajları ekrana aktarır.

import { parseConfig, parseKickKey, resolveColors, resolveKickBridge, resolveSources } from '../core/config.js';
import { createPipeline } from '../core/triggers.js';
import { createDemoAdapter } from '../adapters/demo.js';
import { createTwitchAdapter } from '../adapters/twitch.js';
import { createChatBox } from './chat-box.js';
import { createFx } from './fx-canvas.js';
import './overlay.css';

const QUEUE_LIMIT = 100;
const DRAIN_INTERVAL_MS = 70;
const BURST_LABEL_MS = 1700;
const STATUS_OK_MS = 4000;

const config = parseConfig(location.search);
const sources = resolveSources(config);
const kickBridge = resolveKickBridge(config);
const colors = resolveColors(config);
const root = document.documentElement;
const stage = document.getElementById('stage');
const box = document.getElementById('box');
const statusEl = document.getElementById('status');
const burstLabel = document.getElementById('burst-label');
const canvas = document.getElementById('fx');

const reducedMotion =
  config.motion === 'reduced' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Renkler doğrulanmış #rrggbb değerleridir; CSSOM üzerinden atanır.
root.style.setProperty('--c1', colors.c1);
root.style.setProperty('--c2', colors.c2);
root.style.setProperty('--glow-1', `${colors.c1}8c`);
root.style.setProperty('--glow-2', `${colors.c2}8c`);
root.style.setProperty('--tint-1', `${colors.c1}38`);
root.style.setProperty('--tint-2', `${colors.c2}38`);
root.style.setProperty('--panel-alpha', String(config.panel / 100));
root.style.setProperty('--font-size', `${config.font}px`);
root.style.setProperty('--box-width', `${config.w}px`);
stage.dataset.pos = config.pos;
root.classList.toggle('motion-reduced', reducedMotion);
root.classList.toggle('quality-low', config.quality === 'low');
document.getElementById('credit').hidden = !config.credit;

const chat = createChatBox({
  box,
  list: document.getElementById('messages'),
  config,
});
const pipeline = createPipeline(config);
// Hareket azaltma açıksa parçacık çizilmez; yalnızca sabit bir parlama gösterilir.
const fx = reducedMotion ? null : createFx(canvas, { colors, quality: config.quality });

// Durum satırı: başarılı durum kısa sürede kaybolur, hata kalıcı olur.
let statusTimer = 0;
let statusLocked = false;
function setStatus(level, text, { lock = false } = {}) {
  // Güvenlik uyarısı kilitlidir: bağlantı durumu üzerine yazamaz, status=0 da gizleyemez.
  if (statusLocked || (!config.status && !lock)) return;
  statusLocked = lock;
  clearTimeout(statusTimer);
  statusEl.textContent = text;
  statusEl.dataset.level = level;
  statusEl.hidden = false;
  box.classList.remove('status-hidden');
  if (level === 'ok') {
    statusTimer = setTimeout(() => {
      statusEl.hidden = true;
      box.classList.add('status-hidden');
    }, STATUS_OK_MS);
  }
}

let burstTimer = 0;
let burstCount = 0;
function triggerBurst(burst) {
  burstCount += 1;
  root.dataset.bursts = String(burstCount);
  // Etiket yalnızca ayardaki veya yetkilinin eklediği kuraldan gelir, textContent ile yazılır.
  burstLabel.textContent = burst.label;
  burstLabel.classList.remove('is-live');
  box.classList.remove('is-bursting');
  void burstLabel.offsetWidth; // Animasyonu baştan başlatmak için yerleşimi zorlar.
  burstLabel.classList.add('is-live');
  box.classList.add('is-bursting');
  clearTimeout(burstTimer);
  burstTimer = setTimeout(() => {
    burstLabel.classList.remove('is-live');
    box.classList.remove('is-bursting');
  }, BURST_LABEL_MS);

  if (fx) {
    const rect = box.getBoundingClientRect();
    fx.burst(rect.left + rect.width / 2, rect.top + 8);
  }
}

// Yoğun sohbette arayüzü boğmamak için mesajlar sıraya alınır, sıra taşarsa en eskisi düşer.
const queue = [];
function enqueue(raw) {
  const result = pipeline.process(raw);
  if (!result) return;
  if (result.burst) triggerBurst(result.burst);
  if (!result.message) return;
  queue.push(result);
  if (queue.length > QUEUE_LIMIT) queue.shift();
}
setInterval(() => {
  const next = queue.shift();
  if (next) chat.add(next.message, next.emphasis);
}, DRAIN_INTERVAL_MS);

function onModeration(event) {
  // Sırada bekleyen silinmiş mesajlar da ekrana çıkmamalı.
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    const { message } = queue[i];
    if (
      event.type === 'all' ||
      (event.type === 'message' && message.id === event.id) ||
      (event.type === 'user' && message.login === event.login)
    ) {
      queue.splice(i, 1);
    }
  }
  chat.moderate(event);
}

const shared = { onMessage: enqueue, onModeration, onStatus: setStatus };

if (config.ignoredSensitive.length) {
  // Değer asla gösterilmez; yalnızca parametre adı bildirilir.
  setStatus(
    'error',
    `Remove from your URL: ${config.ignoredSensitive.slice(0, 3).join(', ')}. This overlay never needs passwords or tokens.`,
    { lock: true },
  );
}

// Kick kodu yalnızca köprü ayarlıysa ve CSP kilidi atıldıysa yüklenir. Buradaki hiçbir hata Twitch'i etkilemez.
function startKick() {
  if (root.dataset.kickLock !== kickBridge) {
    setStatus('warn', 'Kick needs its own link. Create it again on the setup page.');
    return;
  }
  const key = parseKickKey(location.hash);
  if (!key) {
    setStatus('warn', 'Kick bridge: the overlay key is missing from the link. Create it again on the setup page.');
    return;
  }
  import('../adapters/kick-bridge.js')
    .then(({ createKickBridgeAdapter }) =>
      createKickBridgeAdapter({ origin: kickBridge, key, ...shared }).start(),
    )
    .catch(() => setStatus('error', 'Kick bridge could not start. Reload this overlay.'));
}

if (sources.demo) {
  createDemoAdapter({ config, ...shared }).start();
} else {
  if (sources.twitch) createTwitchAdapter({ channel: sources.twitch, ...shared }).start();
  if (kickBridge) startKick();
  if (!sources.twitch && !kickBridge && !config.ignoredSensitive.length) {
    setStatus('warn', 'No chat source set. Open the setup page to create your link.');
  }
}
