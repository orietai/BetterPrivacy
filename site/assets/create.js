/* v1 uses the same PBKDF2 / AES-GCM / fragment fields as src/crypto/*. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var message = $('message');
  var phrase = $('create-phrase');
  var form = $('create-form');
  var submit = $('create-submit');
  var generated = $('generated');
  var busy = false;
  var revision = 0;
  var MAX_BYTES = 1360; // Plugin CHUNK_UTF8_BYTES: one link fits Discord's 2,000 characters.
  var ui = window.BPUI;
  function say(id, key, error) {
    $(id).setAttribute('data-copy', key);
    $(id).textContent = ui.text(key);
    $(id).classList.toggle('err', !!error);
  }
  function b64(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function byteLength(text) { return new TextEncoder().encode(text).length; }
  function clearLink() {
    generated.hidden = true;
    $('share-link').value = '';
    $('open-created').removeAttribute('href');
    $('share-status').textContent = '';
    $('share-status').removeAttribute('data-copy');
  }
  function changed() {
    revision++;
    clearLink();
    if (!busy) {
      $('create-status').textContent = '';
      $('create-status').removeAttribute('data-copy');
    }
    var bytes = byteLength(message.value);
    $('message-budget').textContent = bytes.toLocaleString() + ' / 1,360 bytes';
    $('message-budget').classList.toggle('over', bytes > MAX_BYTES);
    message.setAttribute('aria-invalid', String(bytes > MAX_BYTES));
  }
  message.addEventListener('input', changed);
  phrase.addEventListener('input', changed);
  $('show-phrase').addEventListener('click', function () {
    var show = phrase.type === 'password';
    phrase.type = show ? 'text' : 'password';
    this.setAttribute('aria-pressed', String(show));
    this.setAttribute('data-copy', show ? 'hidePhrase' : 'showPhrase');
    ui.refresh();
  });
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (busy) return;
    clearLink();
    if (!message.value.trim()) { say('create-status', 'messageEmpty', true); message.focus(); return; }
    if (byteLength(message.value) > MAX_BYTES) { say('create-status', 'messageLong', true); message.focus(); return; }
    if (!phrase.value.trim()) { say('create-status', 'phraseEmpty', true); phrase.focus(); return; }
    if (!window.crypto || !crypto.subtle) { say('create-status', 'secureOrigin', true); return; }
    busy = true;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    var current = revision;
    var plainBytes = new TextEncoder().encode(message.value);
    var raw = null;
    say('create-status', 'encrypting');
    try {
      // Random salt per message; the v1 URL carries it so no channel or stored keyring is needed.
      var salt = crypto.getRandomValues(new Uint8Array(16));
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var passBytes = new TextEncoder().encode(phrase.value);
      var pk;
      try { pk = await crypto.subtle.importKey('raw', passBytes, 'PBKDF2', false, ['deriveBits']); }
      finally { passBytes.fill(0); }
      raw = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: 600000 }, pk, 256));
      var digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
      var keyId = b64(digest.subarray(0, 6));
      var key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
      raw.fill(0);
      var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plainBytes));
      if (revision !== current) { say('create-status', 'changedWhileEncrypting', true); return; }
      var fragment = '#v1.' + keyId + '.' + b64(salt) + '.' + b64(iv) + '.' + b64(ct);
      var link = 'https://betterprivacy.app/m' + fragment;
      if (('🦇<' + link + '>').length > 2000) throw new Error('oversize');
      $('share-link').value = link;
      // Local preview opens the local reader; the copied link always uses the public domain.
      $('open-created').href = '/m/' + fragment;
      $('share-native').hidden = typeof navigator.share !== 'function';
      generated.hidden = false;
      say('create-status', 'encrypted');
      $('generated-title').focus();
    } catch (_) {
      say('create-status', 'encryptFailed', true);
    } finally {
      if (raw) raw.fill(0);
      plainBytes.fill(0);
      submit.disabled = false;
      busy = false;
      form.removeAttribute('aria-busy');
    }
  });
  $('copy-link').addEventListener('click', async function () {
    var link = $('share-link').value;
    var started = revision;
    if (!link) return;
    function current() { return revision === started && !generated.hidden && $('share-link').value === link; }
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(link);
      if (!current()) return;
      say('share-status', 'linkCopied');
    } catch (_) {
      if (!current()) return;
      $('share-link').focus();
      $('share-link').select();
      say('share-status', 'copyManually');
    }
  });
  $('share-native').addEventListener('click', async function () {
    var link = $('share-link').value;
    var started = revision;
    if (!link || !navigator.share) return;
    try { await navigator.share({ title: 'BetterPrivacy', url: link }); }
    catch (err) { if (revision === started && !generated.hidden && err.name !== 'AbortError') say('share-status', 'shareFailed', true); }
  });
  $('start-over').addEventListener('click', function () {
    form.reset();
    phrase.type = 'password';
    $('show-phrase').setAttribute('aria-pressed', 'false');
    $('show-phrase').setAttribute('data-copy', 'showPhrase');
    $('create-status').textContent = '';
    $('create-status').removeAttribute('data-copy');
    changed();
    ui.refresh();
    message.focus();
  });
  // No message, phrase, or link is persisted; only the language preference is shared.
  window.addEventListener('pagehide', function () { form.reset(); changed(); });
})();
