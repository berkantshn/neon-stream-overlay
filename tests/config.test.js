// Made By FALCREB
// URL parametreleri ve bağlantı üretimi.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOverlayUrl,
  parseConfig,
  resolveColors,
  resolveSources,
  THEMES,
  toSearchParams,
} from '../src/core/config.js';

const PAGE = 'https://example.github.io/neon-stream-overlay/';

test('parametresiz ayar güvenli varsayılan döner', () => {
  const config = parseConfig('');
  assert.equal(config.demo, false);
  assert.equal(config.twitch, '');
  assert.deepEqual(config.commands, ['!hype']);
  assert.equal(config.credit, true);
  assert.equal(config.motion, 'auto');
});

test('Twitch kanal adı doğrulanır, enjeksiyon reddedilir', () => {
  assert.equal(parseConfig('twitch=My_Chan').twitch, 'my_chan');
  assert.equal(parseConfig('twitch=%23chan').twitch, 'chan');
  assert.equal(parseConfig('twitch=@chan').twitch, 'chan');
  assert.equal(parseConfig(`twitch=${encodeURIComponent('https://www.twitch.tv/chan/')}`).twitch, 'chan');
  for (const bad of ['chan%0D%0APRIVMSG', 'a b', 'oauth:abcd', 'x'.repeat(26), '<script>']) {
    assert.equal(parseConfig(`twitch=${bad}`).twitch, '');
  }
});

test('demo modu gerçek bağlantıları kapatır', () => {
  const sources = resolveSources(parseConfig('demo=1&twitch=chan'));
  assert.deepEqual(sources, { demo: true, twitch: '' });
});

test('sayılar sınırlanır, geçersiz sayı varsayılana döner', () => {
  assert.equal(parseConfig('font=9999').font, 40);
  assert.equal(parseConfig('font=1').font, 12);
  assert.equal(parseConfig('font=abc').font, 18);
  assert.equal(parseConfig('max=1e9').max, 12);
  assert.equal(parseConfig('maxlen=-5').maxlen, 20);
});

test('tema ve renkler doğrulanır', () => {
  assert.deepEqual(resolveColors(parseConfig('theme=magma')), THEMES.magma);
  assert.deepEqual(resolveColors(parseConfig('theme=__proto__')), THEMES.cyber);
  assert.equal(parseConfig(`c1=${encodeURIComponent('red;x:url(y)')}`).c1, null);
  const custom = resolveColors(parseConfig('c1=%23112233'));
  assert.equal(custom.c1, '#112233');
  assert.equal(custom.c2, THEMES.cyber.c2);
});

test('listeler temizlenir, tekrarlar atılır, sınırlanır', () => {
  assert.deepEqual(parseConfig('commands=hype,!HYPE,!!boom x,,').commands, ['!hype', '!boom']);
  assert.deepEqual(parseConfig('keywords=GG,gg, ').keywords, ['GG']);
  const many = Array.from({ length: 50 }, (_, i) => `k${i}`).join(',');
  assert.equal(parseConfig(`keywords=${many}`).keywords.length, 20);
});

test('boş commands parametresi komutları kapatır', () => {
  assert.deepEqual(parseConfig('commands=').commands, []);
});

test('parola benzeri parametreler okunmaz ve üretilen bağlantıya geçmez', () => {
  const config = parseConfig('twitch=chan&oauth=abc&token=def&password=ghi&access_token=j&utm=x');
  assert.deepEqual(config.ignoredSensitive, ['oauth', 'token', 'password', 'access_token']);
  const url = buildOverlayUrl(PAGE, config);
  for (const value of ['abc', 'def', 'ghi', 'oauth', 'token', 'password', 'utm']) {
    assert.equal(url.includes(value), false);
  }
});

test('bağlantı gidiş-dönüşte aynı ayarları verir', () => {
  const search =
    'twitch=chan&theme=toxic&c1=%23112233&panel=40&font=22&w=500&pos=tr&max=8&fade=30&maxlen=120' +
    '&ignore=bot1,bot2&hidecmd=1&hidelinks=1&commands=!hype,!boom&keywords=gg&highlights=win' +
    '&fxby=mods&cooldown=3&modkw=1&motion=reduced&quality=low&credit=0&status=0';
  const config = parseConfig(search);
  const url = new URL(buildOverlayUrl(PAGE, config));
  assert.equal(url.pathname, '/neon-stream-overlay/overlay.html');
  assert.deepEqual(parseConfig(url.search), config);
});

test('varsayılan değerler bağlantıya yazılmaz', () => {
  assert.equal(toSearchParams(parseConfig('')).toString(), '');
});

test('üretilen bağlantıdaki özel karakterler kodlanır', () => {
  const url = buildOverlayUrl(PAGE, parseConfig(`keywords=${encodeURIComponent('a&b=c#d')}`));
  assert.deepEqual(parseConfig(new URL(url).search).keywords, ['a&b=c#d']);
});
