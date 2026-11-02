// Made By FALCREB
// URL parametrelerini doğrular. Bilinmeyen parametre yok sayılır; hiçbir değer kontrolsüz kullanılmaz.

import { sanitizeColor, sanitizeText } from './sanitize.js';
import { foldCase, MAX_RULE_ITEMS, MAX_RULE_LENGTH } from './triggers.js';

export const THEMES = {
  cyber: { c1: '#00f0ff', c2: '#ff2bd6' },
  magma: { c1: '#ff7a18', c2: '#ff1f4b' },
  toxic: { c1: '#7dff3c', c2: '#f4ff3a' },
  ice: { c1: '#7fd8ff', c2: '#6e7bff' },
  synth: { c1: '#b26bff', c2: '#ff5fa2' },
};

// Parola benzeri parametreler okunmaz; kullanıcı uyarılmak üzere yalnızca adı saklanır.
const SENSITIVE_PARAM = /oauth|token|pass|secret|auth|api_?key|credential/i;

const bool = (fallback) => ({
  fallback,
  parse(raw) {
    const value = raw.trim().toLowerCase();
    if (['1', 'true', 'on', 'yes'].includes(value)) return true;
    if (['0', 'false', 'off', 'no'].includes(value)) return false;
    return fallback;
  },
  write: (value) => (value ? '1' : '0'),
});

const int = (min, max, fallback) => ({
  fallback,
  parse(raw) {
    if (!/^\s*-?\d+\s*$/.test(raw)) return fallback;
    return Math.min(max, Math.max(min, Number.parseInt(raw, 10)));
  },
  write: String,
});

const choice = (values, fallback) => ({
  fallback,
  parse: (raw) => (values.includes(raw) ? raw : fallback),
  write: String,
});

const color = {
  fallback: null,
  parse: (raw) => sanitizeColor(raw),
  write: String,
};

/** Twitch kullanıcı adı: URL veya @ ile yapıştırılsa da yalnızca geçerli ad kalır. */
const twitchLogin = {
  fallback: '',
  parse(raw) {
    const value = raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?twitch\.tv\//, '')
      .replace(/^[@#]/, '')
      .replace(/\/$/, '');
    return /^[a-z0-9_]{1,25}$/.test(value) ? value : '';
  },
  write: String,
};

// Virgülle ayrılmış liste: temizlenir, tekrarlar atılır, adet ve uzunluk sınırlanır.
const list = (fallback, normalize = (item) => item) => ({
  fallback,
  parse(raw) {
    const seen = new Set();
    const items = [];
    for (const part of raw.split(',')) {
      const clean = sanitizeText(part, { maxLength: MAX_RULE_LENGTH });
      if (!clean) continue;
      const item = normalize(clean);
      const key = foldCase(item);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      if (items.length === MAX_RULE_ITEMS) break;
    }
    return items;
  },
  write: (value) => value.join(','),
});

const asCommand = (item) => `!${item.replace(/^!+/, '').split(/\s+/u)[0]}`;

const SCHEMA = {
  // Kaynaklar
  demo: bool(false),
  twitch: twitchLogin,
  // Görünüm
  theme: choice(Object.keys(THEMES), 'cyber'),
  c1: color,
  c2: color,
  panel: int(0, 100, 70),
  font: int(12, 40, 18),
  w: int(240, 1600, 420),
  pos: choice(['bl', 'br', 'tl', 'tr'], 'bl'),
  // Sohbet
  max: int(3, 50, 12),
  fade: int(0, 600, 0),
  maxlen: int(20, 500, 200),
  ignore: list([]),
  hidecmd: bool(false),
  hidelinks: bool(false),
  // Efektler
  commands: list(['!hype'], asCommand),
  keywords: list([]),
  highlights: list([]),
  fxby: choice(['all', 'mods'], 'all'),
  cooldown: int(0, 300, 8),
  modkw: bool(false),
  // Performans ve erişilebilirlik
  motion: choice(['auto', 'reduced'], 'auto'),
  quality: choice(['high', 'low'], 'high'),
  credit: bool(true),
  status: bool(true),
};

/**
 * URL sorgusundan doğrulanmış ayar nesnesi üretir.
 * @param {string|URLSearchParams} search
 */
export function parseConfig(search = '') {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const config = {};
  for (const [key, field] of Object.entries(SCHEMA)) {
    const raw = params.get(key);
    const fallback = Array.isArray(field.fallback) ? [...field.fallback] : field.fallback;
    config[key] = raw === null ? fallback : field.parse(raw);
  }
  config.ignoredSensitive = [...new Set(params.keys())].filter(
    (key) => !(key in SCHEMA) && SENSITIVE_PARAM.test(key),
  );
  return config;
}

/** Varsayılandan farklı ayarları URL sorgusuna yazar; bilinmeyen alan yazılmaz. */
export function toSearchParams(config) {
  const params = new URLSearchParams();
  for (const [key, field] of Object.entries(SCHEMA)) {
    const value = config[key];
    if (value === undefined || value === null) continue;
    const written = field.write(value);
    const fallback = field.fallback === null ? null : field.write(field.fallback);
    if (written !== fallback) params.set(key, written);
  }
  return params;
}

/** OBS'e yapıştırılacak bağlantıyı üretir. */
export function buildOverlayUrl(pageHref, config) {
  const url = new URL('overlay.html', pageHref);
  url.search = toSearchParams(config).toString();
  url.hash = '';
  return url.href;
}

/** Tema renklerini, varsa özel renklerle birleştirir. */
export function resolveColors(config) {
  const base = THEMES[config.theme] ?? THEMES.cyber;
  return { c1: config.c1 ?? base.c1, c2: config.c2 ?? base.c2 };
}

/** Çalıştırılacak kaynaklar. Demo modu gerçek bağlantıyı kapatır. */
export function resolveSources(config) {
  return {
    demo: config.demo,
    twitch: config.demo ? '' : config.twitch,
  };
}
