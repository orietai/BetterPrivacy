/**
 * BetterPrivacy — UI strings in English, Turkish and Russian.
 *
 * `t(key, params?)` is the single lookup every user-facing string goes
 * through. `en` is the source of truth for the key set; `tr`/`ru` are typed
 * as Record<MsgKey, string> so a missing translation is a compile error.
 *
 * Locale resolution: settings.language when not 'auto', else Discord's own
 * LocaleStore (the language the user picked in Discord), else
 * navigator.language, else English. initI18n() wires the settings store in
 * at plugin start and re-resolves on every settings change; everything is
 * guarded so this module also loads in Node (vitest) where BdApi/navigator
 * may be absent.
 *
 * Placeholder convention: '{name}' — substituted by t(); translations must
 * keep every placeholder of their English source (word order is free).
 */

import type { SettingsStore } from './types'

export type BpLocale = 'en' | 'tr' | 'ru'

const en = {
  'edit.dialogTitle': 'Edit encrypted message',
  'edit.save': 'Save encrypted',
  'edit.hint': 'Edit the message, not its link. Saving keeps the original encryption key. One encrypted part maximum.',
  'edit.menu': 'Edit encrypted message…',
  'edit.unsafe': 'BetterPrivacy: cannot verify the original message or edit format. Edit blocked to prevent a plaintext leak.',
  'edit.noKey': 'BetterPrivacy: the required edit key is unavailable. Recover the original key or select a sending key. Edit blocked.',
  'edit.oversize': 'BetterPrivacy: encrypted edits must fit one message (1360 UTF-8 bytes / 2000 encrypted characters). Shorten the edit.',
  'edit.cancelled': 'BetterPrivacy: edit cancelled because unlocking was cancelled or the session, key, mode, selection or original message changed.',
  'edit.failed': 'BetterPrivacy: edit failed. No plaintext fallback was sent.',
  'sending.channelKey': 'Channel key',
  'sending.picker': 'Sending key',
  'sending.choose': 'Choose a key',
  'sending.with': 'Text and files send with {label}',
  'sending.paused': 'Encryption paused. Selected key: {label}',
  'sending.hint': 'One key for sending. Opening an older message does not change it.',
  'sending.newPhrase': '+ Use a new phrase…',
  'sending.selected': 'Sending with {label}',
  'sending.failed': 'Could not select the sending key. Your selection was not changed.',
  'sending.cancelled': 'Send cancelled: the sending key, encryption mode or key availability changed.',
  'sending.reply': 'Reply using this key',
  'sending.replyHint': 'Select this key for new messages. Nothing is sent automatically.',
  // ---- common ---------------------------------------------------------------
  'common.cancel': 'Cancel',
  'common.unlock': 'Unlock',
  'common.encrypt': 'Encrypt',
  'common.create': 'Create',
  'common.import': 'Import',
  'common.forget': 'Forget',
  'common.delete': 'Delete',

  // ---- send patch -----------------------------------------------------------
  'send.oversize':
    'BetterPrivacy: encrypted message exceeds the 2000-character limit — send cancelled',
  'send.encryptFailed': 'BetterPrivacy: encryption failed — send cancelled',
  'send.sendingParts': '🦇 Long message — sending encrypted in {n} parts',
  'send.confirmTitle': '🦇 Long message',
  'send.confirmParts':
    'This message is long — it will be sent as {n} separate encrypted messages, in order. Send them all?',
  'send.confirmSend': 'Send all',
  'send.declined': 'BetterPrivacy: send cancelled',
  'send.ptTooLong':
    "BetterPrivacy: /pt message exceeds Discord's 2000-character limit — send cancelled",
  'send.partFailed':
    'BetterPrivacy: part {i} of {n} failed to send — the remaining parts were cancelled',
  'send.encUsage': 'BetterPrivacy: usage — /enc <key label> <message>. Send cancelled.',
  'send.noKeyLabelled': 'BetterPrivacy: no key labelled "{label}" — send cancelled',
  'send.keyLocked':
    'BetterPrivacy: key "{label}" is locked — unlock it first. Send cancelled.',
  'send.stickers': "BetterPrivacy: stickers can't be encrypted — send cancelled",
  'send.usingKey': 'BetterPrivacy: using key "{label}"',
  'send.noKeySelected':
    'BetterPrivacy: no send key selected — click 🦇 to set a phrase, or choose a default key from the channel menu. Send cancelled.',
  'send.cancelledLocked': 'BetterPrivacy: send cancelled — key locked',
  'send.internalError': 'BetterPrivacy: internal error — message NOT sent',
  'up.unavailable': 'BetterPrivacy: upload integration is unavailable — files are blocked while keys are configured. Wait for integration recovery.',

  // ---- render patch (message chips) ----------------------------------------
  'chip.modeOffTitle': 'Encryption mode is off for this channel',
  'chip.modeOff': '🔒 Encrypted message — encryption off for this channel (click to enable)',
  'chip.encryptedWith': 'Encrypted with "{label}"',
  'chip.failed': '⚠ Decryption failed (tampered or wrong key)',
  'chip.unknownTitle': 'Click to open with the secret phrase · Alt-click to view ciphertext',
  'chip.unknown': '🔒 Encrypted message (unknown key {keyId}) — click to recover',
  'chip.locked': '🔒 Encrypted message (key: {label}) — click to unlock',
  'chip.decrypting': '🔒 Decrypting…',

  // ---- upload patch ---------------------------------------------------------
  'up.noChannel':
    'BetterPrivacy: upload destination is missing or inconsistent — file blocked. Reselect it in the destination channel; if this persists, the upload integration needs an update.',
  'up.noAccess': 'BetterPrivacy: cannot access the file to encrypt it — upload aborted',
  'up.noKey': 'BetterPrivacy: encrypt mode is ON but no key is selected — upload aborted',
  'up.cancelledLocked': 'BetterPrivacy: upload cancelled — key locked',
  'up.tooLarge': 'BetterPrivacy: file too large to encrypt (64 MB max) — upload aborted',
  'up.encrypted': 'BetterPrivacy: attachment encrypted with "{label}"',
  'up.failed': 'BetterPrivacy: attachment encryption failed — upload aborted',
  'up.checkFailed': 'BetterPrivacy: upload check failed — upload aborted',

  // ---- attachments patch ----------------------------------------------------
  'att.modeOff': '🔒 Encrypted file — encryption off for this channel (click to enable)',
  'att.decryptedTitle': 'Decrypted: {filename} (key: {label})',
  'att.save': 'Save decrypted file ({filename})',
  'att.decrypting': '🔒 Encrypted file — decrypting…',
  'att.unknown': '🔒 Encrypted file (unknown key {keyId})',
  'att.locked': '🔒 Encrypted file (key: {label}) — click to unlock',
  'att.fetchFailed': '🔒 Encrypted file — download failed (click to retry)',
  'att.oversize': '🔒 Encrypted file ({mb} MB) — Download & decrypt',
  'att.plain': '🔒 Encrypted file',

  // ---- chat-bar 🦇 button ----------------------------------------------------
  'bar.noChannel': 'BetterPrivacy: cannot determine the current channel — try switching channels once',
  'bar.broken':
    'BetterPrivacy: encryption unavailable — message interception is broken (messages would send as PLAINTEXT)',
  'bar.encOn': '🦇 Encryption ON for this channel',
  'bar.encPaused': 'BetterPrivacy: encryption paused for this channel',
  'bar.forgetTitle': '🦇 Forget key',
  'bar.forgetBody':
    'Forget {label} ({id})? Nothing is lost forever — entering the same phrase again restores it exactly.',
  'bar.forgotten': 'BetterPrivacy: key forgotten',
  'bar.forgetFailed': 'BetterPrivacy: could not forget the key',
  'bar.lockedAll': '🦇 Everything locked',
  'bar.title.broken':
    'BetterPrivacy: encryption unavailable (Discord update broke message interception) — messages would send as PLAINTEXT',
  'bar.title.noChannel': 'BetterPrivacy: cannot determine the current channel',
  'bar.title.noKey': 'BetterPrivacy: not encrypted — click to set a secret phrase for this channel',
  'bar.title.locked': 'BetterPrivacy: locked — click to enter the phrase',
  'bar.title.on': 'BetterPrivacy: encrypted — click to pause · right-click for options',
  'bar.title.paused': 'BetterPrivacy: encryption paused — click to resume · right-click for options',
  'menu.status.broken': '⚠ Encryption broken (Discord update)',
  'menu.status.noChannel': '⚠ Cannot determine current channel',
  'menu.status.notEncrypted': 'This channel is not encrypted',
  'menu.status.needPhrase': 'Phrase needed — click the 🦇 to enter it',
  'menu.status.on': 'Encrypted & unlocked',
  'menu.status.paused': 'Encryption paused',
  'menu.changePhrase': 'Change phrase…',
  'menu.setPhrase': 'Set phrase…',
  'menu.forgetChannelKey': "Forget this channel's key",
  'menu.lockNow': 'Lock everything now',
  'menu.tip':
    'Tip: /pt msg sends text unencrypted; files still follow channel mode · keys: Settings → BetterPrivacy',

  // ---- labels ---------------------------------------------------------------
  'label.thisChannelKey': "this channel's key",

  // ---- unlock / phrase / create / recover modals ----------------------------
  'um.title': '🦇 Unlock key',
  'um.enterPhraseFor': 'Enter the secret phrase for {label}',
  'um.passphrasePh': 'Passphrase',
  'um.unlocked': 'BetterPrivacy: unlocked "{label}"',
  'um.wrongPassphrase': 'Wrong passphrase',
  'um.cancelled': 'Unlock cancelled because the session or key changed. Try again when ready.',
  'pm.title': '🦇 Encrypt this channel',
  'pm.prompt': 'Pick a secret phrase for this channel. Your messages here will be encrypted with it.',
  'pm.secretPhrasePh': 'Secret phrase',
  'pm.hint':
    'Anyone in this channel who enters the same phrase can read the messages. Share it outside Discord.',
  'pm.phraseRequired': 'A secret phrase is required',
  'pm.channelEncrypted': '🦇 Channel encrypted — share the phrase with the people who should read it',
  'pm.setupFailed': 'Could not set up encryption',
  'rm.title': '🦇 Unlock encrypted message',
  'rm.prompt': 'Enter the secret phrase the sender shared with you.',
  'rm.noChannel':
    'BetterPrivacy: cannot determine this message’s channel — recover via Settings → Key Manager',
  'rm.wrongPhrase':
    'The phrase is incorrect or the encrypted data was changed. Check the phrase and copy the complete message or file again.',
  'rm.accepted': '🦇 Phrase accepted — messages unlocked',
  'rm.failed': 'Key recovery failed',
  'ck.title': '🦇 New key',
  'ck.labelLabel': 'Label',
  'ck.labelPh': 'e.g. team-chat',
  'ck.passLabel': 'Passphrase',
  'ck.passPh': 'Shared out-of-band with your peers',
  'ck.onlyThisChannel': 'Only this channel',
  'ck.labelRequired': 'A key label is required',
  'ck.passRequired': 'A passphrase is required',
  'ck.ready': 'BetterPrivacy: key "{label}" ready (created & unlocked)',
  'ck.created': 'BetterPrivacy: key "{label}" created ({id})',
  'ck.createFailed': 'Key creation failed',

  // ---- settings panel -------------------------------------------------------
  'km.health': 'Health',
  'km.degraded':
    '⚠ Discord integration degraded — affected: {list}. A Discord or plugin update is likely needed.',
  'km.healthy': 'All Discord integration points healthy.',
  'km.title': '🦇 Key Manager',
  'km.th.label': 'Label',
  'km.th.keyId': 'Key ID',
  'km.th.scope': 'Scope',
  'km.th.created': 'Created',
  'km.th.actions': 'Actions',
  'km.scope.global': 'global',
  'km.export': 'Export',
  'km.noKeys': 'No keys yet — create or import one below.',
  'km.newKey': 'New key…',
  'km.importKey': 'Import key…',
  'km.lockAllNow': 'Lock all now',
  'km.allLocked': 'BetterPrivacy: all keys locked',
  'km.deleteTitle': 'Delete key',
  'km.deleteBody':
    'Delete key "{label}" ({id})? Messages encrypted with it become unreadable until the key is imported again.',
  'km.deleted': 'Key "{label}" deleted',
  'km.copied': 'Key blob copied to clipboard',
  'km.copyFailed': 'Could not write to clipboard',
  'km.exportFailed': 'Export failed',
  'km.import.title': 'Import key',
  'km.import.blobLabel': 'Key blob',
  'km.import.passLabel': 'Passphrase',
  'km.import.passPh': 'Passphrase for this key',
  'km.imported': 'BetterPrivacy: imported & unlocked "{label}" ({id})',
  'km.importFailed': 'Key import failed',
  'km.section.language': 'Language',
  'km.language': 'Plugin language',
  'km.languageHint': "Applies to BetterPrivacy's own buttons, menus and messages.",
  'km.dropdownUnavailable': 'BetterDiscord settings dropdown is unavailable. Update BetterDiscord to change this setting.',
  'km.language.auto': 'Auto (follow Discord)',
  'km.section.session': 'Session',
  'km.lockdown': 'Lockdown mode',
  'km.lockdownHint': 'Switching channels re-locks everything until passphrases are re-entered.',
  'km.relockScope': 'Relock scope',
  'km.relockScopeHint': 'Which keys are locked on a channel switch.',
  'km.relock.all': 'All keys',
  'km.relock.prev': 'Previous channel only',
  'km.timeout': 'Decrypt timeout (seconds)',
  'km.timeoutHint': '0 = never, default 10800',
  'km.section.appearance': 'Appearance',
  'km.indicator': 'Indicator color',
  'km.indicatorHint': 'Text color and lock glyph of decrypted messages.',
  'km.section.media': 'Media & memory',
  'km.maxAuto': 'Max auto-download size (MB)',
  'km.maxAutoHint': 'Encrypted attachments larger than this are not fetched automatically.',
  'km.memBudget': 'Memory budget (MB)',
  'km.memBudgetHint': 'Decrypted media beyond this budget is LRU-evicted.',

  // ---- context menus --------------------------------------------------------
  'cm.copyCipher': 'Copy ciphertext',
  'cm.copied': 'BetterPrivacy: ciphertext copied',
  'cm.copyFailed': 'BetterPrivacy: copy failed',
  'cm.redecrypt': 'Re-decrypt',
  'cm.importForMsg': 'Import key for this message…',
  'cm.importTitle': '🦇 Import BetterPrivacy key',
  'cm.passPh': 'Passphrase',
  'cm.imported': 'BetterPrivacy: key "{label}" imported & unlocked',
  'cm.importFailed': 'BetterPrivacy: import failed — {error}',
  'cm.importDialogFailed': 'BetterPrivacy: could not open the import dialog',
  'cm.defaultKey': 'Set default BetterPrivacy key',
  'cm.none': 'None',
  'cm.defaultSet': 'BetterPrivacy: default key for this channel set to {label}',
  'cm.defaultSetFailed': 'BetterPrivacy: could not set the default key',

  // ---- lifecycle ------------------------------------------------------------
  'app.degraded': 'BetterPrivacy degraded — affected: {list}. Retrying in the background.',
  'app.recovered': 'BetterPrivacy: recovered after Discord finished loading: {list}',
  'feat.sending': 'sending',
  'feat.display': 'message display',
  'feat.upload': 'file upload',
  'feat.fileDisplay': 'file display',
  'feat.chatBar': 'chat-bar controls',
  'feat.lockdown': 'lockdown & channel tracking',
  'feat.richText': 'rich text',
  'ses.expired': 'BetterPrivacy: session keys expired',

  // ---- keyring errors (surfaced via toasts) ---------------------------------
  'kr.exists':
    'A key with id {id} already exists in the keyring (same passphrase+salt). Remove it first or use the existing entry.',
  'kr.notBlob': 'Not a BetterPrivacy key blob (expected "betterprivacy-key:...")',
  'kr.malformed': 'Malformed key blob (invalid base64 or JSON)',
  'kr.malformedShape': 'Malformed key blob (unexpected shape)',
  'kr.malformedFields': 'Malformed key blob (missing label, salt, or check)',
  'kr.wrongPass': 'Wrong passphrase or corrupted key blob',
  'kr.noKey': 'No key with id {id} in the keyring',
} as const

