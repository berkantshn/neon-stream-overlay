// Neon Kick Bridge - Made By FALCREB
// Cloudflare Worker girişi: Kick webhook'unu doğrular, temizlenmiş olayı Durable Object üzerinden
// bağlı overlay'lere WebSocket ile iletir. Mantığın tamamı platformdan bağımsız dosyalardadır.

import { DurableObject } from 'cloudflare:workers';
import { createHub } from './hub.js';
import { createKeyProvider } from './kick-key.js';
import { createFailureLimiter } from './limits.js';
import { keyFingerprint, OVERLAY_PROTOCOL, routeRequest } from './webhook.js';

// Bu nesneler örnek ömrü boyunca bellekte kalır, kalıcı değildir.
const limiter = createFailureLimiter();
let keys = null;
let keysPem = null;

function keyProvider(env) {
  const pem = env.KICK_PUBLIC_KEY_PEM ?? '';
  if (!keys || keysPem !== pem) {
    keys = createKeyProvider({ pem });
    keysPem = pem;
  }
  return keys;
}

export default {
  fetch(request, env) {
    const hub = () => env.HUB.get(env.HUB.idFromName('bridge'));
    return routeRequest(request, {
      env,
      keys: keyProvider(env),
      limiter,
      async publish(delivery) {
        const response = await hub().fetch('https://hub/event', {
          method: 'POST',
          body: JSON.stringify(delivery),
        });
        if (!response.ok) throw new Error('hub error');
        return response.text();
      },
      // İstemcinin başlıkları iç isteğe taşınmaz; anahtar Durable Object'e hiç ulaşmaz.
      connect: () => hub().fetch('https://hub/connect', { headers: { upgrade: 'websocket' } }),
    });
  },
};

export class BridgeHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Canlılık sinyali nesneyi uyandırmadan yanıtlanır; ücretsiz kotayı harcamaz.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.hub = createHub({ storage: ctx.storage });
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    const fingerprint = await keyFingerprint(String(this.env.OVERLAY_KEY));
    const sockets = this.ctx.getWebSockets();

    if (pathname === '/event') {
      return new Response(await this.hub.publish(await request.json(), sockets, fingerprint));
    }
    if (pathname === '/connect') {
      if (!this.hub.admit(sockets, fingerprint)) return new Response('busy', { status: 429 });
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ fp: fingerprint, at: Date.now() });
      server.send(JSON.stringify({ v: 1, t: 'hello' }));
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { 'sec-websocket-protocol': OVERLAY_PROTOCOL },
      });
    }
    return new Response('not found', { status: 404 });
  }

  // Overlay yalnızca dinler: "ping" dışında bir şey gönderirse bağlantı kapatılır.
  webSocketMessage(socket) {
    socket.close(1008, 'read only');
  }

  webSocketClose(socket) {
    try {
      socket.close(1000);
    } catch {
      // Zaten kapanmış olabilir.
    }
  }

  webSocketError() {}
}
