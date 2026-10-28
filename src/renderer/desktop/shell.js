/**
 * Адаптивная шапка и плашка «условные данные».
 * Режим подбирается по фактической ширине (ResizeObserver), а не по фиксированным точкам: подписи вкладок
 * разной длины, шрифты и масштаб Windows влияют на ширину, а результат должен быть без пересечений всегда.
 * Порядок сжатия: полные подписи → без слова «Дайджест» → короткие подписи → иконки с подписью активной
 * → только иконки → редкие действия в меню «⋯».
 */
(function () {
  'use strict';
  const bar = document.querySelector('.top .in');
  const nav = bar && bar.querySelector('.tabs');
  if (!bar || !nav) return;

  /* 1. Действия справа — в отдельную группу (третья колонка сетки) */
  const acts = document.createElement('div');
  acts.className = 'fd-actions';
  const ids = ['rfb', 'cnb', 'dmb', 'hb', 'tb'];
  const rare = new Set(['dmb', 'hb', 'tb']);
  for (const id of ids) {
    const b = document.getElementById(id);
    if (!b) continue;
    if (rare.has(id)) b.classList.add('fd-rare');
    acts.appendChild(b);
  }
  // голосовой помощник и будущие кнопки тоже попадут сюда: всё .ib, что осталось в шапке
  bar.querySelectorAll(':scope > .ib').forEach(b => acts.insertBefore(b, acts.firstChild));
  const more = document.createElement('button');
  more.className = 'ib'; more.id = 'fdMore'; more.type = 'button';
  more.setAttribute('aria-label', 'Ещё действия'); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
  more.dataset.tip = 'Ещё: данные, скрыть суммы, тема';
  more.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
  acts.appendChild(more);
  bar.appendChild(acts);

  /* 2. Подписи для чтения с экрана; всплывающая подсказка — только когда вкладка свёрнута до значка (см. tabTips) */
  nav.querySelectorAll('button').forEach(b => {
    const t = (b.querySelector('.tl') || {}).textContent || '';
    if (t) { b.dataset.label = t; if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', t); }
  });
  const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
  const tabTips = () => nav.querySelectorAll('button').forEach(b => {
    const iconOnly = !shown(b.querySelector('.tl')) && !shown(b.querySelector('.ts'));
    if (iconOnly && b.dataset.label) b.dataset.tip = b.dataset.label; else delete b.dataset.tip;
  });

  /* 3. Меню «⋯» */
  const menu = document.createElement('div');
  menu.className = 'fd-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);
  const LABEL = { dmb: 'Данные: экспорт и импорт', hb: 'Скрыть суммы (клавиша H)', tb: 'Тема: авто / светлая / тёмная' };
  function openMenu(on) {
    menu.hidden = !on; more.setAttribute('aria-expanded', String(on));
    if (!on) return;
    menu.innerHTML = '';
    for (const id of ['dmb', 'hb', 'tb']) {
      const src = document.getElementById(id); if (!src) continue;
      const it = document.createElement('button'); it.type = 'button'; it.setAttribute('role', 'menuitem');
      it.innerHTML = (src.querySelector('svg') || {}).outerHTML || '';
      it.appendChild(document.createTextNode(LABEL[id]));
      it.onclick = () => { openMenu(false); src.click(); };
      menu.appendChild(it);
    }
    if (window.FD_openAbout) {   // «О программе»: создатель, версия, обновления с GitHub (desktop/about.js)
      const it = document.createElement('button'); it.type = 'button'; it.setAttribute('role', 'menuitem');
      it.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>';
      it.appendChild(document.createTextNode('О программе и обновления'));
      it.onclick = () => { openMenu(false); window.FD_openAbout(); };
      menu.appendChild(it);
    }
    const r = more.getBoundingClientRect();
    menu.style.top = (r.bottom + 8) + 'px';
    menu.style.right = Math.max(8, innerWidth - r.right) + 'px';
    const f = menu.querySelector('button'); if (f) f.focus();
  }
  more.addEventListener('click', e => { e.stopPropagation(); openMenu(menu.hidden); });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) openMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { openMenu(false); more.focus(); } });

  /* 4. Подбор режима по ширине */
  const MODES = [
    { tabs: 'full', logo: 'full', act: 'all' },
    { tabs: 'full', logo: 'mark', act: 'all' },
    { tabs: 'short', logo: 'full', act: 'all' },
    { tabs: 'short', logo: 'mark', act: 'all' },
    { tabs: 'iconsel', logo: 'mark', act: 'all' },
    { tabs: 'icon', logo: 'mark', act: 'all' },
    { tabs: 'icon', logo: 'mark', act: 'menu' },
  ];
  const bottomBar = matchMedia('(max-width:780px)');
  const logoEl = bar.querySelector('.logo');
  const logoOk = () => !logoEl || logoEl.scrollWidth <= logoEl.clientWidth + 0.5;
  const fits = () => {
    if (!logoOk()) return false;
    if (bottomBar.matches) return bar.scrollWidth <= bar.clientWidth + 0.5 && [...bar.querySelector('.fd-actions').children].every(b => b.getBoundingClientRect().right <= bar.getBoundingClientRect().right + 0.5);
    // вкладки помещаются целиком и сама шапка не переполнена
    const need = [...nav.children].reduce((a, b) => a + b.getBoundingClientRect().width, 0) + 4 * (nav.children.length - 1);
    return need <= nav.clientWidth + 0.5 && bar.scrollWidth <= bar.clientWidth + 0.5;
  };
  let busy = false, last = '';
  function layout() {
    if (busy) return; busy = true;
    const list = bottomBar.matches ? [{ tabs: 'bottom', logo: 'full', act: 'all' }, { tabs: 'bottom', logo: 'mark', act: 'all' }, { tabs: 'bottom', logo: 'mark', act: 'menu' }] : MODES;
    for (const m of list) {
      bar.dataset.tabs = m.tabs; bar.dataset.logo = m.logo; bar.dataset.act = m.act;
      if (fits()) break;
    }
    const key = bar.dataset.tabs + bar.dataset.logo + bar.dataset.act;
    if (key !== last) { last = key; if (bar.dataset.act !== 'menu') openMenu(false); }
    tabTips();
    busy = false;
  }
  let raf = 0;
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(layout); };
  new ResizeObserver(schedule).observe(bar);
  window.FD_relayout = schedule; // модули, добавляющие кнопки в шапку, просят пересчитать режим
  bottomBar.addEventListener('change', schedule);
  // смена вкладки меняет ширину активной кнопки (в режиме iconsel), шрифты подгружаются позже
  nav.addEventListener('click', () => setTimeout(schedule, 0));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  layout();

  /* 5. Плашка «условные данные» (пока не подключён ни один источник) */
  const main = document.querySelector('main');
  if (main) {
    const d = document.createElement('div');
    d.className = 'fd-demo-bar'; d.setAttribute('role', 'status');
    d.innerHTML = '<span><b>Показаны условные данные.</b> Ваши цифры появятся после подключения Zenmoney, почты с чеками и ИИ — ни одна личная цифра в программу не встроена.</span><button class="bn" type="button" data-open-conn="zen">Подключить</button>';
    main.insertBefore(d, main.firstChild);
  }
})();
