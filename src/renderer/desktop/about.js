/**
 * «О программе» — вкладка в «Подключениях» и пункт меню «⋯»: создатель, версия, обновление из GitHub Releases.
 * Основной процесс — main/updates.js; выпуск версий — scripts/release.js (npm run release).
 * При запуске, если на GitHub есть версия новее, появляется подсказка «Доступна версия X» с кнопкой «Обновить».
 */
(function () {
  'use strict';
  const N = window.fdNative;
  const panel = document.getElementById('cnp');
  if (!N || !N.updates || !panel) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const AUTHOR = 'Vlad Nikolaev';
  const fmtDate = d => { try { return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) { return ''; } };
  const mb = b => b ? (b / 1048576).toFixed(1).replace('.', ',') + ' МБ' : '';
  const GH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.1-1.47-1.1-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>';

  /* ---------- вкладка в «Подключениях» ---------- */
  const tabs = panel.querySelector('.cn-tabs');
  const tb = document.createElement('button');
  tb.setAttribute('role', 'tab'); tb.dataset.t = 'about'; tb.type = 'button'; tb.innerHTML = '<i id="ct-about"></i>О программе';
  tabs.appendChild(tb);
  const sec = document.createElement('section');
  sec.className = 'cn-sec'; sec.dataset.sec = 'about'; sec.setAttribute('role', 'tabpanel');
  panel.querySelector('[data-sec="sys"]').after(sec);

  let st = null, prog = null, info = { version: '' };
  const msg = (text, kind) => { const el = $('ab-msg'); if (el) { el.textContent = text || ''; el.className = 'cn-msg' + (kind ? ' ' + kind : ''); } };
  const open = url => url && N.app.openUrl(url);

  function render() {
    const s = st || {};
    const L = s.latest;
    const head = `<div class="cn-card ab-hero">
        <div class="ab-mark" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg></div>
        <div><b class="ab-title">Финансовый дайджест</b>
          <p class="nt">Версия <b>${esc(s.current || info.version)}</b> · настольная программа для Windows</p>
          <p class="ab-author">Создатель — <b>${AUTHOR}</b>${s.owner ? ` · <button class="cn-link" type="button" data-url="https://github.com/${esc(s.owner)}">${GH}<span>github.com/${esc(s.owner)}</span></button>` : ''}</p></div>
      </div>
      <p class="nt">Личный финансовый отчёт по данным Zenmoney, почты и чеков: баланс и цели, доходы и расходы, имущество, капитал, ЖКХ и продукты,
        выводы ИИ и голосовой помощник. Данные и ключи хранятся только на этом компьютере (%APPDATA%\\FinDigest).</p>`;

    const repo = `<div class="cn-card"><b>Обновления программы — GitHub</b>
        <p class="nt">Каждая версия — релиз в репозитории GitHub с установщиком и архивом исходников. Программа проверяет релизы, скачивает
          установщик, сверяет контрольную сумму и ставит обновление поверх — папка, данные и ключи сохраняются.</p>
        <div class="cn-row"><label>Репозиторий (владелец/название)<input id="ab-repo" type="text" spellcheck="false" autocomplete="off" placeholder="например, vlad-nikolaev/fin-digest" value="${esc(s.owner ? s.owner + '/' + s.repo : '')}"></label>
          <button class="bn" type="button" id="ab-save">Сохранить</button></div>
        <div class="cn-row"><label>${s.hasToken ? 'Токен сохранён. Новый заменит его' : 'Токен GitHub — только для закрытого репозитория'}<input class="cn-key" id="ab-token" type="password" autocomplete="off" spellcheck="false" placeholder="${s.hasToken ? '•••• сохранён' : 'необязательно'}"></label>
          <button class="bn gh" type="button" id="ab-tsave">${s.hasToken ? 'Заменить' : 'Сохранить токен'}</button></div>
        <label class="cn-prim"><input type="checkbox" role="switch" id="ab-auto" ${s.auto !== false ? 'checked' : ''}>Проверять новые версии при запуске и раз в 12 часов</label>
        <label class="cn-prim"><input type="checkbox" role="switch" id="ab-pre" ${s.prerelease ? 'checked' : ''}>Предлагать предварительные версии (pre-release)</label>
        <div class="cn-row cn-foot"><button class="bn" type="button" id="ab-check" ${s.configured ? '' : 'disabled'}>Проверить обновления</button>
          ${s.latestPage ? `<button class="cn-link" type="button" data-url="${esc(s.latestPage)}">Последняя версия на GitHub →</button>` : ''}</div>
        <div class="ab-state" id="ab-state">${stateHtml(s, L)}</div>
        <div class="ab-prog" id="ab-prog" ${prog ? '' : 'hidden'}><i style="width:${prog ? Math.round(prog.got / Math.max(1, prog.total) * 100) : 0}%"></i></div>
        <p class="cn-msg" id="ab-msg" role="status"></p>
      </div>`;

    const list = (s.releases || []).length ? `<div class="cn-card"><b>Версии</b>
        <ul class="ab-list">${s.releases.slice(0, 12).map(r => `<li>
          <div class="ab-v"><b>${esc(r.version)}</b>${r.version === s.current ? '<span class="ab-chip">установлена</span>' : ''}${r === L ? '<span class="ab-chip new">последняя</span>' : ''}${r.prerelease ? '<span class="ab-chip">pre</span>' : ''}
            <small>${fmtDate(r.date)}${r.exe ? ' · ' + mb(r.exe.size) : ''}</small></div>
          <div class="ab-acts"><button class="cn-link" type="button" data-url="${esc(r.url)}">Релиз</button>
            ${r.src && r.src.url ? `<button class="cn-link" type="button" data-url="${esc(r.src.url)}">Исходники</button>` : ''}
            ${r.exe && r.version !== s.current ? `<button class="bn gh" type="button" data-inst="${esc(r.version)}">${r === L ? 'Установить' : 'Откатиться'}</button>` : ''}</div>
          ${r.notes ? `<details><summary>Что нового</summary><pre class="ab-notes">${esc(r.notes)}</pre></details>` : ''}</li>`).join('')}</ul></div>` : '';

    const how = `<details class="cn-card ab-how"><summary><b>Как выпускать версии</b></summary>
        <ol class="nt">
          <li>Создайте репозиторий на GitHub (можно закрытый) и укажите его выше.</li>
          <li>Получите токен: GitHub → Settings → Developer settings → Fine-grained tokens, доступ к этому репозиторию, право <b>Contents: Read and write</b>.</li>
          <li>В папке исходников: <code>set GH_TOKEN=…</code>, затем <code>npm run release -- --repo владелец/название</code>.</li>
        </ol>
        <p class="nt">Скрипт соберёт установщик и создаст релиз v<i>версия</i> из package.json: установщик, latest.yml (контрольная сумма) и архив
          исходников. Все версии сохраняются в разделе Releases, ссылка …/releases/latest всегда ведёт на последнюю.
          Для программы токен нужен только с правом чтения и только для закрытого репозитория.</p></details>`;

    sec.innerHTML = head + repo + list + how;
  }

  function stateHtml(s, L) {
    if (!s.configured) return '<p class="nt">Укажите репозиторий, где выпускаются версии, — и программа будет обновляться сама.</p>';
    if (!s.checkedAt) return '<p class="nt">Ещё не проверяли. Нажмите «Проверить обновления».</p>';
    if (!L) return '<p class="nt">В репозитории пока нет выпусков. Первый — командой <code>npm run release</code>.</p>';
    if (s.newer) return `<div class="ab-new"><span>Доступна версия <b>${esc(L.version)}</b> от ${fmtDate(L.date)}${L.exe ? ' · ' + mb(L.exe.size) : ''}</span>
        ${L.exe ? `<button class="bn" type="button" data-inst="${esc(L.version)}">Скачать и установить</button>` : '<span class="nt">в релизе нет установщика</span>'}</div>`;
    return `<p class="ab-ok">Установлена последняя версия (${esc(s.current)}). Проверено ${new Date(s.checkedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</p>`;
  }

  async function check() {
    msg('Проверяю GitHub…');
    try { st = await N.updates.check(); render(); msg(st.newer ? '' : (st.latest ? 'Новых версий нет.' : ''), 'ok'); }
    catch (e) { msg('Не удалось проверить: ' + e.message, 'err'); }
  }
  async function install(v) {
    const ok = window.FD_PAGE && window.FD_PAGE.askConfirm
      ? await window.FD_PAGE.askConfirm(`Установить версию ${v}? Программа закроется, обновление установится поверх и она откроется снова. Данные и ключи сохранятся.`, 'Установить')
      : true;
    if (!ok) return;
    prog = { got: 0, total: 1 }; render(); msg(`Скачиваю версию ${v}…`);
    try {
      const r = await N.updates.install(v);
      msg(r.started ? 'Установщик запущен — программа сейчас закроется и откроется уже обновлённой.' : 'Установщик скачан: ' + r.file, 'ok');
    } catch (e) { prog = null; render(); msg('Обновление не удалось: ' + e.message, 'err'); }
  }

  sec.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.url) return open(b.dataset.url);
    if (b.dataset.inst) return install(b.dataset.inst);
    if (b.id === 'ab-check') return check();
    if (b.id === 'ab-save') {
      const v = $('ab-repo').value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
      if (v && !/^[\w.-]+\/[\w.-]+$/.test(v)) return msg('Формат: владелец/название, например vlad-nikolaev/fin-digest', 'err');
      const [owner = '', repo = ''] = v.split('/');
      st = await N.updates.set({ owner, repo }); render();
      if (st.configured) check(); else msg('Репозиторий убран — обновления не проверяются.', 'ok');
      return;
    }
    if (b.id === 'ab-tsave') {
      const v = $('ab-token').value.trim();
      await N.conn.setSecret('github_token', v);
      st = await N.updates.set({}); render(); msg(v ? 'Токен сохранён в secrets.json (зашифрован).' : 'Токен удалён.', 'ok');
    }
  });
  sec.addEventListener('change', async e => {
    if (e.target.id === 'ab-auto') { st = await N.updates.set({ auto: e.target.checked }); }
    if (e.target.id === 'ab-pre') { st = await N.updates.set({ prerelease: e.target.checked }); if (st.configured) check(); }
  });

  N.updates.onProgress(p => {
    prog = p; const bar = $('ab-prog');
    if (bar) { bar.hidden = false; bar.firstElementChild.style.width = Math.round(p.got / Math.max(1, p.total) * 100) + '%'; }
    msg(`Скачиваю ${p.version}: ${mb(p.got)} из ${mb(p.total)}`);
  });
  N.updates.onAvailable(u => {
    if (window.FD_toast) window.FD_toast(`Доступна новая версия ${u.version} (у вас ${u.current})`, { sticky: true, action: { label: 'Обновить', run: () => { if (window.FD_openConnections) window.FD_openConnections('about'); install(u.version); } } });
  });

  // при открытии вкладки — свежие данные
  tb.addEventListener('click', async () => { st = await N.updates.status(); render(); if (st.configured && !st.checkedAt) check(); });
  window.FD_openAbout = () => { if (window.FD_openConnections) window.FD_openConnections('about'); tb.click(); };

  (async () => {
    try { info = await N.app.info(); } catch (_) { /* нет данных о версии */ }
    try { st = await N.updates.status(); } catch (_) { st = {}; }
    render();
  })();
})();
