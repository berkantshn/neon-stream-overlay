// Made By FALCREB
// Köprünün webhook kapısı: imza, tekrar, boyut, bozuk JSON, yayıncı filtresi, gizlilik.
// Kick yerine yerel üretilen anahtar çifti kullanılır; testler ağa çıkmaz.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  createKeyProvider,
  importPublicKey,
  KICK_PUBLIC_KEY_URL,
  pemFromResponse,
  verifySignature,
} from '../kick-bridge/src/kick-key.js';
import { createHub } from '../kick-bridge/src/hub.js';
import { createFailureLimiter, FRESHNESS_MS, MAX_BODY_BYTES } from '../kick-bridge/src/limits.js';
import { keysMatch, OVERLAY_PROTOCOL, readSettings, routeRequest } from '../kick-bridge/src/webhook.js';
import { buildFrame } from '../kick-bridge/src/events.js';
import { banPayload, BROADCASTER_ID, chatPayload, nextId, signBody, signedDelivery, testKeyPair } from './kick-helpers.js';

const OVERLAY_KEY = 'k'.repeat(43);
const pair = testKeyPair();
const other = testKeyPair();
const env = { OVERLAY_KEY, BROADCASTER_USER_ID: String(BROADCASTER_ID) };

function bridge({ envOverride = env, publishImpl, now, keys } = {}) {
  const published = [];
  const deps = {
    env: envOverride,
    keys: keys ?? createKeyProvider({ pem: pair.publicKey }),
    limiter: createFailureLimiter(),
    publish: publishImpl ?? (async (delivery) => (published.push(delivery), 'forwarded')),
    connect: async () => ({ connected: true }),
    ...(now ? { now } : {}),
  };
  const post = ({ body, headers }) =>
    routeRequest(new Request('https://bridge.test/webhook', { method: 'POST', body, headers }), deps);
  return { deps, post, published };
}

const statusOf = async (response) => (await response.json()).status;

test('İmza: geçerli imza kabul, gövde/kimlik/zaman değişirse red', async () => {
  const key = await importPublicKey(pair.publicKey);
  const bytes = (text) => new TextEncoder().encode(text);
  const signature = signBody(pair.privateKey, 'ID1', '2026-01-01T00:00:00Z', '{"a":1}');
  assert.equal(await verifySignature(key, 'ID1', '2026-01-01T00:00:00Z', bytes('{"a":1}'), signature), true);
  assert.equal(await verifySignature(key, 'ID1', '2026-01-01T00:00:00Z', bytes('{"a":2}'), signature), false);
  assert.equal(await verifySignature(key, 'ID2', '2026-01-01T00:00:00Z', bytes('{"a":1}'), signature), false);
  assert.equal(await verifySignature(key, 'ID1', '2026-01-01T00:00:01Z', bytes('{"a":1}'), signature), false);
  assert.equal(await verifySignature(key, 'ID1', '2026-01-01T00:00:00Z', bytes('{"a":1}'), '%%%bozuk%%%'), false);
  assert.equal(await verifySignature(key, 'ID1', '2026-01-01T00:00:00Z', bytes('{"a":1}'), 'A'.repeat(5000)), false);
});

test('Anahtar: kısa RSA ve RSA dışı anahtar reddedilir, tek satırlık PEM kabul edilir', async () => {
  const short = generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  await assert.rejects(importPublicKey(short.publicKey));
  const ec = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  await assert.rejects(importPublicKey(ec.publicKey));
  await assert.rejects(importPublicKey('yok'));
  await importPublicKey(pair.publicKey.replace(/\n/g, '\\n'));
});

test('Anahtar: Kick yanıtı JSON (canlı uç) veya düz PEM (belge örneği) olabilir', () => {
  assert.equal(pemFromResponse(JSON.stringify({ data: { public_key: pair.publicKey }, message: 'OK' })), pair.publicKey);
  assert.equal(pemFromResponse(pair.publicKey), pair.publicKey);
  assert.throws(() => pemFromResponse('{"data":{}}'));
  assert.throws(() => pemFromResponse('<html>blocked</html>'));
});

