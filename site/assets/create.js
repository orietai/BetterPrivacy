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
  var links = [];
  var qrUrl = null;
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
  // Keep boundaries identical to src/crypto/wire.ts: lossless UTF-8 chunks,
  // whole code points, preferring whitespace in the latter 40% of a part.
  function chunkPlaintext(text) {
    var chunks = [], start = 0, i = 0, bytes = 0, breakAt = -1, breakBytes = 0;
    while (i < text.length) {
      var cp = text.codePointAt(i);
      var units = cp > 0xffff ? 2 : 1;
      var size = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
      if (bytes + size > MAX_BYTES) {
        var cut = breakAt > start && breakBytes >= MAX_BYTES * 0.6 ? breakAt : i;
        chunks.push(text.slice(start, cut));
        start = i = cut;
        bytes = 0; breakAt = -1; breakBytes = 0;
        continue;
      }
      bytes += size; i += units;
      if (cp === 0x20 || cp === 0x0a || cp === 0x09) { breakAt = i; breakBytes = bytes; }
    }
    chunks.push(text.slice(start));
    return chunks;
  }
  function budget() {
    $('qr-image').alt = ui.text('qrAlt');
    var count = chunkPlaintext(message.value).length;
    $('message-budget').textContent = byteLength(message.value).toLocaleString(document.documentElement.lang) +
      ' ' + ui.text('bytesLabel') + ' · ' + count + ' ' + ui.text(count > 1 ? 'linksCount' : 'linkCount');
  }
  function clearQr() {
    $('qr-panel').hidden = true;
    $('qr-image').removeAttribute('src');
    $('download-qr').removeAttribute('href');
    $('show-qr').hidden = true;
    $('show-qr').setAttribute('aria-expanded', 'false');
    $('show-qr').setAttribute('data-copy', 'qrShow');
    $('show-qr').textContent = ui.text('qrShow');
    $('qr-limit').hidden = true;
    $('qr-status').textContent = '';
    $('qr-status').removeAttribute('data-copy');
    $('qr-status').classList.remove('err');
    if (qrUrl) { URL.revokeObjectURL(qrUrl); qrUrl = null; }
  }
  $('show-qr').addEventListener('click', function () {
    if (generated.hidden || links.length !== 1 || !window.BPQR || !BPQR.canEncode(links[0])) return;
    if (!$('qr-panel').hidden) {
      clearQr();
      $('show-qr').hidden = false;
      return;
    }
    try {
      var svg = BPQR.svg(links[0]);
      qrUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      var url = qrUrl, started = revision;
      // A fresh node owns each load; an old image error must not clear a new QR.
      var image = $('qr-image').cloneNode(false);
      image.onerror = function () {
        if (revision !== started || qrUrl !== url) return;
        clearQr();
        $('show-qr').hidden = false;
        say('qr-status', 'qrFailed', true);
      };
      $('qr-image').replaceWith(image);
      image.src = qrUrl;
      $('download-qr').href = qrUrl;
      $('qr-panel').hidden = false;
      $('qr-status').textContent = '';
      $('qr-status').removeAttribute('data-copy');
      $('qr-status').classList.remove('err');
      $('show-qr').setAttribute('aria-expanded', 'true');
      say('show-qr', 'qrHide');
    } catch (_) {
      clearQr();
      $('show-qr').hidden = false;
      say('qr-status', 'qrFailed', true);
    }
  });
  function clearLink() {
    clearQr();
    links = [];
    generated.hidden = true;
    $('share-link').value = '';
    $('generated-parts').replaceChildren();
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
    budget();
  }
  window.addEventListener('bp-language-change', budget);
  budget();
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
    revision++;
    clearLink();
    if (!message.value.trim()) { say('create-status', 'messageEmpty', true); message.focus(); return; }
    if (!phrase.value.trim()) { say('create-status', 'phraseEmpty', true); phrase.focus(); return; }
    if (!window.crypto || !crypto.subtle) { say('create-status', 'secureOrigin', true); return; }
    busy = true;
    submit.disabled = true;
    form.setAttribute('aria-busy', 'true');
    var current = revision;
    var chunks = chunkPlaintext(message.value);
    var plainBytes = null;
    var raw = null;
    say('create-status', 'encrypting');
    try {
      // One fresh salt per submission, one derivation for all parts. Each URL
      // remains a standalone v1 message with its own fresh AES-GCM nonce.
      var salt = crypto.getRandomValues(new Uint8Array(16));
      var passBytes = new TextEncoder().encode(phrase.value);
      var pk;
      try { pk = await crypto.subtle.importKey('raw', passBytes, 'PBKDF2', false, ['deriveBits']); }
      finally { passBytes.fill(0); }
      raw = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: 600000 }, pk, 256));
      var digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
      var keyId = b64(digest.subarray(0, 6));
      var key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
      raw.fill(0);
      var pending = [];
      for (var n = 0; n < chunks.length; n++) {
        if (revision !== current) { say('create-status', 'changedWhileEncrypting', true); return; }
        var iv = crypto.getRandomValues(new Uint8Array(12));
        plainBytes = new TextEncoder().encode(chunks[n]);
        var ct;
        try { ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plainBytes)); }
        finally { plainBytes.fill(0); }
        var fragment = '#v1.' + keyId + '.' + b64(salt) + '.' + b64(iv) + '.' + b64(ct);
        var link = 'https://betterprivacy.app/m' + fragment;
        if (('🦇<' + link + '>').length > 2000) throw new Error('oversize');
        pending.push(link);
      }
      if (revision !== current) { say('create-status', 'changedWhileEncrypting', true); return; }
      // Publish atomically: never expose an incomplete or obsolete set of parts.
      links = pending;
      $('share-link').value = links.join('\n');
      var multi = links.length > 1;
      $('share-link').rows = multi ? 5 : 3;
      say('generated-title', multi ? 'readyManyTitle' : 'readyTitle');
      say('ready-help', multi ? 'readyManyHelp' : 'readyHelp');
      say('share-link-label', multi ? 'linksLabel' : 'linkLabel');
      say('copy-link', multi ? 'copyAllLinks' : 'copyLink');
      $('generated-parts').hidden = !multi;
      if (multi) links.forEach(function (part, index) {
        var row = document.createElement('li');
        var label = document.createElement('span');
        label.setAttribute('data-copy', 'partLabel');
        label.textContent = ui.text('partLabel');
        var heading = document.createElement('p');
        heading.append(label, ' ' + (index + 1) + ' / ' + links.length);
        var actions = document.createElement('div');
        actions.className = 'actions';
        var copy = document.createElement('button');
        copy.type = 'button'; copy.className = 'button secondary compact';
        copy.setAttribute('data-copy', 'copyLink'); copy.textContent = ui.text('copyLink');
        copy.addEventListener('click', function () { copyLinks(part, current); });
        var open = document.createElement('a');
        open.className = 'button secondary compact'; open.target = '_blank'; open.rel = 'noopener noreferrer';
        open.href = '/m/' + new URL(part).hash;
        open.setAttribute('data-copy', 'openPart'); open.textContent = ui.text('openPart');
        row.append(heading, actions); actions.append(copy, open);
        $('generated-parts').append(row);
      });
      // Local preview opens the local reader; the copied link always uses the public domain.
      $('open-created').href = '/m/' + new URL(links[0]).hash;
      $('open-created').hidden = multi;
      $('share-native').hidden = typeof navigator.share !== 'function';
      generated.hidden = false;
      $('show-qr').hidden = multi || !window.BPQR || !BPQR.canEncode(links[0]);
      $('qr-limit').hidden = !$('show-qr').hidden;
      say('create-status', multi ? 'encryptedMany' : 'encrypted');
      $('generated-title').focus();
    } catch (_) {
      say('create-status', 'encryptFailed', true);
    } finally {
      if (raw) raw.fill(0);
      if (plainBytes) plainBytes.fill(0);
      submit.disabled = false;
      busy = false;
      form.removeAttribute('aria-busy');
    }
  });
  async function copyLinks(link, started) {
    if (!link) return;
    function current() { return revision === started && !generated.hidden; }
    if (!current()) return;
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(link);
      if (!current()) return;
      say('share-status', link.includes('\n') ? 'linksCopied' : 'linkCopied');
    } catch (_) {
      if (!current()) return;
      $('share-link').focus();
      var offset = $('share-link').value.indexOf(link);
      $('share-link').setSelectionRange(offset, offset + link.length);
      say('share-status', link.includes('\n') ? 'copyManyManually' : 'copyManually');
    }
  }
  $('copy-link').addEventListener('click', function () {
    copyLinks($('share-link').value, revision);
  });
  $('share-native').addEventListener('click', async function () {
    var link = $('share-link').value;
    var started = revision;
    if (!link || !navigator.share) return;
    try { await navigator.share(links.length > 1 ? { title: 'BetterPrivacy', text: link } : { title: 'BetterPrivacy', url: link }); }
    catch (err) { if (revision === started && !generated.hidden && (!err || err.name !== 'AbortError')) say('share-status', 'shareFailed', true); }
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
  window.addEventListener('pagehide', function () {
    form.reset();
    phrase.type = 'password';
    $('show-phrase').setAttribute('aria-pressed', 'false');
    $('show-phrase').setAttribute('data-copy', 'showPhrase');
    changed();
    ui.refresh();
  });
})();
