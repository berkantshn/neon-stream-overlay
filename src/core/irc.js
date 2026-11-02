// Made By FALCREB
// Twitch IRC satırlarını çözer ve ortak mesaj biçimine çevirir.

const TAG_ESCAPES = { ':': ';', s: ' ', '\\': '\\', r: '\r', n: '\n' };

function unescapeTag(value) {
  return value.replace(/\\(.?)/g, (_, char) => TAG_ESCAPES[char] ?? char);
}

/**
 * Tek bir IRC satırını parçalarına ayırır. Bozuk satırda null döner.
 * @param {string} line
 */
export function parseIrcLine(line) {
  if (typeof line !== 'string') return null;
  let rest = line.replace(/\r?\n$/, '');
  if (!rest) return null;
  const tags = {};
  if (rest[0] === '@') {
    const end = rest.indexOf(' ');
    if (end === -1) return null;
    for (const pair of rest.slice(1, end).split(';')) {
      const eq = pair.indexOf('=');
      if (eq === -1) tags[pair] = '';
      else tags[pair.slice(0, eq)] = unescapeTag(pair.slice(eq + 1));
    }
    rest = rest.slice(end + 1);
  }
  let prefix = '';
  if (rest[0] === ':') {
    const end = rest.indexOf(' ');
    if (end === -1) return null;
    prefix = rest.slice(1, end);
    rest = rest.slice(end + 1);
  }
  const trailingAt = rest.indexOf(' :');
  let trailing = null;
  if (trailingAt !== -1) {
    trailing = rest.slice(trailingAt + 2);
    rest = rest.slice(0, trailingAt);
  } else if (rest[0] === ':') {
    trailing = rest.slice(1);
    rest = '';
  }
  const [command, ...params] = rest.split(' ').filter(Boolean);
  if (!command) return null;
  return { tags, prefix, command: command.toUpperCase(), params, trailing };
}

/** "moderator/1,subscriber/12" biçimindeki rozetleri rozet adlarına çevirir. */
function badgeNames(value) {
  return new Set(
    (value || '')
      .split(',')
      .map((badge) => badge.split('/')[0])
      .filter(Boolean),
  );
}

/**
 * PRIVMSG satırını ortak mesaj biçimine çevirir. Metin burada temizlenmez.
 * Emote etiketleri bilerek kullanılmaz: emote adı düz metin olarak görünür.
 */
export function privmsgToMessage(parsed) {
  if (!parsed || parsed.command !== 'PRIVMSG' || parsed.trailing === null) return null;
  const { tags, prefix } = parsed;
  let text = parsed.trailing;
  let isAction = false;
  const action = /^\u0001ACTION (.*)\u0001$/.exec(text);
  if (action) {
    text = action[1];
    isAction = true;
  }
  const badges = badgeNames(tags.badges);
  // Paylaşımlı sohbette başka kanaldan gelen mesajın yetkisi bu kanalda geçerli sayılmaz.
  const fromOtherRoom =
    Boolean(tags['source-room-id']) && tags['source-room-id'] !== tags['room-id'];
  return {
    id: tags.id || null,
    platform: 'twitch',
    user: tags['display-name'] || prefix.split('!')[0] || '',
    login: prefix.split('!')[0] || '',
    color: tags.color || null,
    text,
    isAction,
    isBroadcaster: !fromOtherRoom && badges.has('broadcaster'),
    isMod: !fromOtherRoom && (tags.mod === '1' || badges.has('moderator')),
    isVip: !fromOtherRoom && badges.has('vip'),
    isSub: badges.has('subscriber') || badges.has('founder'),
    isFirst: tags['first-msg'] === '1',
  };
}
