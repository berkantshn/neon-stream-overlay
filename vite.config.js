// Made By FALCREB
import { defineConfig } from 'vite';

// Ortak CSP kuralları: dış kaynaktan script, stil veya görsel yüklenemez.
const BASE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
];

// Overlay yalnızca Twitch WebSocket adresine bağlanabilir; yapılandırma sayfası hiçbir yere bağlanmaz.
// Köprü adresi kişiye özel olduğu için Kick sayfası burada yalnızca wss: izni alır;
// src/overlay/csp-lock.js bu izni overlay kodu başlamadan doğrulanmış tek adrese daraltır.
const CSP_BY_PAGE = {
  overlay: [...BASE_CSP, 'connect-src wss://irc-ws.chat.twitch.tv'],
  'overlay-kick': [...BASE_CSP, 'connect-src wss:'],
  config: [...BASE_CSP, "connect-src 'none'", "frame-src 'self'"],
};

function pageOf(path) {
  if (path.endsWith('overlay-kick.html')) return 'overlay-kick';
  return path.endsWith('overlay.html') ? 'overlay' : 'config';
}

// CSP sadece derlemeye eklenir; geliştirme sunucusunun HMR bağlantısı bozulmasın diye.
function injectCsp() {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        return html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP_BY_PAGE[pageOf(ctx.path)].join('; ')}" />`,
        );
      },
    },
  };
}

export default defineConfig({
  // Göreli yollar: GitHub Pages alt klasöründe ve başka barındırmada aynı şekilde çalışır.
  base: './',
  plugins: [injectCsp()],
  build: {
    // OBS eski bir Chromium sürümü kullanabilir; kod buna göre derlenir.
    target: 'chrome95',
    cssTarget: 'chrome95',
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: { index: 'index.html', overlay: 'overlay.html', 'overlay-kick': 'overlay-kick.html' },
    },
  },
});
