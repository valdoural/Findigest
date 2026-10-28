/**
 * Всплывающие панели не наслаиваются: открывается одна — остальные закрываются (своими кнопками «×», чтобы
 * сохранялись их состояния и фокус). Помощник, «Подключения», «Данные», меню «⋯».
 * Подсказки статуса (сообщения под кнопками, итоги импорта, ошибки) мягко проявляются при каждом новом тексте.
 * Положение тостов и панели прогресса относительно открытых панелей — в shell.css (правила с :has()).
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  // закрываем напрямую, без имитации кликов: у «Данных» клик вне панели закрывает её саму
  const PANELS = [
    { sel: '#asp', close: el => (window.FD_closeAssistant ? window.FD_closeAssistant() : (el.hidden = true)) },
    { sel: '#cnp', close: el => (window.FD_closeConnections ? window.FD_closeConnections() : (el.hidden = true)) },
    { sel: '#dmp', close: el => { el.hidden = true; const b = $('dmb'); if (b) b.setAttribute('aria-expanded', 'false'); } },
    { sel: '.fd-menu', close: el => { el.hidden = true; const m = $('fdMore'); if (m) m.setAttribute('aria-expanded', 'false'); } },
  ];
  const nodes = () => PANELS.map(p => ({ ...p, el: document.querySelector(p.sel) })).filter(p => p.el);
  let closing = false;
  const mo = new MutationObserver(recs => {
    if (closing) return;
    for (const r of recs) {
      const el = r.target;
      if (el.hidden) continue;                       // закрылась — ничего не делаем
      closing = true;
      for (const p of nodes()) if (p.el !== el && !p.el.hidden) { try { p.close(p.el); } catch (_) { p.el.hidden = true; } }
      closing = false;
    }
  });
  function watch() { for (const p of nodes()) if (!p.el.fdWatched) { p.el.fdWatched = true; mo.observe(p.el, { attributes: true, attributeFilter: ['hidden'] }); } }
  watch();
  // меню «⋯» и панели могут появиться позже (создаются модулями) — подхватываем
  new MutationObserver(watch).observe(document.body, { childList: true });

  /* ---------- подсказки статуса: проявление при смене текста ---------- */
  const STATUS = '.cn-msg, #xm, #xm2, #xm3, .fd-ai-err, #as-st, .fd-toast span, #jobm, #pend';
  const flash = el => {
    if (!el || !el.textContent.trim()) return;
    el.classList.remove('fd-status-in'); void el.offsetWidth; el.classList.add('fd-status-in');
  };
  const seen = new WeakMap();
  new MutationObserver(recs => {
    for (const r of recs) {
      const t = r.target.nodeType === 3 ? r.target.parentElement : r.target;
      const el = t && t.closest && t.closest(STATUS);
      if (!el) continue;
      const txt = el.textContent;
      if (seen.get(el) === txt) continue;
      seen.set(el, txt); flash(el);
    }
  }).observe(document.body, { childList: true, characterData: true, subtree: true });
})();
