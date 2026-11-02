// Made By FALCREB
// Köprünün sınırları tek yerde durur. Sabitler bilerek cömert değildir: köprü tek yayıncı içindir.

// Kabul edilen en büyük webhook gövdesi. Sohbet mesajı yükü bunun çok altındadır.
export const MAX_BODY_BYTES = 32 * 1024;
// İmzalı zaman damgası bu kadar eskiyse veya ilerideyse olay iletilmez.
export const FRESHNESS_MS = 5 * 60 * 1000;
// Tekrar saldırısına karşı akılda tutulan en fazla mesaj kimliği sayısı.
export const MAX_SEEN_IDS = 1000;
// Aynı anda bağlı overlay sayısı ve dakikadaki yeni bağlantı sınırı.
export const MAX_SOCKETS = 5;
export const MAX_CONNECTS_PER_MINUTE = 30;
// Bir IP'nin dakikada yapabileceği başarısız deneme sayısı (geçersiz imza veya yanlış anahtar).
export const MAX_FAILURES_PER_MINUTE = 20;
const MAX_TRACKED_IPS = 2000;

/**
 * Başarısız denemeleri IP başına sayar. Sayaç bellekte durur, bu yüzden en iyi çaba korumasıdır:
 * Cloudflare yeni bir örnek başlatırsa sayaç sıfırlanır. IP adresi kalıcı olarak yazılmaz.
 */
export function createFailureLimiter({
  limit = MAX_FAILURES_PER_MINUTE,
  windowMs = 60_000,
  now = () => Date.now(),
} = {}) {
  const counts = new Map();
  const current = (ip) => {
    const entry = counts.get(ip);
    if (!entry || now() - entry.start >= windowMs) return null;
    return entry;
  };
  return {
    blocked: (ip) => (current(ip)?.count ?? 0) >= limit,
    fail(ip) {
      const entry = current(ip);
      if (entry) {
        entry.count += 1;
        return;
      }
      // Bellek sınırsız büyümesin: sınır dolunca tablo temizlenir.
      if (counts.size >= MAX_TRACKED_IPS) counts.clear();
      counts.set(ip, { start: now(), count: 1 });
    },
  };
}
