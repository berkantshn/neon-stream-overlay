// Made By FALCREB
// Overlay'in Kick adaptörü sahte köprüyle denenir: ayrıştırma, XSS, yeniden bağlanma, köprü kapalıyken davranış.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKickBridgeAdapter, MAX_FAILURES, parseBridgeFrame } from '../src/adapters/kick-bridge.js';
import { createTwitchAdapter } from '../src/adapters/twitch.js';
import { parseConfig } from '../src/core/config.js';
import { createPipeline } from '../src/core/triggers.js';

const KEY = 'k'.repeat(43);
const ORIGIN = 'wss://bridge.example.workers.dev';

function fakeSocketClass() {
  class FakeSocket {
    static instances = [];
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.sent = [];
      this.listeners = {};
      FakeSocket.instances.push(this);
    }
    addEventListener(type, listener) {
      (this.listeners[type] ??= []).push(listener);
    }
    emit(type, event = {}) {
      for (const listener of this.listeners[type] ?? []) listener(event);
    }
    send(data) {
      this.sent.push(data);
    }
    close(code) {
      this.emit('close', { code });
    }
    hello() {
      this.emit('open');
      this.emit('message', { data: JSON.stringify({ v: 1, t: 'hello' }) });
    }
    frame(value) {
      this.emit('message', { data: typeof value === 'string' ? value : JSON.stringify(value) });
    }
  }
  return FakeSocket;
}

function fakeTimers() {
  const pending = new Map();
  let nextId = 1;
  return {
    pending,
    setTimeout(fn, ms) {
      pending.set(nextId, { fn, ms });
      return nextId++;
    },
    clearTimeout: (id) => pending.delete(id),
    runShortest() {
      const [id, entry] = [...pending].sort((a, b) => a[1].ms - b[1].ms)[0];
      pending.delete(id);
      entry.fn();
      return entry.ms;
    },
  };
}

function setup(overrides = {}) {
  const Socket = fakeSocketClass();
  const timers = fakeTimers();
  const log = { messages: [], status: [], moderation: [] };
  const adapter = createKickBridgeAdapter({
    origin: ORIGIN,
    key: KEY,
    onMessage: (m) => log.messages.push(m),
    onStatus: (level, text, options) => log.status.push({ level, text, options }),
    onModeration: (e) => log.moderation.push(e),
    WebSocketImpl: Socket,
    timers,
    random: () => 0.5,
    ...overrides,
  });
  return { adapter, Socket, timers, log };
}

const chat = (overrides = {}) => ({ v: 1, t: 'msg', id: 'm1', user: 'Viewer', text: 'hello', ...overrides });

test('Bağlantı: anahtar adreste değil alt protokoldedir ve sohbete hiçbir şey gönderilmez', () => {
  const { adapter, Socket, log } = setup();
  adapter.start();
  const socket = Socket.instances[0];
  assert.equal(socket.url, `${ORIGIN}/overlay`);
  assert.equal(socket.url.includes(KEY), false);
  assert.deepEqual(socket.protocols, ['neon-bridge.v1', KEY]);
  socket.hello();
  assert.equal(log.status.at(-1).level, 'ok');
  assert.deepEqual(socket.sent, []);
  // Durum metinlerinde anahtar veya adres görünmez.
  assert.equal(log.status.some(({ text }) => text.includes(KEY) || text.includes(ORIGIN)), false);
});

test('Köken: wss dışı veya biçimi bozuk adres reddedilir', () => {
  for (const origin of ['ws://a.dev', 'https://a.dev', 'wss://a.dev/yol', 'wss://a.dev;x', '']) {
    assert.throws(() => setup({ origin }));
  }
});

test('Çerçeve: sohbet ortak biçime döner, rol ve renk doğrulanır', () => {
  const { message } = parseBridgeFrame(JSON.stringify(chat({ role: 'mod', color: '#ff5733' })));
  assert.equal(message.platform, 'kick');
  assert.equal(message.login, 'viewer');
  assert.equal(message.isMod, true);
  assert.equal(message.isBroadcaster, false);
  assert.equal(message.color, '#ff5733');
  const weird = parseBridgeFrame(JSON.stringify(chat({ role: 'admin', color: 'red;background:url(x)' }))).message;
  assert.equal(weird.isMod, false);
  assert.equal(weird.color, null);
  assert.deepEqual(parseBridgeFrame(JSON.stringify({ v: 1, t: 'ban', user: 'Bad_User' })), {
    kind: 'moderation',
    event: { type: 'user', login: 'bad_user' },
  });
});