test('Anahtar: resmi adresten okunur, önbelleğe alınır, dönünce yenilenir, sel kısıtlanır', async () => {
  let served = pair.publicKey;
  let clock = 1_000_000;
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return new Response(JSON.stringify({ data: { public_key: served } }));
  };
  const keys = createKeyProvider({ fetchImpl, now: () => clock });
  const { post } = bridge({ keys });

  const first = signedDelivery(pair.privateKey, chatPayload());
  assert.equal((await post(first)).status, 200);
  const second = signedDelivery(pair.privateKey, chatPayload());
  assert.equal((await post(second)).status, 200);
  assert.deepEqual(urls, [KICK_PUBLIC_KEY_URL], 'ikinci teslimat önbellekten doğrulanır');

  // Kick anahtarı döndürdü: yeni imza tutar, tek yenileme yeterli olur.
  served = other.publicKey;
  clock += 61_000;
  assert.equal((await post(signedDelivery(other.privateKey, chatPayload()))).status, 200);
  assert.equal(urls.length, 2);

  // Sahte imzalar dakikada en fazla bir yenileme tetikler.
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await post(signedDelivery(pair.privateKey, chatPayload()))).status, 401);
  }
  assert.equal(urls.length, 3 - 1, 'kısa aralıkta yeniden okuma yapılmaz');
});

test('Anahtar alınamazsa olay iletilmez ve 503 döner', async () => {
  const keys = createKeyProvider({ fetchImpl: async () => new Response('blocked', { status: 403 }) });
  const { post, published } = bridge({ keys });
  const response = await post(signedDelivery(pair.privateKey, chatPayload()));
  assert.equal(response.status, 503);
  assert.equal(published.length, 0);
});

test('Webhook: geçerli sohbet en küçük temiz biçimde iletilir', async () => {
  const { post, published } = bridge();
  const payload = chatPayload();
  const response = await post(signedDelivery(pair.privateKey, payload));
  assert.equal(response.status, 200);
  assert.equal(await statusOf(response), 'forwarded');
  assert.equal(published.length, 1);
  assert.deepEqual(JSON.parse(published[0].frame), {
    v: 1,
    t: 'msg',
    id: payload.message_id,
    user: 'Viewer_One',
    text: 'Hello HYPERCLAP chat',
    color: '#ff5733',
    role: 'mod',
  });
  // Profil resmi, kullanıcı kimliği ve yanıtlanan mesaj dışarı çıkmaz.
  assert.equal(/private\.jpg|987654321|channel_slug/.test(published[0].frame), false);
});

test('Webhook: geçersiz imza, başka anahtar ve eksik başlık reddedilir', async () => {
  const { post, published } = bridge();
  const good = signedDelivery(pair.privateKey, chatPayload());

  assert.equal((await post(signedDelivery(other.privateKey, chatPayload()))).status, 401);
  assert.equal((await post({ ...good, body: `${good.body} ` })).status, 401);
  assert.equal((await post({ body: good.body, headers: { 'content-type': 'application/json' } })).status, 400);
  const badTime = { ...good.headers, 'kick-event-message-timestamp': 'yesterday' };
  assert.equal((await post({ body: good.body, headers: badTime })).status, 400);
  const badId = { ...good.headers, 'kick-event-message-id': 'a b<c>' };
  assert.equal((await post({ body: good.body, headers: badId })).status, 400);
  assert.equal(published.length, 0);
});

test('Webhook: eski, ileri tarihli ve tekrar eden teslimat iletilmez', async () => {
  const sent = [];
  const hub = createHub({ storage: memoryStorage() });
  const socket = fakeHubSocket(sent);
  const { post } = bridge({ publishImpl: (delivery) => hub.publish(delivery, [socket], 'fp') });

  const old = new Date(Date.now() - FRESHNESS_MS - 5000).toISOString();
  const staleReply = await post(signedDelivery(pair.privateKey, chatPayload(), { timestamp: old }));
  assert.equal(await statusOf(staleReply), 'stale');
  const future = new Date(Date.now() + FRESHNESS_MS + 5000).toISOString();
  assert.equal(await statusOf(await post(signedDelivery(pair.privateKey, chatPayload(), { timestamp: future }))), 'stale');
  assert.equal(sent.length, 0);

  const delivery = signedDelivery(pair.privateKey, chatPayload());
  assert.equal(await statusOf(await post(delivery)), 'forwarded');
  const replay = await post(delivery);
  assert.equal(await statusOf(replay), 'duplicate');
  assert.equal(replay.status, 202);
  assert.equal(sent.length, 1);
});

test('Webhook: büyük gövde, Content-Length yalan söylese de reddedilir', async () => {
  const { post, published, deps } = bridge();
  const big = 'x'.repeat(MAX_BODY_BYTES + 1);
  assert.equal((await post({ body: big, headers: {} })).status, 413);

  // Başlıksız akış: üst sınırı aşan kısım okunmadan kesilir.
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(16 * 1024));
      if (pulled > 50) controller.close();
    },
  });
  const request = new Request('https://bridge.test/webhook', { method: 'POST', body: stream, duplex: 'half' });
  assert.equal((await routeRequest(request, deps)).status, 413);
  assert.ok(pulled < 10, 'akışın tamamı okunmamalı');
  assert.equal(published.length, 0);
});

