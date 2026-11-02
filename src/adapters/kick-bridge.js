// Made By FALCREB
// Kick sohbetini yayıncının kendi köprüsünden SADECE okur. Bu dosya yalnızca Kick ayarlıysa yüklenir.
// Köprüde sorun çıkması Twitch'i veya overlay'i etkilemez: burada hiçbir hata dışarı sızmaz.

import { sanitizeColor, sanitizeText, sanitizeUser } from '../core/sanitize.js';
import { foldCase } from '../core/triggers.js';

export const BRIDGE_PROTOCOL = 'neon-bridge.v1';
const ORIGIN = /^wss:\/\/[a-z0-9.-]+(?::\d{1,5})?$/;
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ROLES = new Set(['host', 'mod', 'vip']);
const MAX_FRAME_CHARS = 8192;
const MAX_TEXT_CHARS = 2000;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;
export const MAX_FAILURES = 8;
const PING_INTERVAL_MS = 60000;
const SILENCE_LIMIT_MS = 150000;

// Köprünün kalıcı ret kodları: yeniden denemek işe yaramaz, kullanıcıya ipucu gösterilir.
const FATAL_CLOSE = new Map([
  [4401, 'Kick bridge: the overlay key has changed. Create a new link on the setup page.'],
  [4409, 'Kick bridge: too many overlays are open. Close one, then reload this overlay.'],
]);
const GIVE_UP_HINT =
  'Kick bridge: not reachable, or the overlay key is wrong. Check docs/KICK.md on the setup page, then reload.';

/**
 * Köprü çerçevesini doğrular. Köprü kendi sunucumuz olsa da içerik yine güvenilmez sayılır.
 * Bilinmeyen veya bozuk her çerçevede null döner, böylece sessizce düşer.
 */
export function parseBridgeFrame(data) {
  if (typeof data !== 'string' || data.length > MAX_FRAME_CHARS) return null;
  let frame;
  try {
    frame = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof frame !== 'object' || frame === null || frame.v !== 1) return null;

  if (frame.t === 'hello') return { kind: 'hello' };
  if (frame.t === 'ban') {
    const name = sanitizeText(frame.user, { maxLength: 32 });
    return name ? { kind: 'moderation', event: { type: 'user', login: foldCase(name) } } : null;
  }
  if (frame.t !== 'msg') return null;
  if (typeof frame.id !== 'string' || !MESSAGE_ID.test(frame.id)) return null;
  if (typeof frame.text !== 'string' || frame.text.length > MAX_TEXT_CHARS) return null;
  if (typeof frame.user !== 'string' || !sanitizeText(frame.user, { maxLength: 32 })) return null;
  const role = ROLES.has(frame.role) ? frame.role : null;
  const user = sanitizeUser(frame.user);
  // Metin ve ad temizliğinin son hali ortak hat içinde (createPipeline) yeniden uygulanır.
  return {
    kind: 'message',
    message: {
      id: frame.id,
      platform: 'kick',
      user,
      login: foldCase(user),
      color: sanitizeColor(frame.color),
      text: frame.text,
      isAction: false,
      isBroadcaster: role === 'host',
      isMod: role === 'mod',
      isVip: role === 'vip',
      isSub: false,
      isFirst: false,
    },
  };
}

export function createKickBridgeAdapter({
  origin,
  key,
  onMessage,
  onModeration = () => {},
  onStatus = () => {},
  WebSocketImpl = globalThis.WebSocket,
  timers = globalThis,
  random = Math.random,
}) {
  if (!ORIGIN.test(origin)) throw new Error('Invalid Kick bridge origin');

  let socket = null;
  let stopped = false;
  let failures = 0;
  let reconnectTimer = null;
  let pingTimer = null;
  let silenceTimer = null;

  const clearTimers = () => {
    timers.clearTimeout(reconnectTimer);
    timers.clearTimeout(pingTimer);
    timers.clearTimeout(silenceTimer);
  };

  function giveUp(hint) {
    stopped = true;
    clearTimers();
    try {
      socket?.close();
    } catch {
      // Kapanmış bağlantı önemli değildir.
    }
    // Kilitli durum: status=0 olsa bile görünür, çünkü kullanıcı bir işlem yapmalıdır.
    onStatus('error', hint, { lock: true });
  }

  function scheduleReconnect() {
    if (stopped) return;
    failures += 1;
    if (failures >= MAX_FAILURES) {
      giveUp(GIVE_UP_HINT);
      return;
    }
    const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (failures - 1));
    const delay = ceiling / 2 + random() * (ceiling / 2);
    onStatus('warn', `Kick: reconnecting (attempt ${failures})`);
    reconnectTimer = timers.setTimeout(connect, delay);
  }

  // Yarı kopmuş bağlantıyı anlamak için düzenli "ping" gider; köprü uyanmadan "pong" döner.
  function armHeartbeat(current) {
    timers.clearTimeout(pingTimer);
    timers.clearTimeout(silenceTimer);
    pingTimer = timers.setTimeout(() => {
      try {
        current.send('ping');
      } catch {
        // Kapanma olayı yeniden bağlanmayı başlatır.
      }
    }, PING_INTERVAL_MS);
    silenceTimer = timers.setTimeout(() => {
      try {
        current.close();
      } catch {
        // Kapanmış bağlantı önemli değildir.
      }
    }, SILENCE_LIMIT_MS);
  }

  function handleFrame(data) {
    const parsed = parseBridgeFrame(data);
    if (!parsed) return;
    if (parsed.kind === 'hello') {
      failures = 0;
      onStatus('ok', 'Kick: connected to your bridge');
    } else if (parsed.kind === 'message') {
      onMessage(parsed.message);
    } else {
      onModeration(parsed.event);
    }
  }

  function connect() {
    if (stopped) return;
    let current;
    try {
      // Anahtar adrese yazılmaz, alt protokol olarak gider. Tarayıcı başlık eklemeye izin vermez.
      current = new WebSocketImpl(`${origin}/overlay`, [BRIDGE_PROTOCOL, key]);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = current;
    onStatus('info', 'Kick: connecting');

    current.addEventListener('open', () => armHeartbeat(current));
    current.addEventListener('message', (event) => {
      armHeartbeat(current);
      if (event.data === 'pong') return;
      try {
        handleFrame(event.data);
      } catch {
        // Tek bir bozuk olay bağlantıyı düşürmemeli.
      }
    });
    current.addEventListener('close', (event) => {
      if (current !== socket) return;
      clearTimers();
      const hint = FATAL_CLOSE.get(event?.code);
      if (hint) giveUp(hint);
      else scheduleReconnect();
    });
  }

  return {
    start: connect,
    stop() {
      stopped = true;
      clearTimers();
      try {
        socket?.close();
      } catch {
        // Kapanmış bağlantı önemli değildir.
      }
    },
  };
}
