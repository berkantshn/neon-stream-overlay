// Made By FALCREB
// Twitch sohbetini anonim (justinfan) IRC bağlantısıyla SADECE okur.
// Hesap, parola veya token istemez; JOIN dışında kanala hiçbir şey göndermez.

import { parseIrcLine, privmsgToMessage } from '../core/irc.js';

export const TWITCH_IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
// Twitch yaklaşık beş dakikada bir PING atar; bu süre aşılırsa bağlantı kopmuş sayılır.
const SILENCE_LIMIT_MS = 6 * 60 * 1000;
const JOIN_WARNING_MS = 10000;

export function createTwitchAdapter({
  channel,
  onMessage,
  onModeration = () => {},
  onStatus = () => {},
  WebSocketImpl = globalThis.WebSocket,
  timers = globalThis,
  random = Math.random,
}) {
  // Kanal adı IRC komutuna girer; satır sonu enjeksiyonu olmasın diye yeniden doğrulanır.
  if (!/^[a-z0-9_]{1,25}$/.test(channel)) throw new Error('Invalid Twitch channel name');

  let socket = null;
  let stopped = false;
  let attempts = 0;
  let reconnectTimer = null;
  let silenceTimer = null;
  let joinTimer = null;

  const clearTimers = () => {
    timers.clearTimeout(reconnectTimer);
    timers.clearTimeout(silenceTimer);
    timers.clearTimeout(joinTimer);
  };

  function armSilenceTimer() {
    timers.clearTimeout(silenceTimer);
    silenceTimer = timers.setTimeout(() => socket?.close(), SILENCE_LIMIT_MS);
  }

  function scheduleReconnect() {
    if (stopped) return;
    attempts += 1;
    const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempts - 1));
    const delay = ceiling / 2 + random() * (ceiling / 2);
    onStatus('warn', `Twitch: reconnecting (attempt ${attempts})`);
    reconnectTimer = timers.setTimeout(connect, delay);
  }

  function handleLine(line) {
    const parsed = parseIrcLine(line);
    if (!parsed) return;
    switch (parsed.command) {
      case 'PING':
        socket.send(`PONG :${parsed.trailing ?? 'tmi.twitch.tv'}`);
        break;
      case 'PRIVMSG': {
        const message = privmsgToMessage(parsed);
        if (message) onMessage(message);
        break;
      }
      case 'ROOMSTATE':
        attempts = 0;
        timers.clearTimeout(joinTimer);
        onStatus('ok', `Twitch: reading #${channel}`);
        break;
      case 'CLEARMSG':
        if (parsed.tags['target-msg-id']) {
          onModeration({ type: 'message', id: parsed.tags['target-msg-id'] });
        }
        break;
      case 'CLEARCHAT':
        onModeration(
          parsed.trailing
            ? { type: 'user', login: parsed.trailing.toLowerCase() }
            : { type: 'all' },
        );
        break;
      case 'RECONNECT':
        socket.close();
        break;
      case 'NOTICE':
        if (/login|unsuccessful|improperly/i.test(parsed.trailing ?? '')) {
          onStatus('error', 'Twitch: anonymous login was refused');
        }
        break;
      default:
        break;
    }
  }

  function connect() {
    if (stopped) return;
    try {
      socket = new WebSocketImpl(TWITCH_IRC_URL);
    } catch {
      scheduleReconnect();
      return;
    }
    const current = socket;
    onStatus('info', 'Twitch: connecting');

    current.addEventListener('open', () => {
      armSilenceTimer();
      current.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      // Anonim giriş: rastgele parola metni gerçek bir kimlik bilgisi değildir.
      current.send('PASS anonymous');
      current.send(`NICK justinfan${10000 + Math.floor(random() * 89999)}`);
      current.send(`JOIN #${channel}`);
      joinTimer = timers.setTimeout(() => {
        onStatus('warn', `Twitch: no reply for #${channel}. Check the channel name.`);
      }, JOIN_WARNING_MS);
    });

    current.addEventListener('message', (event) => {
      armSilenceTimer();
      if (typeof event.data !== 'string') return;
      for (const line of event.data.split('\r\n')) {
        try {
          handleLine(line);
        } catch {
          // Tek bir bozuk satır bağlantıyı düşürmemeli.
        }
      }
    });

    current.addEventListener('close', () => {
      clearTimers();
      if (current === socket) scheduleReconnect();
    });
  }

  return {
    start: connect,
    stop() {
      stopped = true;
      clearTimers();
      socket?.close();
    },
  };
}
