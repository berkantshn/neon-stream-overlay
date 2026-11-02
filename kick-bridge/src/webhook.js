// Made By FALCREB
// Köprünün dış kapısı: webhook doğrulama ve overlay bağlantı yetkisi.
// Platforma bağımlı değildir; bağımlılıklar parametre olarak gelir, bu yüzden Node'da test edilir.
// Bu dosyada günlük yazılmaz: sohbet metni, anahtar veya imza hiçbir yere kaydedilmez.

import { buildFrame } from './events.js';
import { verifyWithRotation } from './kick-key.js';
import { FRESHNESS_MS, MAX_BODY_BYTES } from './limits.js';

export const OVERLAY_PROTOCOL = 'neon-bridge.v1';
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const OVERLAY_KEY = /^[A-Za-z0-9_-]{32,128}$/;
const BROADCASTER_ID = /^[1-9]\d{0,15}$/;

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function reply(status, label) {
  return new Response(JSON.stringify({ status: label }), {
    status,
    headers: { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Secret'ları okur. Eksik veya hatalıysa null döner ve köprü kapalı kalır. */
export function readSettings(env) {
  const overlayKey = String(env.OVERLAY_KEY ?? '');
  const broadcaster = String(env.BROADCASTER_USER_ID ?? '').trim();
  if (!OVERLAY_KEY.test(overlayKey) || !BROADCASTER_ID.test(broadcaster)) return null;
  const broadcasterId = Number(broadcaster);
  return Number.isSafeInteger(broadcasterId) ? { overlayKey, broadcasterId } : null;
}

const digest = async (text) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/** Anahtarları özetleyip sabit sürede karşılaştırır; böylece süre ölçümüyle tahmin edilemez. */
export async function keysMatch(a, b) {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}

/** Anahtarın kendisini saklamadan bağlantıyı bu anahtara bağlamak için kullanılan özet. */
export async function keyFingerprint(key) {
  return [...(await digest(key))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Gövdeyi sınırı aşmadan okur; Content-Length yalan söylese bile fazlası belleğe alınmaz. */
async function readLimited(request, maxBytes) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

const clientIp = (request) => request.headers.get('cf-connecting-ip') ?? 'unknown';

async function handleWebhook(request, { settings, keys, limiter, publish, now }) {
  if (request.method !== 'POST') return reply(405, 'method_not_allowed');
  const ip = clientIp(request);
  if (limiter.blocked(ip)) return reply(429, 'too_many_requests');

  const body = await readLimited(request, MAX_BODY_BYTES);
  if (!body) return reply(413, 'too_large');

  const id = request.headers.get('kick-event-message-id') ?? '';
  const timestamp = request.headers.get('kick-event-message-timestamp') ?? '';
  const signature = request.headers.get('kick-event-signature') ?? '';
  const signedAt = RFC3339.test(timestamp) ? Date.parse(timestamp) : Number.NaN;
  if (!MESSAGE_ID.test(id) || Number.isNaN(signedAt) || !signature) {
    limiter.fail(ip);
    return reply(400, 'bad_headers');
  }

  let valid;
  try {
    valid = await verifyWithRotation(keys, id, timestamp, body, signature);
  } catch {
    // Anahtar alınamadı: olay doğrulanamadığı için iletilmez, Kick'e geçici hata bildirilir.
    return reply(503, 'key_unavailable');
  }
  if (!valid) {
    limiter.fail(ip);
    return reply(401, 'bad_signature');
  }

  // Bu noktadan sonra imza geçerlidir. Bayat ve tekrar olaylar hiçbir overlay'e ulaşmaz, ama yanıt
  // başarı sınıfındadır: sürekli hata almak Kick'in aboneliği kendiliğinden iptal etmesine yol açar.
  if (Math.abs(now() - signedAt) > FRESHNESS_MS) return reply(202, 'stale');

  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return reply(400, 'bad_json');
  }

  const type = request.headers.get('kick-event-type') ?? '';
  const version = request.headers.get('kick-event-version') ?? '';
  const frame = buildFrame(type, version, parsed, settings.broadcasterId);
  if (!frame) return reply(202, 'ignored');

  try {
    const result = await publish({ id, ts: signedAt, frame: JSON.stringify(frame) });
    return reply(result === 'forwarded' ? 200 : 202, result);
  } catch {
    return reply(503, 'hub_unavailable');
  }
}

async function handleOverlay(request, { settings, limiter, connect }) {
  if (request.method !== 'GET') return reply(405, 'method_not_allowed');
  if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
    return reply(426, 'websocket_required');
  }
  const ip = clientIp(request);
  if (limiter.blocked(ip)) return reply(429, 'too_many_requests');

  // Tarayıcı WebSocket'e başlık ekleyemez. Anahtar, adres yerine alt protokol alanında gelir;
  // böylece adres günlüklerine düşmez. Yanıtta yalnızca protokol adı geri döner.
  const offered = (request.headers.get('sec-websocket-protocol') ?? '').split(',').map((part) => part.trim());
  const key = offered.find((part) => part !== OVERLAY_PROTOCOL) ?? '';
  if (
    !offered.includes(OVERLAY_PROTOCOL) ||
    !OVERLAY_KEY.test(key) ||
    !(await keysMatch(key, settings.overlayKey))
  ) {
    limiter.fail(ip);
    return reply(401, 'unauthorized');
  }
  return connect();
}

/**
 * Tüm istekleri yönlendirir.
 * @param {Request} request
 * @param {{env: object, keys: object, limiter: object, publish: Function, connect: Function, now?: Function}} deps
 */
export async function routeRequest(request, { env, keys, limiter, publish, connect, now = () => Date.now() }) {
  const { pathname } = new URL(request.url);
  const settings = readSettings(env);

  if (pathname === '/') {
    // Kurulum kontrolü içindir; yalnızca hazır olup olmadığını söyler, hiçbir değer göstermez.
    const text = settings
      ? 'Neon Kick bridge is running. Made By FALCREB\n'
      : 'Neon Kick bridge is deployed, but OVERLAY_KEY or BROADCASTER_USER_ID is missing. See docs/KICK.md.\n';
    return new Response(text, {
      status: request.method === 'GET' ? 200 : 405,
      headers: { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  if (pathname !== '/webhook' && pathname !== '/overlay') return reply(404, 'not_found');
  // Ayar eksikse köprü kapalı kalır; yanlışlıkla herkese açık çalışmaz.
  if (!settings) return reply(503, 'not_configured');
  if (pathname === '/webhook') return handleWebhook(request, { settings, keys, limiter, publish, now });
  return handleOverlay(request, { settings, limiter, connect });
}
