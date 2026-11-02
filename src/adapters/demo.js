// Made By FALCREB
// Demo modu: hiçbir yere bağlanmaz, kurgusal kullanıcılarla sohbet üretir.

const USERS = [
  { user: 'PixelNomad', color: '#00f0ff' },
  { user: 'lunar_byte', color: '#ff7ad9' },
  { user: 'KaraKedi', color: '#ffd166' },
  { user: 'ghostframe', color: '#7dff3c' },
  { user: 'Mira_GG', color: '#b26bff' },
];
const MOD = { user: 'neon_mod', color: '#ff9f43', isMod: true };
const HOST = { user: 'demo_streamer', color: '#ff5fa2', isBroadcaster: true };

// Sıra bilerek sabittir: önizleme ilk saniyelerde her özelliği gösterir.
function buildScript(config) {
  const command = config.commands[0] ?? '!hype';
  const keyword = config.keywords[0] ?? 'clutch';
  return [
    [USERS[0], 'hello chat, is this thing on?'],
    [USERS[1], 'that neon glow looks clean'],
    [USERS[2], 'Selam! Türkçe karakterler: ğüşıöçİ ✓'],
    [HOST, 'Welcome in everyone, this is demo mode.'],
    [USERS[3], command],
    [USERS[4], 'LUL PogChamp Kappa (emotes stay plain text)'],
    [USERS[0], '<img src=x onerror=alert(1)> stays harmless text'],
    [MOD, `what a ${keyword} moment`],
    [USERS[1], '🔥🔥 👩\u200D💻 🏳️\u200D🌈 emoji stay whole'],
    [{ ...USERS[3], isAction: true }, 'dances in neon'],
    [USERS[2], 'bu overlay ücretsiz mi?'],
    [{ ...USERS[4], isFirst: true }, 'first time here, hi!'],
    [USERS[0], command],
  ];
}

export function createDemoAdapter({
  config,
  onMessage,
  onStatus = () => {},
  timers = globalThis,
  intervalMs = 1100,
}) {
  const script = buildScript(config);
  let index = 0;
  let timer = null;
  let stopped = false;

  function tick() {
    if (stopped) return;
    const [person, text] = script[index % script.length];
    onMessage({
      ...person,
      id: `demo-${index}`,
      platform: 'demo',
      login: person.user.toLowerCase(),
      text,
    });
    index += 1;
    timer = timers.setTimeout(tick, intervalMs);
  }

  return {
    start() {
      onStatus('ok', 'Demo mode: simulated chat, not connected');
      timer = timers.setTimeout(tick, 300);
    },
    stop() {
      stopped = true;
      timers.clearTimeout(timer);
    },
  };
}
