// Made By FALCREB
// Kick'in resmi uçlarıyla webhook aboneliğini yönetir. Yayıncının kendi bilgisayarında çalışır.
// Client secret ve token yalnızca bellekte durur; dosyaya, ekrana veya köprüye yazılmaz.
// Kullanım: node scripts/kick-events.mjs subscribe | list | unsubscribe

import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export const EVENTS = [
  { name: 'chat.message.sent', version: 1 },
  { name: 'moderation.banned', version: 1 },
];
const SLUG = /^[a-z0-9_-]{1,64}$/;
const DEFAULT_BASES = { api: 'https://api.kick.com', id: 'https://id.kick.com' };

/** Sunucu yanıtını yalnızca durum koduyla özetler; gövde hata mesajına kopyalanmaz. */
function expectOk(response, label) {
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
}

export function createKickClient({ clientId, clientSecret, fetchImpl = fetch, bases = DEFAULT_BASES }) {
  let token = '';
  const authorized = () => ({ authorization: `Bearer ${token}`, accept: 'application/json' });

  return {
    async login() {
      const response = await fetchImpl(`${bases.id}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
      expectOk(response, 'Kick login (check Client ID and Client Secret)');
      token = (await response.json()).access_token;
      if (!token) throw new Error('Kick login returned no token');
    },
    async channelId(slug) {
      const query = new URLSearchParams({ slug });
      const response = await fetchImpl(`${bases.api}/public/v1/channels?${query}`, { headers: authorized() });
      expectOk(response, 'Channel lookup');
      const id = (await response.json()).data?.[0]?.broadcaster_user_id;
      if (!Number.isSafeInteger(id)) throw new Error(`Channel "${slug}" was not found`);
      return id;
    },
    async subscribe(broadcasterUserId) {
      const response = await fetchImpl(`${bases.api}/public/v1/events/subscriptions`, {
        method: 'POST',
        headers: { ...authorized(), 'content-type': 'application/json' },
        body: JSON.stringify({ broadcaster_user_id: broadcasterUserId, events: EVENTS, method: 'webhook' }),
      });
      expectOk(response, 'Subscribe');
      return (await response.json()).data ?? [];
    },
    async list(broadcasterUserId) {
      const query = new URLSearchParams({ broadcaster_user_id: String(broadcasterUserId) });
      const response = await fetchImpl(`${bases.api}/public/v1/events/subscriptions?${query}`, {
        headers: authorized(),
      });
      expectOk(response, 'List subscriptions');
      return (await response.json()).data ?? [];
    },
    async unsubscribe(ids) {
      if (ids.length === 0) return;
      const query = new URLSearchParams(ids.map((id) => ['id', id]));
      const response = await fetchImpl(`${bases.api}/public/v1/events/subscriptions?${query}`, {
        method: 'DELETE',
        headers: authorized(),
      });
      expectOk(response, 'Unsubscribe');
    },
    // İş bitince kısa ömürlü token iptal edilir. Kick belgesi token'ı sorgu parametresi olarak ister.
    async logout() {
      if (!token) return;
      const query = new URLSearchParams({ token, token_hint_type: 'access_token' });
      token = '';
      await fetchImpl(`${bases.id}/oauth/revoke?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }).catch(() => {});
    },
  };
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Yazılan secret ekranda görünmesin diye yankı kapatılır.
      rl._writeToOutput = (text) => {
        if (text.includes(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

export async function main(command, { env = process.env, fetchImpl = fetch, bases = DEFAULT_BASES } = {}) {
  if (!['subscribe', 'list', 'unsubscribe'].includes(command)) {
    throw new Error('Use: subscribe, list or unsubscribe');
  }
  const clientId = env.KICK_CLIENT_ID || (await ask('Kick Client ID: '));
  const clientSecret = env.KICK_CLIENT_SECRET || (await ask('Kick Client Secret (hidden): ', { hidden: true }));
  const slug = (env.KICK_CHANNEL || (await ask('Your Kick channel name: '))).toLowerCase();
  if (!clientId || !clientSecret) throw new Error('Client ID and Client Secret are required');
  if (!SLUG.test(slug)) throw new Error('Channel name looks wrong. Use only the last part of your Kick URL');

  const client = createKickClient({ clientId, clientSecret, fetchImpl, bases });
  try {
    await client.login();
    const id = await client.channelId(slug);
    console.log(`\nBROADCASTER_USER_ID for ${slug}: ${id}`);
    if (command === 'subscribe') {
      for (const item of await client.subscribe(id)) {
        console.log(item.error ? `  ${item.name}: FAILED (${item.error})` : `  ${item.name}: subscribed`);
      }
      console.log('Kick can take a short while to list a new subscription. Check with "pnpm run list" later.');
    } else {
      const current = await client.list(id);
      if (command === 'unsubscribe') {
        await client.unsubscribe(current.map((item) => item.id));
        console.log(`Removed ${current.length} subscription(s).`);
      } else {
        for (const item of current) console.log(`  ${item.event} v${item.version} (${item.method})`);
        console.log(`${current.length} subscription(s).`);
      }
    }
  } finally {
    await client.logout();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
