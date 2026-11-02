# Neon Stream Overlay

A free neon chat overlay for OBS Browser Source. For Twitch there is no backend, no account and no login: the page runs in OBS and reads public Twitch chat directly. Kick is optional and needs a [small bridge you deploy yourself](docs/KICK.md).

**[Live demo and link generator](https://berkantshn.github.io/neon-stream-overlay/)** | [Türkçe](#türkçe)

![Neon chat box with a burst effect, recorded from demo mode](docs/demo.gif)

*Recorded from demo mode with simulated chat. The grid behind the box is added for the recording, because the overlay background is transparent.*

## Features

- **Neon chat box** with five themes, custom colours, position, size and panel opacity
- **Safe text:** messages are shown as plain text only, never as HTML, with a length limit and removal of invisible and direction-changing characters
- **Message emphasis:** glow for burst triggers, highlight words, mentions of your channel and first-time chatters
- **Event bursts:** particles, rings and a big label on `!hype` or your own commands and keywords, with a cooldown
- **Mod control:** limit bursts to mods and the broadcaster, and optionally let mods add keywords live
- **Moderation aware:** messages that mods delete on Twitch also disappear from the overlay. On Kick, messages disappear when the user is banned or timed out
- **Optional Kick chat:** through Kick's official webhooks and your own bridge. [Read the notes first](#kick-optional)
- **Comfort and performance:** a reduced-motion option that also follows the system setting, and a low-quality option
- **Demo mode:** simulated chat that connects to nothing
- **Small:** about 5 KB of gzipped JavaScript and no runtime dependencies

## Kick (optional)

> **Kick requires your own bridge. This is a one-time technical setup, and Twitch needs none of it.**
>
> - You create a Kick app and deploy a small program to your own free Cloudflare account. The [step-by-step guide](docs/KICK.md) is written for non-developers.
> - **Not yet verified:** the bridge was tested only on a local computer with simulated, signed Kick events. A real Kick app, real webhook delivery, the real Cloudflare free plan and real OBS have not been tried. [Full list](docs/KICK.md#what-is-not-verified).
> - **Known limit:** Kick has no official event for one deleted message. A message a mod deletes stays on the overlay until it scrolls away or that user is banned or timed out.
> - The overlay link for Kick holds a private key. Do not show it on stream.

It uses only Kick's official webhooks, verified with Kick's public key. Each streamer uses their own Kick app, their own bridge and their own secrets.

## Add it to OBS

1. Open the [setup page](https://berkantshn.github.io/neon-stream-overlay/), turn **Demo mode** off and enter your Twitch channel name.
2. Pick your colours and effects, then press **Copy link**.
3. In OBS: **Sources**, **+**, **Browser**, **Create new**.
4. Paste the link into **URL**. Set the width to `450` and the height to `800`, or to any size you like.
5. Leave **Custom CSS** as it is. The background stays transparent.

To change a setting later, build a new link and replace the old one. Never add a password or token to the link. The overlay does not need one, and it shows a warning if it finds one. The only exception is the separate read-only overlay key of a Kick bridge, which the setup page places after the `#`.

## Settings

The setup page writes these for you. They are listed here for manual editing.

| Parameter | Values | Default | Meaning |
| --- | --- | --- | --- |
| `demo` | `0` `1` | `0` | Simulated chat. Turns off real connections |
| `twitch` | channel name | none | Twitch channel to read |
| `kick` | `https://` bridge address | none | Your own Kick bridge. Needs `overlay-kick.html` and `#kickkey=...`, which the setup page writes for you |
| `theme` | `cyber` `magma` `toxic` `ice` `synth` | `cyber` | Colour preset |
| `c1`, `c2` | `#rrggbb` | theme | Custom colours |
| `panel` | `0`-`100` | `70` | Panel opacity in percent |
| `font` | `12`-`40` | `18` | Text size in pixels |
| `w` | `240`-`1600` | `420` | Box width in pixels |
| `pos` | `bl` `br` `tl` `tr` | `bl` | Screen corner |
| `max` | `3`-`50` | `12` | Messages on screen |
| `fade` | `0`-`600` | `0` | Remove messages after this many seconds. `0` keeps them |
| `maxlen` | `20`-`500` | `200` | Maximum characters per message |
| `ignore` | comma list | none | Users to hide, such as bots |
| `hidecmd` | `0` `1` | `0` | Hide burst commands from the chat box |
| `hidelinks` | `0` `1` | `0` | Replace links with `[link]` |
| `commands` | comma list | `!hype` | Commands that trigger a burst |
| `keywords` | comma list | none | Words that trigger a burst |
| `highlights` | comma list | none | Words that glow without a burst |
| `fxby` | `all` `mods` | `all` | Who can trigger bursts |
| `cooldown` | `0`-`300` | `8` | Minimum seconds between bursts |
| `modkw` | `0` `1` | `0` | Let mods use `!neonkw add word`, `!neonkw del word` and `!neonkw clear` |
| `motion` | `auto` `reduced` | `auto` | Reduced motion. `auto` follows the system setting |
| `quality` | `high` `low` | `high` | `low` uses fewer particles and no glow shadows |
| `credit` | `0` `1` | `1` | Small credit on the overlay |
| `status` | `0` `1` | `1` | Connection status label |

Lists hold up to 20 items of up to 32 characters each. Keywords added with `!neonkw` last until the page reloads.

## Limits

**Twitch**

- Chat is read over Twitch's IRC WebSocket with an anonymous `justinfan` login. It is read-only, and the overlay never sends a chat message.
- This anonymous login is long-standing community knowledge, but Twitch's current documentation does not describe it, and Twitch prefers EventSub for new chat integrations. Twitch could change or end it at any time.
- There are no subscription, raid, bit or follow alerts in v1. Those need authenticated APIs.
- Emotes appear as their text name, such as `Kappa`. No images load from outside.
- Chat history is not shown. Messages appear from the moment the overlay connects.

**Kick**

- Works only through [your own bridge](docs/KICK.md), using Kick's official webhooks. There is no undocumented endpoint and no Pusher connection.
- Kick delivers events by webhook, so a bridge is required. Other developers report occasional late or missing webhooks, which the bridge cannot recover.
- Single deleted messages and `/clear` have no official event, so they stay on screen. Bans and timeouts remove the user's messages.
- Emotes appear as their text name. Chat history is not shown.
- The Cloudflare free plan allows about 100,000 events a day when this was written. Over that, Kick chat stops until the daily reset and Twitch keeps working. [Details](docs/KICK.md#cost-and-limits).

**In general**

- A Twitch link holds your settings in plain text and no secrets, because the overlay needs none. A Kick link also holds your overlay key, so keep it private.
- Very busy chats are rate-limited on screen, and the oldest waiting messages are dropped.
- This project is not affiliated with Twitch, Kick or Cloudflare.

## Privacy and security

- There are no analytics, cookies or third-party scripts. For Twitch there is no server: your browser or OBS connects straight to the chat service. Kick goes through your own bridge, which stores no chat history and writes no logs.
- A strict Content Security Policy allows only the Twitch socket on the default page. The Kick page first allows only secure sockets in its fixed policy, then its first script adds a second policy that narrows connections to your one validated bridge address before any overlay code runs. A browser applies the intersection of both.
- Chat text and names are written with `textContent`, so markup in a message stays visible text. Automated tests cover this.

## Development

Requires Node.js 22.12 or newer and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev      # local server. Open /overlay.html?demo=1
pnpm test     # sanitizer, parser, config, adapter and Kick bridge tests
pnpm build    # static site in dist/
```

The Kick bridge lives in `kick-bridge/`, with its own dependencies. `pnpm test:e2e` runs it locally on the official Cloudflare runtime with headless Chrome and signed fake webhooks. It needs `pnpm build` and `pnpm install` inside `kick-bridge/` first, and never contacts Kick.

The contents of `dist/` work on any static host. The included workflow publishes them to GitHub Pages from `main`.

---

# Türkçe

OBS Browser Source için ücretsiz neon sohbet katmanı (overlay). Twitch için sunucu, hesap veya giriş gerektirmez: sayfa OBS içinde çalışır ve herkese açık Twitch sohbetini doğrudan okur. Kick isteğe bağlıdır ve [kendiniz kurduğunuz küçük bir köprü](docs/KICK.md#kick-kurulum-rehberi) gerektirir.

**[Canlı demo ve bağlantı oluşturucu](https://berkantshn.github.io/neon-stream-overlay/)**

## Özellikler

- **Neon sohbet kutusu:** beş tema, özel renkler, konum, boyut ve panel saydamlığı
- **Güvenli metin:** mesajlar HTML olarak değil yalnızca düz metin olarak gösterilir; uzunluk sınırı vardır, görünmez ve yön değiştiren karakterler silinir
- **Mesaj vurgusu:** tetikleyiciler, vurgu kelimeleri, kanalınızdan bahsedenler ve ilk kez yazanlar parlar
- **Patlama efektleri:** `!hype` veya kendi komut ve kelimelerinizle parçacık, halka ve büyük yazı; bekleme süresi ayarlanabilir
- **Moderatör kontrolü:** efektleri moderatör ve yayıncıyla sınırlayabilir, isterseniz moderatörlerin canlıda kelime eklemesine izin verebilirsiniz
- **Moderasyona uyum:** Twitch'te moderatörün sildiği mesaj overlay'den de kalkar. Kick'te kullanıcı banlanınca veya susturulunca mesajları kalkar
- **İsteğe bağlı Kick sohbeti:** Kick'in resmi webhook'ları ve kendi köprünüzle. [Önce notları okuyun](#kick-isteğe-bağlı)
- **Konfor ve performans:** sistem ayarına da uyan hareket azaltma seçeneği ve düşük kalite seçeneği
- **Demo modu:** hiçbir yere bağlanmayan simüle sohbet
- **Küçük boyut:** yaklaşık 5 KB sıkıştırılmış JavaScript, çalışma anında bağımlılık yok

## Kick (isteğe bağlı)

> **Kick için kendi köprünüz gerekir. Bu, bir kerelik teknik bir kurulumdur; Twitch için hiçbirine gerek yoktur.**
>
> - Bir Kick uygulaması oluşturur ve kendi ücretsiz Cloudflare hesabınıza küçük bir program yüklersiniz. [Adım adım rehber](docs/KICK.md#kick-kurulum-rehberi) yazılımcı olmayanlar için yazıldı.
> - **Henüz doğrulanmadı:** köprü yalnızca yerel bilgisayarda, taklit edilmiş imzalı Kick olaylarıyla denendi. Gerçek Kick uygulaması, gerçek webhook teslimatı, gerçek Cloudflare ücretsiz planı ve gerçek OBS denenmedi. [Tam liste](docs/KICK.md#doğrulanmayanlar).
> - **Bilinen sınır:** Kick'te silinen tek mesaj için resmi olay yoktur. Modun sildiği mesaj, kayana veya o kullanıcı banlanana ya da susturulana kadar overlay'de kalır.
> - Kick için overlay bağlantısı gizli bir anahtar taşır. Yayında göstermeyin.

Yalnızca Kick'in resmi webhook'larını kullanır ve bunları Kick'in açık anahtarıyla doğrular. Her yayıncı kendi Kick uygulamasını, kendi köprüsünü ve kendi gizli değerlerini kullanır.

## OBS'e ekleme

1. [Kurulum sayfasını](https://berkantshn.github.io/neon-stream-overlay/) açın, **Demo mode** seçeneğini kapatın ve Twitch kanal adınızı yazın.
2. Renk ve efektleri seçip **Copy link** düğmesine basın.
3. OBS'te: **Kaynaklar**, **+**, **Tarayıcı**, **Yeni oluştur**.
4. Bağlantıyı **URL** alanına yapıştırın. Genişliği `450`, yüksekliği `800` yapın veya istediğiniz boyutu girin.
5. **Özel CSS** alanını olduğu gibi bırakın. Arka plan saydam kalır.

Bir ayarı sonradan değiştirmek için yeni bağlantı oluşturup eskisiyle değiştirin. Bağlantıya asla parola veya token eklemeyin. Overlay'in buna ihtiyacı yoktur, böyle bir değer görürse uyarı gösterir. Tek istisna, Kick köprüsünün salt okunur overlay anahtarıdır; kurulum sayfası bunu `#` işaretinden sonraya yazar.

Tüm URL parametreleri yukarıdaki [Settings](#settings) tablosundadır. Kurulum sayfası bunları sizin yerinize yazar.

## Sınırlar

**Twitch**

- Sohbet, Twitch'in IRC WebSocket bağlantısından anonim `justinfan` girişiyle okunur. Yalnızca okuma yapılır, overlay sohbete hiçbir mesaj göndermez.
- Bu anonim giriş topluluk tarafından uzun süredir bilinir, ancak Twitch'in güncel belgelerinde anlatılmaz ve Twitch yeni sohbet entegrasyonları için EventSub'ı önerir. Twitch bunu her an değiştirebilir veya kapatabilir.
- v1'de abonelik, raid, bit ve takip bildirimi yoktur. Bunlar kimlik doğrulamalı API gerektirir.
- Emote'lar `Kappa` gibi metin adıyla görünür. Dışarıdan görsel yüklenmez.
- Sohbet geçmişi gösterilmez. Mesajlar overlay bağlandığı andan itibaren görünür.

**Kick**

- Yalnızca Kick'in resmi webhook'larıyla, [kendi köprünüz](docs/KICK.md#kick-kurulum-rehberi) üzerinden çalışır. Belgelenmemiş uç veya Pusher bağlantısı yoktur.
- Kick olayları webhook ile ilettiği için köprü zorunludur. Başka geliştiriciler ara sıra geciken veya gelmeyen webhook bildiriyor; köprü bunları geri getiremez.
- Silinen tek mesaj ve `/clear` için resmi olay yoktur, bu yüzden ekranda kalırlar. Ban ve susturma kullanıcının mesajlarını kaldırır.
- Emote'lar metin adıyla görünür. Sohbet geçmişi gösterilmez.
- Bu yazı hazırlanırken Cloudflare ücretsiz planı günde yaklaşık 100.000 olaya izin veriyordu. Aşılırsa Kick sohbeti günlük sıfırlamaya kadar durur, Twitch çalışmaya devam eder. [Ayrıntılar](docs/KICK.md#maliyet-ve-sınırlar).

**Genel**

- Twitch bağlantısı ayarlarınızı düz metin olarak taşır ve gizli bilgi içermez, çünkü overlay'in buna ihtiyacı yoktur. Kick bağlantısı ayrıca overlay anahtarınızı taşır, gizli tutun.
- Çok yoğun sohbetlerde ekrana yazma hızı sınırlanır ve sırada bekleyen en eski mesajlar atılır.
- Bu proje Twitch, Kick veya Cloudflare ile bağlantılı değildir.

## Gizlilik ve güvenlik

- Analitik, çerez veya üçüncü taraf script yoktur. Twitch için sunucu yoktur: tarayıcınız ya da OBS doğrudan sohbet servisine bağlanır. Kick, sohbet geçmişi saklamayan ve günlük yazmayan kendi köprünüzden geçer.
- Sıkı bir Content Security Policy, varsayılan sayfada yalnızca Twitch soketine izin verir. Kick sayfasının sabit politikası önce yalnızca güvenli soketlere izin verir, ardından ilk script ikinci bir politika ekleyerek overlay kodu başlamadan bağlantıları doğrulanmış tek köprü adresinize daraltır. Tarayıcı iki politikanın kesişimini uygular.
- Sohbet metni ve kullanıcı adları `textContent` ile yazılır, yani mesajdaki işaretleme görünür metin olarak kalır. Otomatik testler bunu doğrular.

## Geliştirme

Node.js 22.12 veya üstü ve [pnpm](https://pnpm.io) gerekir.

```bash
pnpm install
pnpm dev      # yerel sunucu. /overlay.html?demo=1 adresini açın
pnpm test     # temizleyici, çözücü, ayar, adaptör ve Kick köprüsü testleri
pnpm build    # dist/ içinde statik site
```

Kick köprüsü, kendi bağımlılıklarıyla `kick-bridge/` içindedir. `pnpm test:e2e`, köprüyü resmi Cloudflare yerel ortamında, başsız Chrome ve imzalı sahte webhook'larla çalıştırır. Önce `pnpm build` ve `kick-bridge/` içinde `pnpm install` gerekir; Kick'e hiç bağlanmaz.

`dist/` içeriği her statik barındırmada çalışır. Projedeki iş akışı bunu `main` dalından GitHub Pages'e yayınlar.

## ⭐ Support this project

If this project helped you, please give it a ⭐ and [follow me on GitHub](https://github.com/berkantshn) for more.

İşine yaradıysa projeye ⭐ verip [beni GitHub'da takip edebilirsin](https://github.com/berkantshn).

---

MIT License. Made By FALCREB
