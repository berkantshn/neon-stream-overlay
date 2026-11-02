// Made By FALCREB
// Uçtan uca yerel deneme: resmi Cloudflare yerel çalışma ortamı (wrangler dev) + başsız Chrome + derlenmiş overlay.
// Kick'e, Twitch'e veya Cloudflare hesabına bağlanmaz. Kick yerine yerel üretilen anahtarla imzalanmış sahte webhook gönderir.
// Ön koşul: kök klasörde ve kick-bridge içinde "pnpm install", ardından "pnpm build".
// Kullanım: pnpm test:e2e   (Chrome başka yerdeyse CHROME_PATH verin; ekran görüntüsü için E2E_SHOT=dosya.png)

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { banPayload, BROADCASTER_ID, chatPayload, signedDelivery, testKeyPair } from '../kick-helpers.js';

// Yerel wrangler kendinden imzalı sertifika kullanır; bu yalnızca bu test sürecini etkiler.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.removeAllListeners('warning');

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist');
// Windows'ta çok uzun klasör yolunda workerd başlatılamaz; gerekirse kısa yoldaki kopya gösterilir.
const BRIDGE_DIR = process.env.E2E_BRIDGE_DIR ?? join(ROOT, 'kick-bridge');
const OVERLAY_KEY = randomBytes(32).toString('base64url');
const KEYS = testKeyPair();
const OTHER_KEYS = testKeyPair();
const TEMP = mkdtempSync(join(tmpdir(), 'neon-e2e-'));
const cleanups = [];
let passed = 0;
let failed = 0;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitFor(check, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(100);
  }
}

async function step(name, body) {
  try {
    await body();
    passed += 1;
    console.log(`ok   - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL - ${name}\n       ${error.message}`);
  }
}

function freePort() {
  return new Promise((done, fail) => {
    const server = createNetServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = candidates.find((path) => path && existsSync(path));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH.');
  return found;
}

// dist klasörünü statik sunar: GitHub Pages'in davranışına benzer, ek başlık eklemez.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serveDist() {
  const requests = [];
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://x');
    requests.push(request.url);
    const file = join(DIST, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(DIST) || !existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      cleanups.push(() => server.close());
      done({ origin: `http://127.0.0.1:${server.address().port}`, requests });
    });
  });
}

// Wrangler ve Chrome alt süreç açar. Windows'ta yalnızca ana süreci kapatmak bunları açık bırakır.
function killTree(child) {
  return new Promise((done) => {
    if (child.exitCode !== null) {
      done();
      return;
    }
    child.once('exit', () => done());
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500);
    }
  });
}