test('Çerçeve: bilinmeyen veya bozuk her şey düşer', () => {
  const bad = [
    'not json',
    '[]',
    'null',
    '42',
    new ArrayBuffer(4),
    undefined,
    JSON.stringify({ t: 'msg', id: 'a', user: 'u', text: 't' }),
    JSON.stringify({ v: 2, t: 'msg', id: 'a', user: 'u', text: 't' }),
    JSON.stringify({ v: 1, t: 'unknown' }),
    JSON.stringify({ v: 1, t: '__proto__' }),
    JSON.stringify(chat({ id: '<img src=x>' })),
    JSON.stringify(chat({ id: 7 })),
    JSON.stringify(chat({ text: 42 })),
    JSON.stringify(chat({ user: {} })),
    JSON.stringify(chat({ user: '​' })),
    JSON.stringify(chat({ text: 'a'.repeat(2001) })),
    JSON.stringify({ v: 1, t: 'ban' }),
    JSON.stringify({ v: 1, t: 'ban', user: '​' }),
    'x'.repeat(9000),
  ];
  for (const data of bad) assert.equal(parseBridgeFrame(data), null);

  const { adapter, Socket, log } = setup();
  adapter.start();
  const socket = Socket.instances[0];
  socket.hello();
  for (const data of bad) socket.emit('message', { data });
  assert.equal(log.messages.length, 0);
  assert.equal(log.moderation.length, 0);
});

test('Hat: mesaj ortak temizleyiciden geçer, XSS yükü düz metin kalır', () => {
  const pipeline = createPipeline(parseConfig('maxlen=500'));
  const { adapter, Socket } = setup({
    onMessage(message) {
      const result = pipeline.process(message);
      received.push(result.message);
    },
  });
  const received = [];
  adapter.start();
  const socket = Socket.instances[0];
  socket.hello();
  const payloads = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '"><svg/onload=alert(1)>',
    'javascript:alert(1)',
  ];
  for (const [i, text] of payloads.entries()) socket.frame(chat({ id: `x${i}`, text, user: '<b>Hacker</b>' }));
  assert.deepEqual(received.map((m) => m.text), payloads);
  assert.equal(received[0].user, '<b>Hacker</b>');
  // Görünmez ve yön değiştiren karakterler ortak temizleyicide silinir.
  socket.frame(chat({ id: 'y', text: 'te‮st​' }));
  assert.equal(received.at(-1).text, 'test');
});

test('Hat: Kick mesajı efekt ve yoksayma kurallarını Twitch ile aynı uygular', () => {
  const pipeline = createPipeline(parseConfig('fxby=mods&ignore=botty&cooldown=0'));
  const viewer = parseBridgeFrame(JSON.stringify(chat({ text: '!hype' }))).message;
  assert.equal(pipeline.process(viewer).burst, null);
  const mod = parseBridgeFrame(JSON.stringify(chat({ text: '!hype', role: 'mod' }))).message;
  assert.equal(pipeline.process(mod).burst.label, 'HYPE');
  assert.equal(pipeline.process(parseBridgeFrame(JSON.stringify(chat({ user: 'Botty' }))).message), null);
});

test('Moderasyon: ban olayı kullanıcı silme biçiminde iletilir', () => {
  const { adapter, Socket, log } = setup();
  adapter.start();
  const socket = Socket.instances[0];
  socket.hello();
  socket.frame({ v: 1, t: 'ban', user: 'Viewer' });
  assert.deepEqual(log.moderation, [{ type: 'user', login: 'viewer' }]);
});

test('Yeniden bağlanma: bekleme artar, tavanı aşmaz, "hello" sayacı sıfırlar', () => {
  const { adapter, Socket, timers, log } = setup();
  adapter.start();
  const delays = [];
  for (let i = 0; i < 6; i += 1) {
    Socket.instances.at(-1).close(1006);
    delays.push(timers.runShortest());
  }
  assert.deepEqual(delays, [750, 1500, 3000, 6000, 12000, 24000]);
  assert.equal(log.status.at(-2).text, 'Kick: reconnecting (attempt 6)');

  Socket.instances.at(-1).hello();
  Socket.instances.at(-1).close(1006);
  assert.equal(timers.runShortest(), 750, 'başarılı bağlantı sayacı sıfırlar');
});

