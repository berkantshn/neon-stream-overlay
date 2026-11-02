// Made By FALCREB
// Adaptörler sahte WebSocket ile denenir; bu testler ağa çıkmaz.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTwitchAdapter } from '../src/adapters/twitch.js';
import { createDemoAdapter } from '../src/adapters/demo.js';
import { parseConfig } from '../src/core/config.js';

function fakeSocketClass() {
  class FakeSocket {
    static instances = [];
    constructor(url) {
      this.url = url;
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
    close() {
      this.emit('close');
    }
  }
  return FakeSocket;
}

// Zamanlayıcılar elle ilerletilir, testler beklemez.
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

function twitch(overrides = {}) {
  const Socket = fakeSocketClass();
  const timers = fakeTimers();
  const log = { messages: [], status: [], moderation: [] };
  const adapter = createTwitchAdapter({
    channel: 'chan',
    onMessage: (m) => log.messages.push(m),
    onStatus: (level, text) => log.status.push({ level, text }),
    onModeration: (e) => log.moderation.push(e),
    WebSocketImpl: Socket,
    timers,
    random: () => 0.5,
    ...overrides,
  });
  return { adapter, Socket, timers, log };
}

test('Twitch: anonim el sıkışma yalnızca okuma komutları gönderir', () => {
  const { adapter, Socket } = twitch();
  adapter.start();
  const socket = Socket.instances[0];
  assert.equal(socket.url, 'wss://irc-ws.chat.twitch.tv:443');
  socket.emit('open');
  assert.match(socket.sent[2], /^NICK justinfan\d+$/);
  assert.equal(socket.sent[1], 'PASS anonymous');
  assert.equal(socket.sent[3], 'JOIN #chan');
  assert.equal(socket.sent.some((line) => line.startsWith('PRIVMSG')), false);
  assert.equal(socket.sent.some((line) => /oauth/i.test(line)), false);
});

test('Twitch: geçersiz kanal adı reddedilir', () => {
  assert.throws(() => twitch({ channel: 'x\r\nPRIVMSG #y :spam' }));
});

test('Twitch: PING yanıtlanır, birden çok satır işlenir, moderasyon iletilir', () => {
  const { adapter, Socket, log } = twitch();
  adapter.start();
  const socket = Socket.instances[0];
  socket.emit('open');
  socket.emit('message', {
    data: [
      'PING :tmi.twitch.tv',
      '@id=m1;display-name=A :a!a@a PRIVMSG #chan :hello',
      '@target-msg-id=m1 :tmi.twitch.tv CLEARMSG #chan :hello',
      ':tmi.twitch.tv CLEARCHAT #chan :BadUser',
      ':tmi.twitch.tv CLEARCHAT #chan',
      '@room-id=1 :tmi.twitch.tv ROOMSTATE #chan',
      '',
    ].join('\r\n'),
  });
  assert.ok(socket.sent.includes('PONG :tmi.twitch.tv'));
  assert.equal(log.messages[0].text, 'hello');
  assert.deepEqual(log.moderation, [
    { type: 'message', id: 'm1' },
    { type: 'user', login: 'baduser' },
    { type: 'all' },
  ]);
  assert.equal(log.status.at(-1).level, 'ok');
});

test('Twitch: kopunca artan beklemeyle yeniden bağlanır, stop sonrası bağlanmaz', () => {
  const { adapter, Socket, timers } = twitch();
  adapter.start();
  Socket.instances[0].close();
  assert.equal(timers.runShortest(), 750);
  assert.equal(Socket.instances.length, 2);
  Socket.instances[1].close();
  assert.equal(timers.runShortest(), 1500);
  adapter.stop();
  assert.equal(timers.pending.size, 0);
  assert.equal(Socket.instances.length, 3);
});

test('Twitch: WebSocket kurulamazsa hata fırlatmaz', () => {
  const { adapter, timers } = twitch({
    WebSocketImpl: class {
      constructor() {
        throw new Error('blocked');
      }
    },
  });
  assert.doesNotThrow(() => adapter.start());
  assert.equal(timers.pending.size, 1);
});

test('Demo: ağ kullanmadan mesaj üretir ve durdurulabilir', () => {
  const timers = fakeTimers();
  const messages = [];
  const adapter = createDemoAdapter({
    config: parseConfig('demo=1'),
    onMessage: (m) => messages.push(m),
    timers,
  });
  adapter.start();
  for (let i = 0; i < 20; i += 1) timers.runShortest();
  assert.equal(messages.length, 20);
  assert.ok(messages.some((m) => m.text === '!hype'));
  assert.ok(messages.some((m) => m.text.includes('<img')));
  adapter.stop();
  assert.equal(timers.pending.size, 0);
});
