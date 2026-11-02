// Made By FALCREB
// Köprü adresi doğrulaması, CSP kuralları ve varsayılan davranışın (yalnızca Twitch) korunması.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildOverlayUrl,
  overlayConnectSrc,
  parseConfig,
  parseKickBridge,
  parseKickKey,
  resolveKickBridge,
} from '../src/core/config.js';

const KEY = 'AbC_-'.repeat(9);

test('Köprü adresi: geçerliler wss kökenine çevrilir', () => {
  assert.equal(parseKickBridge('https://neon.me.workers.dev'), 'wss://neon.me.workers.dev');
  assert.equal(parseKickBridge('  https://NEON.me.workers.dev/ '), 'wss://neon.me.workers.dev');
  assert.equal(parseKickBridge('wss://neon.me.workers.dev'), 'wss://neon.me.workers.dev');
  assert.equal(parseKickBridge('https://bridge.test:8443'), 'wss://bridge.test:8443');
});

test('Köprü adresi: CSP enjeksiyonu ve şüpheli biçimler reddedilir', () => {
  const bad = [
    'http://neon.dev',
    'ws://neon.dev',
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///c:/x',
    'https://user:pw@neon.dev',
    'https://neon.dev/webhook',
    'https://neon.dev/?a=1',
    'https://neon.dev/#a',
    'https://neon.dev;script-src',
    "https://neon.dev;connect-src'*",
    'https://neon.dev,evil.dev',
    'https://neon.dev connect-src *',
    'https://*.workers.dev',
    'https://[::1]',
    'https://neon_dev"x',
    'neon.dev',
    '',
    `https://${'a'.repeat(300)}.dev`,
    null,
    42,
  ];
  for (const value of bad) assert.equal(parseKickBridge(value), '', String(value));
  for (const value of bad.filter((item) => typeof item === 'string')) {
    assert.equal(parseConfig(new URLSearchParams({ kick: value })).kick, '');
  }
});

test('Anahtar: yalnızca # bölümünden ve geçerli biçimde okunur', () => {
  assert.equal(parseKickKey(`#kickkey=${KEY}`), KEY);
  assert.equal(parseKickKey(`#kickkey=kisa`), '');
  assert.equal(parseKickKey('#kickkey=<script>alert(1)</script>aaaaaaaaaaaaaaaaaaaaa'), '');
  assert.equal(parseKickKey(''), '');
  assert.equal(parseKickKey(undefined), '');
});

test('Anahtar sorguda aranırsa okunmaz, kullanıcı uyarılır', () => {
  const config = parseConfig(`kickkey=${KEY}&twitch=abc`);
  assert.deepEqual(config.ignoredSensitive, ['kickkey']);
  assert.equal(JSON.stringify(config).includes(KEY), false);
});

test('Varsayılan: Kick ayarlı değilse bağlantı eski overlay sayfasına gider ve Kick izi taşımaz', () => {
  const config = parseConfig('twitch=abc');
  assert.equal(config.kick, '');
  assert.equal(resolveKickBridge(config), '');
  const url = buildOverlayUrl('https://x.test/app/', config, { kickKey: KEY });
  assert.equal(url, 'https://x.test/app/overlay.html?twitch=abc');
});

test('Bağlantı: Kick ayarlıysa ayrı sayfaya gider, anahtar yalnızca # bölümündedir', () => {
  const config = parseConfig('twitch=abc&kick=https://neon.me.workers.dev');
  const url = new URL(buildOverlayUrl('https://x.test/app/', config, { kickKey: KEY }));
  assert.equal(url.pathname, '/app/overlay-kick.html');
  assert.equal(url.searchParams.get('kick'), 'wss://neon.me.workers.dev');
  assert.equal(url.search.includes(KEY), false);
  assert.equal(url.hash, `#kickkey=${KEY}`);
  // Üretilen bağlantı aynı ayarlara geri çözülür.
  assert.equal(parseConfig(url.search).kick, 'wss://neon.me.workers.dev');
  assert.equal(parseKickKey(url.hash), KEY);
});

test('Demo modu Kick dahil gerçek bağlantıları kapatır ve anahtarı yazmaz', () => {
  const config = parseConfig('demo=1&twitch=abc&kick=https://neon.me.workers.dev');
  assert.equal(resolveKickBridge(config), '');
  const url = new URL(buildOverlayUrl('https://x.test/', config, { kickKey: KEY }));
  assert.equal(url.pathname, '/overlay.html');
  assert.equal(url.hash, '');
});

