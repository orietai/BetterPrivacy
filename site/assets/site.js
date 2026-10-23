(function () {
  'use strict';
  var defaults = {};
  document.querySelectorAll('[data-copy]').forEach(function (node) { defaults[node.getAttribute('data-copy')] = node.textContent; });
  document.querySelectorAll('[data-copy-placeholder]').forEach(function (node) { defaults[node.getAttribute('data-copy-placeholder')] = node.getAttribute('placeholder'); });
  // English lives next to its markup. These are the same keys in Turkish and Russian.
  Object.assign(defaults, { demoClose: '🦇 Hide', demoUnlocked: 'What you see with the phrase', hidePhrase: 'Hide' });
  var translations = {
    skip: ['İçeriğe geç', 'Перейти к содержимому'], messageDetails: ['Mesaj ayrıntıları', 'Сведения о сообщении'],
    openNav: ['Mesaj aç', 'Открыть сообщение'], createNav: ['Mesaj oluştur', 'Создать сообщение'],
    pluginNav: ['Discord eklentisi', 'Плагин Discord'], terms: ['Kullanım şartları', 'Условия'], home: ['Ana sayfa', 'Главная'],
    heroIntro: ['Discord sohbet çubuğunda tek bir yarasa.', 'Одна летучая мышь в чате Discord.'],
    heroTitle: ['Discord’un rahatlığında gizlilik.', 'Приватность, не покидая Discord.'],
    heroLead: ['Kanalların, arkadaşların, memelerin yerinde kalsın. Mesaj ve dosyaların Discord’dan çıkmadan önce, tek buton ve gizli bir ifadeyle şifrelensin.', 'Ваши каналы, друзья и мемы остаются. Сообщения и файлы шифруются перед отправкой из Discord — одна кнопка и секретная фраза.'],
    createCta: ['Özel mesaj oluştur', 'Создать приватное сообщение'], pluginCta: ['Discord’da kullan', 'Использовать в Discord'],
    webCta: ['Telefonda mısın? Web’i kullan.', 'На телефоне? Откройте веб-версию.'],
    heroNote: ['Masaüstü Discord ve BetterDiscord için. Telefondaki alıcılar mesajları tarayıcılarında açabilir.', 'Для Discord на компьютере с BetterDiscord. На телефоне сообщения открываются в браузере.'],
    demoHeading: ['Discord · #stargazing', 'Discord · #stargazing'], demoMessage: ['Aynı çatı. Gece yarısı. Teleskobu ben getiririm.', 'Та же крыша. В полночь. Я принесу телескоп.'],
    demoLocked: ['Şifreli bir mesajın temsili', 'Иллюстрация зашифрованного сообщения'], demoUnlocked: ['İfade sende olduğunda gördüğün', 'Что вы видите, зная фразу'],
    demoOpen: ['🦇 Göster', '🦇 Открыть'], demoClose: ['🦇 Gizle', '🦇 Скрыть'], demoCaption: ['Discord’da şifreli veri. Ekranında sohbet.', 'В Discord — шифротекст. У вас — разговор.'],
    proof1: ['Gönderilmeden önce şifrelenir', 'Шифрование до отправки'], proof2: ['Mesaj veritabanı yok', 'Без базы сообщений'], proof3: ['Üyelik yok', 'Без регистрации'],
    waysTitle: ['Yeri Discord. Telefonda da yanında.', 'Дома в Discord. Доступен на телефоне.'], waysLead: ['Günlük sohbetinde eklentiyi kullan. Telefondaki veya eklentisi olmayan kişiler de web araçlarıyla sohbete katılsın.', 'Используйте плагин для повседневного чата. Веб-инструменты подключат тех, кто на телефоне или без плагина.'],
    webTitle: ['Her yerde paylaşabileceğin bir bağlantı.', 'Ссылка для любого чата.'], webBody: ['Telefon, tablet veya bilgisayar: yaz, şifrele, kopyala. Alıcına yalnızca bir tarayıcı ve gizli ifade yeter.', 'На телефоне, планшете или компьютере: напишите, зашифруйте, скопируйте. Получателю нужны только браузер и фраза.'],
    webDetail: ['Discord hesabı gerekmez. Eklenti gerekmez. Metin mesajları.', 'Без Discord и расширений. Текстовые сообщения.'],
    discordTitle: ['Discord’un rahatlığında gizlilik.', 'Приватность, не покидая Discord.'], discordBody: ['Kanalların, arkadaşların, memelerin yerinde. Sohbet çubuğundaki yarasa, mesaj ve dosyalarını gönderilmeden şifreler.', 'Ваши каналы, друзья и мемы остаются. Летучая мышь в чате шифрует сообщения и файлы перед отправкой.'],
    discordDetail: ['Masaüstü Discord ve BetterDiscord. Mesajlar ve dosyalar.', 'Discord на компьютере с BetterDiscord. Сообщения и файлы.'], installCta: ['Eklentiyi kur', 'Установить плагин'],
    statement1: ['Görmediğini', 'Нельзя раскрыть'], statement2: ['ifşa edemez.', 'то, чего не видно.'], statementHint: ['Gizli kelimeleri göstermek için dokun.', 'Нажмите на скрытые слова.'],
    statementBody: ['Mesajın paylaşılmadan önce şifreli veriye dönüşür. Bağlantı bu veriyi taşır; gizli ifade seninle alıcın arasında kalır.', 'Сообщение шифруется до отправки. Ссылка несёт зашифрованный текст, а секретная фраза остаётся между вами.'],
    installTitle: ['Zaten Discord’da mısın?', 'Уже общаетесь в Discord?'], installLead: ['Sohbet çubuğuna bir yarasa ekle. Kanalın için ifade belirle, özelden paylaş ve sohbete devam et.', 'Добавьте летучую мышь в чат. Задайте фразу для канала, поделитесь ею лично и продолжайте общаться.'],
    download: ['BetterPrivacy’yi indir', 'Скачать BetterPrivacy'], installNote: ['Yalnızca masaüstü. İstemci değişiklikleri Discord’un şartlarını ihlal edebilir.', 'Только для компьютера. Модификации клиента могут нарушать условия Discord.'], mobileCta: ['Telefonda mısın? Web sürümünü kullan.', 'На телефоне? Откройте веб-версию.'],
    step1: ['BetterDiscord’u kur', 'Установите BetterDiscord'], step2: ['Eklentiyi ekle', 'Добавьте плагин'], step2body: ['Discord ayarlarında BetterDiscord → Eklentiler → Eklenti Klasörünü Aç yoluna git. İndirdiğin dosyayı ekle ve BetterPrivacy’yi etkinleştir.', 'В настройках Discord откройте BetterDiscord → Plugins → Open Plugins Folder. Добавьте скачанный файл и включите BetterPrivacy.'],
    step3: ['Yarasaya tıkla. İfadeni belirle.', 'Нажмите на мышь. Задайте фразу.'], step3body: ['İfadeyi özelden paylaş. Bilen herkes şifreli mesajlarını Discord’da veya web bağlantısıyla açabilir.', 'Поделитесь фразой лично. Зная её, можно открыть сообщения в Discord или по веб-ссылке.'],
    faqTitle: ['Göndermeden önce.', 'Перед отправкой.'], faq1q: ['Karşı tarafın BetterPrivacy kurması gerekir mi?', 'Нужен ли получателю BetterPrivacy?'], faq1a: ['Hayır. Bağlantıyı telefon veya bilgisayar tarayıcısında açıp gizli ifadeyi girmesi yeterli. Eklenti, masaüstü Discord’da okumayı ve göndermeyi kolaylaştırır.', 'Нет. Достаточно открыть ссылку в браузере и ввести фразу. Плагин упрощает чтение и отправку внутри Discord на компьютере.'],
    faq2q: ['İfadeyi nasıl paylaşmalıyım?', 'Как передать фразу?'], faq2a: ['Yüz yüze veya ayrı bir özel kanaldan ilet. İfadeyi şifreli bağlantının yanına yazma. İkisine de sahip olan herkes mesajı okuyabilir.', 'Лично или по отдельному приватному каналу. Не отправляйте фразу рядом со ссылкой: имея и то и другое, любой прочитает сообщение.'],
    faq3q: ['Mesajların süresi dolar mı, silinir mi?', 'Истекает ли срок сообщения?'], faq3a: ['Hayır. Şifreli mesaj, silebileceğimiz bir veritabanında değil, bağlantının içinde. Yeniden açmak için bağlantıyı ve ifadeyi sakla. İfadeni değiştirmek, eski ifadeyle şifrelenmiş mesajları korumaz.', 'Нет. Зашифрованное сообщение хранится в ссылке, а не в нашей базе. Сохраните ссылку и фразу. Смена фразы не защищает старые сообщения.'],
    faq4q: ['Şifreleme neyi korur?', 'От чего защищает шифрование?'], faq4a: ['Mesaj içeriğini ifadeyi bilmeyenlerden korur. Kiminle ne zaman konuştuğunu gizlemez; ekran görüntülerini veya ele geçirilmiş cihazları engellemez. Uzun ve benzersiz bir ifade kullan.', 'Содержимое скрыто от тех, кто не знает фразу. Шифрование не скрывает, с кем и когда вы общаетесь, не мешает скриншотам и не защищает взломанное устройство. Используйте длинную уникальную фразу.'],
    faq5q: ['Şifreli dosyayı burada açabilir miyim?', 'Можно открыть зашифрованный файл?'], faq5a: ['Evet. Aldığın .bpenc dosyasını indir ve Aç sayfasında seç. Dosya kendi cihazında çözülür.', 'Да. Скачайте файл .bpenc и выберите его на странице открытия. Он расшифруется на вашем устройстве.'], openFile: ['Dosya aç', 'Открыть файл'],
    createTab: ['Oluştur', 'Создать'], openTab: ['Aç', 'Открыть'], createTitle: ['Bazı şeyler aranızda kalsın.', 'Некоторые вещи — только между вами.'], createLead: ['Mesajını özel bir bağlantıya dönüştür. Yalnızca gizli ifadeyi bilenler açabilsin.', 'Превратите сообщение в приватную ссылку. Открыть её сможет только тот, кто знает фразу.'],
    nextTitle: ['Sonra ne olacak?', 'Что дальше?'], nextBody: ['Bağlantıyı istediğin sohbette gönder. İfadeyi ayrı paylaş. Alıcın hiçbir şey kurmadan telefonda açabilir.', 'Отправьте ссылку в любом чате, а фразу передайте отдельно. Получатель откроет сообщение на телефоне без установки.'],
    composeTitle: ['Özel mesajını yaz', 'Напишите приватное сообщение'], messageLabel: ['Mesajın', 'Ваше сообщение'], messagePlaceholder: ['Aranızda ne kalsın?', 'Что должно остаться между вами?'], limitHint: ['Uzun mesajlar otomatik olarak bağlantılara bölünür.', 'Длинные сообщения автоматически делятся на ссылки.'],
    phraseLabel: ['Gizli ifade', 'Секретная фраза'], showPhrase: ['Göster', 'Показать'], hidePhrase: ['Gizle', 'Скрыть'], phraseHelp: ['Uzun ve benzersiz bir ifade kullan. Boşluklar ve büyük/küçük harf önemlidir. Bağlantıdan ayrı paylaş.', 'Используйте длинную уникальную фразу. Пробелы и регистр важны. Передайте её отдельно от ссылки.'],
    encryptCta: ['Şifrele ve bağlantıları oluştur', 'Зашифровать и создать ссылки'], readyTitle: ['Özel bağlantın hazır.', 'Ваша приватная ссылка готова.'], readyHelp: ['Bu bağlantıyı paylaş. İfadeyi alıcına ayrı ilet.', 'Поделитесь ссылкой. Фразу передайте отдельно.'], linkLabel: ['Şifreli mesaj bağlantısı', 'Ссылка на зашифрованное сообщение'], copyLink: ['Bağlantıyı kopyala', 'Копировать ссылку'], shareLink: ['Paylaş…', 'Поделиться…'], testLink: ['Bu mesajı aç', 'Открыть это сообщение'], startOver: ['Başka bir mesaj yaz', 'Написать ещё сообщение'],
    noExpiry: ['Bu bağlantının süresi dolmaz. Bağlantıya ve ifadeye sahip olan herkes okuyabilir.', 'Ссылка не истекает. Любой, у кого есть ссылка и фраза, сможет прочитать сообщение.'], localNote: ['Şifreleme bu sekmede yapılır. Mesajın ve ifaden sunucumuza gönderilmez.', 'Шифрование выполняется в этой вкладке. Сообщение и фраза не отправляются на наш сервер.'],
    receivedLink: ['Sana bağlantı mı geldi? Burada aç.', 'Получили ссылку? Откройте здесь.'], discordShortcut: ['BetterPrivacy’yi Discord’da kullan', 'BetterPrivacy в Discord'],
    readerTitle: ['Sana özel bir mesaj var.', 'Вам личное сообщение.'], readerLead: ['Bağlantıyı aç, gizli ifadeyi gir. Mesaj cihazında çözülsün.', 'Откройте ссылку и введите фразу. Сообщение расшифруется на вашем устройстве.'],
    pasteLabel: ['BetterPrivacy bağlantıları', 'Ссылки BetterPrivacy'], pasteCta: ['Bağlantıları yükle', 'Загрузить ссылки'], pasteHelp: ['Bir veya daha fazla tam bağlantıyı mesaj sırasıyla yapıştır. Parçalar yapıştırdığın sırayla birleştirilir; eksik parçalar tespit edilemez.', 'Вставьте одну или несколько полных ссылок в порядке сообщения. Части объединяются в порядке вставки; пропущенные части определить невозможно.'], newMessage: ['Sen de özel bir mesaj oluştur.', 'Создайте своё приватное сообщение.'], hideMessage: ['Mesajı gizle', 'Скрыть сообщение']
  };
  var messages = {
    qrShow: ['Show QR code', 'QR kodunu göster', 'Показать QR-код'],
    qrHide: ['Hide QR code', 'QR kodunu gizle', 'Скрыть QR-код'],
    qrTitle: ['Scan the encrypted link', 'Şifreli bağlantıyı tara', 'Сканируйте зашифрованную ссылку'],
    qrAlt: ['QR code for this encrypted message link', 'Bu şifreli mesaj bağlantısının QR kodu', 'QR-код ссылки на это зашифрованное сообщение'],
    qrHelp: ['Only the encrypted link is in this QR. Share the secret phrase separately.', 'QR yalnızca şifreli bağlantıyı içerir. Gizli ifadeyi ayrı paylaş.', 'QR содержит только зашифрованную ссылку. Передайте секретную фразу отдельно.'],
    qrDownload: ['Download QR (SVG)', 'QR indir (SVG)', 'Скачать QR (SVG)'],
    qrLimit: ['QR is for short, single links only (up to 256 URL bytes). Copy the link instead.', 'QR yalnızca kısa, tek bağlantılar içindir (en fazla 256 URL baytı). Bağlantıyı kopyala.', 'QR доступен для коротких одиночных ссылок (до 256 байт URL). Скопируйте ссылку.'],
    qrFailed: ['QR could not be created. Copy the encrypted link instead.', 'QR oluşturulamadı. Şifreli bağlantıyı kopyala.', 'Не удалось создать QR. Скопируйте зашифрованную ссылку.'],
    messageEmpty: ['Write a message first.', 'Önce bir mesaj yaz.', 'Сначала напишите сообщение.'],
    bytesLabel: ['bytes', 'bayt', 'байт'],
    linkCount: ['link', 'bağlantı', 'ссылка'],
    linksCount: ['links', 'bağlantı', 'ссылок'],
    readyManyTitle: ['Your private links are ready.', 'Özel bağlantıların hazır.', 'Ваши приватные ссылки готовы.'],
    readyManyHelp: ['Send each link as a separate message, in order. Paste all links into Open to read them together with the same phrase. Share the phrase separately.', 'Her bağlantıyı sırasıyla ayrı mesaj olarak gönder. Aynı ifadeyle birlikte okumak için tümünü Aç sayfasına yapıştır. İfadeyi ayrı paylaş.', 'Отправьте каждую ссылку отдельным сообщением по порядку. Вставьте все ссылки на странице открытия, чтобы прочитать их вместе с той же фразой. Передайте фразу отдельно.'],
    linksLabel: ['All encrypted links, in order', 'Tüm şifreli bağlantılar, sırasıyla', 'Все зашифрованные ссылки по порядку'],
    copyAllLinks: ['Copy all links', 'Tüm bağlantıları kopyala', 'Копировать все ссылки'],
    partLabel: ['Part', 'Parça', 'Часть'],
    openPart: ['Open part', 'Parçayı aç', 'Открыть часть'],
    encryptedMany: ['Encrypted. All parts are ready below.', 'Şifrelendi. Tüm parçalar aşağıda hazır.', 'Зашифровано. Все части готовы ниже.'],
    linksCopied: ['All links copied in order. Send them separately; share the phrase separately too.', 'Tüm bağlantılar sırayla kopyalandı. Ayrı mesajlar olarak gönder; ifadeyi de ayrı paylaş.', 'Все ссылки скопированы по порядку. Отправьте их отдельными сообщениями, а фразу передайте отдельно.'],
    copyManyManually: ['Copy the selected links manually — clipboard access is unavailable here.', 'Pano erişimi yok. Seçili bağlantıları elle kopyala.', 'Буфер обмена недоступен. Скопируйте выделенные ссылки вручную.'],
    phraseEmpty: ['Enter a secret phrase.', 'Gizli bir ifade gir.', 'Введите секретную фразу.'],
    secureOrigin: ['Open this page over HTTPS or localhost to use browser encryption.', 'Tarayıcıda şifreleme için bu sayfayı HTTPS veya localhost üzerinden aç.', 'Для шифрования откройте страницу через HTTPS или localhost.'],
    encrypting: ['Encrypting on your device…', 'Cihazında şifreleniyor…', 'Шифруем на вашем устройстве…'],
    encrypted: ['Encrypted. Your link is ready below.', 'Şifrelendi. Bağlantın aşağıda hazır.', 'Зашифровано. Ссылка готова ниже.'],
    changedWhileEncrypting: ['You edited the message or phrase. Encrypt again to create an up-to-date link.', 'Mesajı veya ifadeyi değiştirdin. Güncel bağlantı için yeniden şifrele.', 'Сообщение или фраза изменены. Зашифруйте заново.'],
    encryptFailed: ['The link could not be created. Try again in an up-to-date browser.', 'Bağlantı oluşturulamadı. Güncel bir tarayıcıda tekrar dene.', 'Не удалось создать ссылку. Попробуйте в обновлённом браузере.'],
    linkCopied: ['Link copied. Share the phrase separately.', 'Bağlantı kopyalandı. İfadeyi ayrı paylaş.', 'Ссылка скопирована. Фразу передайте отдельно.'],
    copyManually: ['Copy the selected link manually — clipboard access is unavailable here.', 'Pano erişimi yok. Seçili bağlantıyı elle kopyala.', 'Буфер обмена недоступен. Скопируйте выделенную ссылку вручную.'],
    shareFailed: ['Sharing is unavailable here. Copy the link instead.', 'Buradan paylaşılamıyor. Bağlantıyı kopyala.', 'Поделиться не удалось. Скопируйте ссылку.'],
    pasteInvalid: ['That is not a complete BetterPrivacy message link. Copy the whole link, including the part after #.', 'Bu, tam bir BetterPrivacy mesaj bağlantısı değil. # sonrası dahil bağlantının tamamını kopyala.', 'Это не полная ссылка BetterPrivacy. Скопируйте её целиком, включая часть после #.']
  };
  var lang = 'en';
  function text(key) {
    var index = ['en', 'tr', 'ru'].indexOf(lang);
    if (messages[key]) return messages[key][index];
    if (index > 0 && translations[key]) return translations[key][index - 1];
    return defaults[key] || key;
  }
  function refresh() {
    document.querySelectorAll('[data-copy]').forEach(function (node) { node.textContent = text(node.getAttribute('data-copy')); });
    document.querySelectorAll('[data-copy-placeholder]').forEach(function (node) { node.placeholder = text(node.getAttribute('data-copy-placeholder')); });
    document.querySelectorAll('[data-lang]').forEach(function (node) { node.setAttribute('aria-pressed', String(node.getAttribute('data-lang') === lang)); });
    document.documentElement.lang = lang;
    window.dispatchEvent(new CustomEvent('bp-language-change', { detail: { lang: lang } }));
  }
  function apply(code) {
    lang = /^(en|tr|ru)$/.test(code) ? code : 'en';
    try { localStorage.setItem('bp-lang', lang); } catch (_) {}
    refresh();
  }
  window.BPUI = { text: text, refresh: refresh, apply: apply };
  var saved;
  try { saved = localStorage.getItem('bp-lang'); } catch (_) {}
  apply(saved || (navigator.language || 'en').slice(0, 2));
  document.querySelectorAll('[data-lang]').forEach(function (button) {
    button.addEventListener('click', function () { apply(button.getAttribute('data-lang')); });
  });
})();
