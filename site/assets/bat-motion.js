(function () {
  'use strict';
  // Decorative only: no messages, phrases, hashes or crypto are read here.
  var preference = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var observers = [];
  var buttons = [];
  var intro = null;
  var introTimer = null;
  var started = false;
  var introAttempted = false;
  function canMove() { return !(preference && preference.matches) && !document.hidden; }
  function bat() {
    var node = document.createElement('span');
    node.textContent = '🦇';
    node.setAttribute('aria-hidden', 'true');
    return node;
  }
  function dismissIntro() {
    if (introTimer !== null) clearTimeout(introTimer);
    introTimer = null;
    if (intro) intro.remove();
    intro = null;
    document.removeEventListener('pointerdown', dismissIntro, true);
    document.removeEventListener('keydown', dismissIntro, true);
  }
  function welcome() {
    if (introAttempted) return;
    introAttempted = true;
    if (!canMove()) return;
    // A harmless tab-local appearance preference, never an identifier.
    try {
      if (sessionStorage.getItem('bp-bat-welcome') === 'seen') return;
      sessionStorage.setItem('bp-bat-welcome', 'seen');
    } catch (_) { /* Storage restrictions must not affect the page. */ }
    intro = document.createElement('div');
    intro.className = 'bp-bat-welcome';
    intro.setAttribute('aria-hidden', 'true');
    intro.setAttribute('inert', '');
    var small = window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
    var count = small ? 5 : 10;
    for (var i = 0; i < count; i++) {
      var node = bat();
      var angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      node.className = 'bp-bat-flight';
      node.style.setProperty('--bat-x', Math.round(Math.cos(angle) * 54) + 'vw');
      node.style.setProperty('--bat-y', Math.round(Math.sin(angle) * 48) + 'vh');
      node.style.setProperty('--bat-turn', (i % 2 ? 22 : -22) + 'deg');
      node.style.animationDelay = i * 24 + 'ms';
      intro.appendChild(node);
    }
    document.body.appendChild(intro);
    // The content is never hidden, made inert, or held until this timeout.
    introTimer = setTimeout(dismissIntro, 720);
    document.addEventListener('pointerdown', dismissIntro, true);
    document.addEventListener('keydown', dismissIntro, true);
  }
  function sync(button) {
    var existing = button.querySelector('.bp-bat-working');
    if (!button.disabled || !canMove()) {
      if (existing) existing.remove();
      button.classList.remove('bp-bat-busy');
      return;
    }
    if (existing) return;
    var decoration = document.createElement('span');
    decoration.className = 'bp-bat-working';
    decoration.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 3; i++) decoration.appendChild(bat());
    button.classList.add('bp-bat-busy');
    button.appendChild(decoration);
  }
  function start() {
    if (started) return;
    started = true;
    ['create-submit', 'go', 'fgo'].forEach(function (id) {
      var button = document.getElementById(id);
      if (!button) return;
      buttons.push(button);
      // Scoped to three controls, not the page. Child changes cover language
      // switches that replace a busy button's label; no message text is read.
      var observer = new MutationObserver(function () { sync(button); });
      observer.observe(button, { attributes: true, attributeFilter: ['disabled'], childList: true });
      observers.push(observer);
      sync(button);
    });
    welcome();
  }
  function stop() {
    observers.forEach(function (observer) { observer.disconnect(); });
    observers = [];
    buttons.forEach(function (button) {
      var decoration = button.querySelector('.bp-bat-working');
      if (decoration) decoration.remove();
      button.classList.remove('bp-bat-busy');
    });
    buttons = [];
    started = false;
    dismissIntro();
  }
  function preferenceChanged() {
    if (!canMove()) dismissIntro();
    buttons.forEach(sync);
  }
  if (preference && preference.addEventListener) preference.addEventListener('change', preferenceChanged);
  document.addEventListener('visibilitychange', preferenceChanged);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', function (event) { if (event.persisted) start(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
