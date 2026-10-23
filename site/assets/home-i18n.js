(function () {
  'use strict';
  if (window.BPHome) return;
  // Match complete text nodes, never replace their containing markup.
  var copy = [
    ['Open source. Yours to inspect.', 'Açık kaynak. İncelemek senin elinde.', 'Открытый код. Изучайте сами.'],
    ['View on GitHub ↗', 'GitHub’da incele ↗', 'Посмотреть на GitHub ↗'],
    ['Read the code, report an issue, or contribute.', 'Kodu incele, sorun bildir veya katkıda bulun.', 'Изучайте код, сообщайте о проблемах или вносите свой вклад.'],
    ['Skip to content', 'İçeriğe geç', 'Перейти к содержимому'],
    ['Language', 'Dil', 'Язык'],
    ['How it works', 'Nasıl çalışır', 'Как это работает'],
    ['Open a message', 'Mesaj aç', 'Открыть сообщение'],
    ['Create a message', 'Mesaj oluştur', 'Создать сообщение'],
    ['Security', 'Güvenlik', 'Безопасность'],
    ['FAQ', 'SSS', 'Вопросы'],
    ['Download', 'İndir', 'Скачать'],
    ['Install', 'Kurulum', 'Установка'],
    ['Terms', 'Koşullar', 'Условия'],
    ['BetterDiscord plugin · E2E encryption', 'BetterDiscord eklentisi · Uçtan uca şifreleme', 'Плагин BetterDiscord · Сквозное шифрование'],
    ['Privacy, without', 'Gizlilik,', 'Приватность,'],
    ['leaving Discord.', 'Discord’dan çıkmadan.', 'оставаясь в Discord.'],
    ['Keep your servers, your friends, your memes. Messages and files encrypt', 'Sunucuların, arkadaşların ve memelerin yerinde kalsın. Mesajların ve dosyaların', 'Ваши серверы, друзья и мемы остаются. Сообщения и файлы шифруются'],
    ["inside your client, before they're sent", 'gönderilmeden önce kendi istemcinde şifrelenir', 'в вашем клиенте до отправки'],
    ['— share one phrase, everything else is automatic.', '— tek bir gizli ifade paylaş, gerisi otomatik.', '— поделитесь одной фразой, остальное происходит автоматически.'],
    ['Download the plugin', 'Eklentiyi indir', 'Скачать плагин'],
    ['On mobile? Use the web ↗', 'Telefonda mısın? Web’i kullan ↗', 'На телефоне? Откройте веб-версию ↗'],
    ['AES-256-GCM, locally', 'AES-256-GCM, cihazında', 'AES-256-GCM на устройстве'],
    ['Sealed in your client; opened only on screen. No servers, no accounts.', 'İstemcinde şifrelenir, yalnızca ekranında açılır. Sunucu yok, hesap yok.', 'Шифруется в клиенте, открывается на экране. Без серверов и аккаунтов.'],
    ['Phrase + channel = key', 'İfade + kanal = anahtar', 'Фраза + канал = ключ'],
    ['Deterministic — survives reinstalls and new machines. Nothing to back up.', 'Deterministik: yeniden kurulumda ve yeni cihazda da aynı. Yedek gerektirmez.', 'Воспроизводится после переустановки и на новом устройстве. Резервная копия не нужна.'],
    ['Files too', 'Dosyalar da dahil', 'Файлы тоже'],
    ['Uploads become opaque', 'Yüklenen dosyalar okunamayan', 'Загружаемые файлы превращаются в непрозрачные'],
    ['blobs; key holders see inline previews.', 'verisine dönüşür; anahtarı olanlar önizlemeleri görür.', 'блоки; владельцы ключа видят предпросмотр.'],
    ['Fails closed', 'Sorunda gönderimi durdurur', 'При сбое блокирует отправку'],
    ['Integration health is visible in the chat bar. A red bat means stop and check.', 'Entegrasyonun durumu sohbet çubuğunda görünür. Kırmızı yarasa: dur ve kontrol et.', 'Состояние интеграции видно в чате. Красная мышь означает: остановитесь и проверьте.'],
    ['interactive illustration · v1.0.0 · encryption on your device', 'etkileşimli gösterim · v1.0.0 · şifreleme cihazında', 'интерактивный пример · v1.0.0 · шифрование на устройстве'],
    ['encryption off', 'şifreleme kapalı', 'шифрование выключено'],
    ['decrypted locally', 'cihazında çözüldü', 'расшифровано на устройстве'],
    ['key derived — channel armed', 'anahtar türetildi — kanal hazır', 'ключ получен — канал защищён'],
    ['encrypted before sending', 'gönderilmeden şifrelendi', 'зашифровано до отправки'],
    ['Set a secret phrase', 'Gizli bir ifade belirle', 'Задайте секретную фразу'],
    ['Long and unique — the phrase is the entire protection.', 'Uzun ve benzersiz olsun — tüm koruma bu ifadeye bağlı.', 'Длинную и уникальную — вся защита зависит от фразы.'],
    ['Animated illustration · a friend encrypted #stargazing — you just need the phrase.', 'Animasyonlu gösterim · arkadaşın #stargazing kanalını şifreledi — tek gereken gizli ifade.', 'Анимированный пример · друг зашифровал #stargazing — вам нужна только фраза.'],
    ['A friend already encrypted #stargazing — you just need the phrase.', 'Arkadaşın #stargazing kanalını şifreledi — tek gereken gizli ifade.', 'Друг уже зашифровал #stargazing — вам нужна только фраза.'],
    ['Messages encrypt before sending; only phrase holders ever see plaintext.', 'Mesajlar gönderilmeden şifrelenir; açık metni yalnızca ifadeyi bilenler görür.', 'Сообщения шифруются до отправки; исходный текст видят только знающие фразу.'],
    ['Same phrase, same channel → same key. The old message just decrypted.', 'Aynı ifade, aynı kanal → aynı anahtar. Eski mesaj şimdi çözüldü.', 'Та же фраза, тот же канал → тот же ключ. Старое сообщение расшифровано.'],
    ['Sent. Discord receives and stores only this ciphertext.', 'Gönderildi. Discord yalnızca bu şifreli veriyi alır ve saklar.', 'Отправлено. Discord получает и хранит только этот шифротекст.'],
    ['Phrase holders see plaintext — rendered only on their screens.', 'İfadeyi bilenler açık metni görür — yalnızca kendi ekranlarında.', 'Знающие фразу видят исходный текст — только на своих экранах.'],
    ['01 / HOW IT WORKS', '01 / NASIL ÇALIŞIR', '01 / КАК ЭТО РАБОТАЕТ'],
    ['One button. One phrase. Nothing else to manage.', 'Tek buton. Tek ifade. Yönetmen gereken başka bir şey yok.', 'Одна кнопка. Одна фраза. Больше никаких хлопот.'],
    ['The key derives from your phrase and the channel itself, so the same phrase in the same channel always produces the same key — for everyone, on any machine, forever. No key files, no QR codes, no exchange protocol.', 'Anahtar, ifadenden ve kanalın kendisinden türetilir. Aynı kanalda aynı ifade her zaman, herkes için ve her cihazda aynı anahtarı üretir. Anahtar dosyası, QR kodu veya değişim protokolü yok.', 'Ключ выводится из фразы и самого канала. Одна фраза в одном канале всегда даёт один ключ — для всех и на любом устройстве. Без файлов ключей, QR-кодов и протоколов обмена.'],
    ['Click the 🦇 in the chat bar', 'Sohbet çubuğundaki 🦇 simgesine tıkla', 'Нажмите 🦇 в строке чата'],
    ['Open any channel, group, or DM. The bat button sits next to the message box and asks for exactly one thing.', 'Bir kanal, grup veya özel mesaj aç. Mesaj kutusunun yanındaki yarasa butonu senden tek bir şey ister.', 'Откройте канал, группу или личный чат. Кнопка с мышью рядом с полем сообщения попросит только одно.'],
    ["Make it long and unique — it's the entire protection. From that moment everything you send goes out encrypted, automatically.", 'Uzun ve benzersiz olsun — tüm koruma ona bağlı. O andan itibaren gönderdiğin her şey otomatik olarak şifrelenir.', 'Пусть она будет длинной и уникальной — от неё зависит вся защита. С этого момента всё отправляемое шифруется автоматически.'],
    ['Tell your people the phrase', 'İfadeyi arkadaşlarınla paylaş', 'Передайте фразу своим'],
    ['Share it', 'İfadeyi', 'Передайте её'],
    ['outside Discord', 'Discord dışında paylaş', 'вне Discord'],
    ['. They click the same 🦇, type the same phrase, and every message decrypts — past and future.', '. Onlar da aynı 🦇 simgesine tıklayıp aynı ifadeyi girer; geçmiş ve gelecek tüm mesajlar çözülür.', '. Они нажмут ту же 🦇, введут ту же фразу — и откроются все сообщения, прошлые и будущие.'],
    ['Grey', 'Gri', 'Серая'],
    ['Not encrypted. Click to set a phrase.', 'Şifrelenmiyor. İfade belirlemek için tıkla.', 'Не зашифровано. Нажмите, чтобы задать фразу.'],
    ['Green', 'Yeşil', 'Зелёная'],
    ['Encrypted. Everything sends as ciphertext.', 'Şifreli. Her şey şifrelenerek gönderilir.', 'Зашифровано. Всё отправляется шифротекстом.'],
    ['Amber', 'Sarı', 'Жёлтая'],
    ['Locked. Enter the phrase to unlock.', 'Kilitli. Açmak için ifadeyi gir.', 'Заблокировано. Для открытия введите фразу.'],
    ['Red', 'Kırmızı', 'Красная'],
    ['Integration needs attention. Pause and check the warning.', 'Entegrasyonu kontrol et. Dur ve uyarıyı incele.', 'Интеграция требует внимания. Остановитесь и прочитайте предупреждение.'],
    ['02 / COVERAGE', '02 / KAPSAM', '02 / ВОЗМОЖНОСТИ'],
    ['Everything encrypts. Discord still feels like Discord.', 'Her şey şifrelenir. Discord yine bildiğin Discord.', 'Всё шифруется. Discord остаётся привычным.'],
    ['Full markdown, after decrypt', 'Şifre çözülünce tam Markdown desteği', 'Полный Markdown после расшифровки'],
    ["Code blocks with syntax highlighting, spoilers, custom emoji, links — rendered by Discord's own parser once decrypted. It reads like a normal message, in green.", 'Sözdizimi renklendirmeli kod blokları, spoiler, özel emoji, bağlantılar: şifre çözülünce Discord’un kendi ayrıştırıcısıyla gösterilir. Normal bir mesaj gibi, yeşil renkte okunur.', 'Код с подсветкой, спойлеры, эмодзи, ссылки — после расшифровки их отображает сам Discord. Обычное сообщение, только зелёное.'],
    ['Encrypted files & media', 'Şifreli dosyalar ve medya', 'Зашифрованные файлы и медиа'],
    ['Images, video, audio, any file — uploaded as opaque', 'Görsel, video, ses, her türlü dosya — okunamayan', 'Изображения, видео, аудио, любые файлы загружаются как непрозрачные'],
    ['blobs with the real filename sealed inside. Key holders see inline previews; everyone else sees noise.', 'verisi olarak yüklenir; gerçek dosya adı da şifrelidir. Anahtarı olanlar önizlemeyi görür; diğerleri yalnızca anlamsız veri görür.', 'блоки с зашифрованным именем внутри. Владельцы ключа видят предпросмотр, остальные — шум.'],
    ['Nothing to back up', 'Yedeklenecek bir şey yok', 'Нечего резервировать'],
    ['Keys are derived, never stored. Wipe the plugin, switch machines, come back a year later — type the phrase and everything comes back.', 'Anahtarlar türetilir, saklanmaz. Eklentiyi sil, cihaz değiştir, bir yıl sonra dön: ifadeyi gir, her şey geri gelir.', 'Ключи выводятся, а не хранятся. Удалите плагин, смените устройство, вернитесь через год — введите фразу, и всё откроется.'],
    ['Auto-locking sessions', 'Otomatik kilitlenen oturumlar', 'Автоблокировка сеансов'],
    ['Keys live in memory only and re-lock after inactivity.', 'Anahtarlar yalnızca bellekte tutulur ve hareketsizlikte yeniden kilitlenir.', 'Ключи живут только в памяти и блокируются при бездействии.'],
    ['locks everything instantly; optional lockdown mode re-locks on every channel switch.', 'her şeyi anında kilitler; isteğe bağlı kilitleme modu her kanal değişiminde tekrar kilitler.', 'мгновенно блокирует всё; дополнительный режим блокирует ключи при каждой смене канала.'],
    ['Per-channel control', 'Kanal bazında kontrol', 'Управление по каналам'],
    ['Each channel has its own key and its own on/off switch.', 'Her kanalın ayrı anahtarı ve açma/kapama ayarı vardır.', 'У каждого канала свой ключ и переключатель.'],
    ['sends a single message in plaintext;', 'tek bir mesajı açık metin olarak gönderir;', 'отправляет одно сообщение без шифрования;'],
    ['picks a specific key. Power features stay in Settings.', 'belirli bir anahtar seçer. Gelişmiş özellikler Ayarlar’da kalır.', 'выбирает конкретный ключ. Дополнительные функции находятся в настройках.'],
    ['Visible integration health', 'Görünür entegrasyon durumu', 'Видимое состояние интеграции'],
    ['Discord updates can change its internals. The 🦇 turns red when a required integration is unavailable — check the warning before sending anything sensitive.', 'Discord güncellemeleri iç yapıyı değiştirebilir. Gerekli bir entegrasyon kullanılamazsa 🦇 kırmızı olur; hassas bir şey göndermeden önce uyarıyı kontrol et.', 'Обновления Discord могут менять его внутреннее устройство. Если нужная интеграция недоступна, 🦇 краснеет — проверьте предупреждение перед отправкой личного.'],
    ['data breach →', 'veri sızıntısı →', 'утечка данных →'],
    ['ciphertext', 'şifreli veri', 'шифротекст'],
    ['· scanning bot →', '· tarama botu →', '· сканирующий бот →'],
    ['· subpoena →', '· mahkeme talebi →', '· судебный запрос →'],
    ["Discord can't reveal", 'Discord ifşa edemez:', 'Discord не раскроет'],
    ["what it can't see.", 'göremediğini.', 'то, чего не видит.'],
    ['click the 🦇 — or hover the redaction — to decrypt', 'çözmek için 🦇 simgesine tıkla veya gizli metnin üzerine gel', 'нажмите 🦇 или наведите на скрытый текст, чтобы расшифровать'],
    ['03 / SECURITY, HONESTLY', '03 / GÜVENLİK, DÜRÜSTÇE', '03 / ЧЕСТНО О БЕЗОПАСНОСТИ'],
    ["Clear about what it does — and what it doesn't.", 'Neyi koruduğu da, korumadığı da açık.', 'Честно о том, что защищено, а что нет.'],
    ["The model is simple — Discord can't read what it never receives. Here are its exact edges: passphrase-based symmetric encryption with standard primitives, AES-256-GCM via WebCrypto, PBKDF2-HMAC-SHA256 at 600,000 rounds, with authenticated messages and files. Not independently audited.", 'Model basit: Discord almadığı şeyi okuyamaz. Sınırlar net: gizli ifadeye dayalı simetrik şifreleme, WebCrypto ile AES-256-GCM, 600.000 turlu PBKDF2-HMAC-SHA256 ve bütünlüğü doğrulanan mesajlar ile dosyalar. Bağımsız güvenlik denetiminden geçmedi.', 'Модель проста: Discord не прочитает то, чего не получил. Границы таковы: симметричное шифрование на основе фразы, AES-256-GCM через WebCrypto, PBKDF2-HMAC-SHA256 с 600 000 итераций, проверка подлинности сообщений и файлов. Независимый аудит не проводился.'],
    ['What it protects', 'Neyi korur', 'Что защищает'],
    ['Message and file contents.', 'Mesaj ve dosya içerikleri.', 'Содержимое сообщений и файлов.'],
    ["Discord's servers, data breaches, and subpoenas get ciphertext only.", 'Discord sunucularına, veri sızıntılarına ve mahkeme taleplerine yalnızca şifreli veri gider.', 'Серверы Discord, утечки и судебные запросы получают только шифротекст.'],
    ['Against network observers.', 'Ağ gözetimine karşı.', 'От наблюдателей в сети.'],
    ['ISPs and WiFi snoops see authenticated AES-256-GCM blobs.', 'İnternet sağlayıcıları ve Wi-Fi gözetleyicileri bütünlüğü doğrulanan AES-256-GCM verisi görür.', 'Провайдеры и наблюдатели Wi-Fi видят блоки AES-256-GCM с проверкой подлинности.'],
    ['Against non-recipients.', 'Alıcı olmayanlara karşı.', 'От посторонних.'],
    ['Anyone in the channel without the phrase sees unreadable ciphertext.', 'Kanalda ifadeyi bilmeyen herkes okunamayan şifreli veri görür.', 'Участники канала без фразы видят нечитаемый шифротекст.'],
    ['Attachment names.', 'Ek dosya adları.', 'Имена вложений.'],
    ['Files upload as randomly-named', 'Dosyalar rastgele adlandırılmış', 'Файлы загружаются со случайными именами'],
    ['; the real name is inside the encryption.', 'olarak yüklenir; gerçek ad şifrelemenin içindedir.', '; настоящее имя зашифровано внутри.'],
    ['Against tampering.', 'Değiştirmeye karşı.', 'От подмены.'],
    ['A modified message fails loudly instead of decrypting to something wrong.', 'Değiştirilmiş bir mesaj yanlış içerikle açılmaz, açıkça hata verir.', 'Изменённое сообщение выдаст явную ошибку вместо неверной расшифровки.'],
    ["What it doesn't", 'Neyi korumaz', 'Что не защищает'],
    ['Metadata.', 'Üst veriler.', 'Метаданные.'],
    ['Who talks to whom, when, and how much stays visible — as does the fact that you encrypt.', 'Kimin kiminle, ne zaman ve ne kadar konuştuğu görünür kalır; şifreleme kullandığın da öyle.', 'Кто с кем, когда и сколько общается, остаётся видно, как и сам факт шифрования.'],
    ['Weak phrases.', 'Zayıf ifadeler.', 'Слабые фразы.'],
    ['The phrase is the entire defense. Short or reused phrases can be guessed.', 'Tüm savunma bu ifadeye bağlıdır. Kısa veya tekrar kullanılan ifadeler tahmin edilebilir.', 'Вся защита зависит от фразы. Короткие или повторные фразы можно подобрать.'],
    ['No forward secrecy.', 'İleriye dönük gizlilik yok.', 'Нет прямой секретности.'],
    ['A leaked phrase exposes past and future messages encrypted with it.', 'Sızan bir ifade, onunla şifrelenmiş geçmiş ve gelecek mesajları açığa çıkarır.', 'Утечка фразы раскрывает прошлые и будущие сообщения, зашифрованные ею.'],
    ['Your own device.', 'Kendi cihazın.', 'Ваше устройство.'],
    ['Malware, or anyone at your unlocked keyboard, sees what you see.', 'Kötü amaçlı yazılım veya kilidi açık cihazının başındaki biri senin gördüğünü görür.', 'Вредоносное ПО или человек за вашим незаблокированным устройством видит то же, что и вы.'],
    ['Voice and video calls.', 'Sesli ve görüntülü aramalar.', 'Голосовые и видеозвонки.'],
    ['Out of scope — chat messages and file attachments only.', 'Kapsam dışı: yalnızca sohbet mesajları ve dosya ekleri.', 'Не входят в охват — только сообщения и вложения.'],
    ['Discord ToS warning.', 'Discord koşulları uyarısı.', 'Предупреждение об условиях Discord.'],
    ["BetterPrivacy runs on BetterDiscord, and modifying the Discord client violates Discord's Terms of Service — accounts can be suspended or banned. This project is for educational and personal use. Don't run it on an account you can't afford to lose.", 'BetterPrivacy, BetterDiscord üzerinde çalışır. Discord istemcisini değiştirmek Discord’un kullanım koşullarını ihlal eder; hesaplar askıya alınabilir veya yasaklanabilir. Proje eğitim ve kişisel kullanım içindir. Kaybetmeyi göze alamadığın bir hesapta kullanma.', 'BetterPrivacy работает через BetterDiscord. Изменение клиента нарушает условия Discord — аккаунт могут приостановить или заблокировать. Проект предназначен для обучения и личного использования. Не используйте его на аккаунте, который не готовы потерять.'],
    ['04 / INSTALL', '04 / KURULUM', '04 / УСТАНОВКА'],
    ['Two minutes, four steps.', 'İki dakika, dört adım.', 'Две минуты, четыре шага.'],
    ['— desktop only: Windows, macOS, or Linux.', 'kur — yalnızca masaüstü: Windows, macOS veya Linux.', '— только для компьютера: Windows, macOS или Linux.'],
    ['Download BetterPrivacy.plugin.js', 'BetterPrivacy.plugin.js dosyasını indir', 'Скачайте BetterPrivacy.plugin.js'],
    ['and drop it into your plugins folder:', 've eklenti klasörüne bırak:', 'и поместите в папку плагинов:'],
    ['In Discord, open', 'Discord’da', 'В Discord откройте'],
    ['Settings → BetterDiscord → Plugins', 'Ayarlar → BetterDiscord → Eklentiler', 'Настройки → BetterDiscord → Плагины'],
    ['and switch', 'yolunu aç ve', 'и включите'],
    ['on.', 'eklentisini etkinleştir.', '.'],
    ['Open a channel, click the', 'Bir kanal aç,', 'Откройте канал, нажмите'],
    [", set a phrase. You're encrypted.", 'simgesine tıkla, bir ifade belirle. Artık şifreliyorsun.', ', задайте фразу. Шифрование включено.'],
    ['05 / FAQ', '05 / SSS', '05 / ВОПРОСЫ'],
    ['Questions people actually ask.', 'Gerçekten sorulan sorular.', 'Вопросы, которые задают.'],
    ['What do people without the plugin see?', 'Eklentisi olmayanlar ne görür?', 'Что видят люди без плагина?'],
    ['A 🦇 followed by a link to this site. Clicking it opens the', 'Bir 🦇 ve ardından bu siteye bir bağlantı. Tıklayınca', '🦇 и ссылку на этот сайт. Нажатие открывает'],
    ['decrypt page', 'şifre çözme sayfası açılır', 'страницу расшифровки'],
    [': the scrambled payload rides in the URL fragment — which browsers never send to any server — and the secret phrase unlocks it right in the browser. Every encrypted message is both unreadable and a signpost to the plugin.', ': şifreli veri, tarayıcıların sunuculara göndermediği URL parçasında taşınır. Gizli ifade, veriyi doğrudan tarayıcıda açar. Her şifreli mesaj hem okunamazdır hem de eklentiye yönlendirir.', ': шифротекст находится во фрагменте URL, который браузеры не отправляют на сервер. Фраза открывает его прямо в браузере. Каждое зашифрованное сообщение нечитаемо и одновременно указывает на плагин.'],
    ['Do I need an account or a server?', 'Hesap veya sunucu gerekir mi?', 'Нужен ли аккаунт или сервер?'],
    ['No. There is no backend, no signup, no telemetry. Every cryptographic operation happens inside your Discord client via the WebCrypto API. You can also', 'Hayır. Arka uç, kayıt veya telemetri yok. Tüm kriptografik işlemler WebCrypto API ile Discord istemcinde gerçekleşir. Ayrıca', 'Нет. Нет сервера, регистрации и телеметрии. Все криптографические операции выполняются в клиенте Discord через WebCrypto API. Также можно'],
    ['create a message', 'mesaj oluşturabilir', 'создать сообщение'],
    ['or', 'veya', 'или'],
    ['open one in your browser', 'tarayıcında mesaj açabilirsin', 'открыть его в браузере'],
    [', including on mobile.', '; telefonda da kullanabilirsin.', ', в том числе на телефоне.'],
    ['What if I forget my phrase?', 'İfadeyi unutursam ne olur?', 'Что, если я забуду фразу?'],
    ["It's gone — by design. The plugin never stores the phrase or any way to recover it. Anyone else who knows the phrase effectively holds the backup, since typing it in the same channel always recreates the key.", 'Erişim kaybolur; tasarım böyle. Eklenti ifadeyi veya kurtarma yöntemini saklamaz. İfadeyi bilen başka biri aslında yedeğe sahiptir: aynı kanala aynı ifadeyi girmek anahtarı yeniden oluşturur.', 'Доступ потерян — так задумано. Плагин не хранит фразу и способ её восстановления. Другой знающий фразу человек фактически хранит резервную копию: та же фраза в том же канале воссоздаёт ключ.'],
    ['How do keys survive reinstalling the plugin?', 'Eklenti yeniden kurulunca anahtarlar nasıl korunur?', 'Как ключи переживают переустановку?'],
    ['Keys are derived deterministically — PBKDF2 over your phrase, salted by the channel. The phrase plus the channel', 'Anahtarlar, kanalın tuz değeriyle PBKDF2 kullanılarak ifadeden deterministik olarak türetilir. İfade ve kanal', 'Ключи выводятся детерминированно: PBKDF2 из фразы с солью канала. Фраза вместе с каналом'],
    ['is', 'zaten', 'и есть'],
    ['the key. Reinstall, switch machines, type the phrase again, and everything decrypts.', 'anahtarın kendisidir. Yeniden kur, cihaz değiştir, ifadeyi tekrar gir; her şey çözülür.', 'ключ. Переустановите, смените устройство, введите фразу — и всё расшифруется.'],
    ['Can I send one unencrypted message without switching encryption off?', 'Şifrelemeyi kapatmadan tek bir açık mesaj gönderebilir miyim?', 'Можно отправить одно сообщение без шифрования, не выключая его?'],
    ['Yes — prefix it with', 'Evet, başına', 'Да — добавьте в начало'],
    ["and that single message goes out in plaintext. There's also", 'ekle; yalnızca o mesaj açık metin olarak gider. Belirli bir anahtar kullanmak için', ', и только это сообщение уйдёт открытым текстом. Также есть'],
    ['to encrypt with a specific key.', 'komutu da var.', 'для шифрования конкретным ключом.'],
    ['Does it work on mobile?', 'Telefonda çalışır mı?', 'Работает ли на телефоне?'],
    ['The plugin runs in desktop Discord. On mobile, open the encrypted link in your browser and enter the phrase — or', 'Eklenti masaüstü Discord’da çalışır. Telefonda şifreli bağlantıyı tarayıcında açıp ifadeyi gir veya', 'Плагин работает в Discord на компьютере. На телефоне откройте зашифрованную ссылку в браузере и введите фразу — или'],
    ['create a message here', 'burada mesaj oluştur', 'создайте сообщение здесь'],
    ['and share it back to Discord. No mobile installation needed.', 've Discord’da paylaş. Telefona kurulum gerekmez.', 'и отправьте в Discord. Установка на телефон не нужна.'],
    ["Is this against Discord's Terms of Service?", 'Bu, Discord’un kullanım koşullarına aykırı mı?', 'Нарушает ли это условия Discord?'],
    ['Yes — all client modification is, including BetterDiscord itself. Accounts can be suspended or banned. Weigh that risk before using it on an account that matters to you.', 'Evet; BetterDiscord dahil tüm istemci değişiklikleri aykırıdır. Hesaplar askıya alınabilir veya yasaklanabilir. Önem verdiğin bir hesapta kullanmadan önce bu riski değerlendir.', 'Да — как и любые изменения клиента, включая BetterDiscord. Аккаунты могут приостановить или заблокировать. Оцените риск перед использованием на важном аккаунте.'],
    ['Why should I trust the crypto?', 'Şifrelemeye neden güvenmeliyim?', 'Почему можно доверять шифрованию?'],
    ['Standard primitives, no inventions: AES-256-GCM via WebCrypto, PBKDF2-HMAC-SHA256 key derivation, authenticated chunked file encryption. The wire format is open, and encryption runs on your device. The project has not undergone an independent security audit.', 'Yeni icatlar değil, standart yapı taşları: WebCrypto ile AES-256-GCM, PBKDF2-HMAC-SHA256 ile anahtar türetme, bütünlüğü doğrulanan parçalı dosya şifreleme. Veri biçimi açık, şifreleme cihazında gerçekleşir. Proje bağımsız güvenlik denetiminden geçmedi.', 'Стандартные примитивы: AES-256-GCM через WebCrypto, вывод ключей PBKDF2-HMAC-SHA256, шифрование файлов по частям с проверкой подлинности. Формат открыт, шифрование выполняется на устройстве. Независимый аудит безопасности не проводился.'],
    ['Go dark. Stay comfy.', 'Gizli kal. Rahatına bak.', 'Скройте текст. Сохраните уют.'],
    ['Same servers, same friends, same memes — minus the readable messages. Your next one can already be ciphertext.', 'Aynı sunucular, aynı arkadaşlar, aynı memeler; mesajlarınsa gizli. Bir sonraki mesajın şimdiden şifreli olabilir.', 'Те же серверы, друзья и мемы — а сообщения скрыты. Следующее уже может быть зашифровано.'],
    ['Download BetterPrivacy', 'BetterPrivacy’yi indir', 'Скачать BetterPrivacy'],
    ['v1.0.0 · wire: 🦇<betterprivacy.app/m#v1.…> · no servers were involved in the making of this plugin', 'v1.0.0 · biçim: 🦇<betterprivacy.app/m#v1.…> · bu eklentinin yapımında sunucu kullanılmadı', 'v1.0.0 · формат: 🦇<betterprivacy.app/m#v1.…> · ни один сервер не участвовал в создании этого плагина'],
    ['BetterPrivacy is an independent open project — not affiliated with, endorsed by, or connected to Discord Inc. or the BetterDiscord project. "Discord" is a trademark of Discord Inc. Client modifications violate Discord\'s Terms of Service and may result in account suspension or termination; use at your own risk. Provided as-is, without warranty. Encryption reduces risk — no software eliminates it.', 'BetterPrivacy bağımsız ve açık bir projedir; Discord Inc. veya BetterDiscord projesiyle bağlantılı değildir ve onlar tarafından desteklenmez. “Discord”, Discord Inc. şirketinin ticari markasıdır. İstemci değişiklikleri Discord’un koşullarını ihlal eder ve hesabın askıya alınmasına veya kapatılmasına neden olabilir; sorumluluk sana aittir. Olduğu gibi, garantisiz sunulur. Şifreleme riski azaltır; hiçbir yazılım tamamen ortadan kaldırmaz.', 'BetterPrivacy — независимый открытый проект, не связанный с Discord Inc. или BetterDiscord и не поддерживаемый ими. Discord — товарный знак Discord Inc. Изменения клиента нарушают условия Discord и могут привести к приостановке или удалению аккаунта; используйте на свой риск. Предоставляется как есть, без гарантий. Шифрование снижает риск, но ни одна программа не устраняет его полностью.'],
    ['A project by', 'Geliştiren', 'Проект от'],
    ['oriet.ai — opens in a new tab', 'oriet.ai — yeni sekmede açılır', 'oriet.ai — откроется в новой вкладке'],
    ['Illustrated encryption button', 'Gösterimdeki şifreleme butonu', 'Кнопка шифрования в примере'],
    ['Decrypt with BetterPrivacy', 'BetterPrivacy ile şifreyi çöz', 'Расшифровать с BetterPrivacy'],
    ['what discord never receives it cannot read · it cannot reveal what it cannot see · privacy is a feature not a crime · encrypt everything · betterprivacy.app · ', 'discord almadığını okuyamaz · göremediğini ifşa edemez · gizlilik bir özellik, suç değil · her şeyi şifrele · betterprivacy.app · ', 'discord не прочитает то, чего не получил · не раскроет то, чего не видит · приватность — функция, а не преступление · шифруйте всё · betterprivacy.app · ']
  ];
  function normalize(value) { return value.replace(/\s+/g, ' ').trim(); }
  var dictionary = Object.create(null);
  copy.forEach(function (entry) { dictionary[normalize(entry[0])] = entry; });
  function text(english) {
    var entry = dictionary[normalize(english)];
    var index = ['en', 'tr', 'ru'].indexOf(document.documentElement.lang);
    return entry && index > 0 ? entry[index] : english;
  }
  var nodes = [];
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  var node;
  while ((node = walker.nextNode())) {
    if (node.parentElement.closest('script, style, #langs')) continue;
    if (dictionary[normalize(node.nodeValue)]) {
      nodes.push({ node: node, english: node.nodeValue });
    }
  }
  var attributes = [];
  document.querySelectorAll('[aria-label]').forEach(function (el) {
    if (dictionary[normalize(el.getAttribute('aria-label'))]) {
      attributes.push({ el: el, english: el.getAttribute('aria-label') });
    }
  });
  var animated = new Map();
  function set(el, english) {
    animated.set(el, english);
    el.textContent = text(english);
  }
  function refresh() {
    nodes.forEach(function (item) {
      var original = item.english;
      var translated = text(normalize(original));
      item.node.nodeValue = document.documentElement.lang === 'en' ? original :
        original.match(/^\s*/)[0] + translated + original.match(/\s*$/)[0];
    });
    attributes.forEach(function (item) { item.el.setAttribute('aria-label', text(item.english)); });
    animated.forEach(function (english, el) { el.textContent = text(english); });
  }
  window.BPHome = { text: text, set: set };
  window.addEventListener('bp-language-change', refresh);
})();