test('CSP kilidi: yalnızca kullanılan adresler yazılır, joker karakter olmaz', () => {
  const kick = 'wss://neon.me.workers.dev';
  const twitch = 'wss://irc-ws.chat.twitch.tv';
  assert.equal(overlayConnectSrc({ twitch: '', kick: '' }), "'none'");
  assert.equal(overlayConnectSrc({ twitch: 'abc', kick: '' }), twitch);
  assert.equal(overlayConnectSrc({ twitch: '', kick }), kick);
  assert.equal(overlayConnectSrc({ twitch: 'abc', kick }), `${twitch} ${kick}`);
  // Geçersiz köprü hiçbir zaman politikaya ulaşamaz.
  const hostile = resolveKickBridge(parseConfig('kick=https://a.dev;script-src%20*'));
  assert.equal(overlayConnectSrc({ twitch: '', kick: hostile }), "'none'");
});

test('Statik CSP: varsayılan overlay yalnızca Twitch soketine izin verir, Kick sayfası yalnızca wss:', () => {
  const vite = readFileSync('vite.config.js', 'utf8');
  assert.match(vite, /overlay: \[\.\.\.BASE_CSP, 'connect-src wss:\/\/irc-ws\.chat\.twitch\.tv'\]/);
  assert.match(vite, /'overlay-kick': \[\.\.\.BASE_CSP, 'connect-src wss:'\]/);
  assert.match(vite, /config: \[\.\.\.BASE_CSP, "connect-src 'none'"/);
  assert.match(vite, /"default-src 'none'"/);
});

test('Sayfalar: varsayılan overlay Kick girişini yüklemez, Kick kodu yalnızca dinamik yüklenir', () => {
  assert.match(readFileSync('overlay.html', 'utf8'), /src="\/src\/overlay\/main\.js"/);
  assert.equal(/kick/i.test(readFileSync('overlay.html', 'utf8')), false);
  assert.match(readFileSync('overlay-kick.html', 'utf8'), /src="\/src\/overlay\/kick-entry\.js"/);
  const main = readFileSync('src/overlay/main.js', 'utf8');
  assert.equal(/^import .*kick-bridge/m.test(main), false, 'statik import olmamalı');
  assert.match(main, /import\('\.\.\/adapters\/kick-bridge\.js'\)/);
  // Kilit, overlay kodu yüklenmeden önce çalışır.
  const entry = readFileSync('src/overlay/kick-entry.js', 'utf8');
  assert.ok(entry.indexOf('lockConnectSrc();') < entry.indexOf("import('./main.js')"));
  assert.equal(/^import .*main\.js/m.test(entry), false);
});

test('Kaynak taraması: köprüde tehlikeli çağrı, günlük ve gömülü anahtar yoktur', () => {
  const jsFiles = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return jsFiles(path);
      return /\.m?js$/.test(entry.name) ? [path] : [];
    });
  const forbidden = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|srcdoc/;
  const bridgeSrc = jsFiles('kick-bridge/src');
  assert.ok(bridgeSrc.length >= 6);
  for (const file of [...bridgeSrc, ...jsFiles('kick-bridge/scripts')]) {
    const source = readFileSync(file, 'utf8');
    assert.equal(forbidden.test(source), false, file);
    assert.equal(/BEGIN (RSA |EC )?PRIVATE KEY/.test(source), false, file);
    assert.equal(/BEGIN PUBLIC KEY-----\s*MII/.test(source), false, `${file}: anahtar gömülmemeli`);
  }
  for (const file of bridgeSrc) {
    assert.equal(/\bconsole\./.test(readFileSync(file, 'utf8')), false, `${file}: günlük yazılmamalı`);
  }
  // Pusher ve belgelenmemiş uçlar kullanılmaz.
  const all = [...bridgeSrc, ...jsFiles('kick-bridge/scripts'), ...jsFiles('src')]
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  assert.equal(/pusher|kick\.com\/api\/v|\/api\/v[12]\/channels/i.test(all), false);
});

test('Wrangler ayarı: gizli değer içermez, günlükler kapalıdır, SQLite sınıfı kullanılır', () => {
  const toml = readFileSync('kick-bridge/wrangler.toml', 'utf8');
  assert.equal(/^\s*(OVERLAY_KEY|BROADCASTER_USER_ID|KICK_CLIENT)/m.test(toml), false);
  assert.match(toml, /\[observability\]\s*\nenabled = false/);
  assert.match(toml, /new_sqlite_classes = \["BridgeHub"\]/);
  assert.match(toml, /workers_dev = true/);
});
