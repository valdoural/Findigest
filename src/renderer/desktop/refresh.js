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
  N.digest.onUpdated(async info => {
    if (manual) return;
    const n = (info.changed || 0) + (info.deleted || 0), r = info.mailReceipts || 0;
    const st = await N.digest.status().catch(() => ({}));
    const auto = r && st.mail && st.mail.autoParse;
    // окно свёрнуто в трей: обновляем отчёт и разбираем чеки сразу, никого не отвлекая
    if (document.hidden && (n || r)) { if (auto) sessionStorage.setItem('fd_autoparse', '1'); location.reload(); return; }
    const bits = [n ? `Zenmoney: изменений ${n}` : '', r ? `из почты загружено чеков: ${r}` : ''].filter(Boolean);
    if (!bits.length) return say('Данные проверены — нового нет.');
    say('Обновлено. ' + bits.join('; ') + '.', { sticky: true, action: { label: auto ? 'Показать и разобрать' : 'Показать', run: () => { if (auto) sessionStorage.setItem('fd_autoparse', '1'); location.reload(); } } });
  });

  /* после перезагрузки: сообщения и автоматический разбор новых чеков из почты */
  (async () => {
    const t = sessionStorage.getItem('fd_toast');
    if (t) { sessionStorage.removeItem('fd_toast'); say(t, { err: true, sticky: true }); }
    const st = await N.digest.status().catch(() => null);
    if (!st || !st.mail) return;
    const flag = sessionStorage.getItem('fd_autoparse');
    sessionStorage.removeItem('fd_autoparse');
    if (!st.mail.pending) return;
    if (!flag) {
      return say(`В архиве неразобранных чеков из почты: ${st.mail.pending}.`, { sticky: true, action: { label: 'Разобрать', run: () => { toast.hidden = true; startParse(); } } });
    }
    startParse();
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
