/**
 * Кнопка «Обновить» в шапке и уведомления об обновлении данных Zenmoney.
 * Ручное обновление перезагружает отчёт сразу; обновление по расписанию показывает уведомление
 * с кнопкой «Показать» — чтобы не сбросить то, что вы сейчас вводите.
 */
(function () {
  'use strict';
  const N = window.fdNative;
  const btn = document.getElementById('rfb');
  if (!N || !btn) return;

  const css = document.createElement('style');
  css.textContent = `
  #rfb.run svg{animation:fdspin 1s linear infinite}@keyframes fdspin{to{transform:rotate(360deg)}}
  #rfb.err{color:var(--neg)}
  .fd-toast{position:fixed;z-index:70;right:max(16px,calc((100vw - 1020px)/2 + 16px));bottom:calc(env(safe-area-inset-bottom,0px) + 18px);
    display:flex;align-items:center;gap:12px;max-width:min(460px,calc(100vw - 32px));padding:12px 14px;border-radius:16px;border:1px solid var(--gb);
    background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 12px 40px rgba(0,0,0,.22);
    font-size:.86rem;transition:opacity .2s var(--fd-ease-out),transform .2s var(--fd-ease-out)}
  @starting-style{.fd-toast{opacity:0;transform:translateY(8px)}}
  .fd-toast[hidden]{display:none}.fd-toast span{flex:1}.fd-toast .bn{min-height:44px;padding:0 12px;font-size:.8rem}
  @media (max-width:780px){.fd-toast{left:16px;right:16px;max-width:none;bottom:calc(env(safe-area-inset-bottom,0px) + 96px)}}
  .fd-toast.err{border-color:color-mix(in srgb,var(--neg) 45%,transparent)}
  @media (prefers-reduced-motion:reduce){#rfb.run svg{animation:none}@starting-style{.fd-toast{transform:none}}}`;
  document.head.appendChild(css);

  const toast = document.createElement('div');
  toast.className = 'fd-toast'; toast.hidden = true; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
  document.body.appendChild(toast);
  let tt = null;
  function say(text, { action, err, sticky } = {}) {
    clearTimeout(tt);
    toast.className = 'fd-toast' + (err ? ' err' : '');
    toast.innerHTML = '';
    const s = document.createElement('span'); s.textContent = text; toast.appendChild(s);
    if (action) { const b = document.createElement('button'); b.className = 'bn'; b.type = 'button'; b.textContent = action.label; b.onclick = action.run; toast.appendChild(b); }
    const x = document.createElement('button'); x.className = 'nb'; x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Скрыть'); x.onclick = () => { toast.hidden = true; }; toast.appendChild(x);
    toast.hidden = false;
    if (!sticky) tt = setTimeout(() => { toast.hidden = true; }, 7000);
  }
  window.FD_toast = say;   // для других модулей (например, «Доступна новая версия»)

  const fmt = iso => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ''); };
  let manual = false;
  function paint(st) {
    btn.classList.toggle('run', !!st.running);
    btn.classList.toggle('err', !!st.lastError && !st.running);
    const parts = ['Обновить: Zenmoney и чеки из почты'];
    if (!st.anySource) parts.push('ничего не подключено — откройте «Подключения»');
    else {
      if (st.connected) parts.push('Zenmoney: ' + (st.lastSyncText || 'ещё не было'));
      if (st.mail && st.mail.connected) parts.push('почта: ' + (st.mail.lastCheckText || 'ещё не проверялась') + (st.mail.pending ? `, неразобранных чеков ${st.mail.pending}` : ''));
      if (st.schedule && st.schedule.next) parts.push('следующее: ' + fmt(st.schedule.next));
      if (st.lastError) parts.push('ошибка: ' + st.lastError.message);
    }
    const tip = parts.join(' · ');
    btn.dataset.tip = tip; btn.setAttribute('aria-label', tip);
    btn.setAttribute('aria-busy', String(!!st.running));
  }
  const refreshStatus = () => N.digest.status().then(paint).catch(() => {});

  btn.addEventListener('click', async () => {
    const st = await N.digest.status().catch(() => null);
    if (st && !st.anySource) { if (window.FD_openConnections) window.FD_openConnections('zen'); return; }
    manual = true;
    say('Проверяю ' + ([st && st.connected && 'Zenmoney', st && st.mail && st.mail.connected && 'почту'].filter(Boolean).join(' и ') || 'данные') + '…', { sticky: true });
    try {
      const after = await N.digest.refresh();
      const lr = after.lastRun || {}, zc = (lr.changed || 0) + (lr.deleted || 0);
      const errs0 = lr.errors || [];
      // нажали «Обновить» — отчёт перезагружается всегда: свежие даты обновления на всех листах (Zenmoney, почта, ЖКХ);
      // новые чеки из почты разберутся сразу после перезагрузки; итог — в подсказке
      const ids0 = (lr.mail && lr.mail.ids) || [];
      sessionStorage.setItem('fd_toast_ok', (zc ? `Zenmoney: изменений ${zc}. ` : 'Zenmoney: без изменений. ') + (lr.mail ? (ids0.length ? `Почта: новых чеков ${ids0.length}.` : 'Почта: новых чеков нет.') : ''));
      if (after.mail && after.mail.pending && after.mail.autoParse) sessionStorage.setItem('fd_autoparse', '1');
      const errs = (after.lastRun && after.lastRun.errors) || [];
      if (errs.length) sessionStorage.setItem('fd_toast', 'Не всё обновилось: ' + errs.map(e => (e.source === 'mail' ? 'почта' : 'Zenmoney') + ' — ' + e.message).join('; '));
      location.reload(); // вкладка сохраняется: она записана в адресе страницы (#sheetN)
    } catch (e) {
      manual = false;
      say('Не удалось обновить: ' + (e.message || e), { err: true, sticky: true, action: e.code === 'auth' ? { label: 'Подключения', run: () => window.FD_openConnections && window.FD_openConnections('zen') } : null });
      refreshStatus();
    }
  });

  N.digest.onState(st => { N.digest.status().then(paint).catch(() => paint(st)); });
  /* ---------- новые чеки из почты: загрузка → разбор → база → подсказка, без перезагрузки и без кнопок ---------- */
  const rub = v => Math.round(v).toLocaleString('ru-RU') + ' ₽';
  const dm = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d.slice(8, 10) + '.' + d.slice(5, 7) : '');
  function showReceipts(ids) {
    const t = document.querySelector('.tabs [data-s="sheet6"]'); if (t) t.click();
    setTimeout(() => {
      const box = document.getElementById('rcaBody'); if (box && box.hidden) { const b = document.getElementById('rcaT'); if (b) b.click(); }
      const first = ids && ids[0] && document.querySelector(`#rca [data-sel="${ids[0]}"]`);
      const row = first ? first.closest('details') : document.getElementById('rca');
      if (row) { if (row.tagName === 'DETAILS') row.open = true; row.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }, 250);
  }
  /** Разобрать загруженные из почты чеки (ids — только эти) и сообщить, что добавлено. Возвращает список.
   *  Вызовы идут по очереди: «Сохранить и проверить» и событие обновления не делят чеки между собой. */
  let chain = Promise.resolve();
  const results = new Map();
  function ingestMail(ids, opts) {
    const run = chain.then(() => ingestNow(ids, opts || {}));
    chain = run.catch(() => {});
    return run.then(list => (ids && ids.length ? ids.map(id => results.get(id)).filter(Boolean) : list));
  }
  async function ingestNow(ids, { quietIfNone } = {}) {
    // отчёт строится асинхронно: при запуске ждём, пока он опубликует FD_PAGE (до 30 с)
    for (let i = 0; i < 120 && !(window.FD_PAGE && window.FD_PAGE.ingestMail); i++) await new Promise(r => setTimeout(r, 250));
    const P = window.FD_PAGE; if (!P || !P.ingestMail) return [];
    const st = await N.digest.status().catch(() => ({}));
    const auto = !!(st.mail && st.mail.autoParse);
    const list = await P.ingestMail(ids, { noParse: !auto });
    for (const x of list) results.set(x.id, x);
    // фоновый разбор: итог — в подсказке, панель хода разбора не нужна (иначе они перекрываются внизу экрана)
    if (list.length) { const j = document.getElementById('job'); if (j && j.classList.contains('done')) j.hidden = true; }
    if (!list.length) { if (!quietIfNone) say('Новых чеков в почте нет.'); return list; }
    const ok = list.filter(x => x.status === 'parsed'), bad = list.filter(x => x.status === 'error'), wait = list.filter(x => x.status !== 'parsed' && x.status !== 'error');
    const sum = ok.reduce((a, x) => a + (+x.total || 0), 0);
    let text;
    if (ok.length === 1) { const x = ok[0]; text = `Новый чек из почты: ${x.store || 'магазин'}${dm(x.date) ? ' · ' + dm(x.date) : ''}${x.total ? ' · ' + rub(x.total) : ''} — ${x.items} поз. добавлено в «Продукты»`; }
    else if (ok.length) text = `Из почты добавлено чеков: ${ok.length} (${[...new Set(ok.map(x => x.store).filter(Boolean))].slice(0, 3).join(', ') || 'магазины'})${sum ? ' на ' + rub(sum) : ''} — в «Продукты»`;
    if (bad.length) text = (text ? text + '. ' : '') + `Не разобрано: ${bad.length} — ${bad[0].err || 'проверьте в архиве'}`;
    if (wait.length) text = (text ? text + '. ' : '') + `В архиве ждут разбора: ${wait.length}`;
    say(text + '.', { sticky: true, err: !!bad.length && !ok.length, action: { label: wait.length && !auto ? 'Разобрать' : 'Показать', run: async () => { toast.hidden = true; if (wait.length && !auto) { await window.FD_PAGE.ingestMail(wait.map(x => x.id)); } showReceipts(list.map(x => x.id)); } } });
    return list;
  }
  window.FD_mailIngest = ingestMail;   // «Сохранить и проверить» в «Подключениях → Почта»

  N.digest.onUpdated(async info => {
    if (manual) return;
    const n = (info.changed || 0) + (info.deleted || 0), r = info.mailReceipts || 0;
    const st = await N.digest.status().catch(() => ({}));
    const auto = r && st.mail && st.mail.autoParse;
    // изменились данные Zenmoney — отчёт пересчитан, нужна перезагрузка (чеки разберутся после неё)
    if (n) {
      if (document.hidden) { if (auto) sessionStorage.setItem('fd_autoparse', '1'); location.reload(); return; }
      const bits = [`Zenmoney: изменений ${n}`, r ? `из почты загружено чеков: ${r}` : ''].filter(Boolean);
      return say('Обновлено. ' + bits.join('; ') + '.', { sticky: true, action: { label: 'Показать', run: () => { if (r) sessionStorage.setItem('fd_autoparse', '1'); location.reload(); } } });
    }
    // только почта — разбираем на месте, отчёт не перезагружается
    if (r) return ingestMail(info.mailIds, { quietIfNone: true });
    if (info.reason !== 'mail-poll' && !(info.errors || []).length) say('Данные проверены — нового нет.');
  });

  /* после перезагрузки и при запуске: сообщения и разбор чеков, которые ждут в архиве */
  (async () => {
    const t = sessionStorage.getItem('fd_toast');
    if (t) { sessionStorage.removeItem('fd_toast'); say(t, { err: true, sticky: true }); }
    const t2 = sessionStorage.getItem('fd_toast_ok');
    if (t2 && !t) { sessionStorage.removeItem('fd_toast_ok'); say('Обновлено. ' + t2); }
    const st = await N.digest.status().catch(() => null);
    sessionStorage.removeItem('fd_autoparse');
    // один раз: перепроверить разобранные чеки, где сумма позиций не сходится с итогом (старые ошибки разбора)
    try {
      let done = false; try { done = localStorage.getItem('fd_kopfix2') === '1'; } catch (_) { /* нет хранилища */ }
      if (!done) {
        for (let i = 0; i < 120 && !(window.FD_PAGE && window.FD_PAGE.recheckParsed); i++) await new Promise(r => setTimeout(r, 250));
        const n = window.FD_PAGE && window.FD_PAGE.recheckParsed ? await window.FD_PAGE.recheckParsed() : 0;
        try { localStorage.setItem('fd_kopfix2', '1'); } catch (_) { /* нет хранилища */ }
        if (n) say(`Чеки разобраны заново: ${n} — сумма позиций не сходилась с итогом (копейки читались как тысячи или строки пропускались).`, { sticky: true, action: { label: 'Показать', run: () => { toast.hidden = true; showReceipts([]); } } });
      }
    } catch (_) { /* проверка необязательна */ }
    if (!st || !st.mail || !st.mail.pending) return;
    if (st.mail.autoParse) return ingestMail(null, { quietIfNone: true });
    return say(`В архиве неразобранных чеков из почты: ${st.mail.pending}.`, { sticky: true, action: { label: 'Разобрать', run: () => { toast.hidden = true; startParse(); } } });
  })();
  async function startParse() {
    // кнопка «Разобрать» на листе «Продукты» доступна, когда отчёт загрузил архив и проверил доступ к ИИ
    for (let i = 0; i < 60; i++) {
      // отчёт обновляет доступность кнопок по событию ввода в поле текста чека
      const tx = document.getElementById('txt'); if (tx) tx.dispatchEvent(new Event('input'));
      const sp = document.getElementById('sp');
      if (sp && !sp.disabled) { say('Разбираю чеки из почты — ход разбора внизу экрана.'); sp.click(); return; }
      await new Promise(r => setTimeout(r, 250));
    }
    say('Чеки из почты лежат в архиве («Продукты → Архив чеков»). Чтобы разобрать фото и PDF-сканы, подключите ИИ в «Подключениях».', { sticky: true });
  }
  refreshStatus();
  setInterval(refreshStatus, 60e3);
})();