test('Webhook: imzalı ama bozuk JSON, bilinmeyen tür ve sürüm iletilmez', async () => {
  const { post, published } = bridge();
  assert.equal((await post(signedDelivery(pair.privateKey, '{bozuk'))).status, 400);
  assert.equal((await post(signedDelivery(pair.privateKey, '[1,2,3]'))).status, 202);
  assert.equal(
    await statusOf(await post(signedDelivery(pair.privateKey, chatPayload(), { type: 'channel.followed' }))),
    'ignored',
  );
  assert.equal(
    await statusOf(await post(signedDelivery(pair.privateKey, chatPayload(), { type: '__proto__' }))),
    'ignored',
  );
  assert.equal(await statusOf(await post(signedDelivery(pair.privateKey, chatPayload(), { version: '2' }))), 'ignored');
  assert.equal(published.length, 0);
});

test('Webhook: başka yayıncının olayı iletilmez (açık geçit yok)', async () => {
  const { post, published } = bridge();
  const stranger = chatPayload({ broadcaster: { user_id: 42, username: 'someone_else' } });
  assert.equal(await statusOf(await post(signedDelivery(pair.privateKey, stranger))), 'ignored');
  const asText = chatPayload({ broadcaster: { user_id: String(BROADCASTER_ID) } });
  assert.equal(await statusOf(await post(signedDelivery(pair.privateKey, asText))), 'ignored');
  const ban = { ...banPayload(), broadcaster: { user_id: 42 } };
  assert.equal(await statusOf(await post(signedDelivery(pair.privateKey, ban))), 'ignored');
  assert.equal(published.length, 0);
});

test('Webhook: imzasız tür başlığı değiştirilse de gövde biçimi uyuşmazsa düşer', async () => {
  const { post, published } = bridge();
  const asBan = signedDelivery(pair.privateKey, chatPayload(), { type: 'moderation.banned' });
  assert.equal(await statusOf(await post(asBan)), 'ignored');
  const asChat = signedDelivery(pair.privateKey, banPayload(), { type: 'chat.message.sent' });
  assert.equal(await statusOf(await post(asChat)), 'ignored');
  assert.equal(published.length, 0);
});

test('Olay: rol, renk, anonim ve kötü amaçlı alanlar', () => {
  const frame = (overrides) => buildFrame('chat.message.sent', '1', chatPayload(overrides), BROADCASTER_ID);
  assert.equal(frame({ sender: { user_id: BROADCASTER_ID, username: 'streamer' } }).role, 'host');
  assert.equal(frame({ sender: { user_id: 3, username: 'x', identity: { badges: [{ type: 'subscriber' }] } } }).role, undefined);
  assert.equal(frame({ sender: { user_id: 3, username: 'x', identity: { username_color: 'url(javascript:1)' } } }).color, undefined);
  assert.equal(frame({ sender: { user_id: 3, is_anonymous: true, username: 'x' } }), null);
  assert.equal(frame({ sender: 'nope' }), null);
  assert.equal(frame({ content: 42 }), null);
  assert.equal(frame({ content: '​​ ' }), null);
  assert.equal(frame({ message_id: '<img src=x>' }), null);
  assert.equal(frame({ content: 'a'.repeat(9000) }).text.length, 500);
  assert.equal(frame({ content: 'x‮y\u0000z' }).text, 'xyz');
  assert.deepEqual(buildFrame('moderation.banned', '1', banPayload(), BROADCASTER_ID), { v: 1, t: 'ban', user: 'Viewer_One' });
  assert.equal(buildFrame('moderation.banned', '1', { ...banPayload(), banned_user: {} }, BROADCASTER_ID), null);
});

test('Ayar: eksik veya zayıf secret ile köprü kapalı kalır', async () => {
  assert.equal(readSettings({}), null);
  assert.equal(readSettings({ OVERLAY_KEY: 'kısa', BROADCASTER_USER_ID: '1' }), null);
  assert.equal(readSettings({ OVERLAY_KEY, BROADCASTER_USER_ID: 'abc' }), null);
  assert.equal(readSettings({ OVERLAY_KEY, BROADCASTER_USER_ID: '99999999999999999' }), null);
  const { post, published } = bridge({ envOverride: {} });
  assert.equal((await post(signedDelivery(pair.privateKey, chatPayload()))).status, 503);
  assert.equal(published.length, 0);
});

