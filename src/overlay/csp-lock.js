// Made By FALCREB
// Köprü adresi kişiye özeldir, GitHub Pages ise herkese aynı dosyayı verir. Bu yüzden overlay-kick.html
// içindeki sabit CSP yalnızca wss: bağlantısına izin verir, bu dosya da overlay kodu başlamadan önce
// ikinci bir CSP ekleyerek izni doğrulanmış tek adrese daraltır. Tarayıcı birden çok CSP'nin kesişimini
// uygular: eklenen politika izni yalnızca azaltabilir, sonradan silinmesi de izni geri getirmez.

import { overlayConnectSrc, parseConfig, resolveKickBridge, resolveSources } from '../core/config.js';

export function lockConnectSrc(doc = document, search = location.search) {
  const config = parseConfig(search);
  const kick = resolveKickBridge(config);
  // Geliştirme sunucusunun otomatik yenileme bağlantısı bozulmasın diye yalnızca derlemede uygulanır.
  if (import.meta.env?.PROD) {
    const meta = doc.createElement('meta');
    meta.setAttribute('http-equiv', 'Content-Security-Policy');
    meta.setAttribute('content', `connect-src ${overlayConnectSrc({ twitch: resolveSources(config).twitch, kick })}`);
    doc.head.prepend(meta);
  }
  // Overlay, Kick adaptörünü yalnızca bu kilit atıldıysa başlatır.
  doc.documentElement.dataset.kickLock = kick;
}
