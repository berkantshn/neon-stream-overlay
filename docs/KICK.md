# Kick setup guide

Made By FALCREB | [Türkçe](#kick-kurulum-rehberi)

Twitch works without any of this. Kick needs a small program called a **bridge** that you put online yourself, once. You do not need to be a developer, but you will paste a few commands into a terminal. Plan for about 30 minutes.

**Honest status:** this bridge was tested only on a local computer with simulated Kick events. It has not yet been tested with a real Kick app, real webhook delivery, the real Cloudflare free plan or real OBS. See [What is not verified](#what-is-not-verified).

## How it works

```
Kick --(signed webhook)--> your bridge on Cloudflare --(WebSocket)--> your overlay in OBS
```

- A **webhook** is a message that Kick's servers send to your address whenever something happens, like a chat message. It is Kick's official way to deliver events, and the only official way a small bridge can receive chat.
- A **Cloudflare Worker** is a small program that runs on Cloudflare's servers. A **Durable Object** is the part of it that keeps the overlay connected.
- The bridge checks Kick's **signature** (a mathematical proof that the message came from Kick), drops anything else, and forwards only a display name, message text, colour, role and message ID. It stores no chat history.

## What you get, and what you do not

| | Twitch | Kick through your bridge |
| --- | --- | --- |
| Chat text and names | Yes | Yes |
| Bursts, highlights, mod control | Yes | Yes. Roles depend on the badges Kick sends |
| Banned or timed-out user disappears | Yes | Yes, through `moderation.banned` |
| One message deleted by a mod disappears | Yes | **No.** Kick has no webhook for this and said in December 2025 that it does not plan one. It stays on screen until it scrolls away or the user is banned |
| Chat `/clear` empties the overlay | Yes | **No.** No documented event |
| Needs an account or a server | No | **Yes**: a Kick app and a free Cloudflare account |
| Delivery speed | Direct | Depends on Kick's webhooks. Other developers report occasional delays or gaps |

## Before you start

- A Kick account with **two-factor authentication (2FA)** turned on. Kick requires it for developer tools.
- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account.
- [Node.js](https://nodejs.org) version 22.12 or newer. Choose the LTS installer.
- Read Kick's **Developer Terms and Conditions** in your [Developer settings](https://kick.com/settings/developer) before creating an app. You are the one agreeing to them.

Never paste your Client Secret or overlay key into chat, a screenshot, a stream or a public file.

## Step 1: Get the code

1. Open the [project page](https://github.com/berkantshn/neon-stream-overlay), press **Code**, then **Download ZIP**.
2. Unzip it to a short path. On Windows use something like `C:\neon`, because very long folder paths can break the tools.
3. Open a terminal (Windows: right-click the folder, **Open in Terminal**) inside the `kick-bridge` folder. All commands below run there.
4. Install the tools. **pnpm** is the package manager (a tool that downloads what a project needs) this project uses:

```bash
npm install -g pnpm
pnpm install
```

## Step 2: Put the bridge online

```bash
pnpm exec wrangler login
pnpm run deploy
```

The first command opens your browser so you can allow **wrangler**, Cloudflare's official command-line tool. The second **deploys** (publishes) the bridge. Cloudflare may ask you to pick a `workers.dev` name the first time.

The output ends with your address, for example:

```
https://neon-kick-bridge.your-name.workers.dev
```

Save it. Open it in a browser. It should say that the bridge is deployed but some values are missing. That is correct for now.

Use the `workers.dev` address, **not a custom domain**. Developers have reported that a custom domain's bot protection silently blocks Kick's webhooks before they reach the Worker ([Kick issue 403](https://github.com/KickEngineering/KickDevDocs/issues/403)).

## Step 3: Create your Kick app

1. Open [Kick Developer settings](https://kick.com/settings/developer) and create an app. Any name works. If a **Redirect URL** is required, enter your bridge address. The bridge never uses it.
2. Note your **Client ID** and **Client Secret**. The secret is like a password for the app: it stays on your computer and is never given to the bridge or the overlay.
3. Edit the app, turn **Enable Webhooks** on, and set the **Webhook URL** to your bridge address plus `/webhook`:

```
https://neon-kick-bridge.your-name.workers.dev/webhook
```

The exact look of Kick's settings page may differ from this description.

## Step 4: Subscribe to your chat

```bash
pnpm run subscribe
```

Enter your Client ID, Client Secret (hidden while you type) and channel name, meaning the last part of `kick.com/yourname`. The tool asks Kick for a short-lived token, subscribes to `chat.message.sent` and `moderation.banned` for your channel, then cancels the token. It saves nothing. Each event should say `subscribed`.

Note the line `BROADCASTER_USER_ID for yourname: 12345678`.

## Step 5: Give the bridge its two values

Create an **overlay key**. It is a separate read-only password that only lets an overlay listen. If it leaks, you can replace it without touching Kick.

```bash
pnpm run new-key
```

Copy the printed key somewhere private for a moment, then run these. Each one asks you to paste a value:

```bash
pnpm exec wrangler secret put OVERLAY_KEY
pnpm exec wrangler secret put BROADCASTER_USER_ID
```

Paste the key for the first and your number for the second. These live in Cloudflare's **secret store**, which hides them after saving. They never go into a file in this project.

Refresh your bridge address in the browser. It should now say **Neon Kick bridge is running**. The bridge accepts events for that one channel only, and ignores all others.

## Step 6: Make your OBS link

1. Open the [setup page](https://berkantshn.github.io/neon-stream-overlay/) and turn **Demo mode** off.
2. In **Kick bridge**, enter your bridge address (with nothing after `.dev`) and your overlay key. You can also enter your Twitch channel to show both chats.
3. Press **Copy link** and add it to OBS as a Browser Source, as described in the [README](../README.md#add-it-to-obs).

**This link holds your overlay key, so treat it like a password.** Do not show it on stream, for example while your OBS properties window or a browser address bar is visible. The key sits after the `#`, which browsers do not send to the website hosting the page.

## Step 7: Test it

Ask someone else to write in your Kick chat while the overlay is open, or write from a second account. The overlay status should first say `Kick: connected to your bridge`.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `Kick: reconnecting`, then a message pointing to this guide | The bridge is not reachable or the key is wrong. Check the address, make a new link, and reload the overlay |
| Connected, but no messages | Run `pnpm run list`. Kick can take a short time to list a new subscription. Check the Webhook URL ends in `/webhook` and is on `workers.dev`. Test with a real person's chat message |
| It worked, then stopped | Kick cancels a subscription if your webhook keeps failing for over a day, such as when the free quota runs out. Run `pnpm run subscribe` again |
| Missing or late messages with everything correct | Developers have reported this on Kick's side ([issue 300](https://github.com/KickEngineering/KickDevDocs/issues/300), [issue 367](https://github.com/KickEngineering/KickDevDocs/issues/367)). The bridge cannot recover a message that Kick did not send |
| `Too many overlays` | At most five overlays can connect at once. Close one, then reload |
| Everything fails with `key_unavailable` | The bridge could not read Kick's public key. It tries again by itself. If it continues, see [the public key section](#public-key-problem) |
| `spawn ... workerd.exe ENOENT` on Windows | The folder path is too long. Move the project to a short path like `C:\neon` |

### Public key problem

By default the bridge reads Kick's current public key from the official address, because Kick says the key can change at any time. If Cloudflare cannot reach that address, you can store the key yourself as a temporary measure. Copy it from `https://api.kick.com/public/v1/public-key` and run `pnpm exec wrangler secret put KICK_PUBLIC_KEY_PEM`. The stored copy stops working if Kick changes its key. Remove it with `pnpm exec wrangler secret delete KICK_PUBLIC_KEY_PEM` once the problem has passed.

## Rotating keys

**Overlay key.** If your link was shown or shared:

1. Run `pnpm run new-key`, then `pnpm exec wrangler secret put OVERLAY_KEY` with the new key.
2. Make a new link on the setup page and replace it in OBS.

Overlays using the old key are disconnected at the next event or connection and show a message asking for a new link.

**Kick Client Secret.** Regenerate it in Kick's Developer settings if your settings page offers it, or delete the app and start again from Step 3. The bridge does not hold this secret, so the bridge needs no change.

## Deleting everything

Run these inside `kick-bridge`:

1. Stop Kick's messages: `pnpm run unsubscribe`
2. Delete the bridge from Cloudflare: `pnpm exec wrangler delete`. Then check that `neon-kick-bridge` is gone under **Workers & Pages** in the [Cloudflare dashboard](https://dash.cloudflare.com).
3. Delete the app in [Kick Developer settings](https://kick.com/settings/developer). Turning webhooks off also cancels its subscriptions.
4. Remove the Browser Source from OBS, then delete the project folder.

The bridge stores only recent message IDs and their times, used to detect replays. No chat text is stored.

## Cost and limits

Cloudflare's free plan had these limits when this guide was written (checked 2026-11-02; [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)). Check them yourself, because they can change:

- 100,000 Worker requests a day
- 100,000 Durable Object requests a day
- 13,000 GB-seconds of Durable Object time a day
- 100,000 stored rows written a day, 5 million read, 5 GB stored

Each chat message uses about one of each of the first two and one row written. So the practical ceiling is **about 100,000 Kick events a day, roughly one message a second around the clock, counting the hours you are offline too**, since Kick sends webhooks whenever your chat is active. A very busy channel can go over this.

On the free plan, going over does not create a bill according to Cloudflare's documentation. The operation fails until the limit resets at 00:00 UTC. Kick chat stops during that time, but Twitch and the overlay keep working. Do not add a payment method unless you intend to.

Your bridge address is not secret, so a stranger could send junk requests that use up your daily quota. Invalid requests are refused and limited per IP address on a best-effort basis, but they still count as requests. This can stop your Kick chat for the day. It cannot run up a bill on the free plan.

## Security summary

- **Signature:** every webhook is checked against Kick's public key with RSA and SHA-256. Unsigned or tampered requests are refused.
- **Replays:** a message ID is accepted once, and a timestamp more than 5 minutes off is ignored. These are not shown, even though Kick receives a success reply so that it will not cancel your subscription.
- **Size:** bodies over 32 KB are refused.
- **Only your channel:** events for any other broadcaster are dropped, so the bridge is not an open relay.
- **Secrets:** the overlay key and channel ID live only in Cloudflare's secret store. Your Client Secret never leaves your computer. Worker logs are off, and the bridge writes no logs.
- **The overlay's own protection:** the overlay accepts socket connections only to your validated bridge address, using a Content Security Policy that the browser enforces.

## What is not verified

- A real Kick app, real webhook delivery and the real format of real events. The event format comes from Kick's documentation.
- That app tokens receive `moderation.banned`. Kick's documentation allows it but it was not tried. Timeouts are assumed to arrive as bans with an end time.
- Badge names other than `moderator`. The broadcaster is detected by user ID. A `vip` label depends on a badge name that the documentation does not list.
- Kick's retry behaviour. It is not documented.
- The Cloudflare free plan in real use, and whether Cloudflare can always reach Kick's public key address.
- Real OBS. Testing used headless Chrome. OBS uses a Chromium-based browser, so it should behave the same.

Sources checked 2026-11-02: [Kick webhooks](https://docs.kick.com/events/webhook-security), [Kick events](https://docs.kick.com/events/event-types), [Kick subscriptions](https://docs.kick.com/events/subscribe-to-events), [Kick OAuth](https://docs.kick.com/getting-started/generating-tokens-oauth2-flow).

This project is not affiliated with Kick or Cloudflare.

---

# Kick kurulum rehberi

Made By FALCREB

Twitch bunların hiçbirine ihtiyaç duymaz. Kick için **köprü** (bridge) adlı küçük bir programı bir kez, kendiniz internete koymanız gerekir. Yazılımcı olmanız gerekmez, ama terminale birkaç komut yapıştıracaksınız. Yaklaşık 30 dakika ayırın.

**Dürüst durum:** bu köprü yalnızca yerel bilgisayarda, taklit edilmiş Kick olaylarıyla denendi. Gerçek bir Kick uygulaması, gerçek webhook teslimatı, gerçek Cloudflare ücretsiz planı ve gerçek OBS ile henüz denenmedi. Bkz. [Doğrulanmayanlar](#doğrulanmayanlar).

## Nasıl çalışır

```
Kick --(imzalı webhook)--> Cloudflare'deki köprünüz --(WebSocket)--> OBS'teki overlay'iniz
```

- **Webhook:** Kick sunucularının, sohbet mesajı gibi bir olay olduğunda sizin adresinize gönderdiği mesajdır. Kick'in olayları iletmek için sunduğu resmi yoldur ve küçük bir köprünün sohbeti alabileceği tek resmi yoldur.
- **Cloudflare Worker:** Cloudflare sunucularında çalışan küçük programdır. **Durable Object** ise bunun overlay'i bağlı tutan parçasıdır.
- Köprü, Kick'in **imzasını** (mesajın Kick'ten geldiğinin matematiksel kanıtı) kontrol eder, gerisini atar ve yalnızca görünen ad, mesaj metni, renk, rol ve mesaj kimliğini iletir. Sohbet geçmişi saklamaz.

## Neler var, neler yok

| | Twitch | Köprüyle Kick |
| --- | --- | --- |
| Sohbet metni ve adlar | Var | Var |
| Patlama efektleri, vurgular, mod kontrolü | Var | Var. Roller Kick'in gönderdiği rozetlere bağlıdır |
| Banlanan veya susturulan kullanıcı kaybolur | Var | Var, `moderation.banned` ile |
| Modun sildiği tek mesaj kaybolur | Var | **Yok.** Kick'te bunun için webhook yok ve Aralık 2025'te bunu planlamadığını söyledi. Mesaj kayana veya kullanıcı banlanana kadar ekranda kalır |
| Sohbette `/clear` overlay'i boşaltır | Var | **Yok.** Belgelenmiş olayı yok |
| Hesap veya sunucu gerekir | Hayır | **Evet:** bir Kick uygulaması ve ücretsiz Cloudflare hesabı |
| İletim hızı | Doğrudan | Kick'in webhook'larına bağlı. Başka geliştiriciler ara sıra gecikme ve kayıp bildiriyor |

## Başlamadan önce

- **İki adımlı doğrulaması (2FA)** açık bir Kick hesabı. Kick geliştirici araçları için bunu şart koşuyor.
- Ücretsiz bir [Cloudflare](https://dash.cloudflare.com/sign-up) hesabı.
- [Node.js](https://nodejs.org) 22.12 veya üstü. LTS kurulumunu seçin.
- Uygulama oluşturmadan önce [Geliştirici ayarlarınızdaki](https://kick.com/settings/developer) **Developer Terms and Conditions** metnini okuyun. Bu şartları kabul eden kişi sizsiniz.

Client Secret değerinizi veya overlay anahtarınızı asla sohbete, ekran görüntüsüne, yayına veya herkese açık bir dosyaya yapıştırmayın.

## 1. Adım: Kodu indirin

1. [Proje sayfasını](https://github.com/berkantshn/neon-stream-overlay) açın, **Code** ve ardından **Download ZIP** seçin.
2. Kısa bir yola çıkarın. Windows'ta `C:\neon` gibi bir yer kullanın, çünkü çok uzun klasör yolları araçları bozabilir.
3. `kick-bridge` klasörünün içinde terminal açın (Windows: klasöre sağ tıklayın, **Terminalde Aç**). Aşağıdaki tüm komutlar burada çalışır.
4. Araçları kurun. **pnpm**, bu projenin kullandığı paket yöneticisidir (projenin ihtiyaç duyduklarını indiren araç):

```bash
npm install -g pnpm
pnpm install
```

## 2. Adım: Köprüyü internete koyun

```bash
pnpm exec wrangler login
pnpm run deploy
```

İlk komut, Cloudflare'in resmi komut satırı aracı **wrangler**'a izin vermeniz için tarayıcıyı açar. İkincisi köprüyü **deploy** eder (yayınlar). Cloudflare ilk seferde bir `workers.dev` adı seçmenizi isteyebilir.

Çıktının sonunda adresiniz görünür, örneğin:

```
https://neon-kick-bridge.adiniz.workers.dev
```

Adresi kaydedin ve tarayıcıda açın. Köprünün yayınlandığını ama bazı değerlerin eksik olduğunu söylemelidir. Şimdilik bu doğrudur.

**Özel alan adı değil**, `workers.dev` adresini kullanın. Geliştiriciler, özel alan adındaki bot korumasının Kick webhook'larını Worker'a ulaşmadan sessizce engellediğini bildirdi ([Kick issue 403](https://github.com/KickEngineering/KickDevDocs/issues/403)).

## 3. Adım: Kick uygulamanızı oluşturun

1. [Kick Geliştirici ayarlarını](https://kick.com/settings/developer) açıp bir uygulama oluşturun. Ad önemli değildir. **Redirect URL** istenirse köprü adresinizi yazın. Köprü bunu kullanmaz.
2. **Client ID** ve **Client Secret** değerlerini not edin. Secret, uygulamanın parolası gibidir: bilgisayarınızda kalır, köprüye veya overlay'e asla verilmez.
3. Uygulamayı düzenleyin, **Enable Webhooks** seçeneğini açın ve **Webhook URL** alanına köprü adresinizin sonuna `/webhook` ekleyerek yazın:

```
https://neon-kick-bridge.adiniz.workers.dev/webhook
```

Kick ayar sayfasının görünümü bu anlatımdan farklı olabilir.

## 4. Adım: Sohbetinize abone olun

```bash
pnpm run subscribe
```

Client ID, Client Secret (yazarken gizlenir) ve kanal adınızı, yani `kick.com/adiniz` adresinin son kısmını girin. Araç Kick'ten kısa ömürlü bir token alır, kanalınız için `chat.message.sent` ve `moderation.banned` olaylarına abone olur ve token'ı iptal eder. Hiçbir şey kaydetmez. Her olayın yanında `subscribed` görmelisiniz.

`BROADCASTER_USER_ID for adiniz: 12345678` satırını not edin.

## 5. Adım: Köprüye iki değerini verin

Bir **overlay anahtarı** oluşturun. Bu, overlay'in yalnızca dinlemesine izin veren ayrı bir parola gibidir. Sızarsa Kick'e dokunmadan değiştirebilirsiniz.

```bash
pnpm run new-key
```

Çıkan anahtarı kısa süreliğine güvenli bir yere kopyalayın, sonra şu komutları çalıştırın. Her biri bir değer yapıştırmanızı ister:

```bash
pnpm exec wrangler secret put OVERLAY_KEY
pnpm exec wrangler secret put BROADCASTER_USER_ID
```

İlkine anahtarı, ikincisine numaranızı yapıştırın. Bunlar Cloudflare'in **secret deposunda** durur ve kaydedildikten sonra görünmez. Projedeki hiçbir dosyaya yazılmaz.

Tarayıcıda köprü adresini yenileyin. Artık **Neon Kick bridge is running** yazmalıdır. Köprü yalnızca bu kanalın olaylarını kabul eder, diğerlerini yok sayar.

## 6. Adım: OBS bağlantınızı oluşturun

1. [Kurulum sayfasını](https://berkantshn.github.io/neon-stream-overlay/) açın ve **Demo mode** seçeneğini kapatın.
2. **Kick bridge** bölümüne köprü adresinizi (`.dev`'den sonra hiçbir şey olmadan) ve overlay anahtarınızı girin. İki sohbeti birlikte göstermek için Twitch kanalınızı da yazabilirsiniz.
3. **Copy link** düğmesine basın ve [README](../README.md#obse-ekleme)'de anlatıldığı gibi OBS'e Tarayıcı kaynağı olarak ekleyin.

**Bu bağlantı overlay anahtarınızı taşır, parola gibi davranın.** Örneğin OBS özellikler penceresi veya tarayıcı adres çubuğu görünürken bağlantıyı yayında göstermeyin. Anahtar `#` işaretinden sonra durur; tarayıcılar bu kısmı sayfayı barındıran siteye göndermez.

## 7. Adım: Deneyin

Overlay açıkken başka birinden Kick sohbetinize yazmasını isteyin veya ikinci bir hesaptan yazın. Overlay durumu önce `Kick: connected to your bridge` göstermelidir.

## Sorun giderme

| Gördüğünüz | Yapılacak |
| --- | --- |
| `Kick: reconnecting`, sonra bu rehberi gösteren mesaj | Köprüye ulaşılamıyor veya anahtar yanlış. Adresi kontrol edin, yeni bağlantı oluşturun ve overlay'i yenileyin |
| Bağlı ama mesaj yok | `pnpm run list` çalıştırın. Kick yeni aboneliği kısa bir gecikmeyle listeleyebilir. Webhook URL'sinin `/webhook` ile bittiğini ve `workers.dev` üzerinde olduğunu kontrol edin. Gerçek bir kişinin mesajıyla deneyin |
| Çalışıyordu, durdu | Webhook bir günden uzun süre hata verirse, örneğin ücretsiz kota bittiğinde, Kick aboneliği iptal eder. `pnpm run subscribe` komutunu yeniden çalıştırın |
| Her şey doğruyken eksik veya geç mesaj | Geliştiriciler bunu Kick tarafında bildirdi ([issue 300](https://github.com/KickEngineering/KickDevDocs/issues/300), [issue 367](https://github.com/KickEngineering/KickDevDocs/issues/367)). Köprü, Kick'in göndermediği mesajı geri getiremez |
| `Too many overlays` | Aynı anda en fazla beş overlay bağlanabilir. Birini kapatıp yenileyin |
| Her şey `key_unavailable` ile başarısız | Köprü Kick'in açık anahtarını okuyamadı. Kendiliğinden yeniden dener. Sürerse [açık anahtar bölümüne](#açık-anahtar-sorunu) bakın |
| Windows'ta `spawn ... workerd.exe ENOENT` | Klasör yolu çok uzun. Projeyi `C:\neon` gibi kısa bir yola taşıyın |

### Açık anahtar sorunu

Köprü varsayılan olarak Kick'in güncel açık anahtarını resmi adresten okur, çünkü Kick anahtarın her an değişebileceğini söylüyor. Cloudflare bu adrese ulaşamazsa geçici önlem olarak anahtarı kendiniz saklayabilirsiniz. `https://api.kick.com/public/v1/public-key` adresinden kopyalayıp `pnpm exec wrangler secret put KICK_PUBLIC_KEY_PEM` çalıştırın. Kick anahtarını değiştirirse bu kopya çalışmaz. Sorun geçince `pnpm exec wrangler secret delete KICK_PUBLIC_KEY_PEM` ile kaldırın.

## Anahtarları değiştirme

**Overlay anahtarı.** Bağlantınız görüldüyse veya paylaşıldıysa:

1. `pnpm run new-key`, ardından yeni anahtarla `pnpm exec wrangler secret put OVERLAY_KEY` çalıştırın.
2. Kurulum sayfasında yeni bağlantı oluşturup OBS'te değiştirin.

Eski anahtarı kullanan overlay'ler sonraki olayda veya bağlantıda kesilir ve yeni bağlantı isteyen bir mesaj gösterir.

**Kick Client Secret.** Ayar sayfanız sunuyorsa Kick Geliştirici ayarlarından yenileyin ya da uygulamayı silip 3. adımdan başlayın. Köprü bu secret'ı tutmadığı için köprüde değişiklik gerekmez.

## Her şeyi silme

Bunları `kick-bridge` içinde çalıştırın:

1. Kick mesajlarını durdurun: `pnpm run unsubscribe`
2. Köprüyü Cloudflare'den silin: `pnpm exec wrangler delete`. Ardından [Cloudflare panelinde](https://dash.cloudflare.com) **Workers & Pages** altında `neon-kick-bridge` kalmadığını kontrol edin.
3. Uygulamayı [Kick Geliştirici ayarlarından](https://kick.com/settings/developer) silin. Webhook'ları kapatmak da abonelikleri iptal eder.
4. Tarayıcı kaynağını OBS'ten kaldırın, sonra proje klasörünü silin.

Köprü yalnızca tekrar saldırısını anlamak için kullanılan yakın tarihli mesaj kimliklerini ve zamanlarını saklar. Sohbet metni saklanmaz.

## Maliyet ve sınırlar

Bu rehber yazılırken Cloudflare ücretsiz planının sınırları şöyleydi (2026-11-02'de kontrol edildi; [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)). Değişebilecekleri için kendiniz de kontrol edin:

- Günde 100.000 Worker isteği
- Günde 100.000 Durable Object isteği
- Günde 13.000 GB-saniye Durable Object süresi
- Günde 100.000 yazılan, 5 milyon okunan satır, toplam 5 GB saklama

Her sohbet mesajı ilk ikisinden yaklaşık birer tane ve bir yazılan satır harcar. Yani pratik tavan **günde yaklaşık 100.000 Kick olayı, günün her saati saniyede yaklaşık bir mesajdır; yayında olmadığınız saatler de sayılır**, çünkü sohbet her aktif olduğunda Kick webhook gönderir. Çok yoğun bir kanal bunu aşabilir.

Cloudflare belgesine göre ücretsiz planda sınırı aşmak fatura oluşturmaz. İşlem, sınır 00:00 UTC'de sıfırlanana kadar başarısız olur. Bu sürede Kick sohbeti durur, Twitch ve overlay çalışmaya devam eder. Niyetiniz yoksa ödeme yöntemi eklemeyin.

Köprü adresiniz gizli değildir, bu yüzden yabancı biri gereksiz isteklerle günlük kotanızı harcayabilir. Geçersiz istekler reddedilir ve IP başına en iyi çabayla sınırlanır, ama yine de istek sayılır. Bu, Kick sohbetinizi o gün için durdurabilir. Ücretsiz planda fatura çıkaramaz.

## Güvenlik özeti

- **İmza:** her webhook, RSA ve SHA-256 ile Kick'in açık anahtarına göre kontrol edilir. İmzasız veya değiştirilmiş istekler reddedilir.
- **Tekrar:** bir mesaj kimliği bir kez kabul edilir, 5 dakikadan fazla sapan zaman damgası yok sayılır. Bunlar gösterilmez; yine de Kick aboneliği iptal etmesin diye başarı yanıtı alır.
- **Boyut:** 32 KB üstü gövdeler reddedilir.
- **Yalnızca kanalınız:** başka yayıncıların olayları atılır, yani köprü açık bir geçit değildir.
- **Gizli değerler:** overlay anahtarı ve kanal kimliği yalnızca Cloudflare secret deposundadır. Client Secret bilgisayarınızdan çıkmaz. Worker günlükleri kapalıdır, köprü günlük yazmaz.
- **Overlay'in kendi koruması:** overlay, tarayıcının uyguladığı Content Security Policy sayesinde yalnızca doğrulanmış köprü adresinize soket açabilir.

## Doğrulanmayanlar

- Gerçek bir Kick uygulaması, gerçek webhook teslimatı ve gerçek olayların gerçek biçimi. Olay biçimi Kick belgesinden alındı.
- Uygulama token'ının `moderation.banned` alabildiği. Kick belgesi buna izin veriyor ama denenmedi. Susturmaların, bitiş zamanlı ban olarak geldiği varsayıldı.
- `moderator` dışındaki rozet adları. Yayıncı, kullanıcı kimliğinden anlaşılır. `vip` etiketi, belgede listelenmeyen bir rozet adına bağlıdır.
- Kick'in yeniden gönderim davranışı. Belgelenmemiş.
- Gerçek kullanımda Cloudflare ücretsiz planı ve Cloudflare'in Kick açık anahtar adresine her zaman ulaşabildiği.
- Gerçek OBS. Testler başsız Chrome ile yapıldı. OBS, Chromium tabanlı tarayıcı kullandığı için aynı davranması beklenir.

Kaynaklar, 2026-11-02'de kontrol edildi: [Kick webhook'ları](https://docs.kick.com/events/webhook-security), [Kick olayları](https://docs.kick.com/events/event-types), [Kick abonelikleri](https://docs.kick.com/events/subscribe-to-events), [Kick OAuth](https://docs.kick.com/getting-started/generating-tokens-oauth2-flow).

Bu proje Kick veya Cloudflare ile bağlantılı değildir.