test('Yönlendirme: ana sayfa değer sızdırmaz, bilinmeyen yol 404, yanlış yöntem 405', async () => {
  const { deps } = bridge();
  const home = await routeRequest(new Request('https://bridge.test/'), deps);
  const text = await home.text();
  assert.match(text, /running/);
  assert.equal(text.includes(OVERLAY_KEY), false);
  assert.equal(text.includes(String(BROADCASTER_ID)), false);
  assert.equal((await routeRequest(new Request('https://bridge.test/admin'), deps)).status, 404);
  assert.equal((await routeRequest(new Request('https://bridge.test/webhook'), deps)).status, 405);
  const missing = await routeRequest(new Request('https://bridge.test/'), { ...deps, env: {} });
  assert.match(await missing.text(), /missing/);
});

const overlayRequest = (protocol, ip = '203.0.113.9') =>
  new Request('https://bridge.test/overlay', {
    headers: { upgrade: 'websocket', 'sec-websocket-protocol': protocol, 'cf-connecting-ip': ip },
  });

test('Overlay kapısı: doğru anahtar bağlanır, yanlışlar 401, başarısızlık sınırı 429', async () => {
  const { deps } = bridge();
  const accepted = await routeRequest(overlayRequest(`${OVERLAY_PROTOCOL}, ${OVERLAY_KEY}`), deps);
  assert.deepEqual(accepted, { connected: true });
  assert.equal((await routeRequest(new Request('https://bridge.test/overlay'), deps)).status, 426);
  assert.equal((await routeRequest(overlayRequest(OVERLAY_PROTOCOL), deps)).status, 401);
  assert.equal((await routeRequest(overlayRequest(OVERLAY_KEY), deps)).status, 401);
  const wrong = await routeRequest(overlayRequest(`${OVERLAY_PROTOCOL}, ${'z'.repeat(43)}`), deps);
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.text()).includes(OVERLAY_KEY), false);

  for (let i = 0; i < 20; i += 1) {
    await routeRequest(overlayRequest(`${OVERLAY_PROTOCOL}, ${'z'.repeat(43)}`, '198.51.100.7'), deps);
  }
  const locked = await routeRequest(overlayRequest(`${OVERLAY_PROTOCOL}, ${OVERLAY_KEY}`, '198.51.100.7'), deps);
  assert.equal(locked.status, 429);
  // Başka IP'deki gerçek overlay etkilenmez.
  assert.deepEqual(await routeRequest(overlayRequest(`${OVERLAY_PROTOCOL}, ${OVERLAY_KEY}`), deps), { connected: true });
  assert.equal(await keysMatch('a', 'a'), true);
  assert.equal(await keysMatch('a', 'b'), false);
});

test('Sınırlayıcı: süre dolunca açılır, geçersiz webhook seli kesilir', async () => {
  let clock = 0;
  const limiter = createFailureLimiter({ limit: 2, windowMs: 1000, now: () => clock });
  limiter.fail('ip');
  assert.equal(limiter.blocked('ip'), false);
  limiter.fail('ip');
  assert.equal(limiter.blocked('ip'), true);
  clock = 1000;
  assert.equal(limiter.blocked('ip'), false);

  const { deps } = bridge();
  const flood = () =>
    routeRequest(
      new Request('https://bridge.test/webhook', {
        method: 'POST',
        body: '{}',
        headers: { 'cf-connecting-ip': '192.0.2.1' },
      }),
      deps,
    );
  for (let i = 0; i < 20; i += 1) assert.equal((await flood()).status, 400);
  assert.equal((await flood()).status, 429);
});

test('Gizlilik: köprü konsola hiçbir şey yazmaz', async () => {
  const original = { ...console };
  const lines = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) console[method] = (...args) => lines.push(args);
  try {
    const { post } = bridge();
    await post(signedDelivery(pair.privateKey, chatPayload()));
    await post(signedDelivery(other.privateKey, chatPayload()));
    await post(signedDelivery(pair.privateKey, '{bozuk'));
    const failing = bridge({
      publishImpl: async () => {
        throw new Error('hub down');
      },
    });
    assert.equal((await failing.post(signedDelivery(pair.privateKey, chatPayload()))).status, 503);
  } finally {
    Object.assign(console, original);
  }
  assert.equal(lines.length, 0);
});

function memoryStorage(initial) {
  const data = new Map(initial);
  return {
    data,
    get: async (key) => structuredClone(data.get(key)),
    put: async (key, value) => void data.set(key, structuredClone(value)),
  };
}

