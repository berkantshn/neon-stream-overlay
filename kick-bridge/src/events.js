// Made By FALCREB
// Kick olayını overlay'e gidecek en küçük biçime indirir. Yalnızca adı geçen alanlar okunur,
// yeni nesne üretilir. Profil resmi, kullanıcı kimliği, yanıtlanan mesaj gibi alanlar hiç iletilmez.

import { sanitizeColor, sanitizeText } from '../../src/core/sanitize.js';

const MAX_TEXT = 500;
const MAX_USER = 32;
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Kick emote'u metin içinde "[emote:123:AD]" olarak gelir. Overlay görsel yüklemez, adı yazı olarak kalır.
const EMOTE = /\[emote:\d{1,20}:([^\]\s]{1,64})\]/g;
// Kick belgesindeki örnekte "moderator" rozeti geçer. "broadcaster" ve "vip" belgede örneklenmemiştir,
// gelmezse yalnızca etiket görünmez. Yayıncı ayrıca kullanıcı kimliğinden anlaşılır.
const ROLE_BY_BADGE = [
  ['broadcaster', 'host'],
  ['moderator', 'mod'],
  ['vip', 'vip'],
];

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function cleanName(person) {
  if (!isObject(person) || person.is_anonymous === true) return '';
  return sanitizeText(person.username, { maxLength: MAX_USER });
}

function roleOf(sender, broadcaster) {
  if (sender.user_id === broadcaster.user_id) return 'host';
  const badges = sender.identity?.badges;
  if (!Array.isArray(badges)) return null;
  const types = new Set(badges.slice(0, 20).map((badge) => badge?.type));
  return ROLE_BY_BADGE.find(([type]) => types.has(type))?.[1] ?? null;
}

function chatFrame(body) {
  const { message_id: id, sender, broadcaster, content } = body;
  if (typeof id !== 'string' || !MESSAGE_ID.test(id) || !isObject(sender)) return null;
  if (typeof content !== 'string') return null;
  const text = sanitizeText(content.replace(EMOTE, '$1'), { maxLength: MAX_TEXT });
  const user = cleanName(sender);
  if (!text || !user) return null;
  const frame = { v: 1, t: 'msg', id, user, text };
  const color = sanitizeColor(sender.identity?.username_color);
  if (color) frame.color = color;
  const role = roleOf(sender, broadcaster);
  if (role) frame.role = role;
  return frame;
}

function banFrame(body) {
  const user = cleanName(body.banned_user);
  return user ? { v: 1, t: 'ban', user } : null;
}

const FRAME_BUILDERS = {
  'chat.message.sent': chatFrame,
  'moderation.banned': banFrame,
};

/**
 * @returns {object|null} iletilecek çerçeve; bilinmeyen, bozuk veya başka yayıncıya ait olayda null
 * Olay türü başlığı imzaya dahil değildir. Bu yüzden her tür kendi gövde biçimini doğrular.
 */
export function buildFrame(type, version, body, broadcasterId) {
  if (version !== '1' || !isObject(body) || !Object.hasOwn(FRAME_BUILDERS, type)) return null;
  if (!isObject(body.broadcaster) || body.broadcaster.user_id !== broadcasterId) return null;
  return FRAME_BUILDERS[type](body);
}
