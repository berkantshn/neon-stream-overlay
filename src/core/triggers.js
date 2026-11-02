// Made By FALCREB
// Mesajın hangi efekti tetikleyeceğine karar verir. DOM'a dokunmaz, bu yüzden test edilebilir.

import { sanitizeColor, sanitizeText, sanitizeUser, readableColor } from './sanitize.js';

export const MAX_RULE_ITEMS = 20;
export const MAX_RULE_LENGTH = 32;
export const MOD_KEYWORD_COMMAND = '!neonkw';

/** Karşılaştırma için büyük/küçük harf ve Unicode farklarını yok eder. */
export function foldCase(text) {
  // Türkçe İ/I/ı aynı sayılır; böylece "HIZ" ile "hız" eşleşir.
  return text.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\u0307/g, '').replace(/ı/g, 'i');
}

// Düzenli ifade üretmek yerine sözcük dizisi karşılaştırılır; kullanıcı girdisi regex'e girmez.
function toWordString(text) {
  const words = foldCase(text).split(/[^\p{L}\p{N}\p{M}_]+/u).filter(Boolean);
  return words.length ? ` ${words.join(' ')} ` : '';
}

function containsWords(wordString, phrase) {
  const needle = toWordString(phrase);
  return needle !== '' && wordString.includes(needle);
}

/**
 * Mesaj komut veya anahtar kelime içeriyorsa kuralı döner.
 * Komut yalnızca mesajın ilk sözcüğü olduğunda sayılır.
 */
export function matchTrigger(text, { commands = [], keywords = [] }) {
  const first = foldCase(text.trim().split(/\s+/u, 1)[0] || '');
  for (const command of commands) {
    if (first === foldCase(command)) return { kind: 'command', label: command.replace(/^!/, '') };
  }
  const words = toWordString(text);
  for (const keyword of keywords) {
    if (containsWords(words, keyword)) return { kind: 'keyword', label: keyword };
  }
  return null;
}

/** Yetkili "!neonkw add kelime" komutunu çözer; komut değilse null döner. */
export function parseModKeywordCommand(text) {
  const parts = text.trim().split(/\s+/u);
  if (foldCase(parts[0] || '') !== MOD_KEYWORD_COMMAND) return null;
  const action = foldCase(parts[1] || '');
  if (action === 'clear') return { action };
  if (action !== 'add' && action !== 'del') return null;
  const word = sanitizeText(parts.slice(2).join(' '), { maxLength: MAX_RULE_LENGTH });
  return word ? { action, word } : null;
}

function isPrivileged(message) {
  return Boolean(message.isMod || message.isBroadcaster);
}

/** Adaptörden gelen ham mesajı temizler ve efekt kararını verir. */
export function createPipeline(config, { now = () => Date.now() } = {}) {
  const ignored = new Set(config.ignore.map(foldCase));
  const runtimeKeywords = [];
  const channelNames = [config.twitch].filter(Boolean).map((name) => `@${foldCase(name)}`);
  let lastBurstAt = -Infinity;

  function applyModCommand(command) {
    if (command.action === 'clear') {
      runtimeKeywords.length = 0;
      return;
    }
    const folded = foldCase(command.word);
    const index = runtimeKeywords.findIndex((word) => foldCase(word) === folded);
    if (command.action === 'del') {
      if (index !== -1) runtimeKeywords.splice(index, 1);
    } else if (index === -1 && runtimeKeywords.length < MAX_RULE_ITEMS) {
      runtimeKeywords.push(command.word);
    }
  }

  return {
    /** Çalışma anında eklenen anahtar kelimeler; sayfa yenilenince silinir. */
    get runtimeKeywords() {
      return [...runtimeKeywords];
    },

    /**
     * @param {object} raw adaptör mesajı
     * @returns {null | {message: object, emphasis: string|null, burst: object|null}}
     */
    process(raw) {
      if (!raw || typeof raw.text !== 'string') return null;
      if (ignored.has(foldCase(String(raw.login || raw.user || '')))) return null;
      const text = sanitizeText(raw.text, {
        maxLength: config.maxlen,
        hideLinks: config.hidelinks,
      });
      if (!text) return null;

      if (config.modkw && isPrivileged(raw)) {
        const command = parseModKeywordCommand(text);
        if (command) {
          applyModCommand(command);
          return null;
        }
      }

      const allowed = config.fxby === 'all' || isPrivileged(raw);
      const trigger = allowed
        ? matchTrigger(text, {
            commands: config.commands,
            keywords: [...config.keywords, ...runtimeKeywords],
          })
        : null;

      let burst = null;
      if (trigger && now() - lastBurstAt >= config.cooldown * 1000) {
        lastBurstAt = now();
        burst = { label: trigger.label.toUpperCase(), kind: trigger.kind };
      }

      if (trigger?.kind === 'command' && config.hidecmd) {
        return { message: null, emphasis: null, burst };
      }

      const words = toWordString(text);
      let emphasis = null;
      if (trigger) emphasis = 'trigger';
      else if (config.highlights.some((word) => containsWords(words, word))) emphasis = 'highlight';
      else if (channelNames.some((name) => foldCase(text).includes(name))) emphasis = 'mention';
      else if (raw.isFirst) emphasis = 'first';

      return {
        message: {
          id: raw.id ? String(raw.id) : null,
          platform: raw.platform || 'demo',
          user: sanitizeUser(raw.user),
          login: foldCase(String(raw.login || raw.user || '')),
          color: readableColor(sanitizeColor(raw.color)),
          text,
          isAction: Boolean(raw.isAction),
          role: raw.isBroadcaster ? 'host' : raw.isMod ? 'mod' : raw.isVip ? 'vip' : null,
        },
        emphasis,
        burst,
      };
    },
  };
}
