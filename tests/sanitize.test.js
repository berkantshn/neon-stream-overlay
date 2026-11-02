// Made By FALCREB
// Temizleyici testleri: HTML enjeksiyonu, uzun metin, Unicode, düz metin emote.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readableColor, sanitizeColor, sanitizeText, sanitizeUser } from '../src/core/sanitize.js';

const graphemes = (text) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)];

test('HTML yükü çözülmez, düz metin olarak aynen kalır', () => {
  for (const payload of [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '"><svg/onload=alert(1)>',
    '&lt;b&gt;bold&lt;/b&gt;',
    'javascript:alert(1)',
  ]) {
    assert.equal(sanitizeText(payload), payload);
  }
});

test('metin olmayan girdi boş döner', () => {
  for (const value of [null, undefined, 42, {}, ['<b>'], '']) assert.equal(sanitizeText(value), '');
});

test('uzunluk sınırı uygulanır ve üç nokta eklenir', () => {
  const result = sanitizeText('a'.repeat(5000), { maxLength: 50 });
  assert.equal(graphemes(result).length, 50);
  assert.ok(result.endsWith('…'));
});

test('sınırda kalan metin kesilmez', () => {
  assert.equal(sanitizeText('a'.repeat(50), { maxLength: 50 }), 'a'.repeat(50));
});

test('çok büyük girdi hızlı işlenir', () => {
  const start = performance.now();
  sanitizeText(`a${'\u0301'.repeat(2_000_000)}`, { maxLength: 200 });
  sanitizeText('🔥'.repeat(1_000_000), { maxLength: 200 });
  assert.ok(performance.now() - start < 1500);
});

test('birleşik emoji kesilirken bölünmez', () => {
  const family = '👨\u200D👩\u200D👧\u200D👦';
  const result = sanitizeText(family.repeat(30), { maxLength: 5 });
  assert.equal(result, `${family.repeat(4)}…`);
});

test('emoji, ZWJ ve bayrak dizileri korunur', () => {
  for (const text of ['👩\u200D💻', '🏳️\u200D🌈', '🇹🇷', '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}']) {
    assert.equal(sanitizeText(text), text);
  }
});

test('Türkçe ve diğer alfabeler korunur', () => {
  for (const text of ['ğüşıöçİĞÜŞÖÇ', '日本語のチャット', 'مرحبا', 'नमस्ते']) {
    assert.equal(sanitizeText(text), text.normalize('NFC'));
  }
});

test('ayrık yazılmış harfler NFC biçimine getirilir', () => {
  assert.equal(sanitizeText('s\u0327'), 'ş');
});

test('kontrol ve yön değiştirici karakterler silinir', () => {
  assert.equal(sanitizeText('a\u0000b\u0007c\u001b[31m'), 'abc[31m');
  assert.equal(sanitizeText('safe\u202Etxt.exe\u202C'), 'safetxt.exe');
  assert.equal(sanitizeText('a\u200Bb\u2060c\uFEFFd'), 'abcd');
});

test('görünmez spam karakterleri silinir, sadece onlardan oluşan metin boşalır', () => {
  assert.equal(sanitizeText('hi \u{E0000}'), 'hi');
  assert.equal(sanitizeText('\u200B\u{E0000}\u3164'), '');
});

test('tek başına kalan yarım vekil karakter silinir', () => {
  assert.equal(sanitizeText('a\uD83Db'), 'ab');
});

test('satır sonları ve fazla boşluk tek boşluk olur', () => {
  assert.equal(sanitizeText('  a\r\n\tb \u2028 c  '), 'a b c');
});

test('Zalgo işaret yığını dört ile sınırlanır', () => {
  const result = sanitizeText(`a${'\u0301\u0302\u0303'.repeat(20)}`);
  assert.ok([...result].length <= 5);
});

test('emote adları düz metin olarak kalır', () => {
  assert.equal(sanitizeText('Kappa PogChamp LUL'), 'Kappa PogChamp LUL');
});

test('bağlantı gizleme isteğe bağlıdır', () => {
  const text = 'see https://example.com/x?y=1 and www.example.org now';
  assert.equal(sanitizeText(text), text);
  assert.equal(sanitizeText(text, { hideLinks: true }), 'see [link] and [link] now');
});

test('kullanıcı adı sınırlanır, boşsa yedek kullanılır', () => {
  assert.equal(sanitizeUser('\u200B'), 'anonymous');
  assert.ok(graphemes(sanitizeUser('x'.repeat(100))).length <= 32);
});

test('renk yalnızca #rrggbb ise kabul edilir', () => {
  assert.equal(sanitizeColor('#FF00aa'), '#ff00aa');
  for (const bad of ['red', '#fff', '#12345g', 'url(x)', '#ff00aa;background:url(x)', null]) {
    assert.equal(sanitizeColor(bad), null);
  }
});

test('koyu renk açılır, açık renk değişmez', () => {
  assert.equal(readableColor('#ffffff'), '#ffffff');
  assert.notEqual(readableColor('#000033'), '#000033');
  assert.equal(readableColor('bad'), null);
});