export type MsgKey = keyof typeof en

const tr: Record<MsgKey, string> = {
  'edit.dialogTitle': 'Şifreli mesajı düzenle',
  'edit.save': 'Şifreleyerek kaydet',
  'edit.hint': 'Bağlantıyı değil mesajını düzenle. Kaydedilirken özgün anahtarı korunur. En fazla tek şifreli parça.',
  'edit.menu': 'Şifreli mesajı düzenle…',
  'edit.unsafe': 'BetterPrivacy: özgün mesaj veya düzenleme biçimi doğrulanamadı. Düz metin sızıntısını önlemek için düzenleme engellendi.',
  'edit.noKey': 'BetterPrivacy: gerekli düzenleme anahtarı kullanılamıyor. Özgün anahtarı kurtarın veya gönderim anahtarı seçin. Düzenleme engellendi.',
  'edit.oversize': 'BetterPrivacy: şifreli düzenleme tek mesaja sığmalıdır (1360 UTF-8 baytı / 2000 şifreli karakter). Metni kısaltın.',
  'edit.cancelled': 'BetterPrivacy: kilit açma iptal edildi veya oturum, anahtar, mod, seçim ya da özgün mesaj değişti; düzenleme iptal edildi.',
  'edit.failed': 'BetterPrivacy: düzenleme başarısız. Düz metin gönderilmedi.',
  'sending.channelKey': 'Kanal anahtarı',
  'sending.picker': 'Gönderim anahtarı',
  'sending.choose': 'Anahtar seç',
  'sending.with': 'Metin ve dosyalar şu anahtarla gönderilir: {label}',
  'sending.paused': 'Şifreleme duraklatıldı. Seçili anahtar: {label}',
  'sending.hint': 'Gönderim için tek anahtar. Eski bir mesajı açmak bu seçimi değiştirmez.',
  'sending.newPhrase': '+ Yeni bir ifade kullan…',
  'sending.selected': 'Gönderim anahtarı: {label}',
  'sending.failed': 'Gönderim anahtarı seçilemedi. Seçimin değiştirilmedi.',
  'sending.cancelled': 'Gönderim iptal edildi: gönderim anahtarı, şifreleme modu veya anahtarın kilit durumu değişti.',
  'sending.reply': 'Bu anahtarla yanıtla',
  'sending.replyHint': 'Yeni mesajlar için bu anahtarı seçer. Otomatik mesaj gönderilmez.',
  'common.cancel': 'Vazgeç',
  'common.unlock': 'Kilidi aç',
  'common.encrypt': 'Şifrele',
  'common.create': 'Oluştur',
  'common.import': 'İçe aktar',
  'common.forget': 'Unut',
  'common.delete': 'Sil',

  'send.oversize':
    'BetterPrivacy: şifreli mesaj 2000 karakter sınırını aşıyor — gönderim iptal edildi',
  'send.encryptFailed': 'BetterPrivacy: şifreleme başarısız — gönderim iptal edildi',
  'send.sendingParts': '🦇 Uzun mesaj — {n} şifreli parça halinde gönderiliyor',
  'send.confirmTitle': '🦇 Uzun mesaj',
  'send.confirmParts':
    'Bu mesaj uzun — sırayla {n} ayrı şifreli mesaj olarak gönderilecek. Hepsi gönderilsin mi?',
  'send.confirmSend': 'Hepsini gönder',
  'send.declined': 'BetterPrivacy: gönderim iptal edildi',
  'send.ptTooLong':
    "BetterPrivacy: /pt mesajı Discord'un 2000 karakter sınırını aşıyor — gönderim iptal edildi",
  'send.partFailed':
    'BetterPrivacy: {n} parçadan {i}. gönderilemedi — kalan parçalar iptal edildi',
  'send.encUsage': 'BetterPrivacy: kullanım — /enc <anahtar etiketi> <mesaj>. Gönderim iptal edildi.',
  'send.noKeyLabelled': 'BetterPrivacy: "{label}" etiketli bir anahtar yok — gönderim iptal edildi',
  'send.keyLocked':
    'BetterPrivacy: "{label}" anahtarı kilitli — önce kilidini aç. Gönderim iptal edildi.',
  'send.stickers': 'BetterPrivacy: çıkartmalar şifrelenemez — gönderim iptal edildi',
  'send.usingKey': 'BetterPrivacy: "{label}" anahtarı kullanılıyor',
  'send.noKeySelected':
    'BetterPrivacy: gönderim anahtarı seçili değil — 🦇 ile ifade belirle veya kanal menüsünden varsayılan anahtar seç. Gönderim iptal edildi.',
  'send.cancelledLocked': 'BetterPrivacy: gönderim iptal edildi — anahtar kilitli',
  'send.internalError': 'BetterPrivacy: iç hata — mesaj GÖNDERİLMEDİ',
  'up.unavailable': 'BetterPrivacy: yükleme entegrasyonu kullanılamıyor — kayıtlı anahtarlar varken dosyalar engellenir. Entegrasyonun düzelmesini bekle.',

  'chip.modeOffTitle': 'Bu kanalda şifreleme modu kapalı',
  'chip.modeOff': '🔒 Şifreli mesaj — bu kanalda şifreleme kapalı (açmak için tıkla)',
  'chip.encryptedWith': '"{label}" ile şifrelendi',
  'chip.failed': '⚠ Şifre çözülemedi (mesaj değiştirilmiş ya da anahtar yanlış)',
  'chip.unknownTitle':
    'Gizli ifadeyle açmak için tıkla · Şifreli metni görmek için Alt+tık',
  'chip.unknown': '🔒 Şifreli mesaj (bilinmeyen anahtar {keyId}) — kurtarmak için tıkla',
  'chip.locked': '🔒 Şifreli mesaj (anahtar: {label}) — kilidi açmak için tıkla',
  'chip.decrypting': '🔒 Çözülüyor…',

  'up.noChannel':
    'BetterPrivacy: yüklemenin hedef kanalı eksik veya tutarsız — dosya engellendi. Dosyayı hedef kanalda yeniden seç; sorun sürerse yükleme entegrasyonu güncellenmeli.',
  'up.noAccess': 'BetterPrivacy: şifrelenecek dosyaya erişilemedi — yükleme iptal edildi',
  'up.noKey': 'BetterPrivacy: şifreleme AÇIK ama anahtar seçili değil — yükleme iptal edildi',
  'up.cancelledLocked': 'BetterPrivacy: yükleme iptal edildi — anahtar kilitli',
  'up.tooLarge': 'BetterPrivacy: dosya şifrelenemeyecek kadar büyük (en fazla 64 MB) — yükleme iptal edildi',
  'up.encrypted': 'BetterPrivacy: ek "{label}" ile şifrelendi',
  'up.failed': 'BetterPrivacy: dosya şifrelenemedi — yükleme iptal edildi',
  'up.checkFailed': 'BetterPrivacy: yükleme denetimi başarısız — yükleme iptal edildi',

  'att.modeOff': '🔒 Şifreli dosya — bu kanalda şifreleme kapalı (açmak için tıkla)',
  'att.decryptedTitle': 'Çözüldü: {filename} (anahtar: {label})',
  'att.save': 'Çözülen dosyayı kaydet ({filename})',
  'att.decrypting': '🔒 Şifreli dosya — çözülüyor…',
  'att.unknown': '🔒 Şifreli dosya (bilinmeyen anahtar {keyId})',
  'att.locked': '🔒 Şifreli dosya (anahtar: {label}) — kilidi açmak için tıkla',
  'att.fetchFailed': '🔒 Şifreli dosya — indirme başarısız (tekrar denemek için tıkla)',
  'att.oversize': '🔒 Şifreli dosya ({mb} MB) — İndir ve çöz',
  'att.plain': '🔒 Şifreli dosya',

  'bar.noChannel': 'BetterPrivacy: geçerli kanal belirlenemedi — bir kez kanal değiştirmeyi dene',
  'bar.broken':
    'BetterPrivacy: şifreleme kullanılamıyor — mesaj yakalama bozuk (mesajlar DÜZ METİN gider)',
  'bar.encOn': '🦇 Bu kanalda şifreleme AÇIK',
  'bar.encPaused': 'BetterPrivacy: bu kanalda şifreleme duraklatıldı',
  'bar.forgetTitle': '🦇 Anahtarı unut',
  'bar.forgetBody':
    '{label} ({id}) unutulsun mu? Hiçbir şey sonsuza dek kaybolmaz — aynı ifadeyi tekrar girmek anahtarı birebir geri getirir.',
  'bar.forgotten': 'BetterPrivacy: anahtar unutuldu',
  'bar.forgetFailed': 'BetterPrivacy: anahtar unutulamadı',
  'bar.lockedAll': '🦇 Her şey kilitlendi',
  'bar.title.broken':
    'BetterPrivacy: şifreleme kullanılamıyor (Discord güncellemesi mesaj yakalamayı bozdu) — mesajlar DÜZ METİN gider',
  'bar.title.noChannel': 'BetterPrivacy: geçerli kanal belirlenemedi',
  'bar.title.noKey': 'BetterPrivacy: şifreli değil — bu kanala gizli ifade belirlemek için tıkla',
  'bar.title.locked': 'BetterPrivacy: kilitli — ifadeyi girmek için tıkla',
  'bar.title.on': 'BetterPrivacy: şifreli — duraklatmak için tıkla · seçenekler için sağ tık',
  'bar.title.paused':
    'BetterPrivacy: şifreleme duraklatıldı — sürdürmek için tıkla · seçenekler için sağ tık',
  'menu.status.broken': '⚠ Şifreleme bozuk (Discord güncellemesi)',
  'menu.status.noChannel': '⚠ Geçerli kanal belirlenemedi',
  'menu.status.notEncrypted': 'Bu kanal şifreli değil',
  'menu.status.needPhrase': 'İfade gerekli — girmek için 🦇 simgesine tıkla',
  'menu.status.on': 'Şifreli ve kilidi açık',
  'menu.status.paused': 'Şifreleme duraklatıldı',
  'menu.changePhrase': 'İfadeyi değiştir…',
  'menu.setPhrase': 'İfade belirle…',
  'menu.forgetChannelKey': 'Bu kanalın anahtarını unut',
  'menu.lockNow': 'Şimdi her şeyi kilitle',
  'menu.tip':
    'İpucu: /pt mesaj metni şifresiz gönderir; dosyalar kanal modunu izler · anahtarlar: Ayarlar → BetterPrivacy',

  'label.thisChannelKey': 'bu kanalın anahtarı',

  'um.title': '🦇 Anahtarın kilidini aç',
  'um.enterPhraseFor': '{label} için gizli ifadeyi gir',
  'um.passphrasePh': 'Parola',
  'um.unlocked': 'BetterPrivacy: "{label}" kilidi açıldı',
  'um.wrongPassphrase': 'Yanlış parola',
  'um.cancelled': 'Oturum veya anahtar değiştiği için kilit açma iptal edildi. Hazır olduğunda tekrar dene.',
  'pm.title': '🦇 Bu kanalı şifrele',
  'pm.prompt': 'Bu kanal için gizli bir ifade seç. Buradaki mesajların onunla şifrelenecek.',
  'pm.secretPhrasePh': 'Gizli ifade',
  'pm.hint':
    'Bu kanalda aynı ifadeyi giren herkes mesajları okuyabilir. İfadeyi Discord dışında paylaş.',
  'pm.phraseRequired': 'Gizli bir ifade gerekli',
  'pm.channelEncrypted': '🦇 Kanal şifrelendi — ifadeyi, okuması gereken kişilerle paylaş',
  'pm.setupFailed': 'Şifreleme kurulamadı',
  'rm.title': '🦇 Şifreli mesajın kilidini aç',
  'rm.prompt': 'Gönderenin seninle paylaştığı gizli ifadeyi gir.',
  'rm.noChannel':
    'BetterPrivacy: bu mesajın kanalı belirlenemedi — Ayarlar → Anahtar Yöneticisi üzerinden kurtar',
  'rm.wrongPhrase':
    'İfade yanlış veya şifreli veri değiştirilmiş. İfadeyi kontrol et; mesajı ya da dosyayı eksiksiz yeniden al.',
  'rm.accepted': '🦇 İfade kabul edildi — mesajların kilidi açıldı',
  'rm.failed': 'Anahtar kurtarılamadı',
  'ck.title': '🦇 Yeni anahtar',
  'ck.labelLabel': 'Etiket',
  'ck.labelPh': 'örn. ekip-sohbeti',
  'ck.passLabel': 'Parola',
  'ck.passPh': 'Ekibinle Discord dışında paylaşılır',
  'ck.onlyThisChannel': 'Yalnızca bu kanal',
  'ck.labelRequired': 'Anahtar etiketi gerekli',
  'ck.passRequired': 'Parola gerekli',
  'ck.ready': 'BetterPrivacy: "{label}" anahtarı hazır (oluşturuldu ve kilidi açıldı)',
  'ck.created': 'BetterPrivacy: "{label}" anahtarı oluşturuldu ({id})',
  'ck.createFailed': 'Anahtar oluşturulamadı',

  'km.health': 'Durum',
  'km.degraded':
    '⚠ Discord entegrasyonu aksadı — etkilenen: {list}. Muhtemelen bir Discord ya da eklenti güncellemesi gerekiyor.',
  'km.healthy': 'Tüm Discord entegrasyon noktaları sağlıklı.',
  'km.title': '🦇 Anahtar Yöneticisi',
  'km.th.label': 'Etiket',
  'km.th.keyId': 'Anahtar ID',
  'km.th.scope': 'Kapsam',
  'km.th.created': 'Oluşturulma',
  'km.th.actions': 'İşlemler',
  'km.scope.global': 'genel',
  'km.export': 'Dışa aktar',
  'km.noKeys': 'Henüz anahtar yok — aşağıdan oluştur ya da içe aktar.',
  'km.newKey': 'Yeni anahtar…',
  'km.importKey': 'Anahtar içe aktar…',
  'km.lockAllNow': 'Hepsini şimdi kilitle',
  'km.allLocked': 'BetterPrivacy: tüm anahtarlar kilitlendi',
  'km.deleteTitle': 'Anahtarı sil',
  'km.deleteBody':
    '"{label}" ({id}) anahtarı silinsin mi? Onunla şifrelenen mesajlar, anahtar yeniden içe aktarılana dek okunamaz.',
  'km.deleted': '"{label}" anahtarı silindi',
  'km.copied': 'Anahtar verisi panoya kopyalandı',
  'km.copyFailed': 'Panoya yazılamadı',
  'km.exportFailed': 'Dışa aktarma başarısız',
  'km.import.title': 'Anahtar içe aktar',
  'km.import.blobLabel': 'Anahtar verisi',
  'km.import.passLabel': 'Parola',
  'km.import.passPh': 'Bu anahtarın parolası',
  'km.imported': 'BetterPrivacy: "{label}" içe aktarıldı ve kilidi açıldı ({id})',
  'km.importFailed': 'Anahtar içe aktarılamadı',
  'km.section.language': 'Dil',
  'km.language': 'Eklenti dili',
  'km.languageHint': 'BetterPrivacy’nin kendi düğme, menü ve mesajları için geçerlidir.',
  'km.dropdownUnavailable': 'BetterDiscord ayar menüsü kullanılamıyor. Bu ayarı değiştirmek için BetterDiscord’u güncelle.',
  'km.language.auto': 'Otomatik (Discord’u izle)',
  'km.section.session': 'Oturum',
  'km.lockdown': 'Kilitleme modu',
  'km.lockdownHint': 'Kanal değiştirmek, parolalar yeniden girilene dek her şeyi kilitler.',
  'km.relockScope': 'Yeniden kilitleme kapsamı',
  'km.relockScopeHint': 'Kanal değişiminde hangi anahtarlar kilitlenir.',
  'km.relock.all': 'Tüm anahtarlar',
  'km.relock.prev': 'Yalnızca önceki kanal',
  'km.timeout': 'Çözme zaman aşımı (saniye)',
  'km.timeoutHint': '0 = asla, varsayılan 10800',
  'km.section.appearance': 'Görünüm',
  'km.indicator': 'Gösterge rengi',
  'km.indicatorHint': 'Çözülen mesajların metin rengi ve kilit simgesi.',
  'km.section.media': 'Medya ve bellek',
  'km.maxAuto': 'Otomatik indirme üst sınırı (MB)',
  'km.maxAutoHint': 'Bundan büyük şifreli ekler kendiliğinden indirilmez.',
  'km.memBudget': 'Bellek bütçesi (MB)',
  'km.memBudgetHint': 'Bütçeyi aşan çözülmüş medya LRU ile bellekten atılır.',

  'cm.copyCipher': 'Şifreli metni kopyala',
  'cm.copied': 'BetterPrivacy: şifreli metin kopyalandı',
  'cm.copyFailed': 'BetterPrivacy: kopyalama başarısız',
  'cm.redecrypt': 'Yeniden çöz',
  'cm.importForMsg': 'Bu mesaj için anahtar içe aktar…',
  'cm.importTitle': '🦇 BetterPrivacy anahtarı içe aktar',
  'cm.passPh': 'Parola',
  'cm.imported': 'BetterPrivacy: "{label}" anahtarı içe aktarıldı ve kilidi açıldı',
  'cm.importFailed': 'BetterPrivacy: içe aktarma başarısız — {error}',
  'cm.importDialogFailed': 'BetterPrivacy: içe aktarma penceresi açılamadı',
  'cm.defaultKey': 'Varsayılan BetterPrivacy anahtarını ayarla',
  'cm.none': 'Yok',
  'cm.defaultSet': 'BetterPrivacy: bu kanalın varsayılan anahtarı {label} olarak ayarlandı',
  'cm.defaultSetFailed': 'BetterPrivacy: varsayılan anahtar ayarlanamadı',

  'app.degraded': 'BetterPrivacy aksadı — etkilenen: {list}. Arka planda yeniden deneniyor.',
  'app.recovered': 'BetterPrivacy: Discord yüklendikten sonra düzeldi: {list}',
  'feat.sending': 'gönderme',
  'feat.display': 'mesaj görüntüleme',
  'feat.upload': 'dosya yükleme',
  'feat.fileDisplay': 'dosya görüntüleme',
  'feat.chatBar': 'mesaj çubuğu denetimleri',
  'feat.lockdown': 'kilitleme ve kanal takibi',
  'feat.richText': 'zengin metin',
  'ses.expired': 'BetterPrivacy: oturum anahtarlarının süresi doldu',

  'kr.exists':
    '{id} kimlikli bir anahtar zaten anahtarlıkta (aynı parola+salt). Önce onu kaldır ya da mevcut olanı kullan.',
  'kr.notBlob': 'Bu bir BetterPrivacy anahtar verisi değil ("betterprivacy-key:..." bekleniyordu)',
  'kr.malformed': 'Bozuk anahtar verisi (geçersiz base64 ya da JSON)',
  'kr.malformedShape': 'Bozuk anahtar verisi (beklenmeyen biçim)',
  'kr.malformedFields': 'Bozuk anahtar verisi (label, salt ya da check eksik)',
  'kr.wrongPass': 'Yanlış parola ya da bozuk anahtar verisi',
  'kr.noKey': 'Anahtarlıkta {id} kimlikli bir anahtar yok',
}