function fakeHubSocket(sent, fp = 'fp', at = 1) {
  return {
    closed: null,
    send: (frame) => sent.push(frame),
    close(code) {
      this.closed = code;
    },
    deserializeAttachment: () => ({ fp, at }),
  };
}

test('Merkez: tekrar, uykudan uyanınca da yakalanır; sohbet metni depoya yazılmaz', async () => {
  const storage = memoryStorage();
  const sent = [];
  const socket = fakeHubSocket(sent);
  const delivery = { id: nextId(), ts: Date.now(), frame: '{"v":1,"t":"msg","text":"GIZLI_SOHBET"}' };

  const hub = createHub({ storage });
  assert.equal(await hub.publish(delivery, [socket], 'fp'), 'forwarded');
  assert.equal(await hub.publish(delivery, [socket], 'fp'), 'duplicate');
  assert.equal(sent.length, 1);

  // Hibernate: bellek silinir, kimlikler depodan okunur.
  const woken = createHub({ storage });
  assert.equal(await woken.publish(delivery, [socket], 'fp'), 'duplicate');
  assert.equal(sent.length, 1);
  assert.equal(JSON.stringify([...storage.data]).includes('GIZLI_SOHBET'), false);
  assert.equal(storage.data.size, 1);
});

test('Merkez: kimlik tablosu sınırlıdır; taşınca eski olaylar da reddedilir', async () => {
  const storage = memoryStorage();
  const hub = createHub({ storage, maxSeen: 3 });
  const base = Date.now();
  const send = (id, ts) => hub.publish({ id, ts, frame: '{}' }, [], 'fp');
  for (let i = 0; i < 4; i += 1) assert.equal(await send(`m${i}`, base + i), 'forwarded');
  const { ids, floor } = storage.data.get('seen');
  assert.equal(ids.length, 3);
  assert.equal(floor, base);
  // Unutulan kimlik yeniden gelse bile zamanı tabanın altında kaldığı için geçemez.
  assert.equal(await send('eski', base - 1), 'stale');
});

test('Merkez: eski kayıtlar süresi dolunca silinir', async () => {
  let clock = 1_000_000_000;
  const storage = memoryStorage();
  const hub = createHub({ storage, now: () => clock });
  await hub.publish({ id: 'a', ts: clock, frame: '{}' }, [], 'fp');
  clock += FRESHNESS_MS * 2 + 1;
  await hub.publish({ id: 'b', ts: clock, frame: '{}' }, [], 'fp');
  assert.deepEqual(storage.data.get('seen').ids.map(([id]) => id), ['b']);
});

test('Merkez: depo kotası dolsa da canlı sohbet durmaz', async () => {
  const storage = {
    get: async () => {
      throw new Error('quota');
    },
    put: async () => {
      throw new Error('quota');
    },
  };
  const sent = [];
  const hub = createHub({ storage });
  assert.equal(await hub.publish({ id: 'a', ts: Date.now(), frame: '{}' }, [fakeHubSocket(sent)], 'fp'), 'forwarded');
  assert.equal(sent.length, 1);
});

test('Merkez: bozuk bağlantı diğerlerini etkilemez, eski anahtarlı bağlantı kesilir', async () => {
  const sent = [];
  const broken = { ...fakeHubSocket(sent), send: () => { throw new Error('dead'); } };
  const rotated = fakeHubSocket(sent, 'eski');
  const healthy = fakeHubSocket(sent);
  const hub = createHub({ storage: memoryStorage() });
  await hub.publish({ id: 'a', ts: Date.now(), frame: 'F' }, [broken, rotated, healthy], 'fp');
  assert.deepEqual(sent, ['F']);
  assert.equal(rotated.closed, 4401);
});

test('Merkez: bağlantı sınırı en eskisini kapatır, dakikalık sınır reddeder', () => {
  let clock = 1000;
  const hub = createHub({ storage: memoryStorage(), now: () => clock });
  const sockets = [3, 1, 2, 5, 4].map((at) => fakeHubSocket([], 'fp', at));
  const stale = fakeHubSocket([], 'eski', 9);
  assert.equal(hub.admit([...sockets, stale], 'fp'), true);
  assert.equal(sockets.find((s) => s.deserializeAttachment().at === 1).closed, 4409);
  assert.equal(stale.closed, 4401);
  assert.equal(sockets.filter((s) => s.closed).length, 1);

  for (let i = 0; i < 29; i += 1) assert.equal(hub.admit([], 'fp'), true);
  assert.equal(hub.admit([], 'fp'), false);
  clock += 60_000;
  assert.equal(hub.admit([], 'fp'), true);
});
