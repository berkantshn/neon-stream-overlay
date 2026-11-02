// Made By FALCREB
// Komut, anahtar kelime, bekleme süresi ve vurgu kararları.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/core/config.js';
import { createPipeline, matchTrigger, parseModKeywordCommand } from '../src/core/triggers.js';

const clock = (start = 1000) => {
  const state = { t: start };
  return { now: () => state.t, advance: (ms) => (state.t += ms) };
};
const raw = (text, extra = {}) => ({ user: 'Ali', login: 'ali', platform: 'twitch', text, ...extra });

test('komut yalnızca ilk sözcükse eşleşir, büyük/küçük harf önemsizdir', () => {
  const rules = { commands: ['!hype'], keywords: [] };
  assert.equal(matchTrigger('!HYPE lets go', rules).label, 'hype');
  assert.equal(matchTrigger('say !hype now', rules), null);
  assert.equal(matchTrigger('!hyped', rules), null);
});

test('anahtar kelime tam sözcük olarak eşleşir', () => {
  const rules = { commands: [], keywords: ['gg', 'well played'] };
  assert.equal(matchTrigger('GG, nice', rules).label, 'gg');
  assert.equal(matchTrigger('eggs', rules), null);
  assert.equal(matchTrigger('that was WELL  played!', rules).label, 'well played');
});

test('Türkçe harfler büyük/küçük farkı olmadan eşleşir', () => {
  const rules = { commands: [], keywords: ['hız', 'şimşek', 'isim'] };
  assert.equal(matchTrigger('HIZ', rules).label, 'hız');
  assert.equal(matchTrigger('ŞİMŞEK geldi', rules).label, 'şimşek');
  assert.equal(matchTrigger('İSİM', rules).label, 'isim');
});

test('özel regex karakterleri güvenlidir', () => {
  const rules = { commands: [], keywords: ['(a+)+$', 'c++'] };
  assert.doesNotThrow(() => matchTrigger(`${'a'.repeat(5000)}!`, rules));
});

test('bekleme süresi art arda patlamayı engeller', () => {
  const time = clock();
  const pipeline = createPipeline(parseConfig('cooldown=8'), time);
  assert.ok(pipeline.process(raw('!hype')).burst);
  time.advance(7999);
  const second = pipeline.process(raw('!hype'));
  assert.equal(second.burst, null);
  assert.equal(second.emphasis, 'trigger');
  time.advance(1);
  assert.ok(pipeline.process(raw('!hype')).burst);
});

test('fxby=mods izleyici tetiklemesini engeller', () => {
  const pipeline = createPipeline(parseConfig('fxby=mods&cooldown=0'));
  assert.equal(pipeline.process(raw('!hype')).burst, null);
  assert.ok(pipeline.process(raw('!hype', { isMod: true })).burst);
  assert.ok(pipeline.process(raw('!hype', { isBroadcaster: true })).burst);
  assert.equal(pipeline.process(raw('!hype', { isVip: true })).burst, null);
});

test('hidecmd komutu listeden gizler ama patlamayı korur', () => {
  const result = createPipeline(parseConfig('hidecmd=1')).process(raw('!hype'));
  assert.equal(result.message, null);
  assert.ok(result.burst);
});

test('vurgu türleri belirlenir', () => {
  const pipeline = createPipeline(parseConfig('twitch=mychan&highlights=giveaway&commands='));
  assert.equal(pipeline.process(raw('big GIVEAWAY soon')).emphasis, 'highlight');
  assert.equal(pipeline.process(raw('hi @MyChan')).emphasis, 'mention');
  assert.equal(pipeline.process(raw('hello', { isFirst: true })).emphasis, 'first');
  assert.equal(pipeline.process(raw('hello')).emphasis, null);
});

test('engelli kullanıcı ve boş kalan mesaj gösterilmez', () => {
  const pipeline = createPipeline(parseConfig('ignore=NightBot'));
  assert.equal(pipeline.process(raw('hi', { login: 'nightbot' })), null);
  assert.equal(pipeline.process(raw('\u200B')), null);
  assert.equal(pipeline.process(null), null);
});

test('HTML ve geçersiz renk işlem hattından temiz geçer', () => {
  const { message } = createPipeline(parseConfig('')).process(
    raw('<img src=x onerror=alert(1)>', { user: '<b>x</b>', color: 'red;background:url(x)' }),
  );
  assert.equal(message.text, '<img src=x onerror=alert(1)>');
  assert.equal(message.user, '<b>x</b>');
  assert.equal(message.color, null);
});

test('modun komutu ayrıştırılır', () => {
  assert.deepEqual(parseModKeywordCommand('!NEONKW add big win'), { action: 'add', word: 'big win' });
  assert.deepEqual(parseModKeywordCommand('!neonkw clear'), { action: 'clear' });
  assert.equal(parseModKeywordCommand('!neonkw add'), null);
  assert.equal(parseModKeywordCommand('!neonkw nuke'), null);
  assert.equal(parseModKeywordCommand('hello'), null);
});

test('yalnızca yetkili, açık ayarla çalışma anında kelime ekleyebilir', () => {
  const pipeline = createPipeline(parseConfig('modkw=1&cooldown=0'));
  // İzleyicinin komutu normal mesajdır, kural eklemez.
  assert.ok(pipeline.process(raw('!neonkw add boom')).message);
  assert.deepEqual(pipeline.runtimeKeywords, []);
  // Yetkilinin komutu sohbette görünmez, kural eklenir.
  assert.equal(pipeline.process(raw('!neonkw add boom', { isMod: true })), null);
  assert.ok(pipeline.process(raw('BOOM!')).burst);
  pipeline.process(raw('!neonkw del boom', { isMod: true }));
  assert.equal(pipeline.process(raw('boom')).burst, null);
});

test('modkw kapalıyken yetkili de kural ekleyemez', () => {
  const pipeline = createPipeline(parseConfig(''));
  assert.ok(pipeline.process(raw('!neonkw add boom', { isMod: true })).message);
  assert.deepEqual(pipeline.runtimeKeywords, []);
});

test('çalışma anı kelime sayısı sınırlıdır', () => {
  const pipeline = createPipeline(parseConfig('modkw=1'));
  for (let i = 0; i < 40; i += 1) pipeline.process(raw(`!neonkw add w${i}`, { isMod: true }));
  assert.equal(pipeline.runtimeKeywords.length, 20);
});