function startWrangler(port) {
  const vars = join(TEMP, 'bridge.vars');
  writeFileSync(
    vars,
    [
      `OVERLAY_KEY=${OVERLAY_KEY}`,
      `BROADCASTER_USER_ID=${BROADCASTER_ID}`,
      `KICK_PUBLIC_KEY_PEM="${KEYS.publicKey.replace(/\r?\n/g, '\\n')}"`,
      '',
    ].join('\n'),
  );
  const logs = [];
  const entry = join(BRIDGE_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const child = spawn(
    process.execPath,
    [
      entry, 'dev',
      '--ip', '127.0.0.1',
      '--port', String(port),
      '--local-protocol', 'https',
      '--env-file', vars,
      '--persist-to', join(TEMP, 'state'),
      '--show-interactive-dev-session=false',
    ],
    {
      cwd: BRIDGE_DIR,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NODE_TLS_REJECT_UNAUTHORIZED: '', CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));
  const stop = () => killTree(child);
  cleanups.push(stop);
  return { logs, stop, child };
}

// Puppeteer eklememek için Chrome DevTools Protocol, Node'un yerleşik WebSocket'i ile konuşulur.
class Cdp {
  static async attach(browserPort, url) {
    const target = await (
      await fetch(`http://127.0.0.1:${browserPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
    ).json();
    const cdp = new Cdp(target);
    await cdp.open();
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.navigate', { url });
    return cdp;
  }
  constructor(target) {
    this.target = target;
    this.nextId = 1;
    this.pending = new Map();
    this.sockets = [];
    this.requests = [];
    this.dialogs = 0;
    this.logs = [];
  }
  open() {
    this.ws = new WebSocket(this.target.webSocketDebuggerUrl);
    this.ws.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        this.pending.get(message.id)?.(message);
        this.pending.delete(message.id);
      } else if (message.method === 'Network.webSocketCreated') {
        this.sockets.push(message.params.url);
      } else if (message.method === 'Network.requestWillBeSent') {
        this.requests.push(message.params.request.url);
      } else if (message.method === 'Page.javascriptDialogOpening') {
        this.dialogs += 1;
      } else if (message.method === 'Log.entryAdded') {
        this.logs.push(message.params.entry.text);
      }
    });
    return new Promise((done, fail) => {
      this.ws.addEventListener('open', done, { once: true });
      this.ws.addEventListener('error', fail, { once: true });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((done) => this.pending.set(id, done));
  }
  async eval(expression) {
    const { result } = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result?.result?.value;
  }
  close() {
    this.ws.close();
  }
}

const PAGE_STATE = `JSON.stringify({
  rows: [...document.querySelectorAll('#messages .msg')].map((row) => ({
    id: row.dataset.id,
    user: row.querySelector('.msg-user').textContent,
    text: row.querySelector('.msg-text').textContent,
    tag: row.querySelector('.msg-tag')?.textContent ?? null,
  })),
  status: document.getElementById('status').hidden ? null : document.getElementById('status').textContent,
  level: document.getElementById('status').dataset.level ?? null,
  injected: document.querySelectorAll('#messages img, #messages script, #messages svg, #messages b').length,
  metaCsp: [...document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')].map((meta) => meta.content),
})`;
const stateOf = async (cdp) => JSON.parse(await cdp.eval(PAGE_STATE));

// Sayfa içinden bağlantı denemesi: CSP engellerse securitypolicyviolation olayı yakalanır.
const tryConnect = (kind, url) => `new Promise((done) => {
  const onViolation = (event) => done('blocked:' + event.violatedDirective);
  document.addEventListener('securitypolicyviolation', onViolation, { once: true });
  try {
    ${kind === 'ws' ? `new WebSocket(${JSON.stringify(url)});` : `fetch(${JSON.stringify(url)}).catch(() => {});`}
  } catch (error) {
    done('threw:' + error.name);
  }
  setTimeout(() => done('not-blocked'), 1500);
})`;

async function main() {
  assert.ok(existsSync(join(DIST, 'overlay-kick.html')), 'Run pnpm build first');
  const bridgePort = await freePort();
  const bridgeOrigin = `https://127.0.0.1:${bridgePort}`;
  const wssOrigin = `wss://127.0.0.1:${bridgePort}`;
  const site = await serveDist();
  const wrangler = startWrangler(bridgePort);

  const post = async (payload, overrides = {}, signer = KEYS.privateKey) => {
    const { body, headers } = signedDelivery(signer, payload, overrides);
    return fetch(`${bridgeOrigin}/webhook`, { method: 'POST', body, headers });
  };

  await waitFor(
    async () => {
      if (wrangler.child.exitCode !== null) throw new Error(`wrangler exited:\n${wrangler.logs.join('')}`);
      try {
        return (await fetch(`${bridgeOrigin}/`)).ok;
      } catch {
        return false;
      }
    },
    'wrangler dev start',
    90000,
  );
  console.log(`wrangler dev is up at ${bridgeOrigin} (workerd, local only)`);

  const browserPort = await freePort();
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-component-update',
      '--ignore-certificate-errors',
      // Dış ağ kapalıdır: yerel adresler dışındaki her ad çözümlemesi başarısız olur.
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      `--remote-debugging-port=${browserPort}`,
      `--user-data-dir=${join(TEMP, 'chrome')}`,
      '--window-size=900,700',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  cleanups.push(() => killTree(chrome));
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${browserPort}/json/version`)).ok;
    } catch {
      return false;
    }
  }, 'Chrome start');
  const version = await (await fetch(`http://127.0.0.1:${browserPort}/json/version`)).json();
  console.log(`Chrome: ${version.Browser}`);

  const overlayUrl = `${site.origin}/overlay-kick.html?kick=${encodeURIComponent(bridgeOrigin)}&status=1#kickkey=${OVERLAY_KEY}`;
  const page = await Cdp.attach(browserPort, overlayUrl);
  const rows = async () => (await stateOf(page)).rows;

  await step('overlay connects to the bridge and reports it', async () => {
    await waitFor(async () => /connected to your bridge/.test((await stateOf(page)).status ?? ''), 'connected status');
  });

  await step('the WebSocket address never contains the overlay key', () => {
    assert.deepEqual(page.sockets, [`${wssOrigin}/overlay`]);
    assert.equal(site.requests.some((url) => url.includes(OVERLAY_KEY)), false, 'static host must not see the key');
  });

  await step('CSP: the lock narrows connect-src to the one configured bridge', async () => {
    const { metaCsp } = await stateOf(page);
    assert.equal(metaCsp.length, 2);
    assert.ok(metaCsp.includes(`connect-src ${wssOrigin}`));
    assert.ok(metaCsp.some((policy) => policy.includes("default-src 'none'") && policy.includes('connect-src wss:')));
  });

  await step('CSP: other socket origins, https fetch and ws are blocked by the browser', async () => {
    for (const [kind, url] of [
      ['ws', 'wss://example.invalid/'],
      ['ws', 'wss://irc-ws.chat.twitch.tv/'],
      ['ws', `ws://127.0.0.1:${bridgePort}/overlay`],
      ['fetch', `${bridgeOrigin}/`],
      ['fetch', 'https://example.invalid/'],
    ]) {
      const outcome = await page.eval(tryConnect(kind, url));
      assert.match(outcome, /^(blocked:connect-src|threw:SecurityError)/, `${kind} ${url}: ${outcome}`);
    }
  });

  await step('a signed chat message reaches the overlay as minimal plain text', async () => {
    const payload = chatPayload();
    const response = await post(payload);
    assert.equal(response.status, 200);
    await waitFor(async () => (await rows()).some((row) => row.id === payload.message_id), 'message row');
    const row = (await rows()).find((item) => item.id === payload.message_id);
    assert.deepEqual(row, { id: payload.message_id, user: 'Viewer_One', text: 'Hello HYPERCLAP chat', tag: 'MOD' });
  });

  await step('XSS payloads stay visible text and nothing runs', async () => {
    const payloads = ['<img src=x onerror=alert(1)>', '<script>alert(2)</script>', '"><svg/onload=alert(3)>'];
    for (const content of payloads) {
      const sender = { ...chatPayload().sender, username: '<b>Hacker</b>' };
      assert.equal((await post(chatPayload({ content, sender }))).status, 200);
    }
    await waitFor(async () => (await rows()).filter((row) => row.user === '<b>Hacker</b>').length === 3, 'xss rows');
    const state = await stateOf(page);
    for (const content of payloads) assert.ok(state.rows.some((row) => row.text === content), content);
    assert.equal(state.injected, 0);
    assert.equal(page.dialogs, 0);
    assert.equal(await page.eval('document.querySelectorAll("#messages .msg-text > *").length'), 0);
  });

  await step('invalid signature, other key, replay, oversize, bad JSON and other broadcaster show nothing', async () => {
    const before = (await rows()).length;

    assert.equal((await post(chatPayload({ content: 'FORGED' }), {}, OTHER_KEYS.privateKey)).status, 401);

    const delivery = signedDelivery(KEYS.privateKey, chatPayload({ content: 'ONCE' }));
    const once = await fetch(`${bridgeOrigin}/webhook`, { method: 'POST', ...delivery });
    assert.equal(once.status, 200);
    const replay = await fetch(`${bridgeOrigin}/webhook`, { method: 'POST', ...delivery });
    assert.equal(replay.status, 202);
    assert.equal((await replay.json()).status, 'duplicate');

    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const staleReply = await post(chatPayload({ content: 'OLD' }), { timestamp: old });
    assert.equal((await staleReply.json()).status, 'stale');

    assert.equal((await post(chatPayload({ content: 'x'.repeat(40000) }))).status, 413);
    assert.equal((await post('{bozuk json')).status, 400);
    const stranger = chatPayload({ content: 'STRANGER', broadcaster: { user_id: 42 } });
    assert.equal((await (await post(stranger)).json()).status, 'ignored');
    const unknown = await post(chatPayload({ content: 'UNKNOWN' }), { type: 'channel.followed' });
    assert.equal((await unknown.json()).status, 'ignored');

    await sleep(500);
    const after = await rows();
    assert.equal(after.length, before + 1);
    assert.equal(after.filter((row) => row.text === 'ONCE').length, 1);
    for (const text of ['FORGED', 'OLD', 'STRANGER', 'UNKNOWN']) {
      assert.equal(after.some((row) => row.text === text), false, text);
    }
  });

  await step('moderation.banned removes that user from the overlay', async () => {
    const sender = { ...chatPayload().sender, username: 'Bad_Actor' };
    await post(chatPayload({ content: 'to be banned', sender }));
    await waitFor(async () => (await rows()).some((row) => row.user === 'Bad_Actor'), 'row before ban');
    const others = (await rows()).filter((row) => row.user !== 'Bad_Actor').length;
    assert.equal((await post(banPayload('Bad_Actor'))).status, 200);
    await waitFor(async () => !(await rows()).some((row) => row.user === 'Bad_Actor'), 'row removed');
    assert.equal((await rows()).length, others, 'other users stay');
  });

  await step('bridge protocol: hello frame, ping gets pong, client text closes, wrong key refused', async () => {
    const open = (protocols) =>
      new Promise((done, fail) => {
        const socket = new WebSocket(`${wssOrigin}/overlay`, protocols);
        socket.addEventListener('open', () => done(socket), { once: true });
        socket.addEventListener('error', () => fail(new Error('refused')), { once: true });
      });
    const socket = await open(['neon-bridge.v1', OVERLAY_KEY]);
    assert.equal(socket.protocol, 'neon-bridge.v1', 'the key must not be echoed back');
    const frames = [];
    socket.addEventListener('message', ({ data }) => frames.push(data));
    socket.send('ping');
    await waitFor(() => frames.includes('pong'), 'pong');
    const closed = new Promise((done) => socket.addEventListener('close', ({ code }) => done(code), { once: true }));
    socket.send('anything else');
    assert.equal(await closed, 1008);

    await assert.rejects(open(['neon-bridge.v1', 'z'.repeat(43)]));
    await assert.rejects(open(['neon-bridge.v1']));
    await assert.rejects(open([OVERLAY_KEY]));
  });

  await step('no chat history: a new overlay starts empty', async () => {
    const fresh = await Cdp.attach(browserPort, overlayUrl);
    await waitFor(async () => /connected/.test((await stateOf(fresh)).status ?? ''), 'second overlay connected');
    await sleep(400);
    assert.equal((await stateOf(fresh)).rows.length, 0);
    fresh.close();
  });

  await step('default overlay: strict Twitch-only CSP and no Kick code or socket', async () => {
    const html = readFileSync(join(DIST, 'overlay.html'), 'utf8');
    assert.match(html, /connect-src wss:\/\/irc-ws\.chat\.twitch\.tv"/);
    const plain = await Cdp.attach(browserPort, `${site.origin}/overlay.html?demo=1`);
    await waitFor(async () => (await stateOf(plain)).rows.length >= 1, 'demo message');
    assert.equal(plain.requests.some((url) => /kick/i.test(url)), false, plain.requests.join(' '));
    assert.deepEqual(plain.sockets, []);
    assert.match(await plain.eval(tryConnect('ws', `${wssOrigin}/overlay`)), /^blocked:connect-src/);
    plain.close();
  });

  await step('Kick link on the plain page: shows a hint, opens no socket', async () => {
    const wrongPage = await Cdp.attach(browserPort, `${site.origin}/overlay.html?kick=${encodeURIComponent(bridgeOrigin)}#kickkey=${OVERLAY_KEY}`);
    await waitFor(async () => /needs its own link/.test((await stateOf(wrongPage)).status ?? ''), 'hint');
    assert.deepEqual(wrongPage.sockets, []);
    wrongPage.close();
  });

  await step('hostile bridge values open no socket and add no CSP source', async () => {
    const value = encodeURIComponent('https://evil.test;script-src *');
    const hostile = await Cdp.attach(browserPort, `${site.origin}/overlay-kick.html?kick=${value}#kickkey=${OVERLAY_KEY}`);
    await waitFor(async () => (await stateOf(hostile)).metaCsp.length === 2, 'lock');
    const { metaCsp, status } = await stateOf(hostile);
    assert.ok(metaCsp.includes("connect-src 'none'"), metaCsp.join(' | '));
    assert.match(status, /No chat source/);
    assert.deepEqual(hostile.sockets, []);
    hostile.close();
  });

  await step('missing key in the link shows a hint and opens no socket', async () => {
    const noKey = await Cdp.attach(browserPort, `${site.origin}/overlay-kick.html?kick=${encodeURIComponent(bridgeOrigin)}`);
    await waitFor(async () => /overlay key is missing/.test((await stateOf(noKey)).status ?? ''), 'hint');
    assert.deepEqual(noKey.sockets, []);
    noKey.close();
  });

  await step('setup page: builds the Kick link, keeps the key out of the query and the preview, connects nowhere', async () => {
    const setup = await Cdp.attach(browserPort, `${site.origin}/index.html`);
    await waitFor(() => setup.eval('document.getElementById("link")?.value.includes("overlay.html")'), 'setup page');
    const fill = (values) =>
      setup.eval(`(() => {
        const form = document.getElementById('form');
        const values = ${JSON.stringify(values)};
        for (const [name, value] of Object.entries(values)) {
          const element = form.elements.namedItem(name);
          if (element.type === 'checkbox') element.checked = value;
          else element.value = value;
        }
        form.dispatchEvent(new Event('input', { bubbles: true }));
        return JSON.stringify({ link: document.getElementById('link').value, hint: document.getElementById('hint').textContent });
      })()`);
    const good = JSON.parse(await fill({ demo: false, kick: bridgeOrigin, kickkey: OVERLAY_KEY }));
    const link = new URL(good.link);
    assert.equal(link.pathname, '/overlay-kick.html');
    assert.equal(link.search.includes(OVERLAY_KEY), false);
    assert.equal(link.hash, `#kickkey=${OVERLAY_KEY}`);
    assert.match(good.hint, /never show it on stream/);
    const bad = JSON.parse(await fill({ kick: 'https://evil.test/webhook' }));
    assert.match(bad.hint, /not valid/);
    assert.equal(new URL(bad.link).pathname, '/overlay.html');
    const noKey = JSON.parse(await fill({ kick: bridgeOrigin, kickkey: '' }));
    assert.match(noKey.hint, /Enter the overlay key/);
    await sleep(600);
    const previewSrc = await setup.eval('document.getElementById("preview").src');
    assert.match(previewSrc, /overlay\.html\?/);
    assert.match(previewSrc, /demo=1/);
    assert.equal(previewSrc.includes('kick='), false);
    assert.equal(previewSrc.includes(OVERLAY_KEY), false);
    assert.deepEqual(setup.sockets, []);
    assert.match(await setup.eval(tryConnect('ws', `${wssOrigin}/overlay`)), /^blocked:connect-src/);
    setup.close();
  });

  if (process.env.E2E_SHOT) {
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(process.env.E2E_SHOT, Buffer.from(shot.result.data, 'base64'));
  }

  // Yanlış anahtarlı overlay tüm geri çekilme adımlarını geçer (en az 91 saniye), bu yüzden köprü
  // kapatılmadan önce arka planda başlatılır. Yanlış anahtar ile köprü kapalı aynı yolu izler.
  const wrongKey = await Cdp.attach(
    browserPort,
    `${site.origin}/overlay-kick.html?kick=${encodeURIComponent(bridgeOrigin)}&status=0#kickkey=${'z'.repeat(43)}`,
  );

  await step('messages flow on the live overlay right before the outage', async () => {
    assert.equal((await post(chatPayload({ content: 'before outage' }))).status, 200);
    await waitFor(async () => (await rows()).some((row) => row.text === 'before outage'), 'message before outage');
  });

  await wrangler.stop();
  console.log('bridge stopped on purpose');

  await step('bridge down: overlay stays alive, shows a retry status, keeps rows', async () => {
    await waitFor(async () => /reconnecting/.test((await stateOf(page)).status ?? ''), 'reconnecting status', 20000);
    const state = await stateOf(page);
    assert.ok(state.rows.some((row) => row.text === 'before outage'));
    assert.equal(state.level, 'warn');
    const before = page.sockets.length;
    await waitFor(() => page.sockets.length > before, 'a new connection attempt', 10000);
  });

  await step('both sources configured: the Twitch socket still opens while the bridge is dead', async () => {
    const both = await Cdp.attach(
      browserPort,
      `${site.origin}/overlay-kick.html?twitch=somechannel&kick=${encodeURIComponent(bridgeOrigin)}#kickkey=${OVERLAY_KEY}`,
    );
    // Chrome dış ağa çıkamaz; burada yalnızca soketin açılmaya çalışıldığı ve CSP'nin izin verdiği doğrulanır.
    await waitFor(() => both.sockets.some((url) => url.startsWith('wss://irc-ws.chat.twitch.tv')), 'twitch socket opened');
    await waitFor(() => both.sockets.some((url) => url.startsWith(wssOrigin)), 'bridge socket attempted');
    const { metaCsp } = await stateOf(both);
    assert.ok(metaCsp.includes(`connect-src wss://irc-ws.chat.twitch.tv ${wssOrigin}`), metaCsp.join(' | '));
    both.close();
  });

  let revived;
  await step('the overlay reconnects by itself when the bridge comes back, without a reload', async () => {
    revived = startWrangler(bridgePort);
    await waitFor(async () => {
      try {
        return (await fetch(`${bridgeOrigin}/`)).ok;
      } catch {
        return false;
      }
    }, 'wrangler restart', 90000);
    await waitFor(async () => /connected to your bridge/.test((await stateOf(page)).status ?? ''), 'reconnected', 70000);
    assert.equal((await post(chatPayload({ content: 'after outage' }))).status, 200);
    await waitFor(async () => (await rows()).some((row) => row.text === 'after outage'), 'message after outage');
  });

  await step('connection cap: the oldest of more than five overlays is closed', async () => {
    const sockets = [];
    const closes = [];
    for (let i = 0; i < 6; i += 1) {
      const socket = new WebSocket(`${wssOrigin}/overlay`, ['neon-bridge.v1', OVERLAY_KEY]);
      socket.addEventListener('close', ({ code }) => closes.push(code));
      await new Promise((done, fail) => {
        socket.addEventListener('open', done, { once: true });
        socket.addEventListener('error', fail, { once: true });
      });
      sockets.push(socket);
    }
    await waitFor(() => closes.includes(4409), 'eviction close code');
    for (const socket of sockets) socket.close();
    await sleep(300);
  });

  await step('repeated failures: it stops retrying and shows the setup hint even with status=0', async () => {
    await waitFor(
      async () => /docs\/KICK\.md/.test((await stateOf(wrongKey)).status ?? ''),
      'give-up hint',
      200000,
    );
    const attempts = wrongKey.sockets.length;
    assert.equal(attempts, 8);
    const { level, status } = await stateOf(wrongKey);
    assert.equal(level, 'error');
    assert.equal(status.includes('zzzz'), false, 'the key is never displayed');
    await sleep(3000);
    assert.equal(wrongKey.sockets.length, attempts, 'no more attempts after giving up');
    assert.equal(await wrongKey.eval('document.getElementById("box") !== null'), true);
  });

  page.close();
  wrongKey.close();
}

let exitCode = 0;
try {
  await main();
} catch (error) {
  exitCode = 1;
  console.error(`E2E aborted: ${error.message}`);
} finally {
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch {
      // Temizlik hatası sonucu değiştirmez.
    }
  }
  await sleep(1000);
  try {
    rmSync(TEMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch {
    console.log(`Note: could not remove the temporary folder ${TEMP}`);
  }
}
console.log(`\nE2E result: ${passed} passed, ${failed} failed`);
process.exit(exitCode || (failed ? 1 : 0));
