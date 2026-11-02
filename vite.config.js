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
const CSP_BY_PAGE = {
  overlay: [...BASE_CSP, 'connect-src wss://irc-ws.chat.twitch.tv'],
  config: [...BASE_CSP, "connect-src 'none'", "frame-src 'self'"],
};

// CSP sadece derlemeye eklenir; geliştirme sunucusunun HMR bağlantısı bozulmasın diye.
function injectCsp() {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const page = ctx.path.endsWith('overlay.html') ? 'overlay' : 'config';
        return html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP_BY_PAGE[page].join('; ')}" />`,
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
      input: { index: 'index.html', overlay: 'overlay.html' },
    },
  },
});
