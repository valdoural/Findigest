/**
 * Логотипы вместо букв: значки счетов (.bd в списках счетов) и магазинов (.bd в списке магазинов, чеках).
 * Название берётся из строки рядом со значком; сайт банка — из данных отчёта (AC[i][4]), магазина — сопоставляет основной процесс.
 * Не нашлось логотипа — остаётся цветная буква. Буква сохраняется для экранного диктора (aria-label строки не меняется).
 */
(function () {
  'use strict';
  const N = window.fdNative;
  if (!N || !N.logos) return;
  const cache = new Map();   // название → data URL | null (null — уже спрашивали, логотипа нет)
  const sites = new Map();   // название счёта → сайт банка
  let pending = false;

  const nameOf = bd => {
    // текст строки после значка: «Карта, Яндекс 177 820 ₽» → берём ближайший текстовый узел/элемент
    let n = bd.nextSibling;
    while (n && !(n.textContent || '').trim()) n = n.nextSibling;
    return n ? (n.textContent || '').trim().split('\n')[0].trim() : '';
  };

  function paint(bd, url) {
    if (bd.dataset.fdLogo === '1') return;
    bd.dataset.fdLogo = '1';
    bd.dataset.letter = bd.textContent;
    bd.textContent = '';
    bd.classList.add('fd-logo');
    bd.style.background = `#fff url("${url}") center / cover no-repeat`;
  }

  async function scan() {
    pending = false;
    const want = new Map();
    for (const bd of document.querySelectorAll('main .bd:not([data-fd-logo="1"])')) {
      const name = nameOf(bd);
      if (!name) continue;
      if (cache.has(name)) { const u = cache.get(name); if (u) paint(bd, u); continue; }
      want.set(name, { name, site: sites.get(name) || '' });
    }
    if (!want.size) return;
    let got = {};
    try { got = await N.logos.get([...want.values()]); } catch (_) { return; }
    for (const name of want.keys()) cache.set(name, got[name] || null);
    for (const bd of document.querySelectorAll('main .bd:not([data-fd-logo="1"])')) { const u = cache.get(nameOf(bd)); if (u) paint(bd, u); }
  }
  const schedule = () => { if (!pending) { pending = true; setTimeout(scan, 120); } };

  Promise.resolve(window.FD_READY).then(d => {
    for (const a of (d && d.AC) || []) if (a[4]) sites.set(a[0], a[4]);
    const main = document.querySelector('main');
    if (main) new MutationObserver(schedule).observe(main, { childList: true, subtree: true });
    schedule();
  }).catch(() => {});
})();
