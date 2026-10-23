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
    node.setAttribute('aria-hidden', 'true');
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 48 32');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'bp-bat-shape');
    [
      ['bp-bat-wing bp-bat-wing-left', 'M23 16C16 7 9 9 2 3C2 14 5 21 10 25Q13 19 17 24Q19 20 23 22Z'],
      ['bp-bat-wing bp-bat-wing-right', 'M25 16C32 7 39 9 46 3C46 14 43 21 38 25Q35 19 31 24Q29 20 25 22Z'],
      ['bp-bat-body', 'M20 15L20 8L24 12L28 8L28 15Q31 24 24 29Q17 24 20 15Z'],
    ].forEach(function (part) {
      var path = document.createElementNS(ns, 'path');
      path.setAttribute('class', part[0]);
      path.setAttribute('d', part[1]);
      svg.appendChild(path);
    });
    node.appendChild(svg);
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
      node.className = 'bp-bat-flight';
      node.style.top = (20 + (i * 13 % 45)) + '%';
      node.style.width = (small ? 26 : 30 + (i % 3) * 7) + 'px';
      node.style.setProperty('--bat-rise', (-8 - i % 4 * 4) + 'vh');
      node.style.animationDelay = i * 35 + 'ms';
      intro.appendChild(node);
    }
    document.body.appendChild(intro);
    // The content is never hidden, made inert, or held until this timeout.
    introTimer = setTimeout(dismissIntro, 1250);
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
    decoration.appendChild(bat());
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
