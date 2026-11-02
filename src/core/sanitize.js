// Made By FALCREB
// Sohbetten gelen her metin buradan geçer. HTML kaçışı yapılmaz, çünkü metin
// DOM'a yalnızca textContent ile yazılır; burada görünmez/bozucu karakterler temizlenir.

export const DEFAULT_MAX_LENGTH = 200;
export const MAX_USER_LENGTH = 32;

// Kontrol karakterleri, yön değiştiriciler (bidi) ve görünmez dolgu karakterleri.
// ZWJ (U+200D) ve U+FE0F korunur: birleşik emojiler bunlarla oluşur.
const INVISIBLE =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0\uFFF0-\uFFFB]/g;
// Etiket karakterleri spam için kullanılır; yalnızca bayrak emojisinin içindekiler kalır.
const TAG_CHARS = /(\u{1F3F4}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]+\u{E007F})|[\u{E0000}-\u{E0FFF}]/gu;
const LONE_SURROGATE = /[\uD800-\uDFFF]/gu;
const LINE_BREAKS = /[\t\n\r\u2028\u2029]/g;
// Zalgo metni: bir harfin üstüne yığılan işaretleri dört ile sınırlar.
const MARK_STACK = /(\p{M}{4})\p{M}+/gu;
const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;

const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

// Metni emojiyi ortadan bölmeden keser; sınır görünen karakter sayısıdır.
function truncate(text, maxLength) {
  const parts = [];
  if (segmenter) {
    for (const { segment } of segmenter.segment(text)) {
      parts.push(segment);
      if (parts.length > maxLength) break;
    }
  } else {
    for (const char of text) {
      parts.push(char);
      if (parts.length > maxLength) break;
    }
  }
  if (parts.length <= maxLength) return text;
  return `${parts.slice(0, Math.max(1, maxLength - 1)).join('').trimEnd()}…`;
}

/**
 * Sohbet metnini ekranda göstermeye uygun düz metne çevirir.
 * @param {unknown} value ham metin
 * @param {{maxLength?: number, hideLinks?: boolean}} [options]
 * @returns {string}
 */
export function sanitizeText(value, { maxLength = DEFAULT_MAX_LENGTH, hideLinks = false } = {}) {
  if (typeof value !== 'string' || value.length === 0) return '';
  // Çok uzun girdide işlem süresini sınırlamak için önce kaba bir kesim yapılır.
  let text = value.length > maxLength * 8 + 256 ? value.slice(0, maxLength * 8 + 256) : value;
  text = text
    .replace(LONE_SURROGATE, '')
    .replace(LINE_BREAKS, ' ')
    .replace(INVISIBLE, '')
    .replace(TAG_CHARS, (_, flag) => flag ?? '')
    .normalize('NFC')
    .replace(MARK_STACK, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
  if (hideLinks) text = text.replace(LINK, '[link]');
  return truncate(text, maxLength);
}

/** Kullanıcı adını temizler; boş kalırsa "anonymous" döner. */
export function sanitizeUser(value) {
  return sanitizeText(value, { maxLength: MAX_USER_LENGTH }) || 'anonymous';
}

/** Yalnızca #rrggbb biçimini kabul eder, aksi halde null döner. */
export function sanitizeColor(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Koyu kullanıcı renklerini koyu panelde okunacak kadar açar. */
export function readableColor(hex) {
  const clean = sanitizeColor(hex);
  if (!clean) return null;
  const channels = [1, 3, 5].map((i) => parseInt(clean.slice(i, i + 2), 16));
  const luminance = (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255;
  if (luminance >= 0.45) return clean;
  const mix = 0.45 - luminance + 0.1;
  const lifted = channels.map((c) => Math.round(c + (255 - c) * mix));
  return `#${lifted.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
