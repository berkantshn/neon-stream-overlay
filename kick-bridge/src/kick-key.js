// Made By FALCREB
// Kick imzasını doğrular. Kick belgesine göre imza RSA PKCS#1 v1.5 + SHA-256'dır ve şu metne atılır:
// "<Kick-Event-Message-Id>.<Kick-Event-Message-Timestamp>.<ham gövde>"
// Açık anahtar koda gömülmez, çünkü Kick anahtarı her an değiştirebileceğini belirtir.

export const KICK_PUBLIC_KEY_URL = 'https://api.kick.com/public/v1/public-key';
const KEY_TTL_MS = 60 * 60 * 1000;
// Sahte imza seli Kick'e anahtar isteği yağdırmasın diye yenileme dakikada bir ile sınırlıdır.
const MIN_REFRESH_MS = 60 * 1000;
const MAX_KEY_BYTES = 8 * 1024;
const MAX_SIGNATURE_CHARS = 2048;
const RSA_PARAMS = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

/** PEM metnini WebCrypto anahtarına çevirir. RSA dışı veya 2048 bitten kısa anahtar reddedilir. */
export async function importPublicKey(pem) {
  // Secret alanına tek satır yapıştırılan PEM'deki "\n" yazıları da gerçek satır sonu sayılır.
  const text = String(pem).replace(/\\n/g, '\n');
  const match = /-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/.exec(text);
  if (!match) throw new Error('not a public key');
  const der = Uint8Array.from(atob(match[1].replace(/\s+/g, '')), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('spki', der, RSA_PARAMS, false, ['verify']);
  if (key.algorithm.modulusLength < 2048) throw new Error('key too short');
  return key;
}

/** Kick'in yanıtını okur: canlı uç JSON döner, belgedeki örnek ise düz PEM varsayar. İkisi de kabul edilir. */
export function pemFromResponse(text) {
  if (!text.trimStart().startsWith('{') && text.includes('-----BEGIN PUBLIC KEY-----')) return text;
  const pem = JSON.parse(text)?.data?.public_key;
  if (typeof pem !== 'string') throw new Error('public key missing');
  return pem;
}

/** İmzayı doğrular. Bozuk base64 hata fırlatmaz, yalnızca false döner. */
export async function verifySignature(key, messageId, timestamp, bodyBytes, signatureB64) {
  if (typeof signatureB64 !== 'string' || signatureB64.length > MAX_SIGNATURE_CHARS) return false;
  let signature;
  try {
    signature = Uint8Array.from(atob(signatureB64), (char) => char.charCodeAt(0));
  } catch {
    return false;
  }
  // Gövde metne çevrilmeden bayt olarak birleştirilir; böylece imzalanan veri birebir korunur.
  const prefix = new TextEncoder().encode(`${messageId}.${timestamp}.`);
  const signed = new Uint8Array(prefix.length + bodyBytes.length);
  signed.set(prefix);
  signed.set(bodyBytes, prefix.length);
  return crypto.subtle.verify(RSA_PARAMS, key, signature, signed);
}

/**
 * Anahtar sağlayıcı. KICK_PUBLIC_KEY_PEM verilirse onu kullanır; verilmezse resmi adresten okur ve
 * önbellekte tutar. İmza tutmazsa anahtar dönmüş olabilir: sınırlı aralıkla bir kez yeniden okunur.
 */
export function createKeyProvider({ pem = '', fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  let cached = null;
  let cachedPem = '';
  let fetchedAt = -Infinity;

  async function load() {
    fetchedAt = now();
    const response = await fetchImpl(KICK_PUBLIC_KEY_URL, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('public key request failed');
    const text = await response.text();
    if (text.length > MAX_KEY_BYTES) throw new Error('public key too large');
    const nextPem = pemFromResponse(text);
    if (nextPem === cachedPem && cached) return false;
    cached = await importPublicKey(nextPem);
    cachedPem = nextPem;
    return true;
  }

  return {
    /** Geçerli anahtarı döner. Alınamazsa eski anahtarla devam eder; hiç anahtar yoksa hata fırlatır. */
    async current() {
      if (pem) {
        cached ??= await importPublicKey(pem);
        return cached;
      }
      if (cached && now() - fetchedAt < KEY_TTL_MS) return cached;
      try {
        await load();
      } catch (error) {
        if (!cached) throw error;
      }
      return cached;
    },
    /** Anahtar gerçekten değiştiyse true döner. Sabit PEM'de ve kısa aralıkta yenileme yapılmaz. */
    async refresh() {
      if (pem || now() - fetchedAt < MIN_REFRESH_MS) return false;
      try {
        return await load();
      } catch {
        return false;
      }
    },
  };
}

/** İmzayı geçerli anahtarla dener, tutmazsa anahtar dönmüş olabileceği için bir kez daha dener. */
export async function verifyWithRotation(keys, messageId, timestamp, bodyBytes, signature) {
  const key = await keys.current();
  if (await verifySignature(key, messageId, timestamp, bodyBytes, signature)) return true;
  if (!(await keys.refresh())) return false;
  return verifySignature(await keys.current(), messageId, timestamp, bodyBytes, signature);
}
