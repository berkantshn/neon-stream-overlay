// Made By FALCREB
// Olayı bağlı overlay'lere dağıtan çekirdek. Sohbet geçmişi tutmaz: mesaj içeriği hiçbir yere yazılmaz,
// tekrar saldırısını önlemek için yalnızca kısa süreli mesaj kimlikleri ve zamanları saklanır.

import {
  FRESHNESS_MS,
  MAX_CONNECTS_PER_MINUTE,
  MAX_SEEN_IDS,
  MAX_SOCKETS,
} from './limits.js';

const STORAGE_KEY = 'seen';
export const CLOSE_KEY_ROTATED = 4401;
export const CLOSE_TOO_MANY = 4409;

function closeQuietly(socket, code, reason) {
  try {
    socket.close(code, reason);
  } catch {
    // Zaten kapanmış olabilir.
  }
}

export function createHub({ storage, now = () => Date.now(), maxSeen = MAX_SEEN_IDS }) {
  let seen = new Map();
  // Tablo taşınca atılan en yeni zaman. Bundan eski olaylar kimliği unutulmuş olabileceği için reddedilir.
  let floor = 0;
  let loaded = false;
  let windowStart = -Infinity;
  let connects = 0;

  // Hibernate sonrası bellek silinir; kimlikler kalıcı depodan geri okunur.
  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const saved = await storage.get(STORAGE_KEY);
      if (saved) {
        seen = new Map(saved.ids);
        floor = saved.floor;
      }
    } catch {
      // Depo okunamazsa imza ve zaman kontrolü geçerliliğini korur.
    }
  }

  function prune() {
    const limit = now() - FRESHNESS_MS * 2;
    for (const [id, ts] of seen) {
      if (ts < limit) seen.delete(id);
    }
    while (seen.size > maxSeen) {
      const [oldest, ts] = seen.entries().next().value;
      seen.delete(oldest);
      floor = Math.max(floor, ts);
    }
  }

  const fingerprintOf = (socket) => socket.deserializeAttachment()?.fp;

  return {
    /**
     * Olayı bir kez dağıtır.
     * @returns {Promise<'forwarded'|'duplicate'|'stale'>}
     */
    async publish({ id, ts, frame }, sockets, fingerprint) {
      await load();
      if (ts < floor) return 'stale';
      if (seen.has(id)) return 'duplicate';
      seen.set(id, ts);
      prune();
      try {
        await storage.put(STORAGE_KEY, { floor, ids: [...seen] });
      } catch {
        // Ücretsiz plan kotası dolarsa yazma hata verir; canlı sohbet bu yüzden durmaz.
      }
      for (const socket of sockets) {
        try {
          // Anahtar değiştiyse eski anahtarla açılmış bağlantı kesilir.
          if (fingerprintOf(socket) !== fingerprint) socket.close(CLOSE_KEY_ROTATED, 'key rotated');
          else socket.send(frame);
        } catch {
          // Kopmuş bir bağlantı diğer overlay'leri etkilemez.
        }
      }
      return 'forwarded';
    },

    /** Yeni bağlantıya yer açar. Dakikalık sınır aşılırsa false döner. */
    admit(sockets, fingerprint) {
      if (now() - windowStart >= 60_000) {
        windowStart = now();
        connects = 0;
      }
      connects += 1;
      if (connects > MAX_CONNECTS_PER_MINUTE) return false;
      const alive = [];
      for (const socket of sockets) {
        if (fingerprintOf(socket) === fingerprint) alive.push(socket);
        else closeQuietly(socket, CLOSE_KEY_ROTATED, 'key rotated');
      }
      // En eski bağlantı kapanır: yarı kopmuş bir overlay yeni bağlantıyı kilitleyemez.
      alive.sort((a, b) => a.deserializeAttachment().at - b.deserializeAttachment().at);
      while (alive.length >= MAX_SOCKETS) closeQuietly(alive.shift(), CLOSE_TOO_MANY, 'too many overlays');
      return true;
    },
  };
}
