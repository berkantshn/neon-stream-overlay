// Made By FALCREB
// Twitch IRC çözücü testleri.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIrcLine, privmsgToMessage } from '../src/core/irc.js';

const LINE =
  '@badges=moderator/1,subscriber/12;color=#1E90FF;display-name=Şeker_Kız;emotes=25:0-4;first-msg=1;id=abc-1;mod=1;room-id=5 ' +
  ':seker!seker@seker.tmi.twitch.tv PRIVMSG #chan :Kappa <b>merhaba</b> : ok';

test('etiketli PRIVMSG çözülür', () => {
  const parsed = parseIrcLine(LINE);
  assert.equal(parsed.command, 'PRIVMSG');
  assert.deepEqual(parsed.params, ['#chan']);
  assert.equal(parsed.trailing, 'Kappa <b>merhaba</b> : ok');
  assert.equal(parsed.tags['display-name'], 'Şeker_Kız');
});

test('etiket kaçışları çözülür', () => {
  const parsed = parseIrcLine('@msg=a\\sb\\:c\\\\d;x=e\\nf :h NOTICE * :t');
  assert.equal(parsed.tags.msg, 'a b;c\\d');
  assert.equal(parsed.tags.x, 'e\nf');
});

test('PING çözülür', () => {
  const parsed = parseIrcLine('PING :tmi.twitch.tv');
  assert.equal(parsed.command, 'PING');
  assert.equal(parsed.trailing, 'tmi.twitch.tv');
});

test('bozuk satırlar hata atmaz', () => {
  for (const bad of ['', '@', '@tags-only', ':prefix-only', null, 42]) {
    assert.equal(parseIrcLine(bad), null);
  }
});

test('mesaj ortak biçime çevrilir, emote düz metin kalır', () => {
  const message = privmsgToMessage(parseIrcLine(LINE));
  assert.equal(message.user, 'Şeker_Kız');
  assert.equal(message.login, 'seker');
  assert.equal(message.text, 'Kappa <b>merhaba</b> : ok');
  assert.equal(message.isMod, true);
  assert.equal(message.isSub, true);
  assert.equal(message.isFirst, true);
  assert.equal(message.id, 'abc-1');
  assert.equal(Object.hasOwn(message, 'emotes'), false);
});

test('/me mesajı işaretlenir', () => {
  const message = privmsgToMessage(parseIrcLine(':a!a@a PRIVMSG #c :\u0001ACTION dans ediyor\u0001'));
  assert.equal(message.isAction, true);
  assert.equal(message.text, 'dans ediyor');
});

test('başka odadan gelen paylaşımlı sohbet mesajı yetki kazanmaz', () => {
  const line = '@badges=moderator/1;mod=1;room-id=1;source-room-id=2 :a!a@a PRIVMSG #c :!hype';
  assert.equal(privmsgToMessage(parseIrcLine(line)).isMod, false);
});

test('PRIVMSG olmayan satır mesaj üretmez', () => {
  assert.equal(privmsgToMessage(parseIrcLine('PING :x')), null);
});
