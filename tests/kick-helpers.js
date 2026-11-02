// Made By FALCREB
// Kick yerine geçen yerel test anahtarı ve imzalı webhook üretici. Gerçek Kick anahtarı kullanılmaz.
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';

export const BROADCASTER_ID = 123456789;

export function testKeyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

let counter = 0;
export function nextId() {
  counter += 1;
  return `01TEST${String(counter).padStart(20, '0')}`;
}

export function signBody(privateKey, id, timestamp, body) {
  return sign('sha256', Buffer.from(`${id}.${timestamp}.${body}`), privateKey).toString('base64');
}

export function chatPayload(overrides = {}) {
  return {
    message_id: `msg_${randomBytes(6).toString('hex')}`,
    broadcaster: { is_anonymous: false, user_id: BROADCASTER_ID, username: 'streamer', channel_slug: 'streamer' },
    sender: {
      is_anonymous: false,
      user_id: 987654321,
      username: 'Viewer_One',
      is_verified: false,
      profile_picture: 'https://example.com/private.jpg',
      channel_slug: 'viewer_one',
      identity: {
        username_color: '#FF5733',
        badges: [{ text: 'Moderator', type: 'moderator' }],
      },
    },
    content: 'Hello [emote:4148074:HYPERCLAP] chat',
    emotes: [{ emote_id: '4148074', positions: [{ s: 6, e: 30 }] }],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function banPayload(username = 'Viewer_One') {
  return {
    broadcaster: { user_id: BROADCASTER_ID, username: 'streamer' },
    moderator: { user_id: 5, username: 'a_mod' },
    banned_user: { user_id: 987654321, username },
    metadata: { reason: 'private reason', created_at: new Date().toISOString(), expires_at: null },
  };
}

/** İmzalı webhook isteğinin parçalarını üretir. */
export function signedDelivery(privateKey, payload, overrides = {}) {
  const id = overrides.id ?? nextId();
  const timestamp = overrides.timestamp ?? new Date().toISOString();
  const type = overrides.type ?? (payload.banned_user ? 'moderation.banned' : 'chat.message.sent');
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'kick-event-message-id': id,
      'kick-event-subscription-id': '01SUBSCRIPTION',
      'kick-event-signature': signBody(privateKey, id, timestamp, body),
      'kick-event-message-timestamp': timestamp,
      'kick-event-type': type,
      'kick-event-version': overrides.version ?? '1',
    },
  };
}