const ru: Record<MsgKey, string> = {
  'edit.dialogTitle': 'Изменить зашифрованное сообщение',
  'edit.save': 'Сохранить зашифрованным',
  'edit.hint': 'Редактируйте сообщение, а не ссылку. При сохранении используется исходный ключ. Не более одной зашифрованной части.',
  'edit.menu': 'Изменить зашифрованное сообщение…',
  'edit.unsafe': 'BetterPrivacy: невозможно проверить исходное сообщение или формат правки. Правка заблокирована для предотвращения утечки открытого текста.',
  'edit.noKey': 'BetterPrivacy: нужный ключ недоступен. Восстановите исходный ключ или выберите ключ отправки. Правка заблокирована.',
  'edit.oversize': 'BetterPrivacy: зашифрованная правка должна помещаться в одно сообщение (1360 байт UTF-8 / 2000 символов шифротекста). Сократите текст.',
  'edit.cancelled': 'BetterPrivacy: правка отменена: разблокировка отменена либо изменились сеанс, ключ, режим, выбор или исходное сообщение.',
  'edit.failed': 'BetterPrivacy: не удалось изменить сообщение. Открытый текст не отправлен.',
  'sending.channelKey': 'Ключ канала',
  'sending.picker': 'Ключ отправки',
  'sending.choose': 'Выбрать ключ',
  'sending.with': 'Текст и файлы отправляются с ключом {label}',
  'sending.paused': 'Шифрование приостановлено. Выбран ключ: {label}',
  'sending.hint': 'Один ключ для отправки. Открытие старого сообщения не меняет выбор.',
  'sending.newPhrase': '+ Использовать новую фразу…',
  'sending.selected': 'Отправка с ключом {label}',
  'sending.failed': 'Не удалось выбрать ключ отправки. Ваш выбор не изменён.',
  'sending.cancelled': 'Отправка отменена: изменился ключ отправки, режим шифрования или доступность ключа.',
  'sending.reply': 'Ответить с этим ключом',
  'sending.replyHint': 'Выбирает ключ для новых сообщений. Ничего не отправляется автоматически.',
  'common.cancel': 'Отмена',
  'common.unlock': 'Разблокировать',
  'common.encrypt': 'Зашифровать',
  'common.create': 'Создать',
  'common.import': 'Импортировать',
  'common.forget': 'Забыть',
  'common.delete': 'Удалить',

  'send.oversize':
    'BetterPrivacy: зашифрованное сообщение превышает лимит в 2000 символов — отправка отменена',
  'send.encryptFailed': 'BetterPrivacy: ошибка шифрования — отправка отменена',
  'send.sendingParts': '🦇 Длинное сообщение — отправляется зашифрованным в {n} частях',
  'send.confirmTitle': '🦇 Длинное сообщение',
  'send.confirmParts':
    'Это длинное сообщение — оно будет отправлено как {n} отдельных зашифрованных сообщений, по порядку. Отправить все?',
  'send.confirmSend': 'Отправить все',
  'send.declined': 'BetterPrivacy: отправка отменена',
  'send.ptTooLong':
    'BetterPrivacy: сообщение /pt превышает лимит Discord в 2000 символов — отправка отменена',
  'send.partFailed':
    'BetterPrivacy: часть {i} из {n} не отправилась — остальные части отменены',
  'send.encUsage': 'BetterPrivacy: использование — /enc <метка ключа> <сообщение>. Отправка отменена.',
  'send.noKeyLabelled': 'BetterPrivacy: нет ключа с меткой "{label}" — отправка отменена',
  'send.keyLocked':
    'BetterPrivacy: ключ "{label}" заблокирован — сначала разблокируйте его. Отправка отменена.',
  'send.stickers': 'BetterPrivacy: стикеры нельзя зашифровать — отправка отменена',
  'send.usingKey': 'BetterPrivacy: используется ключ "{label}"',
  'send.noKeySelected':
    'BetterPrivacy: ключ отправки не выбран — задайте фразу через 🦇 или выберите ключ в меню канала. Отправка отменена.',
  'send.cancelledLocked': 'BetterPrivacy: отправка отменена — ключ заблокирован',
  'send.internalError': 'BetterPrivacy: внутренняя ошибка — сообщение НЕ отправлено',
  'up.unavailable': 'BetterPrivacy: интеграция загрузки недоступна — файлы блокируются, пока сохранены ключи. Дождитесь восстановления интеграции.',

  'chip.modeOffTitle': 'Шифрование в этом канале выключено',
  'chip.modeOff': '🔒 Зашифрованное сообщение — шифрование в канале выключено (нажмите, чтобы включить)',
  'chip.encryptedWith': 'Зашифровано ключом "{label}"',
  'chip.failed': '⚠ Не удалось расшифровать (сообщение изменено или ключ не тот)',
  'chip.unknownTitle':
    'Нажмите, чтобы открыть секретной фразой · Alt+клик — показать шифротекст',
  'chip.unknown': '🔒 Зашифрованное сообщение (неизвестный ключ {keyId}) — нажмите, чтобы восстановить',
  'chip.locked': '🔒 Зашифрованное сообщение (ключ: {label}) — нажмите, чтобы разблокировать',
  'chip.decrypting': '🔒 Расшифровка…',

  'up.noChannel':
    'BetterPrivacy: канал назначения отсутствует или указан неоднозначно — файл заблокирован. Выберите файл заново в нужном канале; если ошибка повторится, интеграцию загрузки нужно обновить.',
  'up.noAccess': 'BetterPrivacy: нет доступа к файлу для шифрования — загрузка прервана',
  'up.noKey': 'BetterPrivacy: шифрование ВКЛЮЧЕНО, но ключ не выбран — загрузка прервана',
  'up.cancelledLocked': 'BetterPrivacy: загрузка отменена — ключ заблокирован',
  'up.tooLarge': 'BetterPrivacy: файл слишком большой для шифрования (максимум 64 МБ) — загрузка прервана',
  'up.encrypted': 'BetterPrivacy: вложение зашифровано ключом "{label}"',
  'up.failed': 'BetterPrivacy: не удалось зашифровать вложение — загрузка прервана',
  'up.checkFailed': 'BetterPrivacy: проверка загрузки не удалась — загрузка прервана',

  'att.modeOff': '🔒 Зашифрованный файл — шифрование в канале выключено (нажмите, чтобы включить)',
  'att.decryptedTitle': 'Расшифровано: {filename} (ключ: {label})',
  'att.save': 'Сохранить расшифрованный файл ({filename})',
  'att.decrypting': '🔒 Зашифрованный файл — расшифровка…',
  'att.unknown': '🔒 Зашифрованный файл (неизвестный ключ {keyId})',
  'att.locked': '🔒 Зашифрованный файл (ключ: {label}) — нажмите, чтобы разблокировать',
  'att.fetchFailed': '🔒 Зашифрованный файл — ошибка загрузки (нажмите, чтобы повторить)',
  'att.oversize': '🔒 Зашифрованный файл ({mb} МБ) — Скачать и расшифровать',
  'att.plain': '🔒 Зашифрованный файл',

  'bar.noChannel': 'BetterPrivacy: не удалось определить текущий канал — попробуйте переключить канал',
  'bar.broken':
    'BetterPrivacy: шифрование недоступно — перехват сообщений сломан (сообщения ушли бы ОТКРЫТЫМ ТЕКСТОМ)',
  'bar.encOn': '🦇 Шифрование в этом канале ВКЛЮЧЕНО',
  'bar.encPaused': 'BetterPrivacy: шифрование в этом канале приостановлено',
  'bar.forgetTitle': '🦇 Забыть ключ',
  'bar.forgetBody':
    'Забыть {label} ({id})? Ничто не теряется навсегда — ввод той же фразы восстановит ключ в точности.',
  'bar.forgotten': 'BetterPrivacy: ключ забыт',
  'bar.forgetFailed': 'BetterPrivacy: не удалось забыть ключ',
  'bar.lockedAll': '🦇 Всё заблокировано',
  'bar.title.broken':
    'BetterPrivacy: шифрование недоступно (обновление Discord сломало перехват) — сообщения ушли бы ОТКРЫТЫМ ТЕКСТОМ',
  'bar.title.noChannel': 'BetterPrivacy: не удалось определить текущий канал',
  'bar.title.noKey': 'BetterPrivacy: не зашифровано — нажмите, чтобы задать секретную фразу для канала',
  'bar.title.locked': 'BetterPrivacy: заблокировано — нажмите, чтобы ввести фразу',
  'bar.title.on': 'BetterPrivacy: зашифровано — клик: пауза · правый клик: настройки',
  'bar.title.paused': 'BetterPrivacy: шифрование на паузе — клик: продолжить · правый клик: настройки',
  'menu.status.broken': '⚠ Шифрование сломано (обновление Discord)',
  'menu.status.noChannel': '⚠ Не удалось определить текущий канал',
  'menu.status.notEncrypted': 'Этот канал не зашифрован',
  'menu.status.needPhrase': 'Нужна фраза — нажмите 🦇, чтобы ввести её',
  'menu.status.on': 'Зашифровано и разблокировано',
  'menu.status.paused': 'Шифрование приостановлено',
  'menu.changePhrase': 'Сменить фразу…',
  'menu.setPhrase': 'Задать фразу…',
  'menu.forgetChannelKey': 'Забыть ключ этого канала',
  'menu.lockNow': 'Заблокировать всё сейчас',
  'menu.tip':
    'Совет: /pt текст отправляет текст без шифрования; файлы следуют режиму канала · ключи: Настройки → BetterPrivacy',

  'label.thisChannelKey': 'ключ этого канала',

  'um.title': '🦇 Разблокировать ключ',
  'um.enterPhraseFor': 'Введите секретную фразу для {label}',
  'um.passphrasePh': 'Пароль',
  'um.unlocked': 'BetterPrivacy: разблокирован "{label}"',
  'um.wrongPassphrase': 'Неверный пароль',
  'um.cancelled': 'Разблокировка отменена: изменился сеанс или ключ. Повторите, когда будете готовы.',
  'pm.title': '🦇 Зашифровать этот канал',
  'pm.prompt': 'Придумайте секретную фразу для этого канала. Ваши сообщения здесь будут шифроваться ею.',
  'pm.secretPhrasePh': 'Секретная фраза',
  'pm.hint':
    'Любой в этом канале, кто введёт ту же фразу, сможет читать сообщения. Передавайте её вне Discord.',
  'pm.phraseRequired': 'Нужна секретная фраза',
  'pm.channelEncrypted': '🦇 Канал зашифрован — передайте фразу тем, кто должен читать',
  'pm.setupFailed': 'Не удалось настроить шифрование',
  'rm.title': '🦇 Разблокировать зашифрованное сообщение',
  'rm.prompt': 'Введите секретную фразу, которой поделился отправитель.',
  'rm.noChannel':
    'BetterPrivacy: не удалось определить канал сообщения — восстановите через Настройки → Менеджер ключей',
  'rm.wrongPhrase':
    'Фраза неверна или зашифрованные данные изменены. Проверьте фразу и заново скопируйте сообщение или файл целиком.',
  'rm.accepted': '🦇 Фраза принята — сообщения разблокированы',
  'rm.failed': 'Не удалось восстановить ключ',
  'ck.title': '🦇 Новый ключ',
  'ck.labelLabel': 'Метка',
  'ck.labelPh': 'напр. team-chat',
  'ck.passLabel': 'Пароль',
  'ck.passPh': 'Передаётся участникам вне Discord',
  'ck.onlyThisChannel': 'Только этот канал',
  'ck.labelRequired': 'Нужна метка ключа',
  'ck.passRequired': 'Нужен пароль',
  'ck.ready': 'BetterPrivacy: ключ "{label}" готов (создан и разблокирован)',
  'ck.created': 'BetterPrivacy: ключ "{label}" создан ({id})',
  'ck.createFailed': 'Не удалось создать ключ',

  'km.health': 'Состояние',
  'km.degraded':
    '⚠ Интеграция с Discord нарушена — затронуто: {list}. Вероятно, нужно обновление Discord или плагина.',
  'km.healthy': 'Все точки интеграции с Discord в порядке.',
  'km.title': '🦇 Менеджер ключей',
  'km.th.label': 'Метка',
  'km.th.keyId': 'ID ключа',
  'km.th.scope': 'Область',
  'km.th.created': 'Создан',
  'km.th.actions': 'Действия',
  'km.scope.global': 'общий',
  'km.export': 'Экспорт',
  'km.noKeys': 'Ключей пока нет — создайте или импортируйте ниже.',
  'km.newKey': 'Новый ключ…',
  'km.importKey': 'Импортировать ключ…',
  'km.lockAllNow': 'Заблокировать всё',
  'km.allLocked': 'BetterPrivacy: все ключи заблокированы',
  'km.deleteTitle': 'Удалить ключ',
  'km.deleteBody':
    'Удалить ключ "{label}" ({id})? Зашифрованные им сообщения станут нечитаемыми, пока ключ не будет импортирован снова.',
  'km.deleted': 'Ключ "{label}" удалён',
  'km.copied': 'Ключ скопирован в буфер обмена',
  'km.copyFailed': 'Не удалось записать в буфер обмена',
  'km.exportFailed': 'Экспорт не удался',
  'km.import.title': 'Импорт ключа',
  'km.import.blobLabel': 'Данные ключа',
  'km.import.passLabel': 'Пароль',
  'km.import.passPh': 'Пароль этого ключа',
  'km.imported': 'BetterPrivacy: импортирован и разблокирован "{label}" ({id})',
  'km.importFailed': 'Не удалось импортировать ключ',
  'km.section.language': 'Язык',
  'km.language': 'Язык плагина',
  'km.languageHint': 'Действует на собственные кнопки, меню и сообщения BetterPrivacy.',
  'km.dropdownUnavailable': 'Меню настроек BetterDiscord недоступно. Обновите BetterDiscord, чтобы изменить этот параметр.',
  'km.language.auto': 'Авто (как в Discord)',
  'km.section.session': 'Сессия',
  'km.lockdown': 'Режим изоляции',
  'km.lockdownHint': 'Смена канала блокирует всё, пока пароли не введены заново.',
  'km.relockScope': 'Что блокировать',
  'km.relockScopeHint': 'Какие ключи блокируются при смене канала.',
  'km.relock.all': 'Все ключи',
  'km.relock.prev': 'Только предыдущий канал',
  'km.timeout': 'Тайм-аут расшифровки (секунды)',
  'km.timeoutHint': '0 = никогда, по умолчанию 10800',
  'km.section.appearance': 'Внешний вид',
  'km.indicator': 'Цвет индикатора',
  'km.indicatorHint': 'Цвет текста и значка замка у расшифрованных сообщений.',
  'km.section.media': 'Медиа и память',
  'km.maxAuto': 'Максимум авто-загрузки (МБ)',
  'km.maxAutoHint': 'Зашифрованные вложения крупнее этого не скачиваются автоматически.',
  'km.memBudget': 'Бюджет памяти (МБ)',
  'km.memBudgetHint': 'Расшифрованные медиа сверх бюджета вытесняются по LRU.',

  'cm.copyCipher': 'Скопировать шифротекст',
  'cm.copied': 'BetterPrivacy: шифротекст скопирован',
  'cm.copyFailed': 'BetterPrivacy: не удалось скопировать',
  'cm.redecrypt': 'Расшифровать заново',
  'cm.importForMsg': 'Импортировать ключ для этого сообщения…',
  'cm.importTitle': '🦇 Импорт ключа BetterPrivacy',
  'cm.passPh': 'Пароль',
  'cm.imported': 'BetterPrivacy: ключ "{label}" импортирован и разблокирован',
  'cm.importFailed': 'BetterPrivacy: импорт не удался — {error}',
  'cm.importDialogFailed': 'BetterPrivacy: не удалось открыть окно импорта',
  'cm.defaultKey': 'Ключ BetterPrivacy по умолчанию',
  'cm.none': 'Нет',
  'cm.defaultSet': 'BetterPrivacy: ключ по умолчанию для канала — {label}',
  'cm.defaultSetFailed': 'BetterPrivacy: не удалось задать ключ по умолчанию',

  'app.degraded': 'BetterPrivacy работает частично — затронуто: {list}. Повтор в фоне.',
  'app.recovered': 'BetterPrivacy: восстановлено после загрузки Discord: {list}',
  'feat.sending': 'отправка',
  'feat.display': 'отображение сообщений',
  'feat.upload': 'загрузка файлов',
  'feat.fileDisplay': 'отображение файлов',
  'feat.chatBar': 'кнопки у поля ввода',
  'feat.lockdown': 'изоляция и отслеживание каналов',
  'feat.richText': 'форматирование текста',
  'ses.expired': 'BetterPrivacy: срок сессионных ключей истёк',

  'kr.exists':
    'Ключ с id {id} уже есть в связке (тот же пароль+salt). Сначала удалите его или используйте существующий.',
  'kr.notBlob': 'Это не ключ BetterPrivacy (ожидалось "betterprivacy-key:...")',
  'kr.malformed': 'Повреждённые данные ключа (некорректный base64 или JSON)',
  'kr.malformedShape': 'Повреждённые данные ключа (неожиданная структура)',
  'kr.malformedFields': 'Повреждённые данные ключа (нет label, salt или check)',
  'kr.wrongPass': 'Неверный пароль или повреждённые данные ключа',
  'kr.noKey': 'В связке нет ключа с id {id}',
}

