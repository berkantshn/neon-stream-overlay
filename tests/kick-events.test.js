// Made By FALCREB
// Abonelik betiği sahte Kick sunucusuyla denenir; gerçek Kick'e istek gitmez, gerçek kimlik kullanılmaz.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKickClient, EVENTS, main } from '../kick-bridge/scripts/kick-events.mjs';

const FAKE_ID = 'fake-client-id';
const FAKE_SECRET = 'fake-client-secret-value';
const FAKE_TOKEN = 'fake-access-token-value';
const BASES = { api: 'https://api.test', id: 'https://id.test' };

function fakeKick(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, init });
    const route = `${init.method ?? 'GET'} ${parsed.pathname}`;
    if (overrides[route]) return overrides[route](parsed, init);
    switch (route) {
      case 'POST /oauth/token':
        return Response.json({ access_token: FAKE_TOKEN, token_type: 'Bearer', expires_in: 3600 });
      case 'GET /public/v1/channels':
        return Response.json({ data: [{ broadcaster_user_id: 555, slug: parsed.searchParams.get('slug') }] });
      case 'POST /public/v1/events/subscriptions':
        return Response.json({
          data: EVENTS.map((event) => ({ name: event.name, version: event.version, subscription_id: '01X' })),
        });
      case 'GET /public/v1/events/subscriptions':
        return Response.json({ data: [{ id: 'S1', event: 'chat.message.sent', version: 1, method: 'webhook' }, { id: 'S2', event: 'moderation.banned', version: 1, method: 'webhook' }] });
      case 'DELETE /public/v1/events/subscriptions':
        return new Response(null, { status: 204 });
      case 'POST /oauth/revoke':
        return new Response('OK');
      default:
        return new Response('nope', { status: 404 });
    }
  };
  return { calls, fetchImpl };
}

async function run(command, kick, channel = 'MyChannel') {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await main(command, {
      env: { KICK_CLIENT_ID: FAKE_ID, KICK_CLIENT_SECRET: FAKE_SECRET, KICK_CHANNEL: channel },
      fetchImpl: kick.fetchImpl,
      bases: BASES,
    });
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

test('Abonelik: istemci kimliğiyle token alır, doğru gövdeyi gönderir, token iptal edilir', async () => {
  const kick = fakeKick();
  const output = await run('subscribe', kick);
  const [login, lookup, subscribe, revoke] = kick.calls;

  assert.equal(login.url.href, 'https://id.test/oauth/token');
  assert.equal(login.init.body.get('grant_type'), 'client_credentials');
  assert.equal(lookup.url.searchParams.get('slug'), 'mychannel');
  assert.equal(lookup.init.headers.authorization, `Bearer ${FAKE_TOKEN}`);
  assert.deepEqual(JSON.parse(subscribe.init.body), {
    broadcaster_user_id: 555,
    events: [
      { name: 'chat.message.sent', version: 1 },
      { name: 'moderation.banned', version: 1 },
    ],
    method: 'webhook',
  });
  assert.equal(revoke.url.pathname, '/oauth/revoke');
  assert.equal(revoke.url.searchParams.get('token'), FAKE_TOKEN);

  assert.match(output, /BROADCASTER_USER_ID for mychannel: 555/);
  assert.equal(output.includes(FAKE_SECRET), false);
  assert.equal(output.includes(FAKE_TOKEN), false);
});

test('Abonelik: yalnızca sohbet ve ban olayları istenir', () => {
  assert.deepEqual(EVENTS.map((event) => event.name), ['chat.message.sent', 'moderation.banned']);
});

test('Listeleme ve iptal: abonelikler kimlikle silinir', async () => {
  const listKick = fakeKick();
  assert.match(await run('list', listKick), /2 subscription/);
  const removeKick = fakeKick();
  assert.match(await run('unsubscribe', removeKick), /Removed 2/);
  const removal = removeKick.calls.find(({ init }) => init.method === 'DELETE');
  assert.deepEqual(removal.url.searchParams.getAll('id'), ['S1', 'S2']);
});

test('Hata: mesajda gizli değer ve sunucu yanıtı görünmez, token yine iptal edilir', async () => {
  const kick = fakeKick({
    'POST /public/v1/events/subscriptions': () => new Response(`leak ${FAKE_TOKEN}`, { status: 403 }),
  });
  await assert.rejects(run('subscribe', kick), (error) => {
    assert.match(error.message, /HTTP 403/);
    assert.equal(error.message.includes(FAKE_TOKEN), false);
    return true;
  });
  assert.equal(kick.calls.at(-1).url.pathname, '/oauth/revoke');

  const denied = fakeKick({ 'POST /oauth/token': () => new Response('bad', { status: 401 }) });
  await assert.rejects(run('list', denied), /Client ID and Client Secret/);
  assert.equal(denied.calls.length, 1);
});

test('Girdi: bilinmeyen komut ve hatalı kanal adı ağa çıkmaz', async () => {
  const kick = fakeKick();
  await assert.rejects(run('delete-everything', kick));
  await assert.rejects(run('list', kick, 'https://kick.com/abc'), /Channel name/);
  assert.equal(kick.calls.length, 0);
});

test('Kanal bulunamazsa açık hata verir', async () => {
  const client = createKickClient({
    clientId: FAKE_ID,
    clientSecret: FAKE_SECRET,
    fetchImpl: fakeKick({ 'GET /public/v1/channels': () => Response.json({ data: [] }) }).fetchImpl,
    bases: BASES,
  });
  await client.login();
  await assert.rejects(client.channelId('yok'), /not found/);
});
