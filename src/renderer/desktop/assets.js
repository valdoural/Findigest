/**
 * «Имущество»: кроме квартиры (она связана с ипотекой и расчётами листа) — дом, машина, ещё квартира, участок,
 * гараж, коммерческая недвижимость, другое. У каждого типа свои поля и своя оценка, карточки оформлены по типу.
 * Если имущества больше одного, верхний блок показывает общую сумму и разбивку. Хранение — БД (docs: assets/list).
 */
(function () {
  'use strict';
  const N = window.fdNative; const $ = id => document.getElementById(id);
  const sheet = $('sheet3'); if (!N || !N.store || !sheet || !$('pv')) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rub = v => Math.round(v).toLocaleString('ru-RU') + ' ₽';
  const YEAR = new Date().getFullYear();
  const I = p => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICON = {
    flat: I('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M11 21v-3h2v3"/>'),
    house: I('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>'),
    car: I('<path d="M5 16l1.5-5.2A2 2 0 0 1 8.4 9.3h7.2a2 2 0 0 1 1.9 1.5L19 16"/><rect x="3" y="15" width="18" height="4" rx="1.5"/><circle cx="7.5" cy="19" r="1.5"/><circle cx="16.5" cy="19" r="1.5"/>'),
    land: I('<path d="M3 19h18"/><path d="M5 19l4-8 3 5 2-3 5 6"/><circle cx="17" cy="6" r="2"/>'),
    garage: I('<path d="M3 20V9l9-5 9 5v11"/><path d="M7 20v-7h10v7M7 16h10"/>'),
    commercial: I('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h3"/><path d="M15 21v-4h3"/>'),
    other: I('<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>'),
  };
  // поля: [ключ, подпись, по умолчанию, тип]; calc — оценка по полям; hint — откуда брать цифры
  const TYPES = {
    house: { t: 'Дом', c: '#2F9E6B', f: [['area', 'Площадь дома, м²', 120], ['m2', 'Цена за м² дома, ₽', 90000], ['plot', 'Участок, сотки', 10], ['sotka', 'Цена сотки, ₽', 150000], ['year', 'Год постройки', 2015]],
      calc: v => v.area * v.m2 + v.plot * v.sotka, hint: 'Цены за м² и сотку — по объявлениям в вашем посёлке (Авито, ЦИАН).' },
    car: { t: 'Машина', c: '#D9822B', f: [['model', 'Марка и модель', '', 'text'], ['year', 'Год выпуска', YEAR - 4], ['price', 'Цена покупки, ₽', 2000000], ['bought', 'Год покупки', YEAR - 3], ['km', 'Пробег, км', 60000]],
      calc: v => { const age = Math.max(0, YEAR - (v.bought || YEAR)); const km = Math.max(0, (v.km || 0) - age * 20000); return Math.max(v.price * 0.15, v.price * Math.pow(0.86, age) * (1 - Math.min(0.15, km / 1e6))); },
      hint: 'Оценка — ориентир: −14% в год владения и поправка за пробег выше 20 тыс. км в год. Точнее — по объявлениям (Авто.ру, Авито).' },
    flat: { t: 'Ещё квартира', c: '#3B6FE0', f: [['area', 'Площадь, м²', 45], ['m2', 'Цена за м², ₽', 150000], ['rent', 'Сдаётся за, ₽/мес', 0]],
      calc: v => v.area * v.m2, yieldOf: 'rent', hint: 'Цена за м² — по объявлениям в доме или оценке Домклик.' },
    land: { t: 'Земельный участок', c: '#8A9A2B', f: [['plot', 'Площадь, сотки', 8], ['sotka', 'Цена сотки, ₽', 120000], ['kind', 'Назначение', 'ИЖС', 'text']],
      calc: v => v.plot * v.sotka, hint: 'Цена сотки — по объявлениям рядом (Авито, ЦИАН).' },
    garage: { t: 'Гараж / машино-место', c: '#6B7280', f: [['price', 'Оценка, ₽', 800000], ['area', 'Площадь, м²', 18]],
      calc: v => v.price, hint: '' },
    commercial: { t: 'Коммерческая недвижимость', c: '#7C4DDB', f: [['area', 'Площадь, м²', 60], ['m2', 'Цена за м², ₽', 120000], ['rent', 'Аренда, ₽/мес', 0]],
      calc: v => v.area * v.m2, yieldOf: 'rent', hint: 'Доходность — годовая аренда к оценке, без налогов и расходов на содержание.' },
    other: { t: 'Другое', c: '#0E9AA7', f: [['price', 'Оценка, ₽', 100000]], calc: v => v.price, hint: '' },
  };
  let list = [];
  const save = () => N.store.set('assets', 'list', { items: list }).catch(() => {});
  const valueOf = a => { const T = TYPES[a.type]; if (!T) return 0; if (+a.manual > 0) return +a.manual; const v = {}; for (const [k, , d, ty] of T.f) v[k] = ty === 'text' ? a[k] : +(a[k] ?? d) || 0; return Math.max(0, T.calc(v) || 0); };
  const flatValue = () => +(($('pv').textContent || '').replace(/[^\d]/g, '')) || 0;

  /* блок «Другое имущество» — после строки «Параметры | Оценочная стоимость» */
  const firstRow = sheet.querySelector('.bt');
  const box = document.createElement('div');
  box.className = 'c mb fd-assets'; box.id = 'fd-assets';
  firstRow.after(box);
  // карточка квартиры — тоже в «типовом» оформлении
  const flatCard = $('pa') && $('pa').closest('.c');
  if (flatCard) { flatCard.classList.add('fd-asset'); flatCard.style.setProperty('--as-c', '#3B6FE0'); const h = flatCard.querySelector('h2'); if (h) h.innerHTML = `<span class="fd-as-ic">${ICON.flat}</span>Квартира — параметры`; }

  function card(a, i) {
    const T = TYPES[a.type], val = valueOf(a), auto = !(+a.manual > 0);
    const fields = T.f.map(([k, l, d, ty]) => `<label>${esc(l)}<input data-i="${i}" data-k="${k}" type="${ty === 'text' ? 'text' : 'number'}" value="${esc(a[k] ?? d)}" ${ty === 'text' ? 'spellcheck="false"' : 'step="any" inputmode="decimal"'}></label>`).join('');
    return `<div class="c s6 fd-asset" style="--as-c:${T.c}" data-i="${i}">
      <div class="fd-as-h"><span class="fd-as-ic">${ICON[a.type]}</span><input class="fd-as-name" data-i="${i}" data-k="name" value="${esc(a.name || T.t)}" aria-label="Название" spellcheck="false">
        <button type="button" class="cn-x" data-del="${i}" aria-label="Удалить ${esc(a.name || T.t)}" title="Удалить"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="fm">${fields}<label>Своя оценка, ₽ (если есть)<input data-i="${i}" data-k="manual" type="number" step="any" value="${esc(a.manual || '')}" placeholder="—"></label><label>Долг по нему, ₽<input data-i="${i}" data-k="debt" type="number" step="any" value="${esc(a.debt || '')}" placeholder="0"></label></div>
      <p class="fd-as-v"><span>${auto ? 'Оценка по полям' : 'Ваша оценка'}</span><b class="amt" data-v="${i}">${rub(val)}</b></p>
      <p class="nt" data-n="${i}">${note(a)}</p></div>`;
  }
  function note(a) {
    const T = TYPES[a.type], val = valueOf(a);
    const y = T.yieldOf && +a[T.yieldOf] > 0 && val ? ` Доходность ${(a[T.yieldOf] * 12 / val * 100).toFixed(1).replace('.', ',')}% годовых.` : '';
    const net = +a.debt > 0 ? ` За вычетом долга — ${rub(val - a.debt)}.` : '';
    return esc(T.hint) + y + net;
  }
  function render() {
    box.innerHTML = `<div class="fd-as-top"><h2>Другое имущество</h2><p class="nt">Дом, машина, участок и другое — с оценкой по типу. Общая сумма — в блоке «Оценочная стоимость» вверху.</p></div>
      <div class="fd-as-add" role="group" aria-label="Добавить имущество">${Object.entries(TYPES).map(([k, T]) => `<button type="button" class="fd-as-chip" data-add="${k}" style="--as-c:${T.c}">${ICON[k]}<span>${T.t}</span></button>`).join('')}</div>
      ${list.length ? `<div class="bt fd-as-grid">${list.map(card).join('')}</div>` : ''}`;
    total();
  }
  // верхний итог: при нескольких объектах — общая сумма и разбивка
  let painting = false;
  function total() {
    const hero = $('pv').closest('.hero'); if (!hero) return;
    let t = $('fd-ptot'), b = $('fd-pbrk');
    const lab = hero.querySelector('.l');
    if (!list.length) { if (t) t.remove(); if (b) b.remove(); $('pv').hidden = false; if (lab) lab.textContent = 'Оценочная стоимость'; return; }
    painting = true;
    if (!t) { t = document.createElement('div'); t.id = 'fd-ptot'; t.className = 'big amt'; $('pv').after(t); }
    if (!b) { b = document.createElement('div'); b.id = 'fd-pbrk'; b.className = 'fd-pbrk'; t.after(b); }
    const fv = flatValue(), rows = [['Квартира', fv, '#3B6FE0'], ...list.map(a => [a.name || TYPES[a.type].t, valueOf(a), TYPES[a.type].c])];
    const sum = rows.reduce((s, r) => s + r[1], 0), debt = list.reduce((s, a) => s + (+a.debt || 0), 0);
    $('pv').hidden = true; if (lab) lab.textContent = `Всё имущество — ${rows.length} ${rows.length < 5 ? 'объекта' : 'объектов'}`;
    t.textContent = rub(sum);
    b.innerHTML = rows.map(r => `<span><i style="--c:${r[2]}"></i>${esc(r[0])} <b class="amt">${rub(r[1])}</b></span>`).join('') + (debt ? `<span class="nt">Долги по ним (кроме ипотеки): <b class="amt">${rub(debt)}</b></span>` : '');
    painting = false;
  }
  new MutationObserver(() => { if (!painting) total(); }).observe($('pv'), { childList: true, characterData: true, subtree: true });

  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.add) {
      const T = TYPES[b.dataset.add], a = { type: b.dataset.add, name: T.t };
      for (const [k, , d] of T.f) a[k] = d;
      list.push(a); save(); render();
      const c = box.querySelector(`.fd-asset[data-i="${list.length - 1}"]`); if (c) { c.classList.add('fd-new'); c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); const f = c.querySelector('.fm input'); if (f) f.focus({ preventScroll: true }); }
    }
    if (b.dataset.del) {
      const i = +b.dataset.del, c = b.closest('.fd-asset');
      const go = () => { list.splice(i, 1); save(); render(); };
      if (!c || matchMedia('(prefers-reduced-motion: reduce)').matches) return go();
      c.classList.add('fd-gone'); setTimeout(go, 260);
    }
  });
  box.addEventListener('input', e => {
    const t = e.target, i = t.dataset.i, k = t.dataset.k; if (i == null || !k) return;
    const a = list[+i]; const T = TYPES[a.type]; const f = T.f.find(x => x[0] === k);
    a[k] = t.type === 'number' ? (t.value === '' ? '' : +t.value) : t.value;
    if (f && f[3] === 'text' || k === 'name') { save(); return total(); }
    const v = box.querySelector(`[data-v="${i}"]`); if (v) v.textContent = rub(valueOf(a));
    const lbl = v && v.previousElementSibling; if (lbl) lbl.textContent = +a.manual > 0 ? 'Ваша оценка' : 'Оценка по полям';
    const n = box.querySelector(`[data-n="${i}"]`); if (n) n.innerHTML = note(a);
    clearTimeout(box.t); box.t = setTimeout(save, 400); total();
  });

  N.store.get('assets', 'list').then(r => { list = (r && r.exists && r.data && Array.isArray(r.data.items) ? r.data.items : []).filter(a => TYPES[a.type]); render(); }).catch(() => render());
})();