const TABLES: Record<BpLocale, Record<MsgKey, string>> = { en, tr, ru }

// ---------------------------------------------------------------------------
// Locale state
// ---------------------------------------------------------------------------

let locale: BpLocale = 'en'

function normalizeTag(tag: unknown): BpLocale | null {
  if (typeof tag !== 'string') return null
  const lower = tag.toLowerCase()
  if (lower === 'tr' || lower.startsWith('tr-')) return 'tr'
  if (lower === 'ru' || lower.startsWith('ru-')) return 'ru'
  if (lower === 'en' || lower.startsWith('en-')) return 'en'
  return null
}

/** Discord's own UI language, via its LocaleStore when reachable. */
function discordLocale(): BpLocale | null {
  try {
    if (typeof BdApi === 'undefined') return null
    const store: any = (BdApi as any).Webpack?.getStore?.('LocaleStore')
    return normalizeTag(store?.locale ?? store?.getLocale?.())
  } catch {
    return null
  }
}

function detectAuto(): BpLocale {
  const fromDiscord = discordLocale()
  if (fromDiscord) return fromDiscord
  try {
    if (typeof navigator !== 'undefined') {
      const fromNav = normalizeTag(navigator.language)
      if (fromNav) return fromNav
    }
  } catch {
    // navigator unavailable (tests) — fall through to English.
  }
  return 'en'
}

function resolve(pref: string | undefined): BpLocale {
  if (pref && pref !== 'auto') {
    const explicit = normalizeTag(pref)
    if (explicit) return explicit
  }
  return detectAuto()
}

/**
 * Wires locale to the settings store: applies settings.language now and on
 * every future settings change. Safe to call more than once (start/stop
 * cycles); without a store (tests) it just re-runs auto-detection.
 */
export function initI18n(settings?: Pick<SettingsStore, 'get' | 'onChange'>): void {
  if (!settings) {
    locale = detectAuto()
    return
  }
  locale = resolve(settings.get().language)
  settings.onChange((s) => {
    locale = resolve(s.language)
  })
}

export function currentLocale(): BpLocale {
  return locale
}

/** Test hook / explicit override; prefer settings.language in product code. */
export function setLocale(code: BpLocale): void {
  locale = code
}

export function t(key: MsgKey, params?: Record<string, string | number>): string {
  let out: string = TABLES[locale][key] ?? en[key]
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      out = out.split(`{${name}}`).join(String(value))
    }
  }
  return out
}
