/**
 * Календарь для полей даты и месяца (input type="date" / "month") в стиле программы: скруглённое окно, тема, анимация.
 * Системный календарь Chromium не оформляется, поэтому его значок скрыт, а по клику на значок (или Alt+↓)
 * открывается этот. Ввод с клавиатуры в само поле работает как раньше. Выбор → value + события input/change.
 */
(function () {
  'use strict';
  const MON = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const MON_S = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ym = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const parse = (v, kind) => { const m = kind === 'month' ? /^(\d{4})-(\d{2})$/.exec(v || '') : /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? new Date(+m[1], +m[2] - 1, kind === 'month' ? 1 : +m[3]) : null; };
  const ARROW = d => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

  const pop = document.createElement('div');
  pop.className = 'fd-cal'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Выбор даты');
  document.body.appendChild(pop);
  let inp = null, kind = 'date', view = new Date(), focus = new Date();

  const isPick = el => el && el.tagName === 'INPUT' && (el.type === 'date' || el.type === 'month');
  const outOfRange = (d, k) => { const v = k === 'month' ? ym(d) : ymd(d); return (inp.min && v < inp.min) || (inp.max && v > inp.max); };

  function render() {
    const cur = parse(inp.value, kind), today = new Date();
    let head, grid;
    if (kind === 'month') {
      head = String(view.getFullYear());
      grid = `<div class="fd-cal-grid m">${MON_S.map((m, i) => { const d = new Date(view.getFullYear(), i, 1); const sel = cur && ym(cur) === ym(d), now = ym(today) === ym(d), foc = ym(focus) === ym(d);
        return `<button type="button" data-v="${ym(d)}" class="${sel ? 'sel' : ''}${now ? ' now' : ''}" ${outOfRange(d, 'month') ? 'disabled' : ''} tabindex="${foc ? 0 : -1}" aria-pressed="${!!sel}" aria-label="${MON[i]} ${view.getFullYear()}">${m}</button>`; }).join('')}</div>`;
    } else {
      head = `${MON[view.getMonth()]} ${view.getFullYear()}`;
      const first = new Date(view.getFullYear(), view.getMonth(), 1), shift = (first.getDay() + 6) % 7;
      const start = new Date(first); start.setDate(1 - shift);
      const cells = [];
      for (let i = 0; i < 42; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const sel = cur && ymd(cur) === ymd(d), now = ymd(today) === ymd(d), out = d.getMonth() !== view.getMonth(), foc = ymd(focus) === ymd(d);
        cells.push(`<button type="button" data-v="${ymd(d)}" class="${sel ? 'sel' : ''}${now ? ' now' : ''}${out ? ' out' : ''}" ${outOfRange(d, 'date') ? 'disabled' : ''} tabindex="${foc ? 0 : -1}" aria-pressed="${!!sel}" aria-label="${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}">${d.getDate()}</button>`);
      }
      grid = `<div class="fd-cal-wd" aria-hidden="true">${WD.map(w => `<span>${w}</span>`).join('')}</div><div class="fd-cal-grid d">${cells.join('')}</div>`;
    }
    pop.innerHTML = `<div class="fd-cal-head"><button type="button" class="fd-cal-nav" data-nav="-1" aria-label="Назад">${ARROW('M15 6l-6 6 6 6')}</button><b>${head}</b><button type="button" class="fd-cal-nav" data-nav="1" aria-label="Вперёд">${ARROW('M9 6l6 6-6 6')}</button></div>${grid}
      <div class="fd-cal-foot"><button type="button" class="bn gh" data-act="today">${kind === 'month' ? 'Этот месяц' : 'Сегодня'}</button><button type="button" class="bn gh" data-act="clear">Очистить</button></div>`;
  }
  function place() {
    const r = inp.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    let top = r.bottom + 6; if (top + h > innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    pop.style.top = Math.max(8, top) + 'px';
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + 'px';
    pop.style.transformOrigin = top < r.top ? 'bottom left' : 'top left';
  }
  function open(el) {
    inp = el; kind = el.type;
    view = parse(el.value, kind) || new Date(); focus = new Date(view);
    if (kind === 'month') view = new Date(view.getFullYear(), 0, 1);
    render(); pop.hidden = false; place();
    const f = pop.querySelector('.fd-cal-grid [tabindex="0"]'); if (f) f.focus();
  }
  function close(back) { if (pop.hidden) return; pop.hidden = true; if (back && inp) inp.focus(); }
  function set(v) {
    inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
    close(true);
  }

  pop.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.nav) {
      const k = +b.dataset.nav;
      if (kind === 'month') view = new Date(view.getFullYear() + k, 0, 1); else view = new Date(view.getFullYear(), view.getMonth() + k, 1);
      focus = kind === 'month' ? new Date(view.getFullYear(), focus.getMonth(), 1) : new Date(view);
      render(); place(); return;
    }
    if (b.dataset.act === 'today') return set(kind === 'month' ? ym(new Date()) : ymd(new Date()));
    if (b.dataset.act === 'clear') return set('');
    if (b.dataset.v) set(b.dataset.v);
  });
  pop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    const step = kind === 'month' ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 } : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in step) || !e.target.closest('.fd-cal-grid')) return;
    e.preventDefault();
    if (kind === 'month') focus = new Date(focus.getFullYear(), focus.getMonth() + step[e.key], 1); else { focus = new Date(focus); focus.setDate(focus.getDate() + step[e.key]); }
    view = kind === 'month' ? new Date(focus.getFullYear(), 0, 1) : new Date(focus.getFullYear(), focus.getMonth(), 1);
    render(); place();
    const f = pop.querySelector('.fd-cal-grid [tabindex="0"]'); if (f) f.focus();
  });

  // открытие: клик по значку календаря в правой части поля или Alt+↓; системный календарь не показываем
  document.addEventListener('click', e => {
    const el = e.target;
    if (isPick(el)) {
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.right - 40) { e.preventDefault(); if (!pop.hidden && inp === el) close(); else open(el); }
      return;
    }
    if (!pop.hidden && !pop.contains(el)) close();
  }, true);
  document.addEventListener('keydown', e => {
    if (isPick(e.target) && ((e.altKey && e.key === 'ArrowDown') || e.key === 'F4')) { e.preventDefault(); open(e.target); }
  }, true);
  window.addEventListener('resize', () => { if (!pop.hidden) place(); });
  document.addEventListener('scroll', () => { if (!pop.hidden) place(); }, true);
  window.addEventListener('blur', () => close());
})();