test('Köprü kapalı: tekrarlı hatada durur ve görünür ipucu bırakır', () => {
  const { adapter, Socket, timers, log } = setup();
  assert.doesNotThrow(() => adapter.start());
  for (let i = 0; i < MAX_FAILURES - 1; i += 1) {
    Socket.instances.at(-1).close(1006);
    timers.runShortest();
  }
  Socket.instances.at(-1).close(1006);
  const count = Socket.instances.length;
  assert.equal(count, MAX_FAILURES);
  assert.equal(timers.pending.size, 0, 'bekleyen zamanlayıcı kalmaz');
  const last = log.status.at(-1);
  assert.equal(last.level, 'error');
  assert.match(last.text, /docs\/KICK\.md/);
  assert.equal(last.options.lock, true, 'status=0 olsa bile görünür');
  assert.equal(last.text.includes(KEY), false);
});

test('Köprü kapalı: WebSocket kurulamazsa hata fırlatmaz, CSP engeli de aynı yoldan yönetilir', () => {
  const { adapter, timers, log } = setup({
    WebSocketImpl: class {
      constructor() {
        throw new Error('blocked by CSP');
      }
    },
  });
  assert.doesNotThrow(() => adapter.start());
  for (let i = 0; i < MAX_FAILURES; i += 1) {
    if (timers.pending.size) assert.doesNotThrow(() => timers.runShortest());
  }
  assert.equal(log.status.at(-1).level, 'error');
  assert.equal(timers.pending.size, 0);
});

test('Yalıtım: Kick köprüsü tamamen dururken Twitch mesajları akmaya devam eder', () => {
  const TwitchSocket = fakeSocketClass();
  const twitchTimers = fakeTimers();
  const shown = [];
  const twitch = createTwitchAdapter({
    channel: 'chan',
    onMessage: (message) => shown.push(message.text),
    WebSocketImpl: TwitchSocket,
    timers: twitchTimers,
  });
  const { adapter, Socket, timers, log } = setup({ onMessage: (message) => shown.push(message.text) });
  twitch.start();
  adapter.start();
  TwitchSocket.instances[0].emit('open');
  for (let i = 0; i < MAX_FAILURES - 1; i += 1) {
    Socket.instances.at(-1).close(1006);
    timers.runShortest();
  }
  Socket.instances.at(-1).close(1006);
  assert.equal(log.status.at(-1).level, 'error');
  TwitchSocket.instances[0].emit('message', { data: '@id=m1;display-name=A :a!a@a PRIVMSG #chan :still here\r\n' });
  assert.deepEqual(shown, ['still here']);
  assert.equal(TwitchSocket.instances.length, 1, 'Twitch yeniden bağlanmadı');
  twitch.stop();
});

test('Kalıcı ret: anahtar döndü ve çok overlay kodları yeniden denemez', () => {
  for (const [code, pattern] of [
    [4401, /key has changed/],
    [4409, /too many overlays/],
  ]) {
    const { adapter, Socket, timers, log } = setup();
    adapter.start();
    Socket.instances[0].hello();
    Socket.instances[0].close(code);
    assert.equal(timers.pending.size, 0);
    assert.equal(Socket.instances.length, 1);
    assert.match(log.status.at(-1).text, pattern);
  }
});

test('Canlılık: ping gönderir, sessizlikte bağlantıyı yeniler, pong mesaj sayılmaz', () => {
  const { adapter, Socket, timers, log } = setup();
  adapter.start();
  const socket = Socket.instances[0];
  socket.hello();
  assert.equal(timers.runShortest(), 60000);
  assert.deepEqual(socket.sent, ['ping']);
  socket.emit('message', { data: 'pong' });
  assert.equal(log.messages.length, 0);
  assert.equal(timers.runShortest(), 60000);
  // Yanıt gelmezse sessizlik süresi dolar ve yeniden bağlanma başlar.
  assert.equal(timers.runShortest(), 150000);
  assert.equal(log.status.at(-1).text, 'Kick: reconnecting (attempt 1)');
});

test('Hata yalıtımı: mesaj işleyici patlasa da adaptör ayakta kalır', () => {
  let calls = 0;
  const { adapter, Socket, log } = setup({
    onMessage() {
      calls += 1;
      throw new Error('boom');
    },
  });
  adapter.start();
  const socket = Socket.instances[0];
  socket.hello();
  assert.doesNotThrow(() => socket.frame(chat()));
  assert.doesNotThrow(() => socket.frame(chat({ id: 'm2' })));
  assert.equal(calls, 2);
  assert.equal(log.status.at(-1).level, 'ok');
});

test('Durdurma: stop sonrası zamanlayıcı kalmaz, yeniden bağlanmaz', () => {
  const { adapter, Socket, timers } = setup();
  adapter.start();
  Socket.instances[0].hello();
  adapter.stop();
  assert.equal(timers.pending.size, 0);
  assert.equal(Socket.instances.length, 1);
});
